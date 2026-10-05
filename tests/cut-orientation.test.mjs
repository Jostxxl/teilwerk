import test from 'node:test';
import assert from 'node:assert/strict';
import {BoxGeometry,Matrix4,Vector3} from 'three';
import Module from 'manifold-3d';
import {orientOnCutFace,cutFacePrintPoses,validatedSelectedCutPose} from '../src/cut-orientation.mjs';
import {cutPoseSelection} from '../src/cut-pose-pairs.mjs';
import {overhangMetrics} from '../src/overhang-metrics.mjs';
import {printStability} from '../src/print-stability.mjs';
import {transformData,bounds,fromSolid,bestOrientation} from '../src/engine.mjs';
import {refineNativeOverhangs} from '../src/refine-native-overhangs.mjs';

function box(){const g=new BoxGeometry(20,30,40);return {vertices:new Float32Array(g.attributes.position.array),triangles:new Uint32Array(g.index.array),cutPlanes:[{normal:[0,0,-1],offset:20},{normal:[1,0,0],offset:10}]};}
const near=(a,b,message,tolerance=1e-4)=>assert.ok(Math.abs(a-b)<tolerance,`${message}: ${a} versus ${b}`);
function verifyHistory(original,oriented){const matrix=new Matrix4().fromArray(oriented.transform),point=new Vector3();for(let i=0;i<original.vertices.length;i+=3){point.fromArray(original.vertices,i).applyMatrix4(matrix);for(let axis=0;axis<3;axis++)near(point.getComponent(axis),oriented.vertices[i+axis],'Assembly transform must reconstruct each printed vertex');}}
function verifyPlanes(original,oriented){const matrix=new Matrix4().fromArray(oriented.transform);original.cutPlanes.forEach((plane,i)=>{const out=oriented.cutPlanes[i];near(Math.hypot(...out.normal),1,'Plane normal remains unit length');for(let j=0;j<original.vertices.length;j+=3){const point=new Vector3().fromArray(original.vertices,j);if(Math.abs(point.dot(new Vector3(...plane.normal))-plane.offset)>1e-6)continue;point.applyMatrix4(matrix);near(point.dot(new Vector3(...out.normal)),out.offset,'Cut planes follow the printed geometry');}});}

test('reorientation uses current geometry while preserving prior assembly transforms',()=>{
 const original=box(),prior=new Matrix4().makeTranslation(80,-20,35).multiply(new Matrix4().makeRotationY(.6)),input={...transformData(original,prior),requiresCutFace:true,overhang:{needsFurtherSplit:true,severeArea:1e9}},beforeVertices=Array.from(input.vertices),beforePlanes=structuredClone(input.cutPlanes),withoutHistory={...input};delete withoutHistory.transform;
 const reference=orientOnCutFace(withoutHistory,[60,60,60]),result=orientOnCutFace(input,[60,60,60]);
 assert.deepEqual(result.vertices,reference.vertices,'Existing transform metadata must not change orientation choice');
 assert.deepEqual(result.cutPlanes,reference.cutPlanes,'Planes must use only the local reorientation');
 assert.equal(result.bedFace,'cut');assert.equal(result.requiresCutFace,false);assert.equal(result.overhang.needsFurtherSplit,false);assert.ok(result.bedContactArea>=1);near(bounds(result).min[2],0,'A real face rests on the plate');
 verifyHistory(original,result);verifyPlanes(original,result);
 assert.deepEqual(Array.from(input.vertices),beforeVertices);assert.deepEqual(input.cutPlanes,beforePlanes);
});

test('repeated cut-face orientation preserves assembly recovery and every plane equation',()=>{
 const original=box(),first=orientOnCutFace(original,[60,60,60]),moved=transformData(first,new Matrix4().makeTranslation(-45,26,18).multiply(new Matrix4().makeRotationX(.37))),second=orientOnCutFace(moved,[60,60,60]),third=orientOnCutFace(second,[60,60,60]);
 for(const result of [first,second,third]){near(bounds(result).min[2],0,'Printed geometry remains grounded');verifyHistory(original,result);verifyPlanes(original,result);assert.equal(result.overhang.needsFurtherSplit,false);}
});

