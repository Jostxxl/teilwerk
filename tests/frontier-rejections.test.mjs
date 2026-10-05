import test from 'node:test';import assert from 'node:assert/strict';
import {createFrontierRejections} from '../src/frontier-rejections.mjs';
const graph=[[1,2],[0],[0,3],[2],[]],failure={child:1,accepted:false,parentFallback:0,reason:'Nicht nachgewiesener Einschub.'};
function remembered(){const cache=createFrontierRejections(5),pin={id:'p1',solid:{}};assert.equal(cache.remember(1,graph,[0],[pin],failure,{complete:true}),true);return{cache,pin};}
test('adding unrelated unresolved bodies may retain only an unresolved outcome',()=>{
 const{cache,pin}=remembered(),result=cache.reuse(1,graph,[0,4],[pin]);
 assert.equal(result.accepted,false);assert.equal(result.rejectionReuse.originalReason,failure.reason);assert.deepEqual(result.rejectionReuse.addedBuilt,[4]);
 assert.equal(result.verified,undefined);assert.match(result.reason,/ungeprüft/);
});
test('a new built contact invalidates a rejection even without geometry changes',()=>{
 const cache=createFrontierRejections(5);cache.remember(2,graph,[0],[],{...failure,child:2},{complete:true});assert.equal(cache.reuse(2,graph,[0,3],[]),null);
});
test('changing ANY old obstacle, including a nonneighbor, invalidates',()=>{
 const cache=createFrontierRejections(5);cache.remember(1,graph,[0,4],[],failure,{complete:true});cache.committed(4,3);assert.equal(cache.reuse(1,graph,[0,4,3],[]),null);
});
test('changing child or contact parent invalidates',()=>{
 for(const pair of [[1,4],[0,4]]){const{cache,pin}=remembered();cache.committed(...pair);assert.equal(cache.reuse(1,graph,[0,4],[pin]),null);}
});
test('removing or replacing or reordering any old obstacle/pin invalidates',()=>{
 const{cache,pin}=remembered();assert.equal(cache.reuse(1,graph,[],[pin]),null);assert.equal(cache.reuse(1,graph,[4,0],[pin]),null);
 assert.equal(cache.reuse(1,graph,[0],[]),null);assert.equal(cache.reuse(1,graph,[0],[{id:pin.id,solid:{}}]),null);assert.equal(cache.reuse(1,graph,[0],[{id:'other',solid:pin.solid}]),null);
});
test('timeouts/stop anywhere in the attempted child and incomplete search cannot be remembered',()=>{
 for(const opts of [{complete:false},{complete:true,attempts:[{reason:'pin_insertion_time_limit'}, {reason:'geometry_error'}]},{complete:true,attempts:[{proof:{reason:'stopped'}}]}]){
  const cache=createFrontierRejections(5);assert.equal(cache.remember(1,graph,[0],[],failure,opts),false);assert.equal(cache.reuse(1,graph,[0,4],[]),null);
 }
});
test('successful results are never remembered or replayed as proofs',()=>{
 const cache=createFrontierRejections(5);assert.equal(cache.remember(1,graph,[0],[],{...failure,accepted:true},{complete:true}),false);assert.equal(cache.reuse(1,graph,[0],[]),null);
});
