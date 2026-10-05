import test from 'node:test';
import assert from 'node:assert/strict';
import {buildConnectorGuide} from '../src/connector-guide.mjs';
import {guideAssemblyPlan} from '../src/guide-layout.mjs';
import {BoxGeometry} from 'three';
const parts=()=>[{id:'1',color:'#ff8800'},{id:'2',color:'#44aadd'},{id:'3',color:'#88bb44'}];
function connection(parentId='1',childId='2',extra={}){return {id:`c-${parentId}-${childId}`,parentId,childId,status:'computed',positions:[[10,20,30],[30,20,30]],normal:[0,0,1],pin:{diameter:3,length:5.8,quantity:2,endClearance:.1},hole:{diameter:3.2,depthParent:3,depthChild:3,wallMargin:1},insertion:{direction:[0,0,-1],approachDistance:6,checked:true,scope:'assembled-parts',method:'continuous-triangle-prisms',obstacleIds:[parentId],collisions:[]},validation:{positiveComponents:[1,1],socketEnvelopeOutside:[0,0]},...extra};}
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}

test('parent-first tree order preserves roof IDs and counts loose pins separately',()=>{
 const input=parts().reverse(),links=[connection('2','3'),connection()];links[0].insertion.obstacleIds=['1','2'];
 const plan=buildConnectorGuide(input,links);
 assert.deepEqual(plan.steps.map(p=>p.partId),['1','2','3']);assert.deepEqual(plan.order,[2,1,0]);assert.deepEqual(plan.steps.map(p=>p.parentId),[null,'1','2']);assert.deepEqual(plan.steps.map(p=>p.parentStep),[null,1,2]);assert.equal(plan.steps[2].parentAnchor,'part-2');
 assert.equal(plan.summary.roofParts,3);assert.equal(plan.summary.computedPins,4);assert.equal(plan.summary.assemblyVerifiedConnections,2);assert.equal(plan.billOfMaterials.length,1);assert.equal(plan.billOfMaterials[0].quantity,4);assert.equal(plan.billOfMaterials[0].kind,'loose-pin');assert.deepEqual(plan.billOfMaterials[0].roofPartIds,['1','2','3']);
 assert.deepEqual(input.map(p=>p.id),['3','2','1']);assert.deepEqual(plan.parts.map(p=>p.id),['3','2','1']);
});

test('contact views and arrows stay in assembly space with explicit parent and child directions',()=>{
 const partData=parts();partData[0].assemblyMatrix=[1,0,0,0,0,1,0,0,0,0,1,0,999,999,999,1];
 const plan=buildConnectorGuide(partData,[connection()]),view=plan.steps[1].views;
 assert.deepEqual(view.center,[20,20,30]);assert.deepEqual(view.parent.cameraDirection,[0,0,1]);assert.deepEqual(view.child.cameraDirection,[0,0,-1]);assert.deepEqual(view.insertionArrow.from,[20,20,36]);assert.deepEqual(view.insertionArrow.to,[20,20,30]);assert.equal(view.insertionArrow.movingPartId,'2');assert.equal(view.insertionArrow.stationaryPartId,'1');assert.equal(view.insertionArrow.dashed,false);
 assert.equal(view.points.length,2);assert.deepEqual(view.points[0].parentHole.bottom,[10,20,27]);assert.deepEqual(view.points[0].childHole.bottom,[10,20,33]);assert.deepEqual(view.points[0].pinEnds,[[10,20,27.1],[10,20,32.9]]);assert.ok(Math.abs(view.overview.cameraDirection[2])<.9,'oblique view keeps insertion arrow visibly projected');
});

test('geometrically computed sockets never imply a checked insertion path',()=>{
 const link=connection();link.insertion.checked=false;link.insertion.obstacleIds=[];const step=buildConnectorGuide(parts(),[link]).steps[1];assert.equal(step.geometryStatus,'computed');assert.equal(step.insertionVerification,'unchecked');assert.equal(step.assemblyPathVerified,false);assert.equal(step.views.insertionArrow.dashed,true);assert.ok(step.notes.some(n=>n.includes('noch nicht geometrisch geprüft')));assert.equal(step.connection.insertion.checked,false);
});