test('the complete pose bank retains all fitting real cut faces and their cumulative assembly transforms',()=>{
 const original=box(),input=transformData(original,new Matrix4().makeTranslation(40,-60,30).multiply(new Matrix4().makeRotationY(.47))),poses=cutFacePrintPoses(input,[60,60,60]);
 assert.equal(poses.length,2);assert.ok(poses.every(p=>p.printStability.stableUnderGravity&&p.cutOrientation.candidates===2));
 for(const p of poses){verifyHistory(original,p);verifyPlanes(original,p);near(bounds(p).min[2],0,'Each candidate is grounded');}
 assert.equal(cutFacePrintPoses({...original,cutPlanes:[{normal:[0,0,1],offset:100}]},[60,60,60]).length,0,'an imaginary plane cannot provide contact');
});

test('selected pose preservation validates current physical measurements instead of trusting metadata',()=>{
 const source=box(),poses=cutFacePrintPoses(source,[60,60,60]),chosen=poses.find(p=>p.bedContactArea===600),selection=cutPoseSelection({...chosen,bedContactArea:600},'stability-first');assert.ok(chosen);
 const kept=validatedSelectedCutPose(source,[60,60,60],chosen.transform,selection);assert.ok(kept);assert.deepEqual(kept.transform,chosen.transform);
 assert.equal(validatedSelectedCutPose(source,[10,10,10],chosen.transform,selection),null,'changed build volume cannot authorize stale pose');
 assert.equal(validatedSelectedCutPose(source,[60,60,60],new Matrix4().makeTranslation(0,0,2).multiply(new Matrix4().fromArray(chosen.transform)).toArray(),selection),null,'floating pose has no actual contact');
 assert.equal(validatedSelectedCutPose(source,[60,60,60],chosen.transform,{...selection,overhang:{severeArea:-10,supportArea:0}}),null,'invalidated local objective triggers full reconsideration');
});

test('pose geometry and physical metrics use the same single original-mesh transform as native export',()=>{
 const moved=transformData(box(),new Matrix4().makeTranslation(702.371,-811.727,1130.39).multiply(new Matrix4().makeRotationX(.78552)).multiply(new Matrix4().makeRotationY(.4917))),local={...moved};delete local.transform;
 const poses=cutFacePrintPoses(local,[60,60,60]);assert.ok(poses.length);
 for(const pose of poses){const exported=transformData(local,new Matrix4().fromArray(pose.transform));assert.deepEqual(pose.vertices,exported.vertices,'no intermediate rounded geometry may determine the physical result');assert.deepEqual(pose.cutPlanes,exported.cutPlanes);assert.deepEqual(pose.overhang,overhangMetrics(exported));assert.deepEqual(pose.printStability,printStability(exported));}
});

async function steppedSlab(){
 const api=await Module();api.setup();const pieces=[];
 function box(size,position){const raw=api.Manifold.cube(size),moved=raw.translate(position);raw.delete();pieces.push(moved);return moved;}
 const solid=api.Manifold.union([box([2,20,2],[0,0,0]),box([30,20,2],[0,0,2]),box([2,20,2],[28,0,4])]);pieces.forEach(p=>p.delete());
 return {api,solid,data:fromSolid(solid)};
}

