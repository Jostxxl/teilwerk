// Local saved-part workflow. Geometry and original permission remain owned here;
// only the host's acknowledged publication chooses the current visible result.
import {exactHash} from './exact-geometry.mjs';
import {createExactProjectContext,restoreExactProjectPart,serializeExactProjectPart,createExactProjectPart,getExactProjectPermission} from './exact-project.mjs';
import {transferExactInteriorPermission} from './exact-interior-permission.mjs';
import {deriveExactSupportPlanes} from './exact-support-planes.mjs';
import {reviewExactPrintPoses} from './exact-pose-review.mjs';
import {createExactRefinementTreeReview} from './exact-refinement-tree.mjs';
import {createExactBatchRefinement} from './exact-batch-refinement.mjs';
import {createExactBatchRefinementResume} from './exact-batch-resume.mjs';
import {displayExactModelTree} from './exact-model-workflow.mjs';
import {captureExactRefinementProfile} from './exact-refinement-profile.mjs';

const preparations=new WeakMap(),results=new WeakMap();
const fail=reason=>Object.assign(Error(`Lokale exakte Teilprüfung: ${reason}.`),{code:'EXACT_PART_WORKFLOW_REJECTED',reason});
const freeze=v=>{if(v&&typeof v==='object'&&!ArrayBuffer.isView(v)&&!Object.isFrozen(v)){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const plain=v=>JSON.parse(JSON.stringify(v,(_,x)=>ArrayBuffer.isView(x)?Array.from(x):x));
const defaultBudget={maxAddedParts:8,maxDepth:3,maxJobs:24,maxDurationMs:300000,maxParentDurationMs:120000,maxMassCandidates:8,maxStabilityCandidates:4};
const caps={maxAddedParts:96,maxDepth:3,maxJobs:512,maxDurationMs:900000,maxParentDurationMs:180000,maxMassCandidates:32,maxStabilityCandidates:24};
function budget(value={}){
 if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw fail('budget');
 const out={...defaultBudget};for(const k of Reflect.ownKeys(value)){const d=Object.getOwnPropertyDescriptor(value,k);if(typeof k!=='string'||!Object.hasOwn(caps,k)||!d?.enumerable||!Object.hasOwn(d,'value'))throw fail('budget');out[k]=d.value;}
 for(const [k,n]of Object.entries(out))if(!Number.isSafeInteger(n)||n<(k.includes('Duration')?1:0)||n>caps[k])throw fail('budget');
 if(out.maxMassCandidates+out.maxStabilityCandidates>32)throw fail('budget');return freeze(out);
}
function bed(value){
 if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype||Reflect.ownKeys(value).length!==4)throw fail('bed');
 const out=[];for(let i=0;i<3;i++){const d=Object.getOwnPropertyDescriptor(value,String(i)),n=d?.value;if(!d||!Object.hasOwn(d,'value')||!Number.isFinite(n)||n<1||n>10000)throw fail('bed');out.push(n);}return freeze(out);
}
function callbacks({getCurrentRevision,signal,onProgress}){
 if(typeof getCurrentRevision!=='function'||onProgress!==undefined&&typeof onProgress!=='function'||signal!==undefined&&(!signal||typeof signal.addEventListener!=='function'||typeof signal.removeEventListener!=='function'||typeof signal.aborted!=='boolean'))throw fail('callbacks');
 const check=()=>{if(signal?.aborted)throw fail('aborted');};
 async function bounded(fn){let timer,abort;check();try{return await Promise.race([Promise.resolve().then(fn),new Promise((_,reject)=>{timer=setTimeout(()=>reject(fail('callback_timeout')),10000);abort=()=>reject(fail('aborted'));signal?.addEventListener('abort',abort,{once:true});})]);}finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}}
 async function current(sourceRevision,planHash,phase){check();const v=await bounded(()=>getCurrentRevision({sourceRevision,planHash,phase}));check();if(v?.sourceRevision!==sourceRevision||v?.planHash!==planHash)throw fail('stale');return v;}
 async function progress(phase,counts={}){check();if(onProgress)await bounded(()=>onProgress(freeze({phase,...counts})));check();}
 return {check,current,progress};
}
function annotationGate(raw){
 if(!raw||typeof raw!=='object')throw fail('part');
 // Do not execute arbitrary getters before the project validator detaches it.
 for(const k of ['mark','exactMachining','plannedMark']){const d=Object.getOwnPropertyDescriptor(raw,k);if(d&&!Object.hasOwn(d,'value'))throw fail('part_accessor');if(d?.value!=null)throw fail(k==='plannedMark'?'pending_mark_transfer_unavailable':'physical_mark_not_recuttable');}
}

/** Heavy preparation belongs in the worker. The exact project validator owns
 * the complete source capsule. Numeric interiorRegion is never recaptured. */