test('pair-only checks remain distinct from complete assembly-path checks',()=>{
 const link=connection();link.insertion.scope='pair';const step=buildConnectorGuide(parts(),[link]).steps[1];assert.equal(step.insertionVerification,'pair');assert.equal(step.assemblyPathVerified,false);assert.match(step.notes.join(' '),/nur.*Teil 1/);assert.match(step.notes.join(' '),/Weitere.*nicht freigegeben/);
});

test('a changed build order reveals missing obstacles instead of claiming an assembly proof',()=>{
 const plan=buildConnectorGuide(parts(),[connection(),connection('1','3')]),last=plan.steps[2];assert.deepEqual(last.missingObstacleIds,['2']);assert.equal(last.insertionVerification,'incomplete-for-order');assert.equal(last.assemblyPathVerified,false);assert.equal(last.views.insertionArrow.dashed,true);assert.match(last.notes.join(' '),/Teile 2/);assert.equal(last.connection.insertion.checked,true,'retain the scoped original result without overstating it');
});

test('planned holes and unresolved contacts remain visible without invented pin geometry',()=>{
 const planned=connection('1','2',{status:'planned'}),unresolved={id:'missing-2-3',parentId:'2',childId:'3',status:'unresolved',reason:'Zu wenig Wandstärke für zwei Aufnahmen.'},plan=buildConnectorGuide(parts(),[planned,unresolved]);
 assert.equal(plan.summary.computedPins,0);assert.equal(plan.summary.plannedPins,2);assert.equal(plan.summary.unresolvedConnections,1);assert.equal(plan.steps[1].assemblyPathVerified,false);assert.equal(plan.steps[1].views.insertionArrow.dashed,true);assert.match(plan.steps[1].instruction,/Geplant/);assert.match(plan.steps[1].notes.join(' '),/noch nicht in der Geometrie/);
 assert.equal(plan.steps[2].views,null);assert.equal(plan.steps[2].insertionVerification,'unresolved');assert.match(plan.steps[2].notes.join(' '),/Wandstärke/);assert.equal(plan.steps[2].connection.pin,null);assert.equal(plan.billOfMaterials[0].quantity,2);
});

test('separate roots form explicit groups and never create nonexistent contacts',()=>{
 const plan=buildConnectorGuide(parts(),[]);assert.equal(plan.components.length,3);assert.equal(plan.summary.computedPins,0);assert.ok(plan.steps.every(p=>p.isStart&&p.contacts.length===0&&p.views===null));assert.match(plan.notices.join(' '),/3 getrennte/);
});

test('multiple parent insertion axes and cycles are rejected',()=>{
 assert.throws(()=>buildConnectorGuide(parts(),[connection('1','3'),connection('2','3')]),/mehrere Eltern/);
 assert.throws(()=>buildConnectorGuide(parts(),[connection('1','2'),connection('2','1')]),/Kreis/);
 assert.throws(()=>buildConnectorGuide(parts(),[connection(),connection()]),/eindeutig/);
});

test('unknown IDs and noncanonical roof numbers are never silently migrated by the guide',()=>{
 assert.throws(()=>buildConnectorGuide(parts(),[connection('1','9')]),/vorhandene/);assert.throws(()=>buildConnectorGuide([{id:'T001'},{id:'2'}],[]),/Teilnummern/);assert.throws(()=>buildConnectorGuide([{id:'01'},{id:'2'}],[]),/Teilnummern/);assert.throws(()=>buildConnectorGuide([{id:1},{id:'1'}],[]),/Doppelte/);
});

test('invalid connector geometry and contradictory proof metadata fail visibly',()=>{
 const mutations=[c=>c.normal=[0,0,2],c=>c.positions[0][0]=Infinity,c=>c.positions[1]=[10,20,30],c=>c.positions[1][2]=35,c=>c.insertion.direction=[0,0,1],c=>c.pin.length=8,c=>c.hole.diameter=2,c=>c.pin.quantity=1,c=>c.insertion.approachDistance=1,c=>c.insertion.obstacleIds=[],c=>c.insertion.obstacleIds=['9'],c=>c.insertion.collisions=[{partId:'1'}],c=>c.insertion.method=undefined,c=>c.validation.positiveComponents=[1,2],c=>c.validation.socketEnvelopeOutside=[NaN,0]];
 for(const mutate of mutations){const c=connection();mutate(c);assert.throws(()=>buildConnectorGuide(parts(),[c]),/Passstift-Anleitung/);}
});

