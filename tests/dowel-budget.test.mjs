import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'manifold-3d';
import {fromSolid} from '../src/engine.mjs';
import {dowelPlanningBudget,planDowelConnections,restoreDowelPlan} from '../src/automatic-dowels.mjs';

test('automatic allowance grows for a full roof, has a fixed ceiling, and does not modify mesh metadata',()=>{
 const small=[{triangles:{length:36}},{triangles:{length:36}}],roof=Array.from({length:80},()=>({triangles:{length:48000}})),dense=Array.from({length:2048},()=>({triangles:{length:3000000}})),before=structuredClone({small,roof,dense});
 assert.equal(dowelPlanningBudget(small),120000);assert.ok(dowelPlanningBudget(roof)>=300000);assert.ok(dowelPlanningBudget(roof)>dowelPlanningBudget(small));assert.equal(dowelPlanningBudget(dense),900000);assert.deepEqual({small,roof,dense},before);
});

const api=await Module();api.setup();
function source(){const solid=api.Manifold.cube([10,10,10]);try{return[{...fromSolid(solid),id:'1'}];}finally{solid.delete();}}

test('the default planner records its adaptive budget while an explicit short budget stays authoritative',async()=>{
 const parts=source(),before=structuredClone(parts),automatic=await planDowelConnections(api,parts,[250,250,250]);assert.equal(automatic.settings.maxMillis,dowelPlanningBudget(parts));
 const explicit=await planDowelConnections(api,parts,[250,250,250],{maxMillis:3210});assert.equal(explicit.settings.maxMillis,3210);assert.equal(explicit.completed,true);assert.deepEqual(parts,before);
 await assert.rejects(()=>planDowelConnections(api,parts,[250,250,250],{maxMillis:0}),/Einstellungen/);
});

test('replay preserves the recorded allowance or an explicit override, and cancellation still stops immediately',async()=>{
 const parts=source(),saved=await planDowelConnections(api,parts,[250,250,250],{maxMillis:3210}),replayed=await restoreDowelPlan(api,parts,saved,[250,250,250]);assert.equal(replayed.settings.maxMillis,3210);assert.deepEqual(replayed.order,saved.order);
 const overridden=await restoreDowelPlan(api,parts,saved,[250,250,250],{maxMillis:4321});assert.equal(overridden.settings.maxMillis,4321);
 const stopped=await planDowelConnections(api,parts,[250,250,250],{stop:()=>true});assert.equal(stopped.stopped,true);assert.equal(stopped.completed,false);assert.equal(stopped.stopReason,'requested');assert.deepEqual(stopped.parts,parts);
});
