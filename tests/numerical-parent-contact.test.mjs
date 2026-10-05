import test from 'node:test';import assert from 'node:assert/strict';
import {certifyNumericalParentContact as certify,NUMERICAL_PARENT_CONTACT_LIMITS as limits} from '../src/numerical-parent-contact.mjs';
const tau=128*Number.EPSILON,plane={normal:[0,0,1],offset:0};
function box(lo,hi){return {vertices:[[-1,-1,lo],[1,-1,lo],[1,1,lo],[-1,1,lo],[-1,-1,hi],[1,-1,hi],[1,1,hi],[-1,1,hi]],triangles:new Uint32Array([0,2,1,0,3,2,4,5,6,4,6,7,0,1,5,0,5,4,1,2,6,1,6,5,2,3,7,2,7,6,3,0,4,3,4,7])};}
const check=(moving=box(0,1),obstacle=box(-1,0),motion=[0,0,1],p=plane,options)=>certify(moving,obstacle,motion,p,options);
function nextUp(x){const b=new DataView(new ArrayBuffer(8));b.setFloat64(0,x);b.setBigUint64(0,b.getBigUint64(0)+1n);return b.getFloat64(0);}

test('exactly touching pair separates without numerical resolution or input edits',async()=>{
 const a=box(0,1),b=box(-1,0),before=structuredClone([a,b]),r=await check(a,b);
 assert.equal(r.verified,true);assert.equal(r.reason,'exact_parent_separation');assert.equal(r.exactZeroOverlap,true);assert.equal(r.numericalContactResolutionApplied,false);assert.equal(r.measuredMaxDepthMm,0);assert.equal(r.resolutionMm,tau);assert.deepEqual([a,b],before);
});
test('tiny positive overlap is explicitly numerical contact, never exact zero',async()=>{
 const r=await check(box(-tau/2,1));assert.equal(r.verified,true);assert.equal(r.reason,'numerical_parent_contact');assert.equal(r.exactZeroOverlap,false);assert.equal(r.numericalContactResolutionApplied,true);assert.equal(r.measuredMaxDepthMm,tau/2);assert.equal(r.resolutionIsKernelErrorBound,false);
});
test('exact resolution boundary passes while one ULP above it fails',async()=>{
 assert.equal((await check(box(-tau,1))).verified,true);const r=await check(box(-nextUp(tau),1));assert.equal(r.verified,false);assert.equal(r.reason,'contact_depth_exceeds_resolution');assert.ok(r.measuredMaxDepthMm>r.resolutionMm);
});
test('small overlap is not enough: both support extrema must match the plane',async()=>{
 const r=await check(box(.5-tau/2,1),box(-1,.5));assert.equal(r.verified,false);assert.equal(r.reason,'contact_plane_mismatch');assert.equal((await check(box(tau/2,1))).verified,true);
});
test('actual inward, tangent or zero motion cannot authorize parent removal',async()=>{
 for(const m of [[0,0,-1],[1,0,0],[0,0,0]]){const r=await check(undefined,undefined,m);assert.equal(r.verified,false);assert.equal(r.reason,'motion_not_separating');}
 const r=await check(undefined,undefined,[1,0,1]);assert.equal(r.verified,true);
});
test('end must clear the measured overlap, with equality allowed',async()=>{
 const a=box(-tau/2,1);assert.equal((await check(a,undefined,[0,0,tau/4])).reason,'end_not_separated');assert.equal((await check(a,undefined,[0,0,tau/2])).verified,true);
});
test('sub-ULP motion is evaluated as an exact sum, not a rounded endpoint',async()=>{
 assert.equal(1+1e-30,1);const r=await check(box(1,2),box(0,1),[0,0,1e-30],{normal:[0,0,1],offset:1});assert.equal(r.verified,true);assert.equal(r.motionDotSign,1);assert.equal(r.endExactlySeparated,true);
});
test('positive normal rescaling changes no decision or measured normal depth',async()=>{
 for(const scale of [Number.MIN_VALUE,2**-500,1,2**500,1e300]){const r=await check(box(-tau/2,1),undefined,[0,0,1],{normal:[0,0,scale],offset:0});assert.equal(r.verified,true,String(scale));assert.ok(Math.abs(r.measuredMaxDepthMm-tau/2)<=tau*Number.EPSILON,'Only derived display diagnostics may round');assert.equal((await check(box(-nextUp(tau),1),undefined,[0,0,1],{normal:[0,0,scale],offset:0})).verified,false);}
 const r=await check(undefined,undefined,[0,0,1],{normal:[0,0,-1],offset:0});assert.equal(r.verified,false);
});
test('oblique contact and translation retain normal-scale independent bounds',async()=>{
 const transform=mesh=>({...mesh,vertices:mesh.vertices.map(([x,y,z])=>[z-x,z+x,y])}),a=transform(box(-tau/4,1)),b=transform(box(-1,0));
 const r=await check(a,b,[1,1,0],{normal:[1,1,0],offset:0});assert.equal(r.verified,true);assert.equal(r.exactZeroOverlap,false);
 const scaled=await check(a,b,[1,1,0],{normal:[8,8,0],offset:0});assert.equal(scaled.verified,true);assert.equal(scaled.measuredMaxDepthMm,r.measuredMaxDepthMm);
});
test('coordinate-dependent resolution is capped, and far-origin ULP penetration stays blocked',async()=>{
 const origin=2**30,shift=mesh=>({...mesh,vertices:mesh.vertices.map(p=>[p[0],p[1],p[2]+origin])});
 const r=await check(shift(box(0,1)),shift(box(-1,0)),[0,0,1],{normal:[0,0,1],offset:origin});assert.equal(r.verified,true);assert.equal(r.resolutionMm,1e-8);
 const a=shift(box(0,1));for(let i=0;i<4;i++)a.vertices[i][2]-=2**-23;const no=await check(a,shift(box(-1,0)),[0,0,1],{normal:[0,0,1],offset:origin});assert.equal(no.verified,false);assert.equal(no.reason,'contact_depth_exceeds_resolution');
});
test('every vertex participates, including a single unreferenced protrusion',async()=>{
 const a=box(0,1);a.vertices.push([0,0,-2*tau]);const r=await check(a);assert.equal(r.verified,false);assert.equal(r.reason,'contact_depth_exceeds_resolution');
});
test('a small-volume deep spike and the wrong body orientation cannot pass',async()=>{
 const a=box(0,1);a.vertices[0]=[0,0,-1e-7];assert.equal((await check(a)).verified,false);assert.equal((await check(box(-1,0),box(0,1))).verified,false);
});
test('invalid, sparse, oversized or incomplete index data fail closed',async()=>{
 for(const mutate of [a=>a.vertices[0]=[NaN,0,0],a=>delete a.vertices[0][1],a=>a.triangles=[0,1,999,0,1,2,0,1,2,0,1,2],a=>{a.triangles=new Array(12);a.triangles[0]=0;},a=>a.triangles=new Float64Array(12)]){const a=box(0,1);mutate(a);assert.equal((await check(a)).verified,false);}
 const a=box(0,1);a.vertices.length=limits.vertices+1;assert.equal((await check(a)).reason,'geometry_limit');
 for(const p of [{normal:[0,0,0],offset:0},{normal:[0,0,1],offset:Infinity}])assert.equal((await check(undefined,undefined,[0,0,1],p)).verified,false);
 assert.equal((await check(undefined,undefined,[0,0,NaN])).reason,'invalid_motion');
});
test('checkpoints propagate cancellation and protect privately captured inputs',async()=>{
 const cancelled=Error('stop');await assert.rejects(check(undefined,undefined,undefined,undefined,{checkpoint:()=>{throw cancelled;}}),e=>e===cancelled);
 const a=box(-tau/2,1),p={normal:[0,0,1],offset:0},m=[0,0,1];let calls=0;
 const r=await check(a,undefined,m,p,{checkpoint:async()=>{if(++calls===1){a.vertices[0][2]=-100;m[2]=-1;p.normal[2]=-1;}}});assert.equal(r.verified,true);assert.equal(r.measuredMaxDepthMm,tau/2);assert.deepEqual(r.plane,plane);
 let laterCalls=0;await assert.rejects(check(undefined,undefined,undefined,undefined,{checkpoint:()=>{if(++laterCalls===3)throw cancelled;}}),e=>e===cancelled);
});
