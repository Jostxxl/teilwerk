import test from 'node:test';import assert from 'node:assert/strict';
import Module from 'manifold-3d';
import {fromSolid,layFlat} from '../src/engine.mjs';
import {printStability} from '../src/print-stability.mjs';
const api=await Module();api.setup();
function mesh(size,position=[0,0,0]){const base=api.Manifold.cube(size),solid=base.translate(position);try{return fromSolid(solid);}finally{base.delete();solid.delete();}}
function composite(boxes){const pieces=boxes.map(({size,position})=>{const cube=api.Manifold.cube(size),moved=cube.translate(position);cube.delete();return moved;}),solid=api.Manifold.union(pieces);try{return fromSolid(solid);}finally{pieces.forEach(p=>p.delete());solid.delete();}}
const near=(actual,expected,epsilon=1e-8)=>assert.ok(Math.abs(actual-expected)<=epsilon,`${actual} differs from ${expected}`);

test('a box has its true volume centroid, exact contact hull and analytic tipping angle',()=>{
 const r=printStability(mesh([10,20,30]));assert.equal(r.valid,true);near(r.volume,6000);r.centerOfMass.forEach((v,i)=>near(v,[5,10,15][i]));near(r.contact.area,200);near(r.contact.hullArea,200);near(r.contact.minimumSpan,10);near(r.contact.maximumSpan,Math.hypot(10,20));near(r.minimumMargin,5);near(r.gravityMargin.criticalTiltDegrees,Math.atan(5/15)*180/Math.PI);assert.equal(r.insideSupportPolygon,true);assert.equal(r.classification,'stable');assert.equal(r.stableUnderGravity,true);
});

test('signed-tetra COM stays accurate after a large translation, including a translated bed',()=>{
 const data=mesh([10,20,30]),offset=[1e9,-2e9,3e9],vertices=new Float64Array(data.vertices);for(let i=0;i<vertices.length;i++)vertices[i]+=offset[i%3];const r=printStability({...data,vertices},{bedZ:offset[2]});near(r.volume,6000);r.centerOfMass.forEach((v,i)=>near(v,offset[i]+[5,10,15][i],1e-6));near(r.minimumMargin,5);near(r.contact.minimumSpan,10);near(r.gravityMargin.criticalTiltDegrees,Math.atan(1/3)*180/Math.PI,1e-6);
});

test('an asymmetric top-heavy body uses volume COM rather than bounding-box center and reports tipping',()=>{
 const data=composite([{size:[10,10,10],position:[0,0,0]},{size:[30,10,10],position:[0,0,10]}]),r=printStability(data);near(r.volume,4000);r.centerOfMass.forEach((v,i)=>near(v,[12.5,5,12.5][i]));assert.notEqual(r.centerOfMass[0],15);near(r.minimumMargin,-2.5);assert.equal(r.insideSupportPolygon,false);assert.equal(r.classification,'unstable');assert.equal(r.stableUnderGravity,false);assert.ok(r.gravityMargin.criticalTiltDegrees<0);assert.ok(r.warnings.some(w=>w.code==='center_outside_support'));
});

test('choosing the broad real opposite face can stabilize the same overhanging body without changing its geometry',()=>{
 const data=composite([{size:[10,10,10],position:[0,0,0]},{size:[30,10,10],position:[0,0,10]}]),before=printStability(data),after=printStability(layFlat(data,[0,0,1]));assert.equal(before.classification,'unstable');assert.equal(after.classification,'stable');assert.equal(after.stableUnderGravity,true);near(after.volume,before.volume,1e-5);near(after.contact.area,300,1e-5);near(after.minimumMargin,5,1e-5);assert.ok(after.gravityMargin.criticalTiltDegrees>30);
});

test('a COM exactly on the support edge has no positive gravity reserve',()=>{
 const data=composite([{size:[10,10,10],position:[0,0,0]},{size:[20,10,10],position:[2.5,0,10]}]),r=printStability(data);near(r.centerOfMass[0],10);near(r.minimumMargin,0);assert.equal(r.insideSupportPolygon,true);assert.equal(r.stableUnderGravity,false);assert.equal(r.classification,'marginal');assert.ok(r.warnings.some(w=>w.code==='center_on_support_edge'));
});

test('signed cavity volume contributes negatively without treating the cavity as solid material',()=>{
 const outer=api.Manifold.cube([20,20,20]),inner0=api.Manifold.cube([6,6,6]),inner=inner0.translate([2,2,8]),shell=outer.subtract(inner);let r;try{r=printStability(fromSolid(shell));}finally{shell.delete();inner.delete();inner0.delete();outer.delete();}
 near(r.volume,8000-216);r.centerOfMass.forEach((v,i)=>near(v,(8000*10-216*[5,5,11][i])/(8000-216)));assert.equal(r.valid,true);near(r.contact.area,400);
});

