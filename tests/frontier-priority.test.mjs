import test from 'node:test';
import assert from 'node:assert/strict';
import {createFrontierPriority} from '../src/frontier-priority.mjs';

const ids = ranked => ranked.map(item => item.child);
test('a drilled common parent cannot put a previous failure before untried children', () => {
  const p = createFrontierPriority(5), graph = [[1,2,3,4],[0],[0],[0],[0]];
  p.rejected(1,graph,[0]);
  p.committed(0,2);
  const ranked = p.rank([1,3,4],graph,[0,2]);
  assert.deepEqual(ids(ranked),[3,4,1]);
  assert.equal(ranked.at(-1).tier,2);
});
test('a newly built contact precedes a mere revision and an unchanged failure', () => {
  const p = createFrontierPriority(7), graph = [[1,2,3,4],[0],[0,4],[0],[0,2,5],[4],[4]];
  for(const child of [1,2,3]) p.rejected(child,graph,[0]);
  p.committed(4,5); // Changes neither old contact of children 1 and 3.
  const ranked = p.rank([1,2,3,6],graph,[0,4,5]);
  assert.deepEqual(ids(ranked),[6,2,1,3]);
  assert.deepEqual(ranked.map(item=>item.tier),[0,1,3,3]);
});
test('an unrelated new body is not a contact-signature change', () => {
  const p = createFrontierPriority(5), graph = [[1],[0],[3],[2,4],[3]];
  p.rejected(1,graph,[0]);
  p.committed(2,3);
  assert.equal(p.rank([1],graph,[0,2,3])[0].tier,3);
});
test('a complete failed frontier still checks EVERY candidate before unresolved', () => {
  const p = createFrontierPriority(5), graph = [[1,2,3,4],[0],[0],[0],[0]], frontier=[1,2,3,4];
  p.rejected(1,graph,[0]);
  const visited=[];
  for(const {child} of p.rank(frontier,graph,[0])) {
    visited.push(child); p.rejected(child,graph,[0]);
  }
  assert.deepEqual(visited,[2,3,4,1]);
  assert.deepEqual([...visited].sort(),frontier);
  // Preserve existing deterministic fallback; do not use the ranked first.
  assert.equal(frontier[0],1);
  assert.deepEqual(ids(p.rank(frontier,graph,[0])),frontier);
});
