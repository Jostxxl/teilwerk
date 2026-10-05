import test from 'node:test';
import assert from 'node:assert/strict';
import {connectorGuideFixture} from './connector-guide-fixture.mjs';
import {connectorReadiness,requireCompleteConnectorPlan} from '../src/connector-readiness.mjs';

test('only a connected, computed assembly with complete insertion paths is ready',async()=>{
 const {parts,connectorPlan:plan}=await connectorGuideFixture();
 assert.equal(connectorReadiness(parts,plan).ready,true);
 const partial=structuredClone(plan);partial.connections.pop();partial.pins=partial.pins.filter(p=>partial.connections.some(c=>c.id===p.connectionId));
 // A false positive completed flag must not hide disconnected parts.
 assert.equal(connectorReadiness(parts,partial).ready,false);
 assert.throws(()=>requireCompleteConnectorPlan(parts,partial),/Export angehalten/);
 const unproven=structuredClone(plan);delete unproven.connections[0].insertion.proof;
 assert.equal(connectorReadiness(parts,unproven).ready,false);
 const pending={...plan,completed:false};assert.equal(connectorReadiness(parts,pending).ready,false);
 assert.equal(connectorReadiness(parts,null).planned,false);
 assert.equal(connectorReadiness(parts,null,{required:true}).ready,false);
 assert.throws(()=>requireCompleteConnectorPlan(parts,null,{required:true}),/Passstifte fehlen/);
 assert.equal(connectorReadiness(parts.slice(0,1),null,{required:true}).ready,true);
});
