import test from 'node:test';import assert from 'node:assert/strict';import Module from 'manifold-3d';import {Matrix4,Vector3} from 'three';
import {drillDowelPair} from '../src/dowel-connectors.mjs';import {fromSolid,toSolid,transformData} from '../src/engine.mjs';
const api=await Module();api.setup();
function box(size=[30,20,8]){const raw=api.Manifold.cube(size),body=raw.translate([-size[0]/2,-size[1]/2,0]);try{return fromSolid(body);}finally{body.delete();raw.delete();}}
function fixture(){return {parent:{...box(),id:'1',assemblyMatrix:new Matrix4().makeTranslation(0,0,-8).toArray(),mark:{text:'1',point:[0,0,1],normal:[0,0,1]},interiorRegion:{vertices:new Float32Array([1,2,3]),triangles:new Uint32Array()}},child:{...box(),id:'2',assemblyMatrix:new Matrix4().toArray(),mark:{text:'2'}},placement:{id:'V1',normal:[0,0,1],positions:[[-6,1,0],[6,-2,0]]}};}
function bodies(part){const local=toSolid(api,part),world=local.transform(part.assemblyMatrix);local.delete();return world;}

test('two matched blind sockets preserve both source parts and yield separate fitting loose pins',()=>{
 const {parent,child,placement}=fixture(),before=structuredClone([parent,child]),result=drillDowelPair(api,parent,child,placement,{retainNative:true});
 try{assert.deepEqual([parent,child],before);assert.deepEqual(result.parts.map(p=>p.id),['1','2']);assert.equal(result.pins.length,2);assert.ok(result.pins.every(p=>p.auxiliary&&p.diameter===3&&p.length===5.8));assert.deepEqual(result.connection.validation.positiveComponents,[1,1]);assert.deepEqual(result.connection.validation.envelopeOutsideVolumes,[0,0,0,0]);assert.deepEqual(result.connection.validation.pinIntersections,[0,0,0,0]);assert.equal(result.connection.insertion.checked,false);assert.equal(result.connection.physicalFitTestRequired,true);
  for(let i=0;i<2;i++){const p=result.parts[i],original=[parent,child][i],native=toSolid(api,p),pieces=native.decompose();try{assert.equal(native.status(),'NoError');assert.equal(pieces.filter(s=>s.volume()>0).length,1);}finally{pieces.forEach(s=>s.delete());native.delete();}assert.deepEqual(p.assemblyMatrix,original.assemblyMatrix);assert.deepEqual(p.mark,original.mark);assert.deepEqual(p.interiorRegion,original.interiorRegion);assert.equal(p.connectorHoles[0].diameter,3.2);assert.equal(p.connectorHoles[0].depth,3);}
  const source=bodies(parent),extra=result.native.parent.subtract(source);try{assert.equal(extra.volume(),0);}finally{extra.delete();source.delete();}
 }finally{result.dispose();result.dispose();}
});

test('different local print poses leave shared assembly socket locations unchanged',()=>{
 const {parent,child,placement}=fixture(),pose=new Matrix4().makeRotationY(.71).multiply(new Matrix4().makeRotationX(.32)).setPosition(3,4,5),rotated={...child,...transformData(child,pose),assemblyMatrix:pose.clone().invert().toArray()},result=drillDowelPair(api,parent,rotated,placement,{retainNative:true});
 try{assert.deepEqual(result.connection.positions,placement.positions);for(let i=0;i<2;i++){const local=new Vector3(...result.parts[1].connectorHoles[0].positions[i]).applyMatrix4(new Matrix4().fromArray(result.parts[1].assemblyMatrix));assert.ok(local.distanceTo(new Vector3(...placement.positions[i]))<1e-8);}assert.ok(result.connection.validation.pinIntersections.every(v=>Math.abs(v)<1e-7));}finally{result.dispose();}
});

test('borrowed native bodies retain earlier sockets without mesh roundtrips or ownership transfer',()=>{
 const {parent,child,placement}=fixture(),first=drillDowelPair(api,parent,child,placement,{retainNative:true});let second;
 try{const volumes=[first.native.parent.volume(),first.native.child.volume()];second=drillDowelPair(api,first.parts[0],first.parts[1],{...placement,id:'V2',positions:[[-6,7,0],[6,7,0]]},{retainNative:true,nativeSources:[first.native.parent,first.native.child]});assert.deepEqual(second.connection.validation.sourceVolumes,volumes);assert.deepEqual([first.native.parent.volume(),first.native.child.volume()],volumes);assert.equal(second.parts[0].connectorHoles.length,2);assert.equal(second.parts[1].connectorHoles.length,2);assert.ok(second.native.parent.volume()<first.native.parent.volume());}finally{second?.dispose();first.dispose();}
});