test('immutable input metadata is copied without sharing mutable annotation arrays',()=>{
 const input=freeze(parts()),links=freeze([connection()]),before=JSON.stringify(links),plan=buildConnectorGuide(input,links);assert.equal(JSON.stringify(links),before);plan.contacts[0].positions[0][0]=500;plan.contacts[0].validation.positiveComponents[0]=8;plan.contacts[0].insertion.obstacleIds.push('3');assert.equal(links[0].positions[0][0],10);assert.equal(links[0].validation.positiveComponents[0],1);assert.deepEqual(links[0].insertion.obstacleIds,['1']);
});

test('all 43 roof numbers remain separate from the 84 physical loose pins in a complete tree',()=>{
 const allParts=Array.from({length:43},(_,i)=>({id:String(i+1)})),links=allParts.slice(1).map((p,i)=>{const c=connection(String(i+1),p.id);c.insertion.obstacleIds=allParts.slice(0,i+1).map(p=>p.id);return c;}),plan=buildConnectorGuide(allParts,links);
 assert.deepEqual(plan.steps.map(p=>p.partId),allParts.map(p=>p.id));assert.equal(plan.summary.roofParts,43);assert.equal(plan.summary.computedPins,84);assert.equal(plan.steps.length,43);assert.equal(plan.summary.assemblyVerifiedConnections,42);assert.equal(plan.billOfMaterials[0].quantity,84);assert.ok(plan.steps.every(p=>p.contacts.length<=1));
});

function fullyChecked(c,built,oldPins=[]){
 const pinIds=[`${c.id}-P1`,`${c.id}-P2`],proof=obstacleIds=>({status:'verified',verified:true,obstacleIds,motion:[0,0,6],diagnostics:{continuous:true,completed:true}});
 c.insertion.obstacleIds=[...built];c.insertion.proof=proof([...built,...oldPins,...pinIds]);
 c.pinInsertion={checked:true,scope:'assembled-parts',direction:[0,0,-1],approachDistance:6,checks:pinIds.map(id=>({id,proof:proof([...built,...oldPins,...pinIds.filter(p=>p!==id)])}))};return c;
}
const pinFiles=links=>links.flatMap(c=>c.pinInsertion.checks.map(p=>({id:p.id,auxiliary:true,connectionId:c.id,diameter:c.pin.diameter,length:c.pin.length})));

test('explicit non-BFS order and all three swept-path proofs remain authoritative',()=>{
 const first=fullyChecked(connection('1','3'),['1']),second=fullyChecked(connection('1','2'),['1','3'],first.pinInsertion.checks.map(p=>p.id)),links=[second,first],files=pinFiles(links),plan=buildConnectorGuide(parts(),links,{order:[0,2,1],pins:files});
 assert.deepEqual(plan.order,[0,2,1]);assert.deepEqual(plan.steps.map(s=>s.partId),['1','3','2']);assert.equal(plan.summary.completeInsertionVerifiedConnections,2);assert.ok(plan.steps.slice(1).every(s=>s.completeInsertionVerified));assert.equal(plan.pinFiles[0].file,`Passstifte/${files[0].id}.stl`);
 assert.throws(()=>buildConnectorGuide(parts(),links,{order:[2,0,1],pins:files}),/vor seinem Elternteil/);for(const order of [[0,1],[0,1,1],[0,1,9],[0,1,'2']])assert.throws(()=>buildConnectorGuide(parts(),links,{order}),/jeden Teilindex/);
 const reordered=buildConnectorGuide(parts(),links,{order:[0,1,2],pins:files});assert.equal(reordered.steps[2].completeInsertionVerified,false);assert.ok(reordered.steps[2].missingPinObstacleIds.includes('2'));
});

