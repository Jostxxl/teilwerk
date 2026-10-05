import {captureExactRefinementProfile} from './exact-refinement-profile.mjs';
import {Matrix4} from 'three';
import {exactHash,validateExactAuthority} from './exact-geometry.mjs';
import {deriveExactDisplay} from './exact-geometry-binding.mjs';
import {validateExactGridPlan} from './exact-grid-plan.mjs';
import {validateExactGridPartitionReview} from './exact-grid-partition.mjs';
import {prepareExactGridGroupingIndex,disposeExactGridGroupingIndex} from './exact-grid-grouping.mjs';
import {createExactGroupingSearch} from './exact-auto-grouping.mjs';
import {createExactBatchRefinement} from './exact-batch-refinement.mjs';
import {createExactBatchRefinementResume} from './exact-batch-resume.mjs';
import {validateExactRefinementTreeReview} from './exact-refinement-tree.mjs';
import {validateExactPrintPoseReview} from './exact-pose-review.mjs';
import {validatePreparedExactModel} from './exact-model-preview.mjs';

const fail=reason=>Object.assign(Error(`Exakter Modellvorschlag: ${reason}.`),{code:'EXACT_MODEL_WORKFLOW_REJECTED',reason});
const identity=Object.freeze(new Matrix4().toArray()),privateResults=new WeakMap();
const freeze=v=>{if(v&&typeof v==='object'&&!ArrayBuffer.isView(v)&&!Object.isFrozen(v)){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const groupingDefaults=Object.freeze({maxCandidates:64,maxMillis:300000});
const batchDefaults=Object.freeze({maxAddedParts:96,maxDepth:3,maxJobs:24,maxDurationMs:300000,maxParentDurationMs:120000,maxMassCandidates:8,maxStabilityCandidates:4});
function fields(value,allowed){
 if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw fail('budget');
 const out={};for(const key of Reflect.ownKeys(value)){const d=Object.getOwnPropertyDescriptor(value,key);if(typeof key!=='string'||!allowed.includes(key)||!d?.enumerable||!Object.hasOwn(d,'value'))throw fail('budget');out[key]=d.value;}return out;
}
function configuration(input={}){
 const raw=fields(input,['grouping','batch']),grouping={...groupingDefaults,...fields(raw.grouping===undefined?{}:raw.grouping,Object.keys(groupingDefaults))},batch={...batchDefaults,...fields(raw.batch===undefined?{}:raw.batch,Object.keys(batchDefaults))};
 for(const [key,n]of Object.entries(grouping))if(!Number.isSafeInteger(n)||n<1||n>(key==='maxCandidates'?512:900000))throw fail('budget');
 const caps={maxAddedParts:96,maxDepth:3,maxJobs:512,maxDurationMs:900000,maxParentDurationMs:180000,maxMassCandidates:32,maxStabilityCandidates:24};
 for(const [key,n]of Object.entries(batch))if(!Number.isSafeInteger(n)||n<(key.includes('Duration')?1:0)||n>caps[key])throw fail('budget');
 if(batch.maxMassCandidates+batch.maxStabilityCandidates>32)throw fail('budget');return freeze({grouping,batch});
}
function callbacks({getCurrentRevision,signal,onProgress}){
 if(typeof getCurrentRevision!=='function'||onProgress!==undefined&&typeof onProgress!=='function'||signal!==undefined&&(!signal||typeof signal.addEventListener!=='function'||typeof signal.removeEventListener!=='function'||typeof signal.aborted!=='boolean'))throw fail('configuration');
 const check=()=>{if(signal?.aborted)throw fail('aborted');};
 async function bounded(fn){
  check();let timer,abort;
  try{return await Promise.race([Promise.resolve().then(fn),new Promise((_,reject)=>{timer=setTimeout(()=>reject(fail('callback_timeout')),10000);abort=()=>reject(fail('aborted'));signal?.addEventListener('abort',abort,{once:true});})]);}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
 }
 async function current(sourceRevision,planHash,phase){
  check();const value=await bounded(()=>getCurrentRevision({sourceRevision,planHash,phase}));check();
  if(value?.sourceRevision!==sourceRevision||value?.planHash!==planHash)throw fail('stale');return value;
 }
 async function progress(phase,counts={}){check();if(onProgress)await bounded(()=>onProgress(freeze({phase,...counts})));check();}
 return {check,current,progress};
}
const batchCounts=s=>({rootCount:s.rootCount,partCount:s.leafCount,addedParts:s.addedParts,nativeJobs:s.nativeJobs,unresolvedCount:s.unresolved?.length??0,complete:s.complete,exhaustedReason:s.exhaustedReason});
const groupingCounts=s=>({initializedBodies:s.initializedBodies,sourceBodyCount:s.sourceBodyCount,partCount:s.groupCount,attempts:s.statistics.attempts,merges:s.statistics.merges,complete:s.complete,budgetExhausted:s.budgetExhausted});
const yieldTurn=()=>new Promise(resolve=>setTimeout(resolve,0));

function displayValidatedTree(tree){
 const counts={partCount:tree.leafCount,stable:0,marginal:0,unstable:0,missingPose:0,unresolvedCount:0};
 const displayParts=tree.leaves.map((leaf,index)=>{
  const local=leaf.poseReview===null?null:validateExactPrintPoseReview(leaf.poseReview,leaf.source),selected=local?.selected??null,s=selected?.printStability??null;
  const classification=!selected?'missingPose':s?.valid!==true||s.stableUnderGravity!==true?'unstable':s.classification==='stable'?'stable':'marginal';
  counts[classification]++;if(classification!=='stable'||!Number.isFinite(s?.volume)||s.volume<1000)counts.unresolvedCount++;
  // The authority is already in ABSOLUTE assembly coordinates. Never multiply
  // the original parent's transform into this inverse a second time.
  const assemblyMatrix=selected?new Matrix4().fromArray(selected.assemblyToPrint).invert().toArray():[...identity];
  const display=deriveExactDisplay(leaf.source,{assemblyMatrix,precision:'float32'});
  return freeze({...display,id:leaf.id,exactLeafId:leaf.id,displayNumber:index+1,printPoseAvailable:!!selected,printStability:s,overhang:selected?.overhang??null,bedContactArea:selected?.connectedBedContactArea??0,poseIssue:classification==='missingPose'?'Keine passende Drucklage vorhanden':classification==='unstable'?'Schwerpunkt liegt nicht sicher über der Auflage':classification==='marginal'?'Geringe Standreserve':s.volume<1000?'Kleiner Materialkörper bleibt zur Prüfung erhalten':null,exactReviewOnly:true,reviewRequired:true,printable:false});
 });
 return freeze({displayParts,summary:counts});
}

/** Standalone read-only derivation. No rounded display buffer is an operand or
 * a newly approved engraving surface. Execute on the owning worker. */
export function displayExactModelTree({tree}={}){return displayValidatedTree(validateExactRefinementTreeReview(tree));}

function bindRoots(prepared,partition,grouped,parts){
 const metadata={schema:'prinjekt-exact-model-roots-v1',sourceRevision:prepared.capture.sourceRevision,sourceAuthorityHash:prepared.capture.geometry.authorityHash,sourceMeshHash:prepared.capture.meshHash,sourcePartId:prepared.capture.partId,permissionHash:prepared.capture.interiorPermission.permissionHash,planHash:prepared.plan.planHash,partitionHash:partition.authorityHash,partitionStateHash:partition.stateHash,groupingHash:grouped.grouping.groupingHash,sourceBodyCount:partition.bodyCount,roots:parts.map(p=>({id:p.id,bodyIds:grouped.parts.find(g=>g.id===p.id).bodyIds,authorityHash:p.source.authorityHash,meshHash:p.source.meshHash,poseReviewHash:p.poseReview?.reviewHash??null})),coverageScope:'complete-group-assignment-relative-to-captured-source-and-trusted-grid-arrangement',interiorPermissionTransferred:false};
 return freeze({...metadata,bindingHash:exactHash(JSON.stringify(metadata))});
}
function completed({prepared,rootBinding,grouping,batch,tree,planHash,sourceRevision,gridJobs,previousJobs=0}){
 const display=displayValidatedTree(tree),groupReason=grouping.exhaustedReason,summary=freeze({...display.summary,...captureExactRefinementProfile(batch.search.refinementProfile),searchComplete:grouping.search.complete&&batch.search.complete,exhaustedReason:batch.search.exhaustedReason??groupReason??null,addedParts:batch.search.addedParts,nativeJobs:gridJobs+batch.search.nativeJobs,totalNativeJobs:previousJobs+gridJobs+batch.search.nativeJobs,groupingComplete:grouping.search.complete,groupingMerges:grouping.search.statistics.merges,refinementComplete:batch.search.complete,finiteSearch:true,globalOptimumProven:false,interiorPermissionTransferred:false,neighborColorsValidated:false,reviewRequired:true,printable:false});
 const result=freeze({schema:'prinjekt-exact-model-review-v1',sourceRevision,planHash,tree,summary,displayParts:display.displayParts,rootBinding,prepared,grouping,batch,reviewRequired:true,printable:false});privateResults.set(result,{prepared,rootBinding,grouping});return result;
}

/** Explicit costly stage after the open proposal has been reviewed. The native
 * clients own their promises until safe settlement; this function never races
 * away from a running native job. Failures leave the prepared source untouched. */
export async function calculateExactModelReview({prepared,runGridReview,runSplitReview,getCurrentRevision,signal,onProgress,budgets,refinementProfile}={}){
 if(typeof runGridReview!=='function'||typeof runSplitReview!=='function')throw fail('configuration');
 const profile=captureExactRefinementProfile(refinementProfile),limits=configuration(budgets),cb=callbacks({getCurrentRevision,signal,onProgress});cb.check();
 prepared=validatePreparedExactModel(prepared);
 const source=validateExactAuthority(prepared.capture.geometry),plan=validateExactGridPlan(prepared.plan,source.meshText),sourceRevision=prepared.capture.sourceRevision;
 if(source.meshText!==prepared.capture.meshText||source.meshHash!==prepared.capture.meshHash)throw fail('source_binding');
 const planHash=exactHash(JSON.stringify({schema:'prinjekt-exact-model-workflow-plan-v1',...profile,sourceRevision,planHash:plan.planHash,budgets:limits}));
 let index,search,batch;
 try{
  await cb.current(sourceRevision,planHash,'start');await cb.progress('grid');await cb.current(sourceRevision,planHash,'grid');
  const response=await runGridReview({operation:'grid',inputs:[{id:'source',role:'source',meshText:source.meshText,meshHash:source.meshHash}],plan,sourceRevision,planHash:plan.planHash,signal,getCurrentRevision:()=>cb.current(sourceRevision,plan.planHash,'grid'),onProgress:event=>cb.progress('grid',{state:typeof event?.state==='string'?event.state:null})});
  await cb.current(sourceRevision,planHash,'grid-ready');
  if(response?.schema!=='prinjekt-exact-grid-review-v1'||response.operation!=='grid'||response.sourceRevision!==sourceRevision||response.planHash!==plan.planHash||response.reviewRequired!==true||response.printable!==false)throw fail('grid_result_binding');
  const options={sourceMeshText:source.meshText,plan},partition=validateExactGridPartitionReview(response.partition,options),started=Date.now();
  await cb.progress('grouping-initialize',{sourceBodyCount:partition.bodyCount});
  index=prepareExactGridGroupingIndex(partition,options);
  search=createExactGroupingSearch(index,{sourceRevision,usableBed:plan.usableBed,budget:{maxCandidates:limits.grouping.maxCandidates},signal,getCurrentRevision:()=>cb.current(sourceRevision,plan.planHash,'grouping')});
  let state=search.snapshot(),groupReason=null;
  for(;;){
   await cb.current(sourceRevision,planHash,'grouping');
   if(Date.now()-started>=limits.grouping.maxMillis){if(state.initializedBodies!==state.sourceBodyCount)throw fail('grouping_baselines_budget');groupReason='grouping_max_duration';break;}
   state=await search.step({maxCandidates:1,maxMillis:1000});await cb.progress('grouping',groupingCounts(state));
   if(state.complete||state.budgetExhausted){if(state.budgetExhausted)groupReason='grouping_max_candidates';break;}
   await yieldTurn();
  }
  if(state.initializedBodies!==state.sourceBodyCount)throw fail('grouping_baselines_pending');
  const grouped=await search.finalize(partition,options),byBodies=new Map(grouped.search.groups.map(g=>[g.bodyIds.join(','),g]));
  const parts=grouped.parts.map(part=>{
   const original=byBodies.get(part.bodyIds.join(','));
   if(!original||!original.initialized||original.authorityHash!==part.authorityHash||original.meshHash!==part.meshHash||part.geometry.authorityHash!==part.authorityHash)throw fail('group_pose_binding');
   // Preserve the original full reviewed bank, not finalize()'s single-pose
   // retained derivative. Missing-pose/tiny bodies remain complete roots.
   return {id:part.id,source:part.geometry,poseReview:original.poseReview};
  });
  const rootBinding=bindRoots(prepared,partition,grouped,parts),grouping=freeze({...grouped,exhaustedReason:groupReason,partition});
  search.cancel();search=null;disposeExactGridGroupingIndex(index);index=null;
  await cb.current(sourceRevision,planHash,'refinement');await cb.progress('refinement',{rootCount:parts.length});
  batch=createExactBatchRefinement({...profile,parts,sourceRevision,runSplitReview,getCurrentRevision:()=>cb.current(sourceRevision,batch.planHash,'refinement'),signal,onProgress:event=>cb.progress('refinement',batchCounts(event.snapshot)),budget:limits.batch});
  let batchState;do{batchState=await batch.step({maxJobs:1});await cb.progress('refinement',batchCounts(batchState));await yieldTurn();}while(!batchState.done);
  const result=await batch.result();await cb.current(sourceRevision,planHash,'display');await cb.progress('display',{partCount:result.tree.leafCount});
  const output=completed({prepared,rootBinding,grouping,batch:result,tree:result.tree,planHash,sourceRevision,gridJobs:1});
  await cb.current(sourceRevision,planHash,'ready');await cb.progress('ready',output.summary);await cb.current(sourceRevision,planHash,'ready');return output;
 }finally{batch?.dispose();search?.cancel();if(index)disposeExactGridGroupingIndex(index);}
}

/** Continues only a private result from this worker/module instance. It keeps
 * the original root/grid/permission binding and all accepted branch history. */
export async function resumeExactModelReview({previous,runSplitReview,getCurrentRevision,signal,onProgress,budget,refinementProfile}={}){
 const owned=privateResults.get(previous);if(!owned)throw fail('unknown_previous_review');if(typeof runSplitReview!=='function')throw fail('configuration');
 const profile=captureExactRefinementProfile(refinementProfile),limits=configuration({batch:budget}),cb=callbacks({getCurrentRevision,signal,onProgress}),sourceRevision=previous.sourceRevision;cb.check();
 let resume;
 try{
  await cb.current(sourceRevision,previous.planHash,'resume-start');
  resume=createExactBatchRefinementResume({...profile,tree:previous.tree,sourceRevision,runSplitReview,getCurrentRevision:()=>cb.current(sourceRevision,resume.planHash,'resume'),signal,onProgress:event=>cb.progress('resume',batchCounts(event.snapshot)),budget:limits.batch});
  let state;do{state=await resume.step({maxJobs:1});await cb.progress('resume',batchCounts(state));await yieldTurn();}while(!state.done);
  const batch=await resume.result();await cb.current(sourceRevision,resume.planHash,'display');
  const result=completed({...owned,batch,tree:batch.tree,sourceRevision,planHash:resume.planHash,gridJobs:0,previousJobs:previous.summary.totalNativeJobs});
  await cb.current(sourceRevision,resume.planHash,'ready');await cb.progress('ready',result.summary);await cb.current(sourceRevision,resume.planHash,'ready');return result;
 }finally{resume?.dispose();}
}

/** Build genuine project parts from the privately owned exact review. Display
 * buffers are never promoted to operands. The caller commits only after its
 * final live revision check; failures leave the review and original intact. */
export async function createExactModelAdoption({previous,metadata={},getCurrentRevision,signal,onProgress}={}){
 const owned=privateResults.get(previous);if(!owned)throw fail('unknown_previous_review');
 if(!metadata||Object.keys(metadata).some(k=>!['name','note','palette'].includes(k))||metadata.name!==undefined&&(typeof metadata.name!=='string'||metadata.name.length>100)||metadata.note!==undefined&&(typeof metadata.note!=='string'||metadata.note.length>2000)||metadata.palette!==undefined&&(!Array.isArray(metadata.palette)||metadata.palette.length!==10||metadata.palette.some(c=>!/^#[0-9a-f]{6}$/i.test(c))))throw fail('adoption_metadata');
 const cb=callbacks({getCurrentRevision,signal,onProgress}),{sourceRevision,planHash}=previous;
 await cb.current(sourceRevision,planHash,'adoption');await cb.progress('adoption',{partCount:previous.tree.leafCount});
 const [{transferExactInteriorPermission},{createExactProjectPart,createExactProjectContext,getExactProjectPermission}]=await Promise.all([import('./exact-interior-permission.mjs'),import('./exact-project.mjs')]);
 const capture=owned.prepared.capture,permissionSources={[sourceRevision]:capture},context=createExactProjectContext({permissionSources});
 const permission=getExactProjectPermission(context,sourceRevision),parts=[];
 for(const [index,leaf]of previous.tree.leaves.entries()){
  await cb.current(sourceRevision,planHash,'adoption');
  const rights=transferExactInteriorPermission(permission,leaf.source,{signal});
  parts.push(createExactProjectPart({source:leaf.source,poseReview:leaf.poseReview,permission:rights,metadata:{id:leaf.id,exactLeafId:leaf.id,name:`${metadata.name||'Teil'} · ${index+1}`,note:metadata.note??'',color:metadata.palette?.[index%10]??'#bde780'},context}));
  await cb.progress('adoption',{completed:index+1,total:previous.tree.leafCount});await yieldTurn();
 }
 await cb.current(sourceRevision,planHash,'adoption-ready');
 return {schema:'prinjekt-exact-model-adoption-v1',sourceRevision,sourcePartId:capture.partId,parts,permissionSources,summary:{...previous.summary,permissionComplete:permission.complete,unmappedSelection:permission.unmapped},reviewRequired:true,printable:false};
}

