import {captureExactRefinementProfile,exactRefinementProfileOptions} from './exact-refinement-profile.mjs';
import {exactHash,validateExactAuthority} from './exact-geometry.mjs';
import {validateExactPrintPoseReview,proposeExactPoseRefinement} from './exact-pose-review.mjs';
import {createExactSplitJob} from './exact-split-job.mjs';
import {reviewExactSplitPoses,validateExactSplitPoseReview,compareExactSplitPoseReviews} from './exact-split-pose-review.mjs';

const freeze=v=>{if(v&&typeof v==='object'&&!Object.isFrozen(v)){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const fail=reason=>Object.assign(Error(`Schnittverfeinerung: ${reason}.`),{code:'EXACT_REFINEMENT_SEARCH_REJECTED',reason});
const hash=/^[a-f0-9]{64}$/;
const budgetReasons=new Set(['max_jobs','max_duration','max_added_parts','parent_timeout']);
const finalizationBudgets=new WeakMap();
// A shared capability, not a caller-supplied deadline/hash. Creating the token
// does not start its clock; start/check only after the owned native job settles.
export function createExactFinalizationBudget(maxDurationMs=120000){
 if(!Number.isSafeInteger(maxDurationMs)||maxDurationMs<1||maxDurationMs>120000)throw fail('finalization_budget');
 const token=Object.freeze({});finalizationBudgets.set(token,{maxDurationMs,started:null});return token;
}
export function validateExactFinalizationBudget(token){if(!finalizationBudgets.has(token))throw fail('finalization_budget');return token;}
export function checkExactFinalizationBudget(token){
 const value=finalizationBudgets.get(token);if(!value)throw fail('finalization_budget');
 if(value.started===null)value.started=Date.now();
 if(Date.now()-value.started>=value.maxDurationMs)throw fail('finalization_timeout');
}
export function remainingExactFinalizationBudget(token){
 checkExactFinalizationBudget(token);const value=finalizationBudgets.get(token);return value.maxDurationMs-(Date.now()-value.started);
}

export function createExactRefinementSearch({source,poseReview,sourceRevision,runSplitReview,getCurrentRevision,signal,onProgress,refinementProfile,maxMassCandidates=8,maxStabilityCandidates=8,maxDurationMs=180000}={}){
 if(!hash.test(sourceRevision??'')||typeof runSplitReview!=='function'||typeof getCurrentRevision!=='function'||onProgress!==undefined&&typeof onProgress!=='function'||!Number.isSafeInteger(maxDurationMs)||maxDurationMs<1||maxDurationMs>180000)throw fail('configuration');
 if(signal!==undefined&&(!signal||typeof signal.addEventListener!=='function'||typeof signal.removeEventListener!=='function'||typeof signal.aborted!=='boolean'))throw fail('configuration');
 const profile=captureExactRefinementProfile(refinementProfile),activeClock=refinementProfile==='stability-breadth-v3';
 const authority=validateExactAuthority(source),storedPose=freeze(JSON.parse(JSON.stringify(poseReview))),localPose=validateExactPrintPoseReview(storedPose,authority);
 if(!localPose.selected)throw fail('parent_pose_missing');
 const refinement=proposeExactPoseRefinement(authority,storedPose,exactRefinementProfileOptions(refinementProfile,localPose,{maxMassCandidates,maxStabilityCandidates}));
 const plan={schema:'prinjekt-exact-refinement-search-plan-v1',...profile,sourceRevision,sourceAuthorityHash:authority.authorityHash,storedPoseReviewHash:storedPose.reviewHash,refinementHash:refinement.refinementHash,maxDurationMs,...(activeClock?{parentTimePolicy:'active-search-work-v1'}:{})},planHash=exactHash(JSON.stringify(plan));
 // Cancellation of a native job because the search budget ends is NOT the
 // same as caller cancellation of the whole operation/finalization.
 const lifecycle=new AbortController(),decisions=[];
 let jobController=null,nativeOutcome='none',busy=false,started=null,next=0,best=null,stopReason=null,complete=false,exhaustedReason=null,finalized=null,usedFinalizationBudget=null;
 function stop(reason){if(!stopReason||reason==='cancellation_unconfirmed')stopReason=reason;lifecycle.abort();jobController?.abort();}
 const externalAbort=()=>stop('aborted');signal?.addEventListener('abort',externalAbort,{once:true});if(signal?.aborted)externalAbort();
 let activeElapsed=0,activeSegment=null;
 const remaining=()=>activeClock?maxDurationMs-activeElapsed-(activeSegment===null?0:Math.max(0,Date.now()-activeSegment)):started===null?maxDurationMs:maxDurationMs-(Date.now()-started);
 function lifecycleCheck(){if(stopReason)throw fail(stopReason);}
 function requestBudgetStop(reason='max_duration'){
  if(!budgetReasons.has(reason))throw fail('budget_reason');
  // Timer-facing, idempotent request: an existing terminal failure wins.
  if(stopReason)return snapshot();if(!exhaustedReason)exhaustedReason=reason;jobController?.abort();
  return snapshot();
 }
 function searchCheck(){lifecycleCheck();if(!exhaustedReason&&remaining()<=0)requestBudgetStop('parent_timeout');if(exhaustedReason)throw fail('budget_exhausted');}
 async function bounded(operation,milliseconds,check){
  check();let timer,listener;
  try{return await Promise.race([Promise.resolve().then(operation),new Promise((_,reject)=>{
   timer=setTimeout(()=>reject(fail('callback_timeout')),Math.max(1,milliseconds));listener=()=>reject(fail(stopReason??'aborted'));lifecycle.signal.addEventListener('abort',listener,{once:true});
  })]);}finally{clearTimeout(timer);lifecycle.signal.removeEventListener('abort',listener);}
 }
 async function guard(check=searchCheck,time=remaining){
  check();const current=await bounded(getCurrentRevision,check===searchCheck?10000:Math.min(10000,time()),check);lifecycleCheck();
  if(current?.sourceRevision!==sourceRevision||current?.planHash!==planHash){stop('stale');throw fail('stale');}
  // A revision already observed as stale wins over simultaneous normal budget
  // expiry; it may not be forgotten if a later callback returns the old value.
  check();
 }
 const bestSummary=()=>best?{candidateId:best.review.candidateId,reviewHash:best.review.reviewHash,splitAuthorityHash:best.partition.authorityHash,selection:best.review.selection.selected,needsRefinement:best.review.needsRefinement}:null;
 function snapshot(){return freeze({schema:'prinjekt-exact-refinement-search-v1',...profile,sourceRevision,planHash,sourceAuthorityHash:authority.authorityHash,storedPoseReviewHash:storedPose.reviewHash,refinementHash:refinement.refinementHash,complete,stopReason,exhaustedReason,budgetFinalized:!!finalized,nativeOutcome,candidates:refinement.planes.length,reviewed:next,decisions:[...decisions],best:bestSummary(),orientationBeforeRefinement:true,finiteSearch:true,globalOptimumProven:false,reviewRequired:true,printable:false});}
 async function progress(phase,extra={}){if(onProgress)await bounded(()=>onProgress(freeze({phase,...extra,snapshot:snapshot()})),10000,searchCheck);await guard();}
 function errorIsBudget(error){
  if(error?.code==='EXACT_JOB_TIMEOUT'&&error.cancellationConfirmed===true){requestBudgetStop('parent_timeout');return true;}
  return !!exhaustedReason&&(error?.code==='EXACT_REFINEMENT_SEARCH_REJECTED'&&error.reason==='budget_exhausted'||error?.code==='EXACT_JOB_ABORTED'&&error.cancellationConfirmed===true||['EXACT_BATCH_REFINEMENT_REJECTED','EXACT_BATCH_RESUME_REJECTED'].includes(error?.code)&&error.reason==='budget_exhausted'&&error.nativeSubmission===false&&error.cancellationConfirmed===true);
 }
 function captureFailure(error){
  if(error?.code==='EXACT_JOB_CANCEL_UNCONFIRMED'||error?.cancellationConfirmed===false||nativeOutcome==='unconfirmed_failure')stop('cancellation_unconfirmed');
  else if(error?.reason==='stale'||error?.code==='EXACT_JOB_STALE')stop('stale');
  else if(!stopReason)stop(error?.reason==='callback_timeout'?'callback_timeout':'failed');
 }
 async function step({maxJobs=1}={}){
  if(busy)throw fail('busy');if(!Number.isInteger(maxJobs)||maxJobs<1||maxJobs>32)throw fail('step_budget');busy=true;if(started===null)started=Date.now();if(activeClock)activeSegment=Date.now();
  let deadline;
  try{
   await guard();
   if(localPose.selected.printStability.classification==='stable'&&localPose.selected.printStability.stableUnderGravity===true){complete=true;return snapshot();}
   let jobs=0;
   while(next<refinement.planes.length&&jobs<maxJobs){
    const candidate=refinement.planes[next],job=createExactSplitJob({source:authority,poseReview:storedPose,refinement,candidateId:candidate.id,sourceRevision});
    await progress('submitting',{candidateId:candidate.id});
    searchCheck();jobController=new AbortController();nativeOutcome='pending';
    deadline=setTimeout(()=>{if(!stopReason)requestBudgetStop('parent_timeout');},Math.max(1,remaining()));
    let response;
    try{
     response=await runSplitReview({...job,signal:jobController.signal,getCurrentRevision:async()=>{await guard();return {sourceRevision,planHash:job.planHash};},onProgress:event=>progress('computing',{candidateId:candidate.id,state:event.state})});
     nativeOutcome='returned';
    }catch(error){nativeOutcome=error?.cancellationConfirmed===true?'confirmed_failure':'unconfirmed_failure';throw error;}
    finally{clearTimeout(deadline);deadline=null;jobController=null;}
    lifecycleCheck();
    if(response?.schema!=='prinjekt-exact-split-review-v1'||response.operation!=='split'||response.sourceRevision!==sourceRevision||response.planHash!==job.planHash||response.reviewRequired!==true||response.printable!==false)throw fail('split_result_binding');
    await guard();
    const partition=freeze(JSON.parse(JSON.stringify(response.partition))),review=reviewExactSplitPoses(partition,{source:authority,poseReview:storedPose,refinement,candidateId:candidate.id});await guard();
    const decision=freeze({candidateId:candidate.id,jobPlanHash:job.planHash,splitAuthorityHash:partition.authorityHash,poseReviewHash:review.reviewHash,acceptedForRefinement:review.acceptedForRefinement,needsRefinement:review.needsRefinement,reason:review.selection.reason,selection:review.selection.selected,childCount:review.childCount});
    // The ONLY checkpoint eligible for budget finalization is past native
    // settlement, exact partition + child-pair validation and live revision.
    if(review.acceptedForRefinement&&(!best||compareExactSplitPoseReviews(review,best.review)<0))best={partition,review};
    decisions.push(decision);next++;jobs++;await progress('candidate-reviewed',{candidateId:candidate.id});
   }
   complete=next===refinement.planes.length;await guard();return snapshot();
  }catch(error){
   if(!stopReason&&errorIsBudget(error)&&!['pending','unconfirmed_failure'].includes(nativeOutcome))return snapshot();
   captureFailure(error);throw error;
  }finally{clearTimeout(deadline);if(activeClock&&activeSegment!==null){activeElapsed+=Math.max(0,Date.now()-activeSegment);activeSegment=null;}busy=false;}
 }
 function checkedResult(checked){return freeze({schema:'prinjekt-exact-refinement-result-v1',sourceRevision,planHash,search:snapshot(),acceptedForRefinement:!!best,partition:best?.partition??null,poseReview:checked,reviewRequired:true,printable:false});}
 async function finishAtBudget({reason,maxFinalizationMs=120000,finalizationBudget}={}){
  if(busy)throw fail('busy');
  if(!Number.isSafeInteger(maxFinalizationMs)||maxFinalizationMs<1||maxFinalizationMs>120000)throw fail('finalization_budget');
  lifecycleCheck();if(reason!==undefined)requestBudgetStop(reason);
  if(!exhaustedReason)throw fail('budget_not_exhausted');
  if(['pending','unconfirmed_failure'].includes(nativeOutcome))throw fail('cancellation_unconfirmed');
  const token=validateExactFinalizationBudget(usedFinalizationBudget??finalizationBudget??createExactFinalizationBudget(maxFinalizationMs));
  if(finalizationBudget&&usedFinalizationBudget&&usedFinalizationBudget!==finalizationBudget)throw fail('finalization_budget_changed');
  usedFinalizationBudget=token;busy=true;
  const finalRemaining=()=>remainingExactFinalizationBudget(token),check=()=>{lifecycleCheck();checkExactFinalizationBudget(token);};
  try{
   await guard(check,finalRemaining);
   const checked=best?validateExactSplitPoseReview(best.review,best.partition,{source:authority,poseReview:storedPose,refinement,candidateId:best.review.candidateId}):null;
   await guard(check,finalRemaining);
   finalized=true;
   return checkedResult(checked);
  }catch(error){captureFailure(error);throw error;}
  finally{busy=false;}
 }
 async function result(){
  if(busy)throw fail('busy');
  if(finalized)return finishAtBudget();
  busy=true;if(activeClock)activeSegment=Date.now();
  try{await guard();if(!complete)throw fail('search_incomplete');
   const checked=best?validateExactSplitPoseReview(best.review,best.partition,{source:authority,poseReview:storedPose,refinement,candidateId:best.review.candidateId}):null;await guard();
   return checkedResult(checked);
  }finally{if(activeClock&&activeSegment!==null){activeElapsed+=Math.max(0,Date.now()-activeSegment);activeSegment=null;}busy=false;}
 }
 function dispose(){signal?.removeEventListener('abort',externalAbort);}
 return Object.freeze({planHash,refinement,step,snapshot,result,requestBudgetStop,finishAtBudget,cancel(){externalAbort();dispose();},dispose(){externalAbort();dispose();}});
}