test('an untagged stepped import chooses stable real side seating before any new cut',async()=>{
 const {solid,data}=await steppedSlab(),before=structuredClone(data);
 try{
  const oldHeightChoice=bestOrientation(data,[100,100,100]);assert.equal(printStability(oldHeightChoice).stableUnderGravity,false);near(printStability(oldHeightChoice).minimumMargin,-13,'Height-only orientation is demonstrably unstable');
  const result=orientOnCutFace(data,[100,100,100]),once=transformData(data,new Matrix4().fromArray(result.transform));
  assert.equal(result.printStability.classification,'stable');assert.ok(result.printStability.minimumMargin>2);assert.equal(result.overhang.severeArea,0);assert.equal(result.overhang.supportArea,0);
  assert.equal(result.bedFace,'surface');assert.equal(result.cutPlanes,undefined);assert.equal(result.requiresCutFace,false);assert.ok(result.cutOrientation.candidates>1);assert.equal(result.cutOrientation.source,'surface');
  assert.deepEqual(result.vertices,once.vertices);assert.deepEqual(result.triangles,data.triangles);assert.deepEqual(result.printStability,printStability(once));assert.deepEqual(result.overhang,overhangMetrics(once));assert.equal(result.bedContactArea,result.printStability.contact.area);near(bounds(result).min[2],0,'The selected physical surface reaches the bed');
  assert.deepEqual(data,before);assert.equal(solid.volume(),1360);assert.equal(solid.status(),'NoError');
 }finally{solid.delete();}
});

test('untagged physical orientation preserves cumulative history without importing assembly or annotation metadata',async()=>{
 const {solid,data}=await steppedSlab();
 try{
  const prior=new Matrix4().makeTranslation(60,-40,15).multiply(new Matrix4().makeRotationY(.47)),input={...transformData(data,prior),cutPlanes:[],assemblyMatrix:prior.clone().invert().toArray(),plannedMark:{point:[1,2,3],normal:[0,0,1],text:'1',size:6,depth:.4},nativeGeometry:{testOnly:'must not enter the internal geometric search'}},before=structuredClone(input),local={vertices:input.vertices,triangles:input.triangles};
  const expected=orientOnCutFace(local,[100,100,100]),result=orientOnCutFace(input,[100,100,100]);
  assert.deepEqual(result.vertices,expected.vertices);assert.ok(result.printStability.stableUnderGravity);assert.equal(result.cutPlanes,undefined);assert.equal(result.assemblyMatrix,undefined);assert.equal(result.nativeGeometry,undefined);assert.equal(result.plannedMark,undefined);verifyHistory(data,result);assert.deepEqual(input,before);
  assert.deepEqual(result.transform,new Matrix4().fromArray(expected.transform).multiply(prior).toArray());
 }finally{solid.delete();}
});

test('untagged fallback never returns an oversized pose as fitting',async()=>{
 const {solid,data}=await steppedSlab();try{assert.throws(()=>orientOnCutFace(data,[2,2,2]),/Keine Drucklage/);}finally{solid.delete();}
});

test('native refinement reorients an untagged tipping source instead of trying avoidable subdivisions',async()=>{
 const {api,solid}=await steppedSlab();let result;
 try{
  result=await refineNativeOverhangs(api,[{solid,ownerId:'untagged-stepped-slab',cutPlanes:[]}],[100,100,100],{policy:'stability-first',maxExtraParts:1,maxCandidatesPerOwner:8,maxMillis:10000});
  assert.equal(result.partitionUsable,true);assert.equal(result.materialPreserved,true);assert.equal(result.splits,0);assert.equal(result.attempted,0);assert.equal(result.owners.length,1);assert.equal(result.volumeBefore,result.volumeAfter);assert.equal(result.owners[0].printStability.classification,'stable');assert.ok(result.owners[0].printStability.minimumMargin>2);assert.deepEqual(result.owners[0].cutPlanes,[]);assert.equal(result.owners[0].overhang.severeArea,0);
  assert.ok(result.orientationsBeforeCut[0].candidates>1);assert.equal(result.orientationsBeforeCut[0].classification,'stable');assert.equal(result.unresolved.some(p=>p.reason==='unstable_print_pose'),false);assert.equal(solid.status(),'NoError');assert.equal(solid.volume(),1360);
 }finally{result?.dispose();solid.delete();}
});