test('a connected bridge uses the convex support of real feet while retaining their actual contact area',()=>{
 const r=printStability(composite([{size:[2,2,10],position:[0,0,0]},{size:[2,2,10],position:[8,0,0]},{size:[10,2,2],position:[0,0,10]}]));near(r.contact.area,8);near(r.contact.hullArea,20);near(r.contact.minimumSpan,2);near(r.centerOfMass[0],5);near(r.centerOfMass[1],1);assert.equal(r.insideSupportPolygon,true);
});

test('a narrow tall base is a measured warning even while full-body gravity COM stays inside',()=>{
 const r=printStability(mesh([2,20,100]));near(r.minimumMargin,1);near(r.contactSpanToHeight,.02);near(r.gravityMargin.criticalHorizontalAccelerationG,.02);assert.equal(r.stableUnderGravity,true);assert.equal(r.classification,'marginal');assert.ok(r.warnings.some(w=>w.code==='narrow_base'));assert.ok(r.warnings.some(w=>w.code==='low_tipping_margin'));assert.equal(r.assumptions.adhesionConsidered,false);assert.equal(r.assumptions.printingProgressConsidered,false);assert.match(r.limitations,/vollständigen Körpers/);
});

test('support width and margin are invariant to in-plane rotation rather than using an XY bounding box',()=>{
 const data=mesh([2,20,100]),vertices=new Float64Array(data.vertices),angle=73*Math.PI/180;for(let i=0;i<vertices.length;i+=3){const x=vertices[i],y=vertices[i+1];vertices[i]=x*Math.cos(angle)-y*Math.sin(angle);vertices[i+1]=x*Math.sin(angle)+y*Math.cos(angle);}const r=printStability({...data,vertices});near(r.contact.minimumSpan,2);near(r.minimumMargin,1);near(r.gravityMargin.criticalTiltDegrees,Math.atan(.02)*180/Math.PI);assert.ok(r.bounds.size[0]>19);assert.ok(r.bounds.size[1]>7);
});

test('a tilted box with only edge contact and an elevated box do not acquire fictional bed triangles',()=>{
 const data=mesh([10,10,10]),vertices=new Float64Array(data.vertices),angle=10*Math.PI/180;for(let i=0;i<vertices.length;i+=3){const y=vertices[i+1],z=vertices[i+2];vertices[i+1]=y*Math.cos(angle)-z*Math.sin(angle);vertices[i+2]=y*Math.sin(angle)+z*Math.cos(angle);}for(const d of [{...data,vertices},mesh([10,10,10],[0,0,1])]){const r=printStability(d);assert.equal(r.valid,true);assert.equal(r.classification,'no-contact');assert.equal(r.contact.area,0);assert.equal(r.minimumMargin,null);assert.equal(r.stableUnderGravity,false);}
});

test('a body penetrating the bed cannot obtain a stable classification from a surviving horizontal patch',()=>{
 const r=printStability(mesh([10,10,10],[0,0,-1]));assert.equal(r.valid,false);assert.equal(r.classification,'invalid');assert.ok(r.warnings.some(w=>w.code==='below_bed'));
});

test('missing faces, nonpositive winding, invalid indices and nonfinite coordinates fail explicitly',()=>{
 const data=mesh([10,10,10]),reversed=new Uint32Array(data.triangles);for(let i=0;i<reversed.length;i+=3)[reversed[i],reversed[i+1]]=[reversed[i+1],reversed[i]];
 for(const bad of [{...data,triangles:data.triangles.slice(3)},{...data,triangles:reversed},{...data,triangles:new Uint32Array([0,1,999999])},{...data,vertices:Float64Array.from(data.vertices,(v,i)=>i? v:NaN)}])assert.equal(printStability(bad).valid,false);
 assert.throws(()=>printStability(data,{contactTolerance:-1}),/Ungültige/);
});

test('calculated volume, margins and model input remain stable with harmless zero-area triangles',()=>{
 const data=mesh([10,20,30]),vertices=data.vertices.slice(),triangles=new Uint32Array([...data.triangles,0,0,0]),r=printStability({...data,triangles});near(r.volume,6000);near(r.minimumMargin,5);assert.deepEqual(data.vertices,vertices);assert.equal(data.triangles.length+3,triangles.length);
});
