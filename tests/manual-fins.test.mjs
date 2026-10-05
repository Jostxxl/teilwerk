import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'manifold-3d';
import {fromSolid,ground,bounds,toSolid,binarySTL} from '../src/engine.mjs';
import {printGeometry} from '../src/supports.mjs';
import {SWAY} from '../src/vendor/support-fins/sway.js';
import {printStability} from '../src/print-stability.mjs';
import {addManualFin,removeManualFin,rebuildManualFins,restoreManualFins} from '../src/manual-fins.mjs';
const api=await Module();api.setup();
function box(size=[20,30,100]){const solid=api.Manifold.cube(size);try{return {...ground(fromSolid(solid)),id:'7',color:'#ab4567',mark:{text:'7',point:[0,0,100],normal:[0,0,1],size:6,depth:.4},interiorRegion:{vertices:new Float32Array([0,0,100,1,0,100,0,1,100]),triangles:new Uint32Array([0,1,2])}};}finally{solid.delete();}}
const spec={point:[10,0,50],normal:[1,0,0]},bed=[100,100,150];
test('a manually clicked PrintFins brace is one native connected body with bed and tooth contact',()=>{
 const part=box(),before=structuredClone(part),oldSettings={...SWAY},supports=addManualFin(api,part,bed,spec);assert.deepEqual(part,before);assert.deepEqual(SWAY,oldSettings);assert.equal(supports.kind,'manual');assert.equal(supports.count,1);assert.equal(supports.fins[0].spec.width,4);assert.ok(supports.fins[0].tines>=3);assert.ok(supports.fins[0].bedArea>1);assert.ok(supports.fins[0].modelContactVolume>0);assert.ok(supports.fins[0].minimumBiteFraction>=.999);
 const fin=toSolid(api,supports),model=toSolid(api,part),components=fin.decompose(),contact=fin.intersect(model),combined=fin.add(model),joined=combined.decompose();try{assert.equal(fin.status(),'NoError');assert.equal(components.length,1);assert.ok(components[0].volume()>0);assert.equal(joined.filter(c=>c.volume()>0).length,1);assert.ok(contact.volume()>0);assert.ok(bounds(supports).min[2]>=0);assert.ok(bounds(fromSolid(contact)).min[2]>.6);}finally{[...joined,...components,fin,model,contact,combined].forEach(s=>s.delete());}
 const printed=printGeometry({...part,supports});assert.ok(printed.triangles.length>part.triangles.length);assert.equal(new DataView(binarySTL(printed).buffer).getUint32(80,true),printed.triangles.length/3);
});
test('separate manual fins preserve IDs, remove idempotently and retain the original mesh',()=>{
 const part=box(),first=addManualFin(api,part,bed,spec),snapshot=structuredClone(first),second=addManualFin(api,{...part,supports:first},bed,{...spec,point:[10,10,50]});assert.deepEqual(first,snapshot);assert.deepEqual(second.fins.map(f=>f.id),['m1','m2']);
 const removed=removeManualFin(second,'m1');assert.equal(removed.count,1);assert.equal(removed.fins[0].id,'m2');assert.equal(removeManualFin(removed,'missing'),removed);assert.equal(removeManualFin(removed,'m2'),undefined);assert.equal(removeManualFin(undefined,'m1'),undefined);
 const solid=toSolid(api,removed);try{assert.equal(solid.status(),'NoError');assert.ok(solid.volume()>0);}finally{solid.delete();}
});
test('saved geometry is ignored and manual specifications are freshly rebuilt, with export disabled retained',()=>{
 const part=box(),supports=addManualFin(api,part,bed,spec),saved=JSON.parse(JSON.stringify({...supports,enabled:false,vertices:[NaN],triangles:[999]})),rebuilt=rebuildManualFins(api,part,bed,saved);assert.equal(rebuilt.enabled,false);assert.equal(rebuilt.fins[0].id,'m1');assert.deepEqual(rebuilt.fins[0].spec,supports.fins[0].spec);assert.deepEqual(rebuilt.vertices,supports.vertices);assert.equal(restoreManualFins,rebuildManualFins);assert.equal(printGeometry({...part,supports:rebuilt}).vertices,part.vertices);
});
test('native collision checks reject too-close braces and all failures leave the part unchanged',()=>{
 const part=box(),supports=addManualFin(api,part,bed,spec),withFin={...part,supports},before=structuredClone(withFin);assert.throws(()=>addManualFin(api,withFin,bed,{...spec,point:[10,3.5,50]}),/Abstand/);assert.deepEqual(withFin,before);
 assert.throws(()=>addManualFin(api,part,[30,100,150],spec),/Bauraum/);assert.throws(()=>addManualFin(api,part,bed,{...spec,point:[0,0,50]}),/Außenseite/);assert.throws(()=>addManualFin(api,part,bed,{...spec,normal:[-1,0,0]}),/Außenseite/);assert.throws(()=>addManualFin(api,part,bed,{point:[0,0,100],normal:[0,0,1]}),/aufrechte/);assert.throws(()=>addManualFin(api,part,bed,{...spec,width:1}),/Finnenmaße/);
});
test('thin opposite walls cannot be pierced by contact tines',()=>{
 const part=box([.25,30,100]);assert.throws(()=>addManualFin(api,part,bed,{point:[.125,0,50],normal:[1,0,0]}),{code:'MANUAL_SWAY_CONTACT_UNRESOLVED'});
});
test('a tooth may not bridge a thin outer skin and a second wall even when its tip is inside',()=>{
 const source=toSolid(api,box()),slot=api.Manifold.cube([.05,4,98]),shift=slot.translate([9.91,-2,1]),hollow=source.subtract(shift);try{const part=fromSolid(hollow);assert.throws(()=>addManualFin(api,part,bed,spec),/mehrere Wandflächen|Hohlraum/);}finally{[source,slot,shift,hollow].forEach(s=>s.delete());}
});
test('combined stability includes every manual fin and is invalidated when one is removed',()=>{
 const part=box(),first=addManualFin(api,part,bed,spec),supports=addManualFin(api,{...part,supports:first},bed,{point:[-10,0,50],normal:[-1,0,0]}),model=toSolid(api,part),fins=toSolid(api,supports),combined=model.add(fins);try{const measured=printStability(fromSolid(combined));assert.deepEqual(supports.printStability,measured);assert.ok(supports.printStability.contact.area>printStability(part).contact.area);assert.equal(part.printStability,undefined);assert.equal(removeManualFin(supports,'m2').printStability,undefined);}finally{[combined,fins,model].forEach(s=>s.delete());}
});
test('a failed restoration never installs a successfully rebuilt prefix',()=>{
 const part=box(),supports=addManualFin(api,part,bed,spec),before=structuredClone(part),saved={...supports,fins:[...supports.fins,{id:'m2',spec:{...spec,point:[10,.1,50]}}]};assert.throws(()=>rebuildManualFins(api,part,bed,saved),/Abstand/);assert.deepEqual(part,before);assert.equal(saved.fins.length,2);
});
test('ordinary native failure releases temporary handles and leaves the part untouched',()=>{
 const part=box(),before=structuredClone(part);let deleted=0,created=0;const native=api.Manifold;
 const wrapped=new Proxy(native,{construct(target,args){created++;const solid=Reflect.construct(target,args),dispose=solid.delete.bind(solid);solid.delete=()=>{deleted++;dispose();};return solid;},get(target,key,receiver){if(key==='union')return()=>{throw Error('controlled ordinary native failure');};return Reflect.get(target,key,receiver);}});
 assert.throws(()=>addManualFin({...api,Manifold:wrapped},part,bed,spec),/controlled ordinary/);assert.equal(deleted,created);assert.ok(created>2);assert.deepEqual(part,before);
});
test('fatal native failure makes no further native calls, including deletion',()=>{
 const part=box(),before=structuredClone(part),native=api.Manifold;let poisoned=false,callsAfter=0;const created=[];
 const wrapped=new Proxy(native,{construct(target,args){const solid=Reflect.construct(target,args);created.push(solid);for(const method of ['delete','status','volume','decompose']){const call=solid[method].bind(solid);solid[method]=(...args)=>{if(poisoned)callsAfter++;return call(...args);};}return solid;},get(target,key,receiver){if(key==='union')return()=>{poisoned=true;throw new WebAssembly.RuntimeError('controlled poisoned kernel');};return Reflect.get(target,key,receiver);}});
 assert.throws(()=>addManualFin({...api,Manifold:wrapped},part,bed,spec),WebAssembly.RuntimeError);assert.equal(callsAfter,0);assert.deepEqual(part,before);poisoned=false;created.forEach(s=>s.delete());
});
test('material changes do not leak vendor settings and a controlled small angle is validated',()=>{
 const part=box(),before={...SWAY},pla=addManualFin(api,part,bed,spec),petg=addManualFin(api,part,bed,{...spec,material:'petg'}),again=addManualFin(api,part,bed,spec);assert.deepEqual(SWAY,before);assert.deepEqual(again.vertices,pla.vertices);assert.ok(petg.fins[0].modelContactVolume<pla.fins[0].modelContactVolume);
 const turned=addManualFin(api,part,bed,{...spec,angle:5});assert.equal(turned.fins[0].spec.angle,5);assert.ok(turned.fins[0].modelContactVolume>0);assert.notDeepEqual(turned.vertices,pla.vertices);assert.throws(()=>addManualFin(api,part,bed,{...spec,angle:90}),/Rippe oder Fuß|Kontaktzähne/);
});
