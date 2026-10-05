import test from 'node:test';
import assert from 'node:assert/strict';
import {sha256} from '@noble/hashes/sha2.js';
import Module from 'manifold-3d';
import {serializeProjectDocument,parseProjectDocument,PROJECT_FILE_LIMIT} from '../src/project-codec.mjs';
import {restoreInteriorSelection,restoreMarkLocation} from '../src/mark-locations.mjs';
import {fromSolid} from '../src/engine.mjs';
import {bindNativeGeometry,restoreBoundNative} from '../src/native-geometry-binding.mjs';

const rejection=e=>e?.code==='PROJECT_CODEC_REJECTED';
const digest=bytes=>Buffer.from(sha256(bytes)).toString('hex');
const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
function fixture(){
 const vertices=new Float32Array([0,0,0,10,0,0,0,10,0]),triangles=new Uint32Array([0,1,2]);
 const mask={vertices:new Float64Array([.123456789012345,0,0,10.123456789012345,0,0,.123456789012345,10,0]),triangles:new Uint32Array([0,1,2])};
 return {format:'teilwerk',version:1,palette:['#ff9900'],automaticMarks:{size:8,depth:.4,fitSize:true},parts:[{id:'1',vertices,triangles,interiorRegion:mask,interiorBaseRegion:mask,assemblyMatrix:new Float64Array(identity),plannedMark:{point:new Float64Array([1,2,0]),normal:new Float32Array([0,0,1]),text:'1',size:6,depth:.4,autoId:true},cutPlanes:[{normal:new Float64Array([0,0,1]),offset:0}]}]};
}
const rawPacked=p=>JSON.parse(serializeProjectDocument(p,{mode:'packed'}).contents);
function block(type,values){
 const size=type==='f64'?8:4,bytes=Buffer.alloc(size*values.length);
 values.forEach((x,i)=>type==='f64'?bytes.writeDoubleLE(x,i*size):type==='f32'?bytes.writeFloatLE(x,i*size):bytes.writeUInt32LE(x,i*size));
 return {type,length:values.length,sha256:digest(bytes),data:bytes.toString('base64')};
}
function packedDocument(buffers,document={format:'teilwerk',version:1,parts:[{vertices:{$buffer:0},triangles:[0,1,2]}]}){
 return {format:'teilwerk',version:2,encoding:'binary-arrays-le-v1',document,buffers,texts:[]};
}
const decode=p=>parseProjectDocument(JSON.stringify(p));

test('small auto projects retain V1 and all metadata vectors stay ordinary arrays',()=>{
 const p=fixture(),saved=serializeProjectDocument(p),restored=parseProjectDocument(saved.contents);
 assert.equal(saved.packed,false);assert.equal(JSON.parse(saved.contents).version,1);
 assert.equal(saved.fileBytes,Buffer.byteLength(saved.contents));assert.equal(PROJECT_FILE_LIMIT,200*1024*1024);
 assert.deepEqual(restored,JSON.parse(JSON.stringify(p,(_,v)=>ArrayBuffer.isView(v)?Array.from(v):v)));
 assert.doesNotThrow(()=>restoreMarkLocation(restored.parts[0].plannedMark));
});

test('packed F32 display and F64 interior masks round-trip every value exactly',()=>{
 const p=fixture(),saved=serializeProjectDocument(p,{mode:'packed'}),restored=parseProjectDocument(saved.contents),a=restored.parts[0],b=p.parts[0];
 assert.equal(saved.packed,true);assert.ok(a.vertices instanceof Float32Array);assert.ok(a.triangles instanceof Uint32Array);assert.ok(a.interiorRegion.vertices instanceof Float64Array);
 for(const [x,y] of [[a.vertices,b.vertices],[a.triangles,b.triangles],[a.interiorRegion.vertices,b.interiorRegion.vertices],[a.interiorRegion.triangles,b.interiorRegion.triangles]])assert.deepEqual(x,y);
 assert.notEqual(a.interiorRegion.vertices[0],Math.fround(a.interiorRegion.vertices[0]));
 const restoredSelection=restoreInteriorSelection(a,a);assert.deepEqual(restoredSelection.interiorRegion,b.interiorRegion);
 assert.deepEqual(a.assemblyMatrix,identity);assert.ok(Array.isArray(a.assemblyMatrix));assert.ok(Array.isArray(a.plannedMark.point));assert.ok(Array.isArray(a.plannedMark.normal));assert.ok(Array.isArray(a.cutPlanes[0].normal));
 assert.doesNotThrow(()=>restoreMarkLocation(a.plannedMark));
});

test('ordinary vertex arrays select F64 whenever a value cannot be represented in F32',()=>{
 const p=fixture();p.parts[0].vertices=[.1,0,0,10,0,0,0,10,0];const restored=parseProjectDocument(serializeProjectDocument(p,{mode:'packed'}).contents);
 assert.ok(restored.parts[0].vertices instanceof Float64Array);assert.equal(restored.parts[0].vertices[0],.1);
});

