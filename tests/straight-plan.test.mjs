import test from 'node:test';import assert from 'node:assert/strict';
import Module from 'manifold-3d';
import {straightPlanProposals} from '../src/straight-plan.mjs';
import {throughSurfacePlan} from '../src/through-plan.mjs';
import {consolidateDraft} from '../src/consolidate-draft.mjs';
import {closeGroupedPlan} from '../src/close-grouped-plan.mjs';
import {fromSolid,toSolid,bounds} from '../src/engine.mjs';
const api=await Module();api.setup();
function box(size,offset=[0,0,0]){const initial=api.Manifold.cube(size),solid=initial.translate(offset);try{return fromSolid(solid);}finally{solid.delete();initial.delete();}}
function area(data){let sum=0;const v=data.vertices,t=data.triangles;for(let f=0;f<t.length;f+=3){const a=t[f]*3,b=t[f+1]*3,c=t[f+2]*3,ux=v[b]-v[a],uy=v[b+1]-v[a+1],uz=v[b+2]-v[a+2],vx=v[c]-v[a],vy=v[c+1]-v[a+1],vz=v[c+2]-v[a+2];sum+=Math.hypot(uy*vz-uz*vy,uz*vx-ux*vz,ux*vy-uy*vx)/2;}return sum;}
const close=(a,b,tolerance=1e-5)=>assert.ok(Math.abs(a-b)<=tolerance,`${a} differs from ${b}`);

test('balanced dimensions avoid a thin final strip and obey the usable bed',()=>{
 const proposals=straightPlanProposals(box([501,249,249]),[250,250,250]);assert.deepEqual(proposals.grid.counts,[3,1,1]);assert.equal(proposals.length,3);
 for(const p of proposals){assert.equal(p.method,'straight');assert.deepEqual(p.faces,[]);assert.deepEqual(p.estimatedSize,[167,249,249]);}
 assert.equal(proposals[0].cutDefinition.contours[0][1][0],proposals[1].cutDefinition.contours[0][0][0]);assert.equal(proposals[1].cutDefinition.contours[0][1][0],proposals[2].cutDefinition.contours[0][0][0]);
});

test('exact full-bed dimensions do not add an unnecessary cell for outer padding',()=>{
 const proposals=straightPlanProposals(box([1500,500,250]),[250,250,250]);assert.deepEqual(proposals.grid.counts,[6,2,1]);assert.equal(proposals.length,12);for(const p of proposals)assert.deepEqual(p.estimatedSize,[250,250,250]);
 close(proposals[0].cutDefinition.contours[0][0][0],-.01);close(proposals[5].cutDefinition.contours[0][1][0],1500.01);close(proposals[0].cutDefinition.min,-.01);close(proposals[0].cutDefinition.max,250.01);
});

test('translated negative-coordinate models keep their exact bounds and shared internal planes',()=>{
 const source=box([35,23,17],[-41,13,-29]),before=Array.from(source.vertices),proposals=straightPlanProposals(source,[12,12,12]);assert.deepEqual(proposals.grid.counts,[3,2,2]);assert.deepEqual(proposals.grid.sourceBounds.min,[-41,13,-29]);assert.deepEqual(proposals.grid.sourceBounds.max,[-6,36,-12]);assert.deepEqual(Array.from(source.vertices),before);
 for(const p of proposals)p.estimatedSize.forEach((size,axis)=>assert.ok(size<=12+1e-10));
});

test('open preview retains the complete original surface without a residual or added caps',()=>{
 const source=box([51,31,11],[-9,8,13]),proposals=straightPlanProposals(source,[20,20,20]),surfaces=throughSurfacePlan(source,proposals);assert.equal(surfaces.filter(p=>p.unassigned).length,0);close(surfaces.reduce((sum,p)=>sum+area(p),0),area(source),.001);
 for(const p of surfaces){assert.ok(p.triangles.length);for(let i=0;i<p.vertices.length;i+=3){const xyz=Array.from(p.vertices.subarray(i,i+3));assert.ok(xyz.some((v,axis)=>Math.abs(v-proposals.grid.sourceBounds.min[axis])<1e-4||Math.abs(v-proposals.grid.sourceBounds.max[axis])<1e-4),'every preview vertex remains on the original box shell');}}
});

test('all grid cuts close faithfully and each part stands on a real planar face within the bed',async()=>{
 const source=box([51,31,11]),bed=[20,20,20],proposals=straightPlanProposals(source,bed),surfaces=throughSurfacePlan(source,proposals),grouping=consolidateDraft(surfaces,proposals,bed),result=await closeGroupedPlan(api,source,proposals,grouping.groups,bed);
 assert.equal(result.remainingCount,0);assert.equal(result.complete,true);close(result.resultVolume,51*31*11,.001);assert.equal(result.parts.length,6);
 for(const part of result.parts){assert.equal(part.bedFace,'cut');assert.ok(part.bedContactArea>=1);const b=bounds(part);close(b.min[2],0,.001);b.size.forEach((size,axis)=>assert.ok(size<=bed[axis]+.005));const solid=toSolid(api,part),components=solid.decompose();try{assert.equal(components.length,1);assert.ok(solid.volume()>0);}finally{components.forEach(c=>c.delete());solid.delete();}}
});

test('fully internal solid cells require closure groups even without original surface triangles',async()=>{
 const source=box([30,30,30]),bed=[10,10,10],proposals=straightPlanProposals(source,bed),surfaces=throughSurfacePlan(source,proposals),visible=new Set(surfaces.filter(p=>!p.unassigned).map(p=>p.proposal));assert.equal(proposals.length,27);assert.equal(visible.size,26);assert.equal(visible.has(13),false);
 const result=await closeGroupedPlan(api,source,proposals,proposals.map((_,i)=>[i]),bed);assert.equal(result.remainingCount,0);assert.equal(result.parts.length,27);close(result.resultVolume,27000,.001);result.parts.forEach(p=>close(p.volume,1000,.001));
});

test('invalid bounds and impractically large grids fail before allocating proposals',()=>{
 const source=box([10,10,10]);assert.throws(()=>straightPlanProposals(source,[0,10,10]),/Bauraum/);assert.throws(()=>straightPlanProposals(source,[1,1,1]),/512/);assert.throws(()=>straightPlanProposals({vertices:[0,0,0,1,1,0,2,2,0]},[10,10,10]),/positive Ausdehnung/);assert.throws(()=>straightPlanProposals({vertices:[0,0,0,1,1,1,NaN,2,2]},[10,10,10]),/endlich/);
});
