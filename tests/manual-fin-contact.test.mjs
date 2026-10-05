import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'manifold-3d';
import {Matrix4,Vector3} from 'three';
import {fromSolid,toSolid} from '../src/engine.mjs';
import {preparePrintMesh} from '../src/print-mesh.mjs';
import {classifyManualTip,manualToothGeometry} from '../src/manual-fin-contact.mjs';
import {addManualDrawnFin} from '../src/manual-drawn-fins.mjs';
import {rebuildManualFins} from '../src/manual-fins.mjs';
import {bindNativeGeometry,validateNativeBinding} from '../src/native-geometry-binding.mjs';
const api=await Module();api.setup();
export function slanted(degrees,rz=0,thickness=20){
 const c=api.Manifold.cube([30,24,thickness]),mid=c.translate([-15,-12,0]),angle=degrees*Math.PI/180,T=new Matrix4().makeTranslation(0,0,15*Math.sin(angle)).multiply(new Matrix4().makeRotationZ(rz)).multiply(new Matrix4().makeRotationY(angle)),solid=mid.transform(T.toArray());
 const p={...fromSolid(solid),id:'7',assemblyMatrix:new Matrix4().toArray()},spec={a:new Vector3(-11,0,0).applyMatrix4(T).toArray(),b:new Vector3(7,0,0).applyMatrix4(T).toArray()};
 p.nativeGeometry=bindNativeGeometry(api,solid,p);solid.delete();mid.delete();c.delete();return {p,spec};
}
test('numerical contact classification has both absolute/relative ceilings; signed and zero nonempty stays unresolved',()=>{
 const q=(v,t=.005)=>classifyManualTip({empty:false,outsideVolume:v,tipVolume:t});
 assert.equal(q(9.34e-15).accepted,true);assert.equal(q(1e-8).accepted,true);assert.equal(q(1.0001e-8).accepted,false);assert.equal(q(1e-8,.0001).accepted,false);
 for(const v of [0,-1e-15,NaN,Infinity]){assert.equal(q(v).accepted,false);assert.equal(q(v).reason,'unresolved_contact_residual');}
 assert.equal(q(.000125).accepted,false);assert.equal(q(.00423).accepted,false);
});
test('adaptive ramp preserves rear coordinates, bite footprint, width and never rises more than one layer',()=>{
 const c={x:13,y:-2,z:10.27,biteX:Math.cos(.3),biteY:Math.sin(.3)},opts={bite:.3,width:.5,overlap:.3,gap:.2,layerHeight:.2},a=manualToothGeometry(c,opts),b=manualToothGeometry(c,{...opts,lift:1});
 assert.equal(a.tooth.length,b.tooth.length);
 for(let i=0;i<a.tooth.length;i++){const p=a.tooth[i],q=b.tooth[i],u=(p[0]-c.x)*c.biteX+(p[1]-c.y)*c.biteY;assert.equal(q[0],p[0]);assert.equal(q[1],p[1]);assert.ok(q[2]-p[2]>=-1e-12&&q[2]-p[2]<=.2+1e-12);if(Math.abs(u+.3)<1e-12)assert.equal(q[2],p[2]);if(Math.abs(u-.3)<1e-12)assert.ok(Math.abs(q[2]-p[2]-.2)<1e-12);}
 assert.deepEqual(a.step,b.step);
});
test('thick tilted faces with layer-snap misses are repaired geometrically, not accepted by widened residual',()=>{
 for(const degrees of [25,30,40])for(const rz of [0,.19]){
  const {p,spec}=slanted(degrees,rz),before=structuredClone(p),s=addManualDrawnFin(api,p,[100,100,100],spec),r=s.fins[0];
  assert.ok(r.tines>=2);assert.ok(r.modelContactVolume>0);assert.ok(r.minimumBiteFraction>=.99999);
  for(const c of r.contactChecks)assert.ok(c.exact||c.outsideVolume<=Math.min(1e-8,c.tipVolume*1e-5));
  if(degrees!==30||rz!==0)assert.ok(r.liftedTines>0);assert.deepEqual(p,before);assert.deepEqual(validateNativeBinding(p).snapshot,validateNativeBinding(before).snapshot);
 }
});
test('adaptive teeth are regenerated from saved raw endpoints, not trusted saved mesh or checks',()=>{
 const {p,spec}=slanted(25,.19),s=addManualDrawnFin(api,p,[100,100,100],spec),saved={...s,vertices:[NaN],triangles:[-1],fins:s.fins.map(r=>({...r,contactChecks:[{exact:true}],liftedTines:0}))},rebuilt=rebuildManualFins(api,p,[100,100,100],saved);
 assert.deepEqual(rebuilt.vertices,s.vertices);assert.deepEqual(rebuilt.fins[0].contactChecks,s.fins[0].contactChecks);assert.equal(rebuilt.fins[0].liftedTines,s.fins[0].liftedTines);
});
test('manual contact trims generated teeth at thin far skins instead of rejecting useful surface grip',()=>{
 for(const thickness of [.05,.1]){
  const {p,spec}=slanted(25,.19,thickness),before=structuredClone(p),supports=addManualDrawnFin(api,p,[100,100,100],spec),record=supports.fins[0];
  assert.ok(record.surfaceAdjustedTines>0);assert.ok(record.trimmedSupportVolume>0);assert.ok(record.modelContactVolume>0);assert.deepEqual(p,before);
  const T=new Matrix4().makeTranslation(0,0,15*Math.sin(25*Math.PI/180)).multiply(new Matrix4().makeRotationZ(.19)).multiply(new Matrix4().makeRotationY(25*Math.PI/180)).invert(),v=new Vector3();
  for(let i=0;i<supports.vertices.length;i+=3){v.fromArray(supports.vertices,i).applyMatrix4(T);assert.ok(v.z<=thickness+1e-5,'No generated support passes the opposite model surface');}
  const mesh=preparePrintMesh(api,{...p,supports},[100,100,100]),solid=toSolid(api,mesh),pieces=solid.decompose();try{assert.equal(pieces.length,1);assert.ok(solid.volume()>0);}finally{pieces.forEach(s=>s.delete());solid.delete();}
 }
});

