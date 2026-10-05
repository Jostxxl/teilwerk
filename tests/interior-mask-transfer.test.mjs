import test from 'node:test';import assert from 'node:assert/strict';
import Module from 'manifold-3d';import {Matrix4,Vector3} from 'three';
import {createInteriorMaskContext,transferInteriorMask} from '../src/interior-mask-transfer.mjs';
import {restoreInteriorRegion,unionInteriorRegions,transferInteriorSelection} from '../src/mark-locations.mjs';
import {autoMarkLocations} from '../src/interior-marking.mjs';
const api=await Module();api.setup();
const mesh=points=>({vertices:new Float64Array(points.flat(2)),triangles:Uint32Array.from({length:points.length*3},(_,i)=>i)});
const square=(x0,y0,x1,y1,z=0)=>mesh([[[x0,y0,z],[x1,y0,z],[x1,y1,z]],[[x0,y0,z],[x1,y1,z],[x0,y1,z]]]);
const concat=(...masks)=>mesh(masks.flatMap(m=>Array.from({length:m.triangles.length/3},(_,f)=>[0,1,2].map(k=>Array.from(m.vertices.subarray(m.triangles[f*3+k]*3,m.triangles[f*3+k]*3+3))))));
const regionArea=data=>{let result=0;for(let f=0;f<data.triangles.length;f+=3){const[a,b,c]=[0,1,2].map(k=>new Vector3().fromArray(data.vertices,data.triangles[f+k]*3));result+=b.sub(a).cross(c.sub(a)).length()/2;}return result;};
const section=data=>api.CrossSection.ofPolygons(Array.from({length:data.triangles.length/3},(_,f)=>[0,1,2].map(k=>Array.from(data.vertices.subarray(data.triangles[f*3+k]*3,data.triangles[f*3+k]*3+2)))),'Positive');
function checkSubset(result,mask,expectedArea){let selected,outside,body;try{selected=section(mask);body=section(result);outside=body.subtract(selected);assert.ok(Math.abs(outside.area())<1e-9,'No unselected area may be created');assert.ok(Math.abs(body.area()-expectedArea)<1e-8);}finally{outside?.delete();body?.delete();selected?.delete();}}
function transfer(body,mask,options){const context=createInteriorMaskContext(mask);try{return transferInteriorMask(body,context,options);}finally{context.dispose();}}

