import test from 'node:test';
import assert from 'node:assert/strict';
import {connectorSettings,connectorPartDecorations,savedConnectorPlan,connectorPinFilename,connectorGeometryOperations} from '../src/connector-project.mjs';

test('connector removal keeps decoration and manual specs while restoring the untouched base geometry and marks',()=>{
 const base=[{id:'1',vertices:new Float32Array([1,2,3]),mark:{text:'1'},interiorRegion:{vertices:[4,5,6]},assemblyMatrix:[1],color:'#aaaaaa',note:'old'}],current=[{id:'1',vertices:new Float32Array([9,9,9]),mark:{text:'forged'},assemblyMatrix:[2],color:'#112233',name:'A',note:'new',supports:{kind:'manual',fins:[{spec:{point:[1,2,3]}}]}}],before=structuredClone(base);
 const restored=connectorPartDecorations(base,current);assert.deepEqual(base,before);assert.equal(restored[0].vertices,base[0].vertices);assert.equal(restored[0].mark,base[0].mark);assert.equal(restored[0].interiorRegion,base[0].interiorRegion);assert.equal(restored[0].assemblyMatrix,base[0].assemblyMatrix);assert.equal(restored[0].color,'#112233');assert.equal(restored[0].note,'new');assert.equal(restored[0].supports,current[0].supports);
 assert.throws(()=>connectorPartDecorations(base,[{id:'2'}]),/Teilnummern/);assert.throws(()=>connectorPartDecorations(base,[]),/Basisteile/);
});
test('a valid partial plan retains explicit unresolved connections and disallows stopped or reordered results',()=>{
 const result={parts:[{id:'1'},{id:'2'}],pins:[],connections:[{status:'unresolved'}],unresolved:[{reason:'thin_wall'}],completed:false,order:[0,1]};const saved=savedConnectorPlan(result,{});assert.equal(saved.completed,false);assert.deepEqual(saved.unresolved,result.unresolved);assert.deepEqual(saved.settings,{pinDiameter:3,diametralClearance:.2,socketDepth:3,minWall:1});assert.throws(()=>savedConnectorPlan({...result,stopped:true},{}));assert.throws(()=>savedConnectorPlan({...result,order:[1,1]},{}));
});
test('separate pins cannot overwrite roof files or escape the export folder',()=>{
 assert.equal(connectorPinFilename({id:'V-1-2-P1',auxiliary:true}),'Passstifte/V-1-2-P1.stl');for(const id of ['../1','1/2','C:\\x',''])assert.throws(()=>connectorPinFilename({id,auxiliary:true}));assert.throws(()=>connectorPinFilename({id:'1',auxiliary:false}));
});
test('geometry and mark edits are locked while printing and manual fins remain possible',()=>{
 for(const op of ['cut','scale','printOrient','mark','engravePlanned','autoContours'])assert.equal(connectorGeometryOperations.has(op),true);
 for(const op of ['printMeshes','addManualFin','removeManualFin','neighborColors','import','restoreDowels'])assert.equal(connectorGeometryOperations.has(op),false);
 assert.throws(()=>connectorSettings({minWall:.9}),/Materialreserve/);assert.throws(()=>connectorSettings({socketDepth:NaN}));
});
