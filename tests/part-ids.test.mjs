import test from 'node:test';
import assert from 'node:assert/strict';
import {partNumber, normalizePartNumbers, numberReplacementParts, mergedPartNumbers, partMarkNotice} from '../src/part-ids.mjs';

test('part numbers are canonical positive safe integer strings', () => {
  for (const [value, expected] of [[1,'1'],['001','1'],['12','12'],[9007199254740991,'9007199254740991']]) assert.equal(partNumber(value), expected);
  for (const value of ['T001','1.2','0','-1','1e2',' 2',2.5,Infinity,'9007199254740992',null]) assert.equal(partNumber(value), null);
});

test('old projects migrate globally without collisions with already numeric IDs', () => {
  const old = [{id:'T001.1'},{id:'2'},{id:'T001.2'},{id:2},{id:'003'},{id:0}], result = normalizePartNumbers(old);
  assert.deepEqual(result.map(part => part.id), ['1','2','4','5','3','6']);
  assert.deepEqual(normalizePartNumbers(result).map(part => part.id), result.map(part => part.id));
  assert.deepEqual(old.map(part => part.id), ['T001.1','2','T001.2',2,'003',0]);
});

test('whole-model split starts at one and repeated splits retain all sibling numbers', () => {
  let parts = normalizePartNumbers([{id:'T001'}]);
  let replacement = numberReplacementParts(parts, 0, [{},{},{}]);
  assert.deepEqual(replacement.map(part => part.id), ['1','2','3']); parts.splice(0,1,...replacement);
  replacement = numberReplacementParts(parts, 1, [{},{},{}]);
  assert.deepEqual(replacement.map(part => part.id), ['2','4','5']);
  assert.deepEqual(numberReplacementParts(parts,1,replacement),replacement,'accepting a preview must preserve its numbers'); parts.splice(1,1,...replacement);
  replacement = numberReplacementParts(parts, 0, [{},{}]);
  assert.deepEqual(replacement.map(part => part.id), ['1','6']); parts.splice(0,1,...replacement);
  assert.equal(new Set(parts.map(part => part.id)).size, parts.length); assert.deepEqual(parts.map(part => part.id), ['1','6','2','4','5','3']);
});

test('automatic drafts update while custom drafts and physical inscriptions stay unchanged', () => {
  const automatic = {id:'T001.8',plannedMark:{text:'T001.8',autoId:true,point:[1,2,3]},mark:{text:'T001.8',autoId:true}}, manual = {id:'T001.9',plannedMark:{text:'INNEN',autoId:false},mark:{text:'INNEN',autoId:false}};
  const [a,b] = normalizePartNumbers([automatic, manual]);
  assert.equal(a.plannedMark.text,'1'); assert.deepEqual(a.plannedMark.point,[1,2,3]); assert.equal(a.mark.text,'T001.8'); assert.strictEqual(a.mark,automatic.mark);
  assert.strictEqual(b.plannedMark,manual.plannedMark); assert.equal(b.mark.text,'INNEN'); assert.equal(automatic.plannedMark.text,'T001.8');
  assert.match(partMarkNotice(a),/T001\.8.*Teilnummer: 1/); assert.match(partMarkNotice(b),/INNEN.*Teilnummer: 2/); assert.equal(partMarkNotice({id:'1',mark:{text:'1'}}),'');
  const children=numberReplacementParts([{id:'1'},{id:'2'}],0,[{plannedMark:{text:'old',autoId:true}},{plannedMark:{text:'FREI',autoId:false}}]);
  assert.equal(children[0].plannedMark.text,'1');assert.equal(children[1].plannedMark.text,'FREI');assert.equal(children[1].id,'3');
});

test('merges and reordering preserve established numbers and free numbers can be reused', () => {
  const original=[{id:'3'},{id:'1'},{id:'2'},{id:'7'}], groups=[{members:[3]},{members:[0,1]},{members:[2]}];
  assert.deepEqual(mergedPartNumbers(original,groups),['7','1','2']);
  const merged=mergedPartNumbers(original,groups).map(id=>({id}));
  assert.deepEqual(numberReplacementParts(merged,0,[{},{}]).map(part=>part.id),['7','3']);
});

test('invalid existing partitions and reused merge members are rejected', () => {
  assert.throws(()=>numberReplacementParts([{id:'1'},{id:'1'}],0,[{}]),/eindeutig/);
  assert.throws(()=>numberReplacementParts([{id:'1'}],0,[]),/Ungültige/);
  assert.throws(()=>mergedPartNumbers([{id:'1'}],[{members:[0]},{members:[0]}]),/einer Gruppe/);
});
