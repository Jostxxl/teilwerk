import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'manifold-3d';
import {Matrix4,Vector3} from 'three';
import {fromSolid,bounds} from '../src/engine.mjs';
import {printStability} from '../src/print-stability.mjs';
import {comparePrintPoses} from '../src/print-pose-ranking.mjs';
import {orientOnCutFace} from '../src/cut-orientation.mjs';
import {preparePartForSupports} from '../src/support-orientation.mjs';
import {savedPartQuality,partQualityMessages,stabilityDescription} from '../src/part-quality.mjs';
const api=await Module();api.setup();
function ledge(){const stem=api.Manifold.cube([8,20,100]),cap=api.Manifold.cube([100,20,10]),arm=cap.translate([0,0,90]),solid=stem.add(arm);try{return {...fromSolid(solid),id:'19',cutPlanes:[{normal:[0,0,1],offset:0},{normal:[0,0,1],offset:100},{normal:[0,1,0],offset:0},{normal:[0,1,0],offset:20}],assemblyMatrix:new Matrix4().makeTranslation(400,50,20).toArray()};}finally{[stem,cap,arm,solid].forEach(s=>s.delete());}}
test('geometric tipping class takes priority over even a large overhang score',()=>{
 const candidate=(classification,stableUnderGravity,score,angle=10)=>({score,printStability:{valid:true,classification,stableUnderGravity,minimumMargin:angle,gravityMargin:{criticalTiltDegrees:angle}}});
 const stable=candidate('stable',true,1e10),marginal=candidate('marginal',true,0),unstable=candidate('unstable',false,-1e10,-20);
 assert.ok(comparePrintPoses(stable,marginal)<0);assert.ok(comparePrintPoses(marginal,unstable)<0);
 assert.ok(comparePrintPoses(candidate('unstable',false,1e10,-2),unstable)<0);
 assert.ok(comparePrintPoses(candidate('stable',true,10),candidate('stable',true,20))<0);
});
test('cut-face search replaces an overhanging mass with a fitting pose whose center lies inside its footprint',()=>{
 const input=ledge(),old=printStability(input);assert.equal(old.classification,'unstable');
 const result=orientOnCutFace(input,[150,150,150]);assert.equal(result.printStability.classification,'stable');assert.ok(result.printStability.minimumMargin>0);assert.ok(result.cutOrientation.candidates>=3);assert.ok(bounds(result).size.every(x=>x<=150.005));
 assert.equal(printStability(input).minimumMargin,old.minimumMargin,'input unchanged');
});
test('automatic print optimization retains every engraved vertex in assembly coordinates',()=>{
 const input=ledge();input.mark={point:[4,10,40],normal:[1,0,0],text:'19',size:6,depth:.4,rotation:0};
 const result=preparePartForSupports(input,[150,150,150]);assert.equal(result.printStability.classification,'stable');assert.equal(result.mark.text,'19');
 const before=new Matrix4().fromArray(input.assemblyMatrix),after=new Matrix4().fromArray(result.assemblyMatrix);
 for(let i=0;i<input.vertices.length;i+=3){const a=new Vector3().fromArray(input.vertices,i).applyMatrix4(before),b=new Vector3().fromArray(result.vertices,i).applyMatrix4(after);assert.ok(a.distanceTo(b)<1e-4);}
 const a=new Vector3(...input.mark.point).applyMatrix4(before),b=new Vector3(...result.mark.point).applyMatrix4(after);assert.ok(a.distanceTo(b)<1e-4);
});
test('a saved tipping result stays visible and a newly measured pose supersedes its old cut warning',()=>{
 const input=ledge(),measurement=printStability(input),saved=savedPartQuality({printStability:measurement});
 assert.equal(saved.printStability.minimumMargin,measurement.minimumMargin);assert.deepEqual(saved.printStability.centerOfMass,measurement.centerOfMass);assert.match(partQualityMessages(saved).join(' '),/Kippgefahr/);
 const result=orientOnCutFace(input,[150,150,150]);result.cutQuality={version:1,issues:[{reason:'unstable_print_pose'}]};assert.deepEqual(partQualityMessages(result),[]);assert.match(stabilityDescription(result.printStability),/Schwerpunkt innerhalb/);
 assert.equal(savedPartQuality({printStability:{valid:true,classification:'stable',stableUnderGravity:true}}).printStability,undefined);
});
test('a strict print-orientation commit rejects all unsafe candidates and preserves its input',()=>{
 const input=ledge();input.cutPlanes=[{normal:[0,0,1],offset:0}];const before=structuredClone(input);
 assert.throws(()=>preparePartForSupports(input,[150,150,150],{usePrintFins:false,requireStable:true}),/Keine standfeste Drucklage/);
 assert.deepEqual(input,before);
 assert.equal(preparePartForSupports(ledge(),[150,150,150],{requireStable:true}).printStability.stableUnderGravity,true);
});
