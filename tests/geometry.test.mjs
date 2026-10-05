import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'manifold-3d';
import {BoxGeometry,Matrix4,Vector3} from 'three';
import {STLLoader} from 'three/addons/loaders/STLLoader.js';
import {validate,splitPlane,automaticSplit,bestOrientation,bounds,ground,layFlat,smartRegion,binarySTL,usableBed,transformData} from '../src/engine.mjs';
const api=await Module();api.setup();
function box(x=100,y=80,z=60){const g=new BoxGeometry(x,y,z),data={vertices:new Float32Array(g.attributes.position.array),triangles:new Uint32Array(g.index.array)};g.dispose();return validate(api,data);}
function approx(a,b,tol=1e-3){assert.ok(Math.abs(a-b)<tol,`${a} != ${b}`);}
function closed(data){const edges=new Map();for(let i=0;i<data.triangles.length;i+=3){const t=data.triangles.slice(i,i+3);for(let j=0;j<3;j++){const a=t[j],b=t[(j+1)%3],k=a<b?`${a},${b}`:`${b},${a}`;edges.set(k,(edges.get(k)||0)+(a<b?1:-1));}}assert.ok([...edges.values()].every(v=>v===0),'Every edge must have opposite paired winding');assert.ok(validate(api,data).volume>0);}
test('STL-style duplicated vertices weld into a valid volume',()=>{const d=box();approx(d.volume,480000);closed(d);});
test('oblique plane creates closed pieces and preserves total volume',()=>{const d=box(),parts=splitPlane(api,d,new Vector3(1,1,.3).normalize().toArray(),0);assert.equal(parts.length,2);parts.forEach(closed);approx(parts.reduce((v,p)=>v+p.volume,0),d.volume,.1);});
test('automatic grid fits all three axes and preserves material',()=>{const d=box(540,320,210),bed=[180,150,100],parts=automaticSplit(api,d,bed);assert.equal(parts.length,27);for(const p of parts){closed(p);assert.ok(bounds(p).size.every((v,i)=>v<=bed[i]+1e-3));}approx(parts.reduce((v,p)=>v+p.volume,0),d.volume,1);});
test('an already fitting model needs no cuts',()=>{assert.equal(automaticSplit(api,box(),[200,200,200]).length,1);});
test('orientation turns a tall object to fit a shallow printer',()=>{const d=box(60,80,240),oriented=bestOrientation(d,[250,100,100]);assert.ok(bounds(oriented).size.every((v,i)=>v<=[250,100,100][i]+.001));approx(bounds(oriented).min[2],0);closed(oriented);});
test('a selected side face can be laid on the bed',()=>{const result=layFlat(box(100,80,60),[1,0,0]);approx(bounds(result).size[2],100);approx(bounds(result).min[2],0);});
test('smart region traverses coplanar neighboring triangles, stops at sharp edges',()=>{const d=box(),r=smartRegion(d,0,40,200);assert.equal(r.faces.length,2);assert.equal(r.normal.length,3);assert.ok(Number.isFinite(r.offset));});
test('binary STL round trip retains volume',()=>{const original=box(),d=ground(original),g=new STLLoader().parse(binarySTL(d).buffer);const raw={vertices:new Float32Array(g.attributes.position.array),triangles:Uint32Array.from({length:g.attributes.position.count},(_,i)=>i)};approx(validate(api,raw).volume,original.volume);g.dispose();});
test('open meshes are rejected',()=>{const d=box();assert.throws(()=>validate(api,{...d,triangles:d.triangles.slice(3)}),/Netz/);});
test('non-intersecting planes are rejected',()=>{assert.throws(()=>splitPlane(api,box(),[0,0,1],1000),/Ebene/);});
test('invalid printer settings and excessive partition counts are rejected',()=>{assert.throws(()=>usableBed([10,20,30],8));assert.throws(()=>usableBed([NaN,20,30],0));assert.throws(()=>automaticSplit(api,box(1000,1000,1000),[10,10,10]),/256/);});
test('negative-space and concave cuts stay closed',()=>{const outer=api.Manifold.cube([100,100,100],true),inner=api.Manifold.cube([60,60,120],true),tube=outer.subtract(inner);const mesh=tube.getMesh(),d={vertices:new Float32Array(mesh.vertProperties),triangles:new Uint32Array(mesh.triVerts)};const parts=splitPlane(api,d,[1,0,0],0);parts.forEach(closed);approx(parts.reduce((n,p)=>n+p.volume,0),640000,.01);outer.delete();inner.delete();tube.delete();});
test('disconnected components become separate export parts',()=>{const a=api.Manifold.cube([10,10,10]),b=api.Manifold.cube([10,10,10]).translate([30,0,0]),both=api.Manifold.union([a,b]);const m=both.getMesh(),d={vertices:new Float32Array(m.vertProperties),triangles:new Uint32Array(m.triVerts)};const parts=automaticSplit(api,d,[100,100,100]);assert.equal(parts.length,2);parts.forEach(closed);a.delete();b.delete();both.delete();});
