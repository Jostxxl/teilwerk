import test from 'node:test';
import assert from 'node:assert/strict';
import {BoxGeometry,Matrix4,Vector3} from 'three';
import {restoreMarkLocation,transformMarkLocation,assignMarkLocations} from '../src/mark-locations.mjs';
import {textMesh} from '../src/features.mjs';
import {transformData} from '../src/engine.mjs';
const mark={point:[2,3,5],normal:[0,0,1],text:'T001.2',size:3,depth:.6,rotation:37,emboss:false,autoId:true};
function box(x=0){const g=new BoxGeometry(10,10,10);g.translate(x,0,0);return {vertices:g.attributes.position.array,triangles:g.index.array};}
function near(a,b,tolerance=1e-5){assert.equal(a.length,b.length);a.forEach((value,i)=>assert.ok(Math.abs(value-b[i])<tolerance,`entry ${i}: ${value} ≠ ${b[i]}`));}
test('text position, normal and baseline follow arbitrary print orientation',()=>{
 const matrix=new Matrix4().makeRotationX(1.4).multiply(new Matrix4().makeRotationZ(.8));matrix.setPosition(10,-20,30);
 const m=transformMarkLocation(mark,matrix),expected=transformData(textMesh(mark.text,mark.point,mark.normal,mark.size,mark.depth,mark.rotation),matrix);
 const actual=textMesh(m.text,m.point,m.normal,m.size,m.depth,m.rotation);near(actual.vertices,expected.vertices);assert.equal(m.autoId,true);
 const restored=transformMarkLocation(m,matrix.clone().invert());near(restored.point,mark.point);near(restored.normal,mark.normal);assert.ok(Math.abs(restored.rotation-mark.rotation)<1e-8);
});
test('uniform resize transforms stored text dimensions as well as its anchor',()=>{
 const m=transformMarkLocation(mark,new Matrix4().makeScale(2,2,2));near(m.point,[4,6,10]);assert.equal(m.size,6);assert.equal(m.depth,1.2);
});
test('source marking maps to oriented closed surface and retains glyph rotation',()=>{
 const matrix=new Matrix4().makeRotationY(.7);matrix.setPosition(25,30,40);const p=transformData(box(),matrix);
 assert.deepEqual(assignMarkLocations([p],[mark]),{assigned:1,unassigned:0});const expected=transformMarkLocation(mark,matrix);near(p.plannedMark.point,expected.point);near(p.plannedMark.normal,expected.normal);assert.ok(Math.abs(p.plannedMark.rotation-expected.rotation)<1e-8);
});
test('mark on shared cut boundary remains unassigned instead of selecting an arbitrary neighbor',()=>{
 const parts=[box(-5),box(5)];assert.deepEqual(assignMarkLocations(parts,[{...mark,point:[0,0,5]}]),{assigned:0,unassigned:1});assert.ok(parts.every(p=>!p.plannedMark));
});
test('opposite face across a thin shell is never substituted for the chosen surface',()=>{
 const p={vertices:new Float32Array([0,0,0,0,10,0,10,0,0]),triangles:new Uint32Array([0,1,2])};
 assert.equal(assignMarkLocations([p],[{...mark,point:[2,2,.1]}]).assigned,0);
});
test('second mark targeting an occupied part is reported rather than moved to another part',()=>{
 const parts=[box(),box(11)];const position={...mark,point:[5,0,0],normal:[1,0,0]};assert.deepEqual(assignMarkLocations(parts,[position,position]),{assigned:1,unassigned:1});assert.equal(parts[1].plannedMark,undefined);
});
test('invalid saved annotation fails before geometry rendering',()=>{
 for(const invalid of [{...mark,point:[NaN,0,0]},{...mark,normal:[0,0,0]},{...mark,text:'<script>'},{...mark,depth:Infinity},{...mark,size:1000}])assert.throws(()=>restoreMarkLocation(invalid),/Ungültige/);
 assert.equal(restoreMarkLocation(null),undefined);assert.deepEqual(restoreMarkLocation({...mark,normal:[0,0,3]}).normal,[0,0,1]);
});
import {restoreInteriorRegion} from '../src/mark-locations.mjs';
test('saved interior selection is validated as an open surface, without requiring caps',()=>{
 const region=restoreInteriorRegion({vertices:[0,0,0,1,0,0,0,1,0],triangles:[0,1,2]});assert.ok(region.vertices instanceof Float64Array);assert.equal(region.triangles.length,3);
 for(const value of [{vertices:[0,0,0],triangles:[0,1,2]},{vertices:[0,0,NaN],triangles:[0,0,0]},{vertices:[0,0],triangles:[0,0,0]}])assert.throws(()=>restoreInteriorRegion(value),/Ungültige Innenfläche/);
});

test('unsupported scaling cannot leave an unrenderable saved annotation',()=>{assert.throws(()=>transformMarkLocation(mark,new Matrix4().makeScale(100,100,100)),/Ungültige/);const tiny={...mark,size:1,depth:.1};assert.doesNotThrow(()=>transformMarkLocation(tiny,new Matrix4().makeRotationY(.3)));});

