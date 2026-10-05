import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'manifold-3d';
import {fromSolid,validate} from '../src/engine.mjs';
import {drawnContour,drawnPreview,drawnCut} from '../src/drawn.mjs';
const api=await Module();api.setup();
const points=[[20,20,20],[70,20,20],[70,60,20],[20,60,20]],normals=points.map(()=>[0,0,1]);
for(const style of ['line','spline'])test(`drawn ${style} gives closed volume-preserving cuts`,()=>{
  const solid=api.Manifold.cube([100,80,20]),data=fromSolid(solid);solid.delete();
  const preview=drawnPreview(api,data,points,normals,style,30);
  assert.equal(preview.missed,0);assert.ok(preview.boundaryCount>4);
  const pieces=drawnCut(api,data,points,normals,style,30);
  assert.equal(pieces.length,2);pieces.forEach(p=>assert.ok(validate(api,p).volume>0));
  assert.ok(Math.abs(pieces.reduce((s,p)=>s+p.volume,0)-160000)<.1);
  const small=Math.min(...pieces.map(p=>p.volume));
  if(style==='line')assert.ok(Math.abs(small-40000)<.1);
  else assert.ok(small>40000,'Spline must change the actual cut, not just the display');
});
test('crossing and degenerate contours are rejected',()=>{
  assert.throws(()=>drawnContour([points[0],points[2],points[1],points[3]],normals),/kreuzt/);
  assert.throws(()=>drawnContour([points[0],points[0],points[1]],normals.slice(0,3)),/doppelte|kreuzt/);
  assert.throws(()=>drawnContour(points.slice(0,2),normals.slice(0,2)),/3–128/);
});
test('contour outside the model is rejected before boolean',()=>{
  const solid=api.Manifold.cube([100,80,20]),data=fromSolid(solid);solid.delete();
  assert.throws(()=>drawnPreview(api,data,points.map(p=>[p[0]+200,p[1],p[2]]),normals,'line',30),/außerhalb/);
});
test('drawn spline follows a curved shell and closes through the wall',()=>{
 const outer=api.Manifold.sphere(100,64),inner=api.Manifold.sphere(90,64),solid=outer.subtract(inner),data=fromSolid(solid);outer.delete();inner.delete();solid.delete();
 const p=[[-30,-20],[40,-20],[40,25],[-30,25]].map(([x,y])=>[x,y,Math.sqrt(10000-x*x-y*y)]),n=p.map(p=>p.map(v=>v/100));
 const preview=drawnPreview(api,data,p,n,'spline',25),z=[];
 for(let i=2;i<preview.walls.vertices.length;i+=12)z.push(preview.walls.vertices[i]);
 assert.ok(Math.max(...z)-Math.min(...z)>3,'Preview must follow the curved surface');
 const pieces=drawnCut(api,data,p,n,'spline',25);assert.equal(pieces.length,2);pieces.forEach(p=>assert.ok(validate(api,p).volume>0));assert.ok(Math.abs(pieces.reduce((s,p)=>s+p.volume,0)-data.volume)<1);
});