test('wall reserve rejects thin walls and edge holes instead of reducing the pin silently',()=>{
 const {parent,child,placement}=fixture();const thin={...child,...box([30,20,3.5])};assert.throws(()=>drillDowelPair(api,parent,thin,placement),e=>e.reason==='insufficient_material');assert.throws(()=>drillDowelPair(api,parent,child,{...placement,positions:[[-13,1,0],[6,-2,0]]}),e=>e.reason==='insufficient_material');
});

test('an existing engraving recess inside the reserve prevents connector placement',()=>{
 const {parent,child,placement}=fixture(),source=toSolid(api,child),cut=api.Manifold.cube([2,2,3]).translate([-6,0,2]),engraved=source.subtract(cut);try{assert.throws(()=>drillDowelPair(api,parent,{...child,...fromSolid(engraved)},placement),e=>e.reason==='insufficient_material');}finally{engraved.delete();cut.delete();source.delete();}
});

test('microscopic entry-plane differences are bounded spatially and do not permit a wall breach',()=>{
 const {parent,child,placement}=fixture(),tiny={...child,assemblyMatrix:new Matrix4().makeTranslation(0,0,.00001).toArray()},result=drillDowelPair(api,parent,tiny,placement);
 assert.ok(result.connection.validation.envelopeOutsideVolumes[2]>0);assert.equal(result.connection.validation.entryPlaneTolerance,.0001);
 assert.throws(()=>drillDowelPair(api,parent,{...child,assemblyMatrix:new Matrix4().makeTranslation(0,0,.001).toArray()},placement),e=>e.reason==='insufficient_material');
});

test('invalid frames, measures and conflicting bore locations fail explicitly',()=>{
 const {parent,child,placement}=fixture();for(const options of [{pinDiameter:0},{socketDepth:NaN},{minWall:.5},{pinEndClearance:3},{diametralClearance:-.1}])assert.throws(()=>drillDowelPair(api,parent,child,placement,options),{code:'CONNECTOR_REJECTED'});
 for(const bad of [{...placement,positions:[[0,0,0],[1,0,0]]},{...placement,positions:[[0,0,0],[8,0,.1]]},{...placement,normal:[0,0,0]}])assert.throws(()=>drillDowelPair(api,parent,child,bad),{code:'CONNECTOR_REJECTED'});
 assert.throws(()=>drillDowelPair(api,parent,{...child,assemblyMatrix:new Matrix4().makeScale(2,1,1).toArray()},placement),e=>e.reason==='invalid_frame');
});

function faultApi(stage,{ordinary=false}={}){
 let poisoned=false;const raw=new WeakMap(),wrapped=new WeakMap(),live=new Set(),callsAfter=[],marker=new(ordinary?Error:WebAssembly.RuntimeError)(`fault ${stage}`);const unwrap=v=>Array.isArray(v)?v.map(unwrap):raw.get(v)||v;
 const check=key=>{if(poisoned){callsAfter.push(key);throw marker;}if(key===stage){poisoned=!ordinary;throw marker;}};
 function wrap(value){if(Array.isArray(value))return value.map(wrap);if(!value||typeof value.delete!=='function')return value;if(wrapped.has(value))return wrapped.get(value);const proxy=new Proxy(value,{get(target,key){const item=Reflect.get(target,key);if(typeof item!=='function')return item;return(...args)=>{check(String(key));const result=item.apply(target,args.map(unwrap));if(key==='delete')live.delete(target);return wrap(result);};}});raw.set(proxy,value);wrapped.set(value,proxy);live.add(value);return proxy;}
 const out=Object.create(api);Object.defineProperty(out,'Manifold',{value:new Proxy(api.Manifold,{construct(target,args){check('construct');return wrap(Reflect.construct(target,args.map(unwrap)));},get(target,key){const item=Reflect.get(target,key);if(typeof item!=='function')return item;return(...args)=>{check(String(key));return wrap(item.apply(target,args.map(unwrap)));};}})});return{api:out,marker,callsAfter,live,cleanup(){for(const item of live)item.delete();live.clear();}};
}

for(const stage of ['cylinder','subtract','decompose','getMesh','delete'])test(`fatal socket ${stage} performs no additional native calls`,()=>{
 const {parent,child,placement}=fixture(),fault=faultApi(stage),before=structuredClone([parent,child]);try{assert.throws(()=>drillDowelPair(fault.api,parent,child,placement),e=>e===fault.marker);assert.deepEqual(fault.callsAfter,[]);assert.deepEqual([parent,child],before);}finally{fault.cleanup();}
});

test('ordinary socket failure frees all native handles and keeps input unchanged',()=>{
 const {parent,child,placement}=fixture(),fault=faultApi('subtract',{ordinary:true}),before=structuredClone([parent,child]);try{assert.throws(()=>drillDowelPair(fault.api,parent,child,placement),e=>e===fault.marker);assert.equal(fault.live.size,0);assert.deepEqual([parent,child],before);}finally{fault.cleanup();}
});
