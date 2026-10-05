import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'manifold-3d';
import {prepareMarksForExport} from '../src/export-marks.mjs';
import {fromSolid,toSolid,binarySTL} from '../src/engine.mjs';
import {markPart} from '../src/features.mjs';
import {STLLoader} from 'three/addons/loaders/STLLoader.js';
const api=await Module();api.setup();
const fixture=()=>{const solid=api.Manifold.cube([50,50,10]);try{return {...fromSolid(solid),id:'7',plannedMark:{text:'7',point:[20,20,10],normal:[0,0,1],size:6,depth:.4,rotation:0,emboss:false}};}finally{solid.delete();}};
test('a pending number becomes a real recess in the exported STL before export is permitted',async()=>{
 const p=fixture(),before=structuredClone(p),out=await prepareMarksForExport([p],async parts=>({parts:parts.map(part=>({...part,...markPart(api,part,part.plannedMark),mark:part.plannedMark,plannedMark:undefined})),failed:[]}));
 assert.equal(out.engraved,1);assert.deepEqual(p,before);assert.equal(out.parts[0].mark.text,'7');assert.equal(out.parts[0].plannedMark,undefined);
 const bytes=binarySTL(out.parts[0]),geometry=new STLLoader().parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)),vertices=geometry.attributes.position.array,data={vertices,triangles:Uint32Array.from({length:vertices.length/3},(_,i)=>i)},body=toSolid(api,data),parts=body.decompose();
 try{assert.equal(body.status(),'NoError');assert.equal(parts.length,1);assert.ok(body.volume()<25000-.1);assert.ok([...vertices].some((v,i)=>i%3===2&&Math.abs(v-9.6)<1e-4),'STL contains the actual 0.4 mm deep letter bottom');}finally{parts.forEach(s=>s.delete());body.delete();geometry.dispose();}
});
test('a failed native engraving aborts the whole export and keeps all original planned geometry',async()=>{
 const p=fixture(),copy=structuredClone(p);await assert.rejects(prepareMarksForExport([p],async()=>({parts:[{...p,plannedMarkIssue:'Keine Wand'}],failed:[{id:'7',reason:'Keine Wand'}]})),/Gravur für Teil 7.*Keine Wand/);assert.deepEqual(p,copy);
});
test('a partial batch is never accepted as a fully numbered print package',async()=>{
 const a=fixture(),b={...fixture(),id:'8'};await assert.rejects(prepareMarksForExport([a,b],async()=>({parts:[{...a,mark:a.plannedMark,plannedMark:undefined},b],failed:[]})),/Teil 8/);
});
test('existing physical marks are not engraved twice and missing authorized locations block',async()=>{
 const part=fixture(),marked={...part,mark:part.plannedMark,plannedMark:undefined};let called=false;const out=await prepareMarksForExport([marked],()=>{called=true;});assert.equal(called,false);assert.equal(out.parts[0],marked);assert.equal(out.engraved,0);
 await assert.rejects(prepareMarksForExport([{...part,plannedMark:undefined,plannedMarkIssue:'Kein Platz'}],()=>{}),/Teil 7.*Gravurstelle/);
});