test('packing identical masks and unbored baselines shares exact blocks without losing fields',()=>{
 const p=fixture();p.connectorBaseParts=structuredClone(p.parts);p.connectorPlan={connections:[{parent:'1',child:'2',proof:{verified:true}}]};const before=structuredClone(p),saved=serializeProjectDocument(p,{mode:'packed'}),restored=parseProjectDocument(saved.contents);
 assert.ok(saved.sharedReferences>=7);assert.ok(saved.referencedBytes>saved.decodedBytes);
 assert.deepEqual(restored.parts[0].vertices,restored.connectorBaseParts[0].vertices);assert.deepEqual(restored.parts[0].interiorRegion.vertices,before.parts[0].interiorRegion.vertices);
 assert.deepEqual(restored.connectorPlan,p.connectorPlan);assert.equal(restored.verified,undefined);assert.deepEqual(p,before);
});

test('same binary bytes with different numeric types are never conflated',()=>{
 const p={format:'teilwerk',version:1,parts:[{vertices:new Float32Array([0,0,0]),triangles:new Uint32Array([0,0,0])}]},saved=serializeProjectDocument(p,{mode:'packed'}),r=parseProjectDocument(saved.contents);
 assert.equal(saved.buffers,2);assert.ok(r.parts[0].vertices instanceof Float32Array);assert.ok(r.parts[0].triangles instanceof Uint32Array);
});

test('long native payload strings are shared exactly, including surrogate pairs and literal escapes',()=>{
 const p=fixture(),payload=('A\\n\u{1f3e0}\n').repeat(1500);p.parts[0].nativeGeometry={payload,snapshotHash:'not-an-authority'};p.connectorBaseParts=[{...p.parts[0],nativeGeometry:{payload}}];const saved=serializeProjectDocument(p,{mode:'packed'}),r=parseProjectDocument(saved.contents);
 assert.equal(saved.texts,1);assert.equal(r.parts[0].nativeGeometry.payload,payload);assert.equal(r.connectorBaseParts[0].nativeGeometry.payload,payload);
});

test('auto switches to packed format for large numeric geometry or long payloads',()=>{
 const p=fixture();p.parts[0].vertices=new Float32Array(200001);assert.equal(serializeProjectDocument(p).packed,true);
 p.parts[0].vertices=new Float32Array(9);p.parts[0].nativeGeometry={payload:'A'.repeat(2*1024*1024+1)};assert.equal(serializeProjectDocument(p).packed,true);
});

test('native binding survives packed storage and still requires its independent native validation',async()=>{
 const api=await Module();api.setup();const cube=api.Manifold.cube([10,12,14]),solid=cube.translate([.123456789012,.234567890123,.345678901234]);cube.delete();let restored;
 try{const part={...fromSolid(solid),id:'1',assemblyMatrix:identity};part.nativeGeometry=bindNativeGeometry(api,solid,part);const p={format:'teilwerk',version:1,parts:[part]},r=parseProjectDocument(serializeProjectDocument(p,{mode:'packed'}).contents);restored=restoreBoundNative(api,r.parts[0]);assert.equal(restored.solid.status(),'NoError');assert.equal(restored.solid.volume(),solid.volume());assert.deepEqual(restored.solid.boundingBox(),solid.boundingBox());assert.equal(restored.validation.savedProofsUsed,false);}
 finally{restored?.dispose();solid.delete();}
});

test('invalid geometry numbers are rejected before either legacy or packed saving',()=>{
 for(const mode of ['auto','legacy','packed'])for(const [key,value] of [['vertices',NaN],['vertices',Infinity],['triangles',-.1],['triangles',1.5],['triangles',4294967296]]){
  const p=fixture();p.parts[0][key]=Array.from(p.parts[0][key]);p.parts[0][key][0]=value;assert.throws(()=>serializeProjectDocument(p,{mode}),rejection,`${mode}: ${key}=${value}`);
 }
});

test('corrupt binary data is rejected even when its encoded length still matches',()=>{
 const p=rawPacked(fixture()),bytes=Buffer.from(p.buffers[0].data,'base64');bytes[0]^=1;p.buffers[0].data=bytes.toString('base64');assert.throws(()=>decode(p),rejection);
});

test('rehashed nonfinite floating geometry is rejected instead of trusting its digest',()=>{
 for(const type of ['f32','f64'])for(const x of [NaN,Infinity,-Infinity])assert.throws(()=>decode(packedDocument([block(type,[x,0,0])])),rejection);
});

