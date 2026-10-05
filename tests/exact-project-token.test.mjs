import test from 'node:test';
import assert from 'node:assert/strict';
import {createExactProjectToken} from '../src/exact-project-token.mjs';
const state=()=>({parts:[{id:'1',matrix:[1,0,0,1],vertices:new Float32Array([0,1,2]),authority:Object.freeze({meshText:'literal rational geometry'})},{id:'2',note:'keep',triangles:[0,1,2]}],active:0,sources:{original:{vertices:[0,1,2],selection:{faces:[0,1]}}},settings:{bed:[250,250,250]},automaticMarks:{size:8,depth:.4}});
test('full selected/sibling/settings/permission mutations become sticky stale without JSON',()=>{
 for(const mutate of [s=>s.parts[0].id='3',s=>s.parts[1].note='changed',s=>s.parts[1].triangles[0]=2,s=>s.parts[0].vertices[0]=4,s=>s.sources.original.selection.faces[0]=4,s=>s.settings.bed[0]=200,s=>s.automaticMarks.depth=.6,s=>s.active=1]){
  const s=state(),g=createExactProjectToken({getState:()=>s,token:'fixture'});assert.equal(g.getCurrentProjectToken(),'fixture');mutate(s);assert.equal(g.getCurrentProjectToken(),'stale-fixture');assert.equal(g.stale,true);
 }
});
test('frozen outer records do not hide mutable descendants or typed arrays',()=>{
 for(const typed of [false,true]){const values=typed?new Float64Array([0,1]):[0,1],s={capsule:Object.freeze({values})},g=createExactProjectToken({getState:()=>s,token:'owned'});values[1]=3;assert.equal(g.getCurrentProjectToken(),'stale-owned');}
});
test('new wrappers with identical values and literal negative zero remain exact',()=>{
 let zero=-0;const fixed=Object.freeze({array:Object.freeze([1,2,3])});const g=createExactProjectToken({getState:()=>({fixed,selected:{zero}}),token:'snapshot'});assert.equal(g.getCurrentProjectToken(),'snapshot');zero=0;assert.equal(g.getCurrentProjectToken(),'stale-snapshot');zero=-0;assert.equal(g.getCurrentProjectToken(),'stale-snapshot');
});
test('accessors/cycles fail closed without invoking getters, including mutations after capture',()=>{
 let called=0;const source={a:[1,2]},guard=createExactProjectToken({getState:()=>source,token:'a'});Object.defineProperty(source.a,'0',{get(){called++;return 1;},enumerable:true});assert.equal(guard.getCurrentProjectToken(),'stale-a');assert.equal(called,0);
 const bad={};Object.defineProperty(bad,'getter',{get(){called++;},enumerable:true});assert.throws(()=>createExactProjectToken({getState:()=>bad,token:'a'}));assert.equal(called,0);
 const cycle={};cycle.loop=cycle;assert.throws(()=>createExactProjectToken({getState:()=>cycle,token:'a'}),e=>e.reason==='cycle');
});
test('shared input graphs remain comparable and replacing a source capsule changes the token',()=>{
 const shared={values:[1,2]},s={a:shared,b:shared},guard=createExactProjectToken({getState:()=>s,token:'shared'});assert.equal(guard.getCurrentProjectToken(),'shared');s.b={values:[1,3]};assert.equal(guard.getCurrentProjectToken(),'stale-shared');
});

test('typed-view metadata accessors are rejected without execution and shared buffers stay observable',()=>{
 let calls=0;const data=new Float32Array([1,2]),state={data},guard=createExactProjectToken({getState:()=>state,token:'view'});
 new Float32Array(data.buffer)[1]=3;assert.equal(guard.getCurrentProjectToken(),'stale-view');
 const bad=new Float32Array([1,2]);Object.defineProperty(bad,'note',{get(){calls++;return 'changed';}});
 assert.throws(()=>createExactProjectToken({getState:()=>({bad}),token:'view'}),e=>e.reason==='view');assert.equal(calls,0);
 const late=new Float32Array([1,2]),g=createExactProjectToken({getState:()=>({late}),token:'view'});Object.defineProperty(late,Symbol.iterator,{get(){calls++;return null;}});assert.equal(g.getCurrentProjectToken(),'stale-view');assert.equal(calls,0);
});