test('two point diagonal PLA/PETG lines retain native connected contact when a rectangular tip corner misses',()=>{
 for(const {degrees,heading,material} of [{degrees:40,heading:30,material:'pla'},{degrees:60,heading:30,material:'pla'},{degrees:40,heading:0,material:'petg'}]){
  const {p}=slanted(degrees,.19,2),T=new Matrix4().makeTranslation(0,0,15*Math.sin(degrees*Math.PI/180)).multiply(new Matrix4().makeRotationZ(.19)).multiply(new Matrix4().makeRotationY(degrees*Math.PI/180)),d=heading*Math.PI/180,spec={a:new Vector3(-10*Math.cos(d),-10*Math.sin(d),0).applyMatrix4(T).toArray(),b:new Vector3(6*Math.cos(d),6*Math.sin(d),0).applyMatrix4(T).toArray(),material},before=structuredClone(p);
  const support=addManualDrawnFin(api,p,[100,100,100],spec),r=support.fins[0];assert.ok(r.surfaceAdjustedTines>0);assert.ok(r.contactChecks.some(c=>c.reason==='native_connected_surface_contact'&&c.modelContactVolume>0));assert.ok(r.modelContactVolume>0);assert.deepEqual(p,before);
  const restored=rebuildManualFins(api,p,[100,100,100],support);assert.deepEqual(restored.vertices,support.vertices);assert.deepEqual(restored.fins[0].contactChecks,r.contactChecks);
 }
});

test('manually drawn shallow and contour-aligned lines get vertical contacts on the chosen wall',()=>{
 for(const [degrees,heading,material] of [[15,0,'pla'],[25,90,'pla'],[40,60,'petg'],[60,90,'petg']]){
  const {p}=slanted(degrees,.19,2),before=structuredClone(p),T=new Matrix4().makeTranslation(0,0,15*Math.sin(degrees*Math.PI/180)).multiply(new Matrix4().makeRotationZ(.19)).multiply(new Matrix4().makeRotationY(degrees*Math.PI/180)),d=heading*Math.PI/180,spec={a:new Vector3(-10*Math.cos(d),-10*Math.sin(d),0).applyMatrix4(T).toArray(),b:new Vector3(6*Math.cos(d),6*Math.sin(d),0).applyMatrix4(T).toArray(),material};
  const support=addManualDrawnFin(api,p,[100,100,100],spec),r=support.fins[0];assert.ok(r.verticalTines>=3);assert.ok(r.modelContactVolume>0);assert.deepEqual(r.spec.a,spec.a);assert.deepEqual(r.spec.b,spec.b);assert.deepEqual(p,before);
  const output=preparePrintMesh(api,{...p,supports:support},[100,100,100]);assert.equal(output.printPreparation.method,'native-union');assert.ok(output.printPreparation.printVolume>output.printPreparation.bodyVolume);
 }
});

test('thin side-edge contact cannot wrap a generated tip around the model and through its far skin',()=>{
 const {p}=slanted(25,.19,.1),before=structuredClone(p),T=new Matrix4().makeTranslation(0,0,15*Math.sin(25*Math.PI/180)).multiply(new Matrix4().makeRotationZ(.19)).multiply(new Matrix4().makeRotationY(25*Math.PI/180)),spec={a:new Vector3(-11,11.9,0).applyMatrix4(T).toArray(),b:new Vector3(7,11.9,0).applyMatrix4(T).toArray()},support=addManualDrawnFin(api,p,[100,100,100],spec),v=new Vector3(),inverse=T.clone().invert();
 assert.ok(support.fins[0].modelContactVolume>0);assert.ok(support.fins[0].trimmedSupportVolume>.1);assert.deepEqual(p,before);
 for(let i=0;i<support.vertices.length;i+=3){v.fromArray(support.vertices,i).applyMatrix4(inverse);assert.ok(v.z<=.10001,'No far-side generated tip remains even when exterior components meet around the side edge');}
 const output=preparePrintMesh(api,{...p,supports:support},[100,100,100]);assert.ok(output.printPreparation.printVolume>output.printPreparation.bodyVolume);
});