test('unknown element types, malformed hashes and inconsistent lengths are rejected',()=>{
 for(const change of [b=>b.type='i64',b=>b.type='F32',b=>b.length=-1,b=>b.length=.5,b=>b.length=Number.MAX_SAFE_INTEGER+1,b=>b.length++,b=>b.sha256='0'.repeat(63),b=>b.sha256=b.sha256.toUpperCase()]){
  const p=rawPacked(fixture());change(p.buffers[0]);assert.throws(()=>decode(p),rejection);
 }
});

test('invalid base64 characters, padding and truncation are rejected without recursive regex failure',()=>{
 for(const change of [s=>'!'+s.slice(1),s=>'='+s.slice(1),s=>s.slice(0,-1),s=>s.slice(0,-2)+'=A',s=>s.slice(0,4)+' '+s.slice(5)]){
  const p=rawPacked(fixture());p.buffers[0].data=change(p.buffers[0].data);assert.throws(()=>decode(p),rejection);
 }
 const p=fixture();p.parts[0].vertices=new Float32Array(300000);assert.doesNotThrow(()=>parseProjectDocument(serializeProjectDocument(p,{mode:'packed'}).contents));
});

test('forged block dimensions are bounded before attempting any decode or allocation',()=>{
 const stub={type:'f32',length:128*1024*1024/4,sha256:'0'.repeat(64),data:''};
 assert.throws(()=>decode(packedDocument([{...stub,length:stub.length+1}])),rejection);
 assert.throws(()=>decode(packedDocument([stub,stub,{...stub,length:1}])),rejection);
 assert.throws(()=>decode(packedDocument([{...stub,length:Number.MAX_SAFE_INTEGER}])),rejection);
});

test('forged data references reject missing, negative, fractional and ambiguous indexes',()=>{
 for(const ref of [{$buffer:-1},{$buffer:.5},{$buffer:999},{$buffer:'0'},{$text:0},{$buffer:0,extra:true},{$buffer:0,$text:0}]){
  const p=rawPacked(fixture());p.document.parts[0].vertices=ref;assert.throws(()=>decode(p),rejection);
 }
});

test('aggregate reference expansion is bounded even when one small valid block is reused',()=>{
 const bytes=Buffer.alloc(1024*1024),b={type:'f32',length:bytes.length/4,sha256:digest(bytes),data:bytes.toString('base64')},document={format:'teilwerk',version:1,parts:[{copies:Array.from({length:513},()=>({$buffer:0}))}]};
 assert.throws(()=>decode(packedDocument([b],document)),rejection);
});

test('prototype-bearing objects and excessive packed document depth are rejected',()=>{
 for(const key of ['__proto__','constructor','prototype']){const p=rawPacked(fixture());p.document.parts[0]=JSON.parse(`{"${key}":{"polluted":true}}`);assert.throws(()=>decode(p),rejection);assert.equal({}.polluted,undefined);}
 const p=rawPacked(fixture());let node=p.document;for(let i=0;i<70;i++)node=node.child={};assert.throws(()=>decode(p),rejection);
 const input=fixture();node=input;for(let i=0;i<70;i++)node=node.child={};assert.throws(()=>serializeProjectDocument(input,{mode:'packed'}),rejection);
});

test('legacy inputs use the same structural and numeric bounds while mesh arrays count as leaves',()=>{
 const p=fixture();p.parts[0].vertices=new Float32Array(2000010);
 const saved=serializeProjectDocument(p,{mode:'legacy'}),restored=parseProjectDocument(saved.contents);
 assert.equal(restored.parts[0].vertices.length,2000010);
 const deep={format:'teilwerk',version:1,parts:[{}]};let node=deep;for(let i=0;i<70;i++)node=node.child={};
 assert.throws(()=>parseProjectDocument(JSON.stringify(deep)),rejection);
 for(const value of [null,-1,.5]){const invalid={format:'teilwerk',version:1,parts:[{vertices:[0,0,0],triangles:[value,0,0]}]};assert.throws(()=>parseProjectDocument(JSON.stringify(invalid)),rejection);}
});

test('the non-geometry structural node budget cannot be expanded through ordinary metadata arrays',()=>{
 const document={format:'teilwerk',version:1,parts:[{metadata:new Array(2000000).fill(null)}]};
 assert.throws(()=>parseProjectDocument(JSON.stringify(document)),rejection);
 assert.throws(()=>decode(packedDocument([],document)),rejection);
});

test('unknown containers and unsupported project versions do not become projects',()=>{
 for(const input of ['',null,'not json','[]','{}',JSON.stringify({format:'teilwerk',version:1,parts:[]}),JSON.stringify({format:'teilwerk',version:3,parts:[{}]})])assert.throws(()=>parseProjectDocument(input),rejection);
 const p=rawPacked(fixture());p.encoding='compressed';assert.throws(()=>decode(p),rejection);
 assert.throws(()=>serializeProjectDocument(fixture(),{mode:'unknown'}),rejection);
});
