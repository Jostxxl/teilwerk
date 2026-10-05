import test from 'node:test';
import assert from 'node:assert/strict';
import {componentCutQuality,normalizeCutQuality,savedPartQuality,partQualityMessages,planStabilityDescription} from '../src/part-quality.mjs';

test('whole-plan review separates positive gravity from useful reserve and unknown checks',()=>{
 const part=(classification,stableUnderGravity,valid=true)=>({printStability:{classification,stableUnderGravity,valid}});
 assert.equal(planStabilityDescription([]),'');
 assert.equal(planStabilityDescription([part('stable',true),part('marginal',true),part('unstable',false),part('no-contact',false),part('invalid',null,false),{}]),'Kippprüfung: 1 mit geometrischer Reserve · 1 mit geringer Kippreserve · 2 mit Kippgefahr oder fehlender Auflage · 2 noch nicht verlässlich geprüft.');
 // Saved or incomplete metadata cannot manufacture a positive result.
 assert.match(planStabilityDescription([part('stable',null)]),/noch nicht verlässlich geprüft/);
});

test('component warnings include group failures without blaming unrelated siblings',()=>{
  const issues=[{reason:'disconnected_group',components:2},{reason:'small_component',component:1,volume:.005},{reason:'severe_overhang',component:0,area:20}];
  assert.deepEqual(componentCutQuality(issues,0).issues.map(i=>i.reason),['disconnected_group','severe_overhang']);
  assert.deepEqual(componentCutQuality(issues,1).issues.map(i=>i.reason),['disconnected_group','small_component']);
});
test('saving and reopening retain unresolved remainder and tiny fragment warnings',()=>{
  const part={remaining:true,requiresCutFace:true,cutQuality:{version:1,issues:[{reason:'small_component',volume:.004876}]}};
  const restored=savedPartQuality(JSON.parse(JSON.stringify(savedPartQuality(part))));
  assert.deepEqual(restored,part);
  assert.match(partQualityMessages(restored).join(' '),/Kleines Reststück.*0,005 mm³.*Restbereich.*Schnittfläche/);
});
test('validated quality metadata drops unknown reasons, malicious text and nonfinite quantities',()=>{
  const restored=normalizeCutQuality({version:1,issues:[{reason:'small_component',volume:Infinity,message:'<script>'},{reason:'disconnected_group',components:2},{reason:'small_component',volume:1},{reason:'made_up'}]});
  assert.deepEqual(restored,{version:1,issues:[{reason:'small_component'},{reason:'disconnected_group',components:2}]});
  assert.equal(normalizeCutQuality({version:99,issues:[]}),undefined);
  assert.deepEqual(partQualityMessages({}),[]);
});
test('current orientation and bed checks supersede stale calculated orientation warnings',()=>{
  const part={cutQuality:{version:1,issues:[{reason:'severe_overhang',area:400},{reason:'outside_bed'},{reason:'no_fitting_cut_face'}]},requiresCutFace:false,overhang:{needsFurtherSplit:false,severeArea:0}};
  assert.deepEqual(partQualityMessages(part,{fits:true}),[]);
  assert.deepEqual(savedPartQuality(part).requiresCutFace,false);
  part.overhang={needsFurtherSplit:true,severeArea:12};
  assert.deepEqual(partQualityMessages(part,{fits:true}),['Überhänge über 60°: 12 mm² – Drucklage und Stützbedarf prüfen']);
});

test('native material lineage survives a project roundtrip without arbitrary metadata',()=>{
 const part={cutLineage:[{ownerId:2,component:0,volume:6.98918,signedGroup:false},{ownerId:'remainder',component:null,volume:25,signedGroup:true},{ownerId:'<script>',component:0,volume:1}]};
 assert.deepEqual(savedPartQuality(JSON.parse(JSON.stringify(savedPartQuality(part)))).cutLineage,part.cutLineage.slice(0,2));
});

test('refined child lineage retains its original owner and split branch',()=>{
 const part={cutLineage:[{ownerId:7,component:0,volume:1500,signedGroup:false,sourceOwnerIds:[5],refinementBranch:[0,1]}]};
 assert.deepEqual(savedPartQuality(JSON.parse(JSON.stringify(savedPartQuality(part)))).cutLineage,part.cutLineage);
 assert.equal(savedPartQuality({cutLineage:[{...part.cutLineage[0],sourceOwnerIds:['invalid']}]}).cutLineage[0].sourceOwnerIds,undefined);
});

test('support orientation provenance and warnings survive saving and reopening',()=>{
 const part={supportNotice:'Überhang prüfen.',supportOrientation:{method:'printfins',candidates:4,printFinsProposals:5,confidence:'high',bedArea:400,severeArea:30,supportArea:80,height:190}};
 assert.deepEqual(savedPartQuality(JSON.parse(JSON.stringify(savedPartQuality(part)))),{cutQuality:undefined,...part});
 assert.equal(savedPartQuality({supportOrientation:{method:'untrusted'}}).supportOrientation,undefined);
 assert.deepEqual(savedPartQuality({supportOrientation:{method:'current',height:Infinity,bedArea:-1}}).supportOrientation,{method:'current'});
});

test('unresolved marking issues remain visible after a project roundtrip',()=>{
 const part={plannedMarkIssue:'Keine sichere Innenfläche für diese Nummer gefunden.'};
 assert.equal(savedPartQuality(JSON.parse(JSON.stringify(savedPartQuality(part)))).plannedMarkIssue,part.plannedMarkIssue);
 assert.equal(savedPartQuality({plannedMarkIssue:{text:'invalid'}}).plannedMarkIssue,undefined);
});
