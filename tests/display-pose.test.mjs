import test from 'node:test';
import assert from 'node:assert/strict';
import {Matrix4,Object3D,Vector3} from 'three';
import {partAssemblyMatrix,displayPartMatrices,applyDisplayPose} from '../src/display-pose.mjs';

function close(actual,expected,message){assert.equal(actual.length,expected.length);for(let i=0;i<actual.length;i++)assert.ok(Math.abs(actual[i]-expected[i])<1e-8,`${message||'coordinate'} ${i}: ${actual[i]} versus ${expected[i]}`);}
function box(min,max){const vertices=[];for(const x of [min[0],max[0]])for(const y of [min[1],max[1]])for(const z of [min[2],max[2]])vertices.push(x,y,z);return {vertices:new Float64Array(vertices),triangles:new Uint32Array()};}
function transformed(part,matrix){const vertices=new Float64Array(part.vertices.length);for(let i=0;i<vertices.length;i+=3)new Vector3().fromArray(part.vertices,i).applyMatrix4(matrix).toArray(vertices,i);return {...part,vertices,transform:matrix.toArray()};}
const identity=new Matrix4();
const parent=new Matrix4().makeTranslation(120,-40,70).multiply(new Matrix4().makeRotationZ(Math.PI/3));
const print=new Matrix4().makeTranslation(8,11,-5).multiply(new Matrix4().makeRotationY(Math.PI/2));

test('oriented closed preview undoes print placement before applying parent assembly',()=>{
 const original=new Vector3(2,3,4),local=original.clone().applyMatrix4(print),part={transform:print.toArray(),assemblyMatrix:new Matrix4().makeTranslation(999,0,0).toArray()};
 const matrix=partAssemblyMatrix(part,{preview:true,previewAssembly:true,parentAssembly:parent.toArray()});
 close(local.applyMatrix4(matrix).toArray(),original.applyMatrix4(parent).toArray());
 close(parent.toArray(),new Matrix4().makeTranslation(120,-40,70).multiply(new Matrix4().makeRotationZ(Math.PI/3)).toArray(),'parent must not mutate');
});

test('committed assembly matrix is authoritative even if stale transform metadata remains',()=>{
 const part={assemblyMatrix:parent.toArray(),transform:print.toArray()};
 close(partAssemblyMatrix(part).toArray(),parent.toArray());
 close(partAssemblyMatrix({transform:print.toArray()}).toArray(),identity.toArray());
});

test('open and un-oriented preview surfaces stay in parent coordinates',()=>{
 const part={transform:print.toArray(),assemblyMatrix:new Matrix4().makeTranslation(-900,0,0).toArray()};
 close(partAssemblyMatrix(part,{preview:true,previewAssembly:false,parentAssembly:parent.toArray()}).toArray(),parent.toArray());
 close(partAssemblyMatrix(part,{preview:true,previewAssembly:true,openPreview:true,parentAssembly:parent.toArray()}).toArray(),parent.toArray());
});

test('print display uses local mesh coordinates while preserving assembly metadata',()=>{
 const part={...box([10,20,30],[20,40,60]),assemblyMatrix:parent.toArray()};
 const [pose]=displayPartMatrices([part],{mode:'print',explode:0});
 close(pose.matrix.toArray(),identity.toArray());close(pose.assemblyMatrix.toArray(),parent.toArray());close(pose.offset.toArray(),[0,0,0]);
});

test('explosion uses the assembly bounding-box center, independent of world origin',()=>{
 const parts=[box([0,4,50],[10,14,60]),box([20,4,50],[60,14,60])];
 const poses=displayPartMatrices(parts,{mode:'assembly',explode:.6});
 close(poses[0].assemblyCenter.toArray(),[5,9,55]);close(poses[1].assemblyCenter.toArray(),[40,9,55]);
 assert.ok(poses[0].offset.x<0);assert.ok(poses[1].offset.x>0);close([poses[0].offset.y,poses[0].offset.z,poses[1].offset.y,poses[1].offset.z],[0,0,0,0]);
 assert.ok(Math.abs(poses[0].offset.x/poses[1].offset.x+2.5)<1e-8,'center is the complete bbox center x=30, not the mean of part centers');
 const translated=displayPartMatrices(parts.map(p=>({...p,assemblyMatrix:new Matrix4().makeTranslation(200,-300,900).toArray()})),{mode:'assembly',explode:.6});
 poses.forEach((pose,i)=>close(translated[i].offset.toArray(),pose.offset.toArray()));
});

