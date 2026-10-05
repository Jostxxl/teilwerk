import test from 'node:test';import assert from 'node:assert/strict';import Module from 'manifold-3d';import {straightenContour} from '../src/straighten.mjs';import {fromSolid,smartRegion,validate} from '../src/engine.mjs';import {surfaceCutPreview,cutSurfacePatch,prepareSurfaceCutter} from '../src/features.mjs';
const api=await Module();api.setup();
test('jagged rectangular outline becomes four average straight sides',()=>{
 const corners=[[0,0],[100,0],[100,60],[0,60]],p=[];
 for(let side=0;side<4;side++){const a=corners[side],b=corners[(side+1)%4],dx=b[0]-a[0],dy=b[1]-a[1],l=Math.hypot(dx,dy);for(let j=0;j<100;j++){const noise=j?((j%2)*2-1)*.6:0;p.push([a[0]+dx*j/100-dy/l*noise,a[1]+dy*j/100+dx/l*noise]);}}
 const r=straightenContour(p,2);assert.equal(r.points.length,4);assert.ok(r.maxDeviation<1);for(const corner of corners)assert.ok(Math.min(...r.points.map(p=>Math.hypot(p[0]-corner[0],p[1]-corner[1])))<.2);
});
test('straightened contour uses fewer segments and still cuts a closed curved shell',()=>{
 const a=api.Manifold.sphere(100,48),b=api.Manifold.sphere(90,48),shell=a.subtract(b),data=fromSolid(shell);a.delete();b.delete();shell.delete();const selected=smartRegion(data,0,35,60);
 const raw=prepareSurfaceCutter(api,data,selected.faces,25),clean=prepareSurfaceCutter(api,data,selected.faces,25,2);assert.ok(clean.contours.flat().length<raw.contours.flat().length);raw.solid.delete();clean.solid.delete();
 const preview=surfaceCutPreview(api,data,selected.faces,25,null,2);assert.ok(preview.walls.triangles.length>0);
 const pieces=cutSurfacePatch(api,data,selected.faces,25,null,2);assert.equal(pieces.length,2);pieces.forEach(p=>assert.ok(validate(api,p).volume>0));assert.ok(Math.abs(pieces.reduce((s,p)=>s+p.volume,0)-data.volume)<1);
});