test('missing old pins, peer pins, or a full child proof never become a complete assembly claim',()=>{
 const first=fullyChecked(connection('1','3'),['1']),second=fullyChecked(connection('1','2'),['1','3'],first.pinInsertion.checks.map(p=>p.id)),links=[first,second];
 second.pinInsertion.checks[0].proof.obstacleIds=second.pinInsertion.checks[0].proof.obstacleIds.filter(id=>id!==first.pinInsertion.checks[0].id);let plan=buildConnectorGuide(parts(),links,{order:[0,2,1],pins:pinFiles(links)});assert.equal(plan.steps[2].pinInsertionVerification,'incomplete-for-order');assert.equal(plan.summary.completeInsertionVerifiedConnections,1);
 const c=fullyChecked(connection(),['1']);delete c.insertion.proof;plan=buildConnectorGuide(parts().slice(0,2),[c],{order:[0,1],pins:pinFiles([c])});assert.equal(plan.steps[1].completeInsertionVerified,false);assert.match(plan.steps[1].notes.join(' '),/einschließlich Passstiften/);
 const peer=fullyChecked(connection(),['1']);peer.pinInsertion.checks[0].proof.obstacleIds=['1'];plan=buildConnectorGuide(parts().slice(0,2),[peer],{order:[0,1],pins:pinFiles([peer])});assert.equal(plan.steps[1].completeInsertionVerified,false);
});

test('pin quantities, separate file identities and contradictory continuous proofs fail visibly',()=>{
 for(const mutate of [c=>c.pinInsertion.checks[0].proof.verified=false,c=>c.pinInsertion.checks[0].proof.diagnostics.continuous=false,c=>c.insertion.proof.motion=[6,0,0],c=>c.pinInsertion.checks[0].proof.motion=[0,0,1]]){const c=fullyChecked(connection(),['1']);mutate(c);assert.throws(()=>buildConnectorGuide(parts(),[c]),/Passstift-Anleitung/);}
 const c=fullyChecked(connection(),['1']),files=pinFiles([c]);assert.throws(()=>buildConnectorGuide(parts(),[c],{pins:files.slice(0,1)}),/genau zwei/);assert.throws(()=>buildConnectorGuide(parts(),[c],{pins:[files[0],files[0]]}),/stimmen nicht/);assert.throws(()=>buildConnectorGuide(parts(),[c],{pins:[files[0],{...files[1],diameter:4}]}),/stimmen nicht/);
});

test('the render adapter keeps planner order and validates it before browser rendering',()=>{
 const models=parts().map((p,i)=>{const g=new BoxGeometry(10,10,10);g.translate(i*10,0,0);return {...p,vertices:g.attributes.position.array,triangles:g.index.array};}),first=fullyChecked(connection('1','3'),['1']),second=fullyChecked(connection('1','2'),['1','3'],first.pinInsertion.checks.map(p=>p.id)),links=[second,first],connectorPlan={connections:links,order:[0,2,1],pins:pinFiles(links)};
 const plan=guideAssemblyPlan(models,{connectorPlan});assert.deepEqual(plan.order,[0,2,1]);assert.deepEqual(plan.steps.map(s=>s.partId),['1','3','2']);assert.equal(plan.connectorGuide.summary.completeInsertionVerifiedConnections,2);assert.equal(plan.edges,2);assert.equal(plan.stats.length,3);
 assert.throws(()=>guideAssemblyPlan(models,{connectorPlan:{...connectorPlan,order:undefined}}),/geprüfte Reihenfolge/);
});

test('end-pose withdrawal proofs must oppose insertion direction, never continue through the parent',()=>{
 const child=fullyChecked(connection(),['1']);child.insertion.proof.motion=[0,0,-6];assert.throws(()=>buildConnectorGuide(parts(),[child]),/Wegnachweis/);
 const pin=fullyChecked(connection(),['1']);pin.pinInsertion.checks[1].proof.motion=[0,0,-6];assert.throws(()=>buildConnectorGuide(parts(),[pin]),/Wegnachweis/);
 const valid=fullyChecked(connection(),['1']);assert.equal(buildConnectorGuide(parts().slice(0,2),[valid],{pins:pinFiles([valid])}).steps[1].completeInsertionVerified,true);
});