test('assembly centers and explosion survive distinct print orientations',()=>{
 const parts=[box([-30,-10,0],[-10,10,10]),box([10,-10,0],[50,10,10])],p2=new Matrix4().makeTranslation(-17,23,1).multiply(new Matrix4().makeRotationX(.7));
 const baseline=displayPartMatrices(parts,{mode:'assembly',explode:.7});
 const oriented=displayPartMatrices(parts.map((p,i)=>transformed(p,i? p2:print)),{mode:'assembly',preview:true,previewAssembly:true,parentAssembly:identity.toArray(),explode:.7});
 baseline.forEach((pose,i)=>{close(oriented[i].assemblyCenter.toArray(),pose.assemblyCenter.toArray());close(oriented[i].offset.toArray(),pose.offset.toArray());});
 const printPoses=displayPartMatrices(parts.map((p,i)=>transformed(p,i? p2:print)),{mode:'print',preview:true,previewAssembly:true,parentAssembly:identity.toArray(),explode:.7});
 printPoses.forEach((pose,i)=>close(pose.offset.toArray(),baseline[i].offset.toArray()));
});

test('single-part explosion never moves a model away from its assembly position',()=>{
 const part={...box([27,-13,91],[44,17,143]),assemblyMatrix:parent.toArray()};
 const [pose]=displayPartMatrices([part],{mode:'assembly',explode:1});
 close(pose.offset.toArray(),[0,0,0]);close(pose.matrix.toArray(),parent.toArray());
 assert.deepEqual(displayPartMatrices([],{mode:'assembly',explode:1}),[]);
});

test('per-part preview overrides leave untouched committed siblings in assembly coordinates',()=>{
 const child=transformed(box([0,0,0],[10,10,10]),print),sibling={...box([20,0,0],[30,10,10]),assemblyMatrix:new Matrix4().makeTranslation(-45,8,19).toArray()};
 const poses=displayPartMatrices([child,sibling],{mode:'assembly',explode:0,perPart:[{preview:true,previewAssembly:true,parentAssembly:parent.toArray()},{}]});
 close(poses[0].matrix.toArray(),parent.clone().multiply(print.clone().invert()).toArray());close(poses[1].matrix.toArray(),sibling.assemblyMatrix);
});

test('exact transformed vertex bounds determine the center for asymmetric geometry',()=>{
 const part={vertices:new Float64Array([0,0,0,8,0,0,0,2,0]),triangles:new Uint32Array([0,1,2]),assemblyMatrix:new Matrix4().makeRotationZ(Math.PI/4).toArray()};
 const [pose]=displayPartMatrices([part],{mode:'assembly',explode:0});
 close(pose.assemblyCenter.toArray(),[3/Math.sqrt(2),4/Math.sqrt(2),0]);
});

test('annotation pose preserves its local alignment and converts picked points back exactly',()=>{
 const annotation=new Object3D();annotation.position.set(11,7,-3);annotation.rotation.set(.2,-.4,.8);annotation.updateMatrix();
 const localAlignment=annotation.matrix.clone(),pose=new Matrix4().makeTranslation(-8,12,3).multiply(parent),before=pose.toArray(),local=new Vector3(3,4,5),expected=local.clone().applyMatrix4(localAlignment).applyMatrix4(pose);
 applyDisplayPose(annotation,pose);annotation.updateMatrixWorld(true);
 close(annotation.localToWorld(local.clone()).toArray(),expected.toArray());close(annotation.worldToLocal(expected.clone()).toArray(),local.toArray());close(pose.toArray(),before,'shared pose must not mutate');
});