export function prepareExactPartReview({part,permissionSources,usableBed}={}){
 annotationGate(part);const capacity=bed(usableBed),context=createExactProjectContext({permissionSources});
 const restored=restoreExactProjectPart(part,{context}),base=freeze(plain(serializeExactProjectPart(restored,{context}))),source=restored.exactGeometry.authority;
 const permissionRevision=restored.exactInteriorPermission?.sourceRevision??null;
 const permission=permissionRevision?getExactProjectPermission(context,permissionRevision):null;
 // Keep all previously verified planes, then add a bounded actual-surface
 // shortlist. Do not throw away the old real contact to make room for a hint.
 const known=restored.exactPoseReview?.configuration.cutPlanes??[],map=new Map(known.map(p=>[p.planeHash,p]));
 for(const p of deriveExactSupportPlanes(source,{maximumPlanes:24,minimumArea:50}))if(map.size<128)map.set(p.planeHash,p);
 const cutPlanes=[...map.values()],retained=restored.exactPoseReview?.selected?.assemblyToPrint;
 const poseReview=cutPlanes.length?reviewExactPrintPoses(source,{usableBed:capacity,cutPlanes,posePolicy:'search',...(retained?{retainedAssemblyToPrint:retained}:{})}):null;
 const identity={schema:'prinjekt-exact-local-part-source-v1',base,usableBed:capacity,permissionSourceRevision:permissionRevision,permissionReviewHash:permission?.reviewHash??null,poseReview};
 const sourceRevision=exactHash(JSON.stringify(identity)),root={id:`part-${sourceRevision.slice(0,32)}`,source,poseReview};
 const initialTree=createExactRefinementTreeReview({roots:[root],splits:[],leaves:[root]});
 const rootBinding=freeze({schema:'prinjekt-exact-local-part-binding-v1',sourceRevision,sourcePartId:base.id,sourceExactLeafId:base.exactLeafId??null,sourceAuthorityHash:source.authorityHash,sourceMeshHash:source.meshHash,basePartHash:exactHash(JSON.stringify(base)),originalPoseReviewHash:base.exactPoseReview?.reviewHash??null,originalAssemblyMatrix:base.assemblyMatrix,permissionSourceRevision:permissionRevision,permissionReviewHash:permission?.reviewHash??null,sourcePermissionHash:base.exactInteriorPermission?.reviewHash??null,usableBed:capacity,initialPoseReviewHash:poseReview?.reviewHash??null,coverageScope:'complete-replacement-relative-to-saved-selected-part',originalRoofCoverageProven:false});
 const display=displayExactModelTree({tree:initialTree});
 const prepared=freeze({kind:'exactLocalPartPreparation',sourceRevision,rootBinding,...display,display:{parts:display.displayParts,mode:'local-part',open:false,frame:'assembly'},descriptor:{...display.summary,mode:'local-part',gridJobs:0,orientationBeforeRefinement:true},reviewRequired:true,printable:false});
 preparations.set(prepared,{prepared,base,source,root,initialTree,context,permission,rootBinding,busy:false,locked:false});return prepared;
}
function ownedPreparation(value){const own=preparations.get(value);if(!own)throw fail('unknown_preparation');return own;}
function enter(own){if(own.locked)throw fail('cancellation_unconfirmed');if(own.busy)throw fail('busy');own.busy=true;}
function poison(own,error){if(error?.cancellationConfirmed===false||error?.code==='EXACT_JOB_CANCEL_UNCONFIRMED'||error?.reason==='cancellation_unconfirmed')own.locked=true;}
function finish(own,batch,planHash,previousJobs=0){
 const display=displayExactModelTree({tree:batch.tree}),summary=freeze({...display.summary,...captureExactRefinementProfile(batch.search.refinementProfile),searchComplete:batch.search.complete,exhaustedReason:batch.search.exhaustedReason??null,addedParts:batch.tree.leafCount-1,nativeJobs:batch.search.nativeJobs,totalNativeJobs:previousJobs+batch.search.nativeJobs,gridJobs:0,orientationBeforeRefinement:true,neighborColorsValidated:false,reviewRequired:true,printable:false});
 const result=freeze({schema:'prinjekt-exact-local-part-review-v1',sourceRevision:own.prepared.sourceRevision,planHash,rootBinding:own.rootBinding,tree:batch.tree,summary,displayParts:display.displayParts,batch,reviewRequired:true,printable:false});
 return result;
}
const progressCounts=s=>({partCount:s.leafCount,addedParts:s.addedParts,nativeJobs:s.nativeJobs,unresolvedCount:s.unresolved?.length??0,complete:s.complete,exhaustedReason:s.exhaustedReason});
async function run({prepared,previous,runSplitReview,getCurrentRevision,signal,onProgress,budget:requested,refinementProfile},resuming){
 const own=resuming?results.get(previous):ownedPreparation(prepared);
 if(!own)throw fail('unknown_review');
 if(typeof runSplitReview!=='function')throw fail('split_callback');
 const profile=captureExactRefinementProfile(refinementProfile),limits=budget(requested),cb=callbacks({getCurrentRevision,signal,onProgress}),sourceRevision=own.prepared.sourceRevision;
 cb.check();enter(own);let batch;
 try{
  await cb.current(sourceRevision,previous?.planHash??sourceRevision,'local-start');
  const shared={...profile,sourceRevision,runSplitReview,getCurrentRevision:()=>cb.current(sourceRevision,batch.planHash,resuming?'local-resume':'local-refinement'),signal,onProgress:event=>cb.progress(resuming?'local-resume':'local-refinement',progressCounts(event.snapshot)),budget:limits};
  batch=resuming?createExactBatchRefinementResume({...shared,tree:previous.tree}):createExactBatchRefinement({...shared,parts:[own.root]});
  let state;do{state=await batch.step({maxJobs:1});await cb.progress('local-refinement',progressCounts(state));await new Promise(r=>setTimeout(r,0));}while(!state.done);
  const checked=await batch.result();await cb.current(sourceRevision,batch.planHash,'local-display');
  const result=finish(own,checked,batch.planHash,previous?.summary.totalNativeJobs??0);
  await cb.current(sourceRevision,batch.planHash,'local-ready');await cb.progress('local-ready',result.summary);await cb.current(sourceRevision,batch.planHash,'local-ready');
  // Do not supersede an earlier owned review before the host's accept-result.
  // A cancelled/unpublished return must leave the old private review usable.
  results.set(result,own);return result;
 }catch(error){poison(own,error);throw error;}finally{batch?.dispose();own.busy=false;}
}
export async function calculateExactPartReview(options={}){return run(options,false);}
export async function resumeExactPartReview(options={}){return run(options,true);}

