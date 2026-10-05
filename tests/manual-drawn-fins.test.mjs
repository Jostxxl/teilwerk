import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import Module from 'manifold-3d';
import {Matrix4,Vector3} from 'three';
import {fromSolid,toSolid} from '../src/engine.mjs';
import {bindNativeGeometry,validateNativeBinding} from '../src/native-geometry-binding.mjs';
import {authoritativeNativeInPrintFrame,supportNativeScope} from '../src/native-print-body.mjs';
import {addManualDrawnFin,addManualFin,removeManualFin,rebuildManualFins} from '../src/manual-fins.mjs';
import {preparePrintMesh} from '../src/print-mesh.mjs';
import {markPart} from '../src/features.mjs';
import {PROP} from '../src/vendor/support-fins/prop.js';
const api=await Module();api.setup();const bed=[100,100,100];
function fixture({bound=false,thickness=20}={}){
 const source=api.Manifold.cube([20,20,thickness]),center=source.translate([-10,-10,0]),T=new Matrix4().makeTranslation(0,0,10*Math.sin(Math.PI/3)).multiply(new Matrix4().makeRotationY(Math.PI/3)),solid=center.transform(T.toArray());
 const part={...fromSolid(solid),id:'7',color:'#ffaa00',note:'Original erhalten'},a=new Vector3(-9,0,0).applyMatrix4(T).toArray(),b=new Vector3(5,0,0).applyMatrix4(T).toArray();
 if(bound){const A=new Matrix4().makeTranslation(512.125,27.75,10.125).multiply(new Matrix4().makeRotationZ(.17)),world=solid.transform(A.toArray());try{part.assemblyMatrix=A.toArray();part.nativeGeometry=bindNativeGeometry(api,world,part);}finally{world.delete();}}
 const nativeVolume=solid.volume();solid.delete();center.delete();source.delete();return{part,spec:{a,b},nativeVolume};
}
test('two-click wall uses untouched upstream, flat bed, real positive teeth and one body',()=>{
 assert.equal(crypto.createHash('sha256').update(fs.readFileSync(new URL('../src/vendor/support-fins/draw.js',import.meta.url))).digest('hex'),'82281f4c88f39d9b5391f0a51b8bba8fdc00919119649a64eea34482e764e8ad');
 const {part,spec}=fixture(),before=structuredClone(part),settings={...PROP},support=addManualDrawnFin(api,part,bed,spec),record=support.fins[0];
 assert.deepEqual(part,before);assert.deepEqual(PROP,settings);assert.equal(support.kind,'manual');assert.equal(record.spec.mode,'draw');assert.deepEqual(record.spec.a,spec.a);assert.deepEqual(record.spec.b,spec.b);assert.ok(record.bedArea>1);assert.ok(record.tines>=2);assert.ok(record.modelContactVolume>0);assert.equal(record.minimumBiteFraction,1);
 const fin=toSolid(api,support),body=toSolid(api,part),joined=body.add(fin),components=joined.decompose();try{assert.equal(fin.status(),'NoError');assert.equal(components.length,1);assert.ok(joined.volume()>body.volume());}finally{components.forEach(s=>s.delete());joined.delete();body.delete();fin.delete();}
 // This wall does not cure the fixture's tipping: expose fresh quality honestly.
 assert.equal(support.printStability.stableUnderGravity,false);
 assert.ok(support.warnings.some(s=>s.includes('kippsichere')));
});
test('native bound assembly is restored and transformed exactly, never reimported as display authority',()=>{
 const {part,spec}=fixture({bound:true}),before=structuredClone(part),source=validateNativeBinding(part),print=authoritativeNativeInPrintFrame(api,part);let volume;try{volume=print.solid.volume();assert.equal(print.nativeBound,true);assert.equal(print.solid.status(),'NoError');}finally{print.dispose();}
 const supports=addManualDrawnFin(api,part,bed,spec),out=preparePrintMesh(api,{...part,supports},bed);
 assert.equal(supports.fins[0].nativeSource,'bound-native');assert.equal(out.printPreparation.bodyVolume,volume);assert.ok(out.printPreparation.printVolume>volume);assert.deepEqual(validateNativeBinding(part).snapshot,source.snapshot);assert.deepEqual(part,before);assert.equal(out.nativeGeometry,undefined);
});
test('export keeps a genuine 0.4 mm engraved native body, including precision absent from Float32 display',()=>{
 const cube=api.Manifold.cube([20.0000001,30,100]),print=cube.translate([-10,-15,0]),A=new Matrix4().makeTranslation(512.123456789,27,13),world=print.transform(A.toArray());let p;
 try{p={...fromSolid(print),id:'7',assemblyMatrix:A.toArray()};p.nativeGeometry=bindNativeGeometry(api,world,p);}finally{world.delete();print.delete();cube.delete();}
 const mark={text:'7',point:[0,0,100],normal:[0,0,1],size:6,depth:.4,rotation:0,emboss:false};p={...p,...markPart(api,p,mark),mark};
 const snapshot=structuredClone(p),body=authoritativeNativeInPrintFrame(api,p),display=toSolid(api,p);let exactVolume;try{exactVolume=body.solid.volume();assert.notEqual(exactVolume,display.volume());assert.ok(exactVolume<60000);}finally{display.delete();body.dispose();}
 const supports=addManualFin(api,p,[100,100,150],{point:[10,0,50],normal:[1,0,0]}),out=preparePrintMesh(api,{...p,supports},[100,100,150]);
 assert.equal(out.printPreparation.bodyVolume,exactVolume);assert.equal(out.mark.depth,.4);assert.deepEqual(p,snapshot);assert.deepEqual(validateNativeBinding(p).snapshot,validateNativeBinding(snapshot).snapshot);
});
test('restore ignores saved mesh/proofs and rebuilds literal endpoints; remove retains other records',()=>{
 const {part,spec}=fixture(),one=addManualDrawnFin(api,part,bed,spec),second=addManualDrawnFin(api,{...part,supports:one},bed,{...spec,a:[spec.a[0],6,spec.a[2]],b:[spec.b[0],6,spec.b[2]]}),saved=JSON.parse(JSON.stringify({...second,enabled:false,vertices:[NaN],triangles:[999],printStability:{stableUnderGravity:true}})),restored=rebuildManualFins(api,part,bed,saved);
 assert.equal(restored.enabled,false);assert.deepEqual(restored.vertices,second.vertices);assert.deepEqual(restored.fins.map(r=>r.spec),second.fins.map(r=>r.spec));assert.equal(restored.printStability.stableUnderGravity,false);const removed=removeManualFin(restored,'m1');assert.equal(removed.count,1);assert.equal(removed.fins[0].id,'m2');assert.equal(removeManualFin(removed,'m2'),undefined);
});
test('source/space/spacing/no-tine/exact restrictions fail without partial changes',()=>{
 const {part,spec}=fixture(),supports=addManualDrawnFin(api,part,bed,spec),p={...part,supports},before=structuredClone(p);
 assert.throws(()=>addManualDrawnFin(api,p,bed,spec),/Abstand/);assert.throws(()=>addManualDrawnFin(api,part,[12,100,100],spec),/Bauraum/);assert.throws(()=>addManualDrawnFin(api,part,bed,{...spec,a:[spec.a[0],0,90]}),/Endpunkte/);assert.throws(()=>addManualDrawnFin(api,part,bed,{...spec,b:spec.a}),/7 und 300/);assert.throws(()=>addManualDrawnFin(api,part,bed,{...spec,tines:false}),/Kontaktzähne/);assert.throws(()=>addManualDrawnFin(api,{...part,exactGeometry:{}},bed,spec),/exakten Finnenpfad/);assert.throws(()=>preparePrintMesh(api,{...p,exactGeometry:{}},bed),/exakten Finnenexport/);assert.deepEqual(p,before);
});
test('thin wall uses connected trimmed contacts; invalid saved prefix stays atomic',()=>{
 const thin=fixture({thickness:.1}),thinBefore=structuredClone(thin.part),thinFin=addManualDrawnFin(api,thin.part,bed,thin.spec);assert.ok(thinFin.fins[0].modelContactVolume>0);assert.deepEqual(thin.part,thinBefore);
 const inverse=new Matrix4().makeTranslation(0,0,10*Math.sin(Math.PI/3)).multiply(new Matrix4().makeRotationY(Math.PI/3)).invert(),v=new Vector3();for(let i=0;i<thinFin.vertices.length;i+=3){v.fromArray(thinFin.vertices,i).applyMatrix4(inverse);assert.ok(v.z<=.10001,'The generated support stays behind the far model surface');}
 const {part,spec}=fixture(),s=addManualDrawnFin(api,part,bed,spec),before=structuredClone(part);assert.throws(()=>rebuildManualFins(api,part,bed,{...s,fins:[...s.fins,{id:'m2',spec:{...s.fins[0].spec,a:[spec.a[0],0,99]}}]}),/Endpunkte/);assert.deepEqual(part,before);
});
test('material/global settings are scoped and malformed or unknown specs fail',()=>{
 const {part,spec}=fixture(),saved={...PROP},outside=[];globalThis.__TINECAP=outside;try{const a=addManualDrawnFin(api,part,bed,spec);assert.deepEqual(PROP,saved);assert.equal(globalThis.__TINECAP,outside);assert.deepEqual(outside,[]);assert.throws(()=>addManualDrawnFin(api,part,bed,{...spec,version:8}),/version/i);const sparse=Array(3);assert.throws(()=>addManualDrawnFin(api,part,bed,{...spec,a:sparse}),/gültige/);assert.equal(a.count,1);}finally{delete globalThis.__TINECAP;}
});
test('over-the-part floor and stale native display cannot be accepted as a bed-attached wall',()=>{
 const {part,spec}=fixture(),T=new Matrix4().makeTranslation(0,0,10*Math.sin(Math.PI/3)).multiply(new Matrix4().makeRotationY(Math.PI/3));
 const top={a:new Vector3(-9,0,20).applyMatrix4(T).toArray(),b:new Vector3(5,0,20).applyMatrix4(T).toArray()};
 assert.throws(()=>addManualDrawnFin(api,part,bed,top),/Modell statt|schneiden|gezeichnet/);
 const native=fixture({bound:true});native.part.vertices[0]+=.5;assert.throws(()=>addManualDrawnFin(api,native.part,bed,native.spec),/stale|render|Bindung|hash|position/i);
 const s=addManualDrawnFin(api,part,bed,spec);assert.throws(()=>rebuildManualFins(api,part,bed,{...s,fins:[{id:'m1',spec:{...s.fins[0].spec,mode:'unknown'}}]}),/Finnenart/);
});
test('ordinary failure cleans temporaries; fatal union performs no cleanup after poison',()=>{
 const {part,spec}=fixture(),native=api.Manifold,created=[];let poisoned=false,after=0,deleted=0;
 const wrapped=new Proxy(native,{construct(target,args){const s=Reflect.construct(target,args);created.push(s);const del=s.delete.bind(s);s.delete=()=>{if(poisoned)after++;deleted++;del();};return s;},get(target,key,receiver){if(key==='union')return()=>{throw Error('ordinary controlled');};return Reflect.get(target,key,receiver);}});
 assert.throws(()=>addManualDrawnFin({...api,Manifold:wrapped},part,bed,spec),/ordinary controlled/);assert.equal(deleted,created.length);
 const live=[];const fatalWrapped=new Proxy(native,{construct(target,args){const s=Reflect.construct(target,args);live.push(s);const del=s.delete.bind(s);s.delete=()=>{if(poisoned)after++;del();};return s;},get(target,key,receiver){if(key==='union')return()=>{poisoned=true;throw new WebAssembly.RuntimeError('controlled fatal');};return Reflect.get(target,key,receiver);}});
 assert.throws(()=>addManualDrawnFin({...api,Manifold:fatalWrapped},part,bed,spec),WebAssembly.RuntimeError);assert.equal(after,0);poisoned=false;for(const s of live)s.delete();
});
test('scope consumes ordinary delete failures once, cleans all others, fatal stops immediately',()=>{
 const life=supportNativeScope(),log=[];for(const i of [1,2,3])life.keep({delete(){log.push(i);if(i===2)throw Error('ordinary delete');}});assert.throws(()=>life.dispose(),/ordinary delete/);assert.deepEqual(log,[3,2,1]);life.dispose();assert.deepEqual(log,[3,2,1]);
 const f=supportNativeScope(),calls=[];f.keep({delete(){calls.push(1);}});f.keep({delete(){calls.push(2);throw new WebAssembly.RuntimeError('delete');}});assert.throws(()=>f.dispose(),WebAssembly.RuntimeError);assert.deepEqual(calls,[2]);f.dispose();
});
