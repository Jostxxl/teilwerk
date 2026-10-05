import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'manifold-3d';
import {fromSolid,toSolid,binarySTL} from '../src/engine.mjs';
import {preparePrintMesh} from '../src/print-mesh.mjs';
import {STLLoader} from 'three/addons/loaders/STLLoader.js';
const api=await Module();api.setup();
const rawGeometry=g=>({vertices:new Float32Array(g.attributes.position.array),triangles:g.index?new Uint32Array(g.index.array):Uint32Array.from({length:g.attributes.position.count},(_,i)=>i)});
function box(size,offset){const cube=api.Manifold.cube(size),moved=cube.translate(offset);try{return fromSolid(moved);}finally{cube.delete();moved.delete();}}
const source=()=>({...box([10,10,40],[-5,-5,0]),id:'17',color:'#65a9e8',mark:{text:'17',depth:.4},supports:{...box([15,1,25],[4,-.5,0]),kind:'manual',enabled:true,count:1}});
test('export physically unions supports while preserving the editable engraved body',()=>{
 const part=source(),before=structuredClone(part),result=preparePrintMesh(api,part,[100,100,100]);
 assert.equal(result.supports,undefined);assert.equal(result.id,'17');assert.equal(result.mark.text,'17');assert.equal(result.printPreparation.method,'native-union');assert.equal(result.printPreparation.bodyVolume,4000);assert.equal(result.printPreparation.printVolume,4350);assert.deepEqual(part,before);
 const buffer=binarySTL(result),geometry=new STLLoader().parse(buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength)),mesh=rawGeometry(geometry);geometry.dispose();const imported=toSolid(api,mesh),components=imported.decompose();try{assert.equal(imported.status(),'NoError');assert.equal(components.length,1);assert.equal(imported.volume(),4350);}finally{components.forEach(s=>s.delete());imported.delete();}
});
test('disabled fins and parts without supports preserve exact geometry buffers',()=>{const part=source();part.supports.enabled=false;assert.strictEqual(preparePrintMesh(api,part,[100,100,100]),part);delete part.supports;assert.strictEqual(preparePrintMesh(api,part,[100,100,100]),part);});
test('an unattached extra shell cannot be hidden by one correctly connected fin',()=>{
 const part=source(),a=toSolid(api,part.supports),b=toSolid(api,box([2,2,2],[30,30,0])),both=a.add(b);try{part.supports={...part.supports,...fromSolid(both)};assert.throws(()=>preparePrintMesh(api,part,[100,100,100]),/zusammenhängenden/);}finally{a.delete();b.delete();both.delete();}
});
test('export refuses detached supports and support geometry outside the configured bed',()=>{const part=source();part.supports={...part.supports,...box([3,3,20],[20,20,0])};assert.throws(()=>preparePrintMesh(api,part,[100,100,100]),/Materialkontakt/);assert.throws(()=>preparePrintMesh(api,source(),[20,20,50]),/Druckplatte/);});
test('negative cavity shells of a body remain genuine cavities in the combined print body',()=>{
 const outer=toSolid(api,box([10,10,40],[-5,-5,0])),inner=toSolid(api,box([6,6,30],[-3,-3,5])),hollow=outer.subtract(inner);try{const result=preparePrintMesh(api,{...source(),...fromSolid(hollow)},[100,100,100]),solid=toSolid(api,result);try{assert.equal(solid.volume(),3270);}finally{solid.delete();}}finally{outer.delete();inner.delete();hollow.delete();}
});

function tracked(method,isFatal){
 const live=new Set(),raw=new WeakMap(),state={poisoned:false,afterFatal:0};
 const unwrap=x=>Array.isArray(x)?x.map(unwrap):raw.get(x)||x;
 const wrap=value=>{
  if(Array.isArray(value))return value.map(wrap);
  if(!value||typeof value.delete!=='function'||typeof value.status!=='function')return value;
  let proxy;proxy=new Proxy(value,{get(target,key){if(typeof target[key]!=='function')return target[key];return(...args)=>{
   if(state.poisoned)state.afterFatal++;
   assert.ok(live.has(proxy),'only live native handles are called');
   if(key==='delete'){target.delete();live.delete(proxy);return;}
   if(key===method){if(isFatal){state.poisoned=true;throw new WebAssembly.RuntimeError('injected native failure');}throw Error('injected ordinary failure');}
   return wrap(target[key](...args.map(unwrap)));
  };}});raw.set(proxy,value);live.add(proxy);return proxy;
 };
 function Manifold(mesh){return wrap(new api.Manifold(mesh));}
 Manifold.union=solids=>wrap(api.Manifold.union(unwrap(solids)));
 return {api:{Mesh:api.Mesh,Manifold},live,state};
}
for(const method of ['intersect','add','getMesh'])test(`export stops all native calls after fatal ${method} failure`,()=>{
 const handles=tracked(method,true);
 try{assert.throws(()=>preparePrintMesh(handles.api,source(),[100,100,100]),/injected native failure/);assert.equal(handles.state.afterFatal,0);}
 finally{handles.state.poisoned=false;for(const solid of [...handles.live])solid.delete();}
});
test('ordinary export failure releases every owned temporary body',()=>{
 const handles=tracked('add',false);assert.throws(()=>preparePrintMesh(handles.api,source(),[100,100,100]),/injected ordinary failure/);assert.equal(handles.live.size,0);
});