/** Stages only a complete replacement. Main must compare basePartHash/token,
 * restore staged parts and replace the one selected slot in a single Undo step.
 * Original permission captures remain in the existing central project map. */
export async function createExactPartAdoption({previous,getCurrentRevision,signal,onProgress}={}){
 const own=results.get(previous);if(!own)throw fail('unknown_review');
 const cb=callbacks({getCurrentRevision,signal,onProgress});cb.check();enter(own);
 try{
  const {sourceRevision,planHash}=previous;await cb.current(sourceRevision,planHash,'local-adoption');
  // Fresh full tree validation prevents claimed leaf omission or altered pose.
  const checked=createExactRefinementTreeReview({roots:previous.tree.roots,splits:previous.tree.splits,...(previous.tree.repartitions?{repartitions:previous.tree.repartitions}:{}),leaves:previous.tree.leaves});
  if(checked.roots.length!==1||!same(checked.roots[0],own.root))throw fail('local_root_changed');
  const parts=[];
  for(const [i,leaf]of checked.leaves.entries()){
   await cb.current(sourceRevision,planHash,'local-adoption');
   const rights=own.permission?transferExactInteriorPermission(own.permission,leaf.source,{signal}):null;
   const unchanged=leaf.id===own.root.id,oldLineage=own.base.exactLeafId??own.base.id;
   const exactLeafId=unchanged?oldLineage:`${oldLineage}/edit-${sourceRevision.slice(0,12)}/${leaf.id.slice(own.root.id.length+1)}`;
   if(exactLeafId.length>512)throw fail('lineage_limit');
   const metadata={id:i===0?own.base.id:`pending-${i+1}`,name:checked.leafCount===1?own.base.name:`${own.base.name} · ${i+1}`,note:own.base.note,color:own.base.color,exactLeafId,...(own.base.plannedMarkIssue!==undefined?{plannedMarkIssue:own.base.plannedMarkIssue}:{})};
   parts.push(createExactProjectPart({source:leaf.source,poseReview:leaf.poseReview,permission:rights,metadata,context:own.context}));
   await cb.progress('local-adoption',{completed:i+1,total:checked.leafCount});await new Promise(r=>setTimeout(r,0));
  }
  await cb.current(sourceRevision,planHash,'local-adoption-ready');
  return {schema:'prinjekt-exact-local-part-adoption-v1',sourceRevision,planHash,sourcePartId:own.base.id,basePartHash:own.rootBinding.basePartHash,rootBinding:own.rootBinding,parts,permissionSourceRevisions:own.permission?[own.permission.sourceRevision]:[],summary:previous.summary,requiresNumberAllocation:parts.length>1,requiresProjectRevisionCheck:true,neighborColorsValidated:false,reviewRequired:true,printable:false};
 }finally{own.busy=false;}
}
