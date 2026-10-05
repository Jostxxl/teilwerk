import test from 'node:test';import assert from 'node:assert/strict';import {createFreshContactPriority} from '../src/frontier-priority-completion.mjs';
test('failed child with a genuinely new built contact is retried before unrelated untouched frontier',()=>{
 const p=createFreshContactPriority(5),neighbors=[[1],[0,2],[1,3],[2,4],[3]];p.rejected(1,neighbors,[0]);assert.deepEqual(p.rank([3,1],neighbors,[0,2]).map(x=>x.child),[1,3]);
});
test('a new reachable untried neighbor runs before a candidate whose contact arrived earlier',()=>{
 const p=createFreshContactPriority(5),neighbors=[[1],[0],[3],[2],[]];assert.deepEqual(p.rank([1,2],neighbors,[0,3]).map(x=>x.child),[2,1]);
});
test('same failed contact does not gain fresh priority; revisions still cause recheck tier',()=>{
 const p=createFreshContactPriority(4),n=[[1,2],[0],[0],[]];p.rejected(1,n,[0]);assert.deepEqual(p.rank([1,2],n,[0]).map(x=>x.child),[2,1]);p.committed(0,3);assert.equal(p.rank([1],n,[0])[0].tier,2);
});
test('all frontier members occur exactly once and equal ties retain preferred order',()=>{
 const p=createFreshContactPriority(5),n=[[1,2,3,4],[0],[0],[0],[0]];assert.deepEqual(p.rank([4,2,1,3],n,[0]).map(x=>x.child),[4,2,1,3]);
});