test('a centroid-selected large triangle is clipped to the actual permission square',()=>{
 const body=mesh([[[-10,-10,0],[10,-10,0],[0,10,0]]]),mask=square(-1,-1,1,1),before=body.vertices.slice(),result=transfer(body,mask);
 assert.ok(result.region.vertices instanceof Float64Array);checkSubset(result.region,mask,4);assert.deepEqual(body.vertices,before);assert.equal(result.report.partialBodyTriangles,1);assert.equal(regionArea(result.region),4);
});
test('a tiny unauthorized corner of a large face is not rounded into full-face permission',()=>{
 const limit=999999.999999,body=mesh([[[0,0,0],[1000000,0,0],[0,1000000,0]]]),mask=mesh([[[0,0,0],[limit,0,0],[0,1000000,0]]]),result=transfer(body,mask);assert.equal(result.report.fullBodyTriangles,0);assert.ok(Math.max(...Array.from(result.region.vertices).filter((_,i)=>i%3===0))<=limit);
});
test('an unselected hole remains a hole even when every body face spans it',()=>{
 const body=square(-2,-2,2,2),mask=concat(square(-2,-2,-1,2),square(1,-2,2,2),square(-1,-2,1,-1),square(-1,1,1,2)),result=transfer(body,mask);
 checkSubset(result.region,mask,12);assert.ok(Math.abs(regionArea(result.region)-12)<1e-8);
});
test('nearby new parallel cuts and tilted caps are not mistaken for selected original skin',()=>{
 const mask=square(-5,-5,5,5),parallel=square(-2,-2,2,2,.01),tilted=square(-2,-2,2,2);for(let i=2;i<tilted.vertices.length;i+=3)tilted.vertices[i]=tilted.vertices[i-2]*.01;
 assert.equal(transfer(parallel,mask).region,undefined);assert.equal(transfer(tilted,mask).region,undefined);
});
test('a genuinely selected coplanar original surface survives despite matching a cut-plane equation',()=>{
 const mask=square(-5,-5,5,5),body={...square(-2,-2,2,2),cutPlanes:[{normal:[0,0,1],offset:0}]},result=transfer(body,mask);checkSubset(result.region,mask,16);
});
test('the opposite face cannot acquire permission from an equally placed outward face',()=>{
 const mask=square(-2,-2,2,2),body={...mask,triangles:mask.triangles.slice()};for(let i=0;i<body.triangles.length;i+=3)[body.triangles[i],body.triangles[i+1]]=[body.triangles[i+1],body.triangles[i]];
 assert.equal(transfer(body,mask).region,undefined);
});
test('independent body printing coordinates are correctly mapped through a rigid assembly pose',()=>{
 const mask=square(-1,-1,1,1),body=square(-2,-2,2,2),pose=new Matrix4().makeTranslation(24,-11,80).multiply(new Matrix4().makeRotationX(.43)).multiply(new Matrix4().makeRotationZ(.31));for(let i=0;i<body.vertices.length;i+=3)new Vector3().fromArray(body.vertices,i).applyMatrix4(pose).toArray(body.vertices,i);
 const result=transfer(body,mask,{toMask:pose.clone().invert()}),back={...result.region,vertices:result.region.vertices.slice()};for(let i=0;i<back.vertices.length;i+=3)new Vector3().fromArray(back.vertices,i).applyMatrix4(pose.clone().invert()).toArray(back.vertices,i);checkSubset(back,mask,4);
});
test('Float64 partial permissions survive project JSON, extension and rigid transfer without a Float32 dilation',()=>{
 const x=1/3,mask=square(x,-1,1,1),region=transfer(square(-2,-2,2,2),mask).region,saved=JSON.parse(JSON.stringify({vertices:Array.from(region.vertices),triangles:Array.from(region.triangles)})),restored=restoreInteriorRegion(saved);
 assert.ok(restored.vertices instanceof Float64Array);assert.deepEqual(restored.vertices,region.vertices);assert.ok(Math.min(...Array.from(restored.vertices).filter((_,i)=>i%3===0))>=x-1e-15);checkSubset(restored,mask,4/3);
 const combined=unionInteriorRegions(restored,restored);assert.ok(combined.vertices instanceof Float64Array);checkSubset(combined,mask,4/3);
 const moved=transferInteriorSelection({interiorRegion:restored},new Matrix4().makeTranslation(1/7,0,0).toArray());assert.ok(moved.interiorRegion.vertices instanceof Float64Array);
});
test('automatic masks use polygon intersections and stay clipped after save/reload',()=>{
 const mask=square(-1,-1,1,1),result=autoMarkLocations([{...square(-10,-10,10,10),id:'1'}],{data:mask},{generateMarks:false});assert.equal(result.parts.length,1);const region=result.parts[0].interiorRegion;checkSubset(region,mask,4);checkSubset(restoreInteriorRegion({vertices:Array.from(region.vertices),triangles:Array.from(region.triangles)}),mask,4);
});
test('invalid and disposed contexts fail explicitly without changing inputs',()=>{
 const mask=square(-1,-1,1,1),body=square(-2,-2,2,2),context=createInteriorMaskContext(mask),before=mask.triangles.slice();assert.throws(()=>transferInteriorMask({...body,triangles:new Uint32Array([0,1,999])},context));assert.throws(()=>transferInteriorMask(body,context,{toMask:[1,2]}));assert.throws(()=>transferInteriorMask(body,context,{toMask:new Matrix4().makeScale(0,1,1)}));context.dispose();context.dispose();assert.throws(()=>transferInteriorMask(body,context));assert.deepEqual(mask.triangles,before);
});
