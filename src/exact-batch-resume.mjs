import {createExactBreadthRefinement} from './exact-breadth-refinement.mjs';
import {captureExactRefinementProfile} from './exact-refinement-profile.mjs';
import {exactHash} from './exact-geometry.mjs';
import {validateExactPrintPoseReview} from './exact-pose-review.mjs';
import {createExactBatchRefinement} from './exact-batch-refinement.mjs';
import {createExactFinalizationBudget,validateExactFinalizationBudget,checkExactFinalizationBudget,remainingExactFinalizationBudget} from './exact-refinement-search.mjs';
import {validateExactRefinementTreeReview,createExactRefinementTreeReview} from './exact-refinement-tree.mjs';

const fail=reason=>Object.assign(Error(`Fortsetzung der Schnittverfeinerung: ${reason}.`),{code:'EXACT_BATCH_RESUME_REJECTED',reason});
const hash=/^[a-f0-9]{64}$/;
const freeze=v=>{if(v&&typeof v==='object'&&!Object.isFrozen(v)){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const defaults=Object.freeze({maxAddedParts:96,maxDepth:3,maxJobs:512,maxDurationMs:900000,maxParentDurationMs:180000,maxMassCandidates:8,maxStabilityCandidates:8});
const limits={...defaults,maxMassCandidates:32,maxStabilityCandidates:24};
function config(value={}){
 if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw fail('budget');
 const result={...defaults};
 for(const key of Reflect.ownKeys(value)){
  if(typeof key!=='string'||!Object.hasOwn(defaults,key))throw fail('budget');
  const descriptor=Object.getOwnPropertyDescriptor(value,key);
  if(!descriptor?.enumerable||!Object.hasOwn(descriptor,'value'))throw fail('budget_accessor');
  result[key]=descriptor.value;
 }
 for(const [key,n]of Object.entries(result))if(!Number.isSafeInteger(n)||n<(['maxDurationMs','maxParentDurationMs'].includes(key)?1:0)||n>limits[key])throw fail('budget');
 if(result.maxMassCandidates+result.maxStabilityCandidates>32)throw fail('budget');
 return Object.freeze(result);
}
const stable=p=>p?.selected?.printStability?.classification==='stable'&&p.selected.printStability.stableUnderGravity===true;

/** Continue a complete, independently validated forest without restarting its
 * accepted branches. Depth and added-part limits apply to the ORIGINAL roots;
 * job/time budgets apply to this continuation. One current leaf is delegated
 * at a time so its remaining depth is enforced by the bounded batch API.
 * No historical search diagnostics are treated as an incomplete-search cache. */
export function createExactBatchRefinementResume({tree,sourceRevision,runSplitReview,getCurrentRevision,signal,onProgress,refinementProfile,budget:requestedBudget,finalizationBudget}={}){
 if(refinementProfile==='stability-breadth-v3')return createExactBreadthRefinement({tree,sourceRevision,runSplitReview,getCurrentRevision,signal,onProgress,refinementProfile,budget:requestedBudget,finalizationBudget});
 if(!hash.test(sourceRevision??'')||typeof runSplitReview!=='function'||typeof getCurrentRevision!=='function'||onProgress!==undefined&&typeof onProgress!=='function')throw fail('configuration');
 if(signal!==undefined&&(!signal||typeof signal.addEventListener!=='function'||typeof signal.removeEventListener!=='function'||typeof signal.aborted!=='boolean'))throw fail('configuration');
 const profile=captureExactRefinementProfile(refinementProfile),budget=config(requestedBudget),base=validateExactRefinementTreeReview(tree);
 const depthById=new Map(base.lineage.map(n=>[n.id,n.depth])),priorAddedParts=base.leafCount-base.rootCount,priorMaxDepth=Math.max(...base.lineage.map(n=>n.depth));
 if(priorAddedParts>budget.maxAddedParts||priorMaxDepth>budget.maxDepth)throw fail('budget_below_history');
 // The unchanged batch accepts bounded root IDs. Refuse unsupported historical
 // IDs explicitly rather than rename them or reconstruct a different lineage.
 if(base.leaves.some(p=>p.id.length>160)||base.leaves.length>2048)throw fail('leaf_batch_limit');
 const history=freeze({baseTreeHash:base.reviewHash,priorSplitCount:base.splitCount,...(base.version===2?{priorRepartitionCount:base.repartitionCount}:{}),priorAddedParts,priorMaxDepth,depthAndPartLimits:'cumulative',jobAndTimeLimits:'this-continuation'});
 const plan=freeze({schema:'prinjekt-exact-batch-resume-plan-v1',...profile,sourceRevision,baseTreeHash:base.reviewHash,budget,queuePolicy:'unstable-before-marginal-then-smaller-face-count-leaf-subtrees-v1'}),planHash=exactHash(JSON.stringify(plan));
 const roots=base.roots,splits=[...base.splits],records=new Map(),allIds=new Set(base.lineage.map(n=>n.id)),queue=[];
 for(const part of base.leaves){const localPose=part.poseReview===null?null:validateExactPrintPoseReview(part.poseReview,part.source);records.set(part.id,{part,localPose,depth:depthById.get(part.id),reason:null,status:'pending'});queue.push(part.id);}
 const priority=r=>!r.localPose?.selected?2:stable(r.localPose)?3:r.localPose.selected.printStability.stableUnderGravity===true?1:0;
 queue.sort((a,b)=>priority(records.get(a))-priority(records.get(b))||records.get(a).part.source.faceCount-records.get(b).part.source.faceCount);
 const controller=new AbortController(),parentSearches=[];
 const finalBudget=validateExactFinalizationBudget(finalizationBudget??createExactFinalizationBudget());
 let proofBudget=finalBudget,normalCompletionBudget=null;
 let cursor=0,busy=false,active=null,started=null,nativeJobs=0,newAddedParts=0,complete=false,exhaustedReason=null,stopReason=null,finalizing=false;
 const remaining=()=>started===null?budget.maxDurationMs:budget.maxDurationMs-(Date.now()-started);
 const added=()=>priorAddedParts+newAddedParts;
 function stop(reason){if(!stopReason||reason==='cancellation_unconfirmed')stopReason=reason;controller.abort();active?.batch.cancel();}
 function expire(){if(stopReason)return;exhaustedReason='max_duration';active?.batch.requestBudgetStop('max_duration');}
 const externalAbort=()=>stop('aborted');signal?.addEventListener('abort',externalAbort,{once:true});if(signal?.aborted)externalAbort();
 function check(){if(stopReason)throw fail(stopReason);if(finalizing){checkExactFinalizationBudget(proofBudget);if(exhaustedReason)checkExactFinalizationBudget(finalBudget);}}
 async function bounded(callback){
  check();let timer,listener;
  try{return await Promise.race([Promise.resolve().then(callback),new Promise((_,reject)=>{
   timer=setTimeout(()=>reject(fail('callback_timeout')),finalizing?Math.min(10000,remainingExactFinalizationBudget(proofBudget),exhaustedReason?remainingExactFinalizationBudget(finalBudget):Infinity):10000);listener=()=>reject(fail(stopReason??'aborted'));controller.signal.addEventListener('abort',listener,{once:true});
  })]);}finally{clearTimeout(timer);controller.signal.removeEventListener('abort',listener);}
 }
 async function guard(){check();const value=await bounded(getCurrentRevision);check();if(value?.sourceRevision!==sourceRevision||value?.planHash!==planHash){stop('stale');throw fail('stale');}}
 function unresolved(){return [...records.values()].filter(r=>!stable(r.localPose)).map(r=>({id:r.part.id,depth:r.depth,reason:!r.localPose?.selected?'missing_pose':r.reason??(exhaustedReason?`budget_${exhaustedReason}`:stopReason??'pending')}));}
 function state(settled=false){return freeze({schema:'prinjekt-exact-batch-refinement-v1',...profile,mode:'resume',sourceRevision,planHash,history,budget,queuePolicy:plan.queuePolicy,done:complete||!!exhaustedReason||!!stopReason,complete,exhaustedReason,stopReason,busy:settled?false:busy,activeParentId:active?.id??null,activeSubtree:active?.batch.snapshot()??null,nativeJobs,addedParts:added(),newAddedParts,rootCount:roots.length,leafCount:records.size,splitCount:splits.length,allStable:[...records.values()].every(r=>stable(r.localPose)),unresolved:unresolved(),parentSearches:[...parentSearches],orientationBeforeRefinement:true,finiteSearch:true,globalOptimumProven:false,reviewRequired:true,printable:false});}
 async function progress(phase,extra={}){if(onProgress)await bounded(()=>onProgress(freeze({phase,...extra,snapshot:state()})));await guard();}
 function begin(record){
  let batch;const completionBudget=createExactFinalizationBudget();
  batch=createExactBatchRefinement({...profile,parts:[record.part],sourceRevision,budget:{...budget,maxDepth:budget.maxDepth-record.depth,maxAddedParts:budget.maxAddedParts-added(),maxJobs:budget.maxJobs-nativeJobs,maxDurationMs:Math.max(1,Math.min(budget.maxDurationMs,remaining()))},signal:controller.signal,finalizationBudget:finalBudget,completionBudget,
   getCurrentRevision:async()=>{await guard();return {sourceRevision,planHash:batch.planHash};},
   onProgress:event=>progress('subtree-progress',{parentId:record.part.id,event}),
   runSplitReview:async request=>{
    await guard();
    if(remaining()<=0||exhaustedReason==='max_duration'){expire();throw Object.assign(fail('budget_exhausted'),{nativeSubmission:false,cancellationConfirmed:true});}
    if(nativeJobs>=budget.maxJobs)throw fail('job_budget_invariant');
    // The inner batch owns the single pending promise and acknowledges its
    // cancellation. Do not race this promise or release the active subtree.
    nativeJobs++;active.nativeOutcome='pending';
    try{const result=await runSplitReview(request);active.nativeOutcome='returned';return result;}
    catch(error){active.nativeOutcome=error?.cancellationConfirmed===true?'confirmed_failure':'unknown_failure';throw error;}
   }
  });
  active={id:record.part.id,depth:record.depth,batch,nativeOutcome:'none',completionBudget};record.status='searching';
 }
 async function compose(){
  const owned=active,result=await owned.batch.result();await guard();
  // The inner complete material tree and the outer whole-forest proof share
  // one finalization token. Never grant a new per-layer proof interval.
  proofBudget=exhaustedReason||result.search.exhaustedReason?finalBudget:owned.completionBudget;finalizing=true;checkExactFinalizationBudget(proofBudget);
  if(result.roots.length!==1||result.roots[0].id!==owned.id||result.tree.rootCount!==1)throw fail('subtree_root');
  const parent=records.get(owned.id);
  if(!parent||result.roots[0].source.authorityHash!==parent.part.source.authorityHash||result.roots[0].poseReview?.reviewHash!==parent.part.poseReview?.reviewHash)throw fail('subtree_source_or_pose');
  const freshIds=result.tree.lineage.filter(n=>n.parentId!==null);
  if(freshIds.some(n=>allIds.has(n.id)||owned.depth+n.depth>budget.maxDepth)||added()+result.splits.length>budget.maxAddedParts)throw fail('cumulative_limit_or_id_collision');
  const childDepths=new Map(result.tree.lineage.map(n=>[n.id,owned.depth+n.depth])),issues=new Map(result.search.unresolved.map(x=>[x.id,x.reason]));
  const next=result.leaves.map(part=>({part,depth:childDepths.get(part.id),localPose:part.poseReview===null?null:validateExactPrintPoseReview(part.poseReview,part.source),status:'finished',reason:issues.get(part.id)??'stable'}));
  await guard();
  if(remaining()<=0)expire();check();
  // All accepted local branches and all untouched material are transferred
  // together only after the local tree proof. Final result rechecks the whole
  // original forest, including its historical branches, independently.
  if(result.splits.length)records.delete(owned.id);
  for(const record of next)records.set(record.part.id,record);
  for(const node of freshIds)allIds.add(node.id);
  splits.push(...result.splits);newAddedParts+=result.splits.length;
  parentSearches.push(freeze({parentId:owned.id,depth:owned.depth,newSplitCount:result.splits.length,search:result.search}));
  owned.batch.dispose();active=null;
  if(result.search.exhaustedReason)exhaustedReason=result.search.exhaustedReason;
  await progress('subtree-composed',{parentId:owned.id,newSplitCount:result.splits.length});
  finalizing=false;
 }
 async function step({maxJobs=1}={}){
  if(busy)throw fail('busy');check();if(!Number.isSafeInteger(maxJobs)||maxJobs<1||maxJobs>512)throw fail('step_budget');
  busy=true;if(started===null)started=Date.now();const first=nativeJobs;let deadline;
  try{
   await guard();if(complete||exhaustedReason)return state(true);
   deadline=setTimeout(expire,Math.max(1,remaining()));
   for(;;){
    await guard();
    if(remaining()<=0)expire();
    if(active){
     if(exhaustedReason==='max_duration'){
      active.batch.requestBudgetStop('max_duration');
      await active.batch.step({maxJobs:1});await compose();continue;
     }
     // Even after a wall-clock limit, let the inner batch finish its normal
     // budget transition/acknowledgement and return its complete material tree.
     const allowance=Math.min(maxJobs-(nativeJobs-first),budget.maxJobs-nativeJobs);
     if(allowance<=0){
      const pending=active.batch.snapshot();
      if(pending.done){await compose();continue;}
      // A previous step used its quota; the global inner budget transition is
      // completed by one further step, which cannot launch beyond its own cap.
      if(nativeJobs>=budget.maxJobs){await active.batch.step({maxJobs:1});await compose();continue;}
      break;
     }
     const snapshot=await active.batch.step({maxJobs:allowance});
     if(snapshot.done)await compose();else break;
     continue;
    }
    if(exhaustedReason)break;
    if(remaining()<=0){exhaustedReason='max_duration';break;}
    while(cursor<queue.length){
     const record=records.get(queue[cursor]);
     if(!record||record.status!=='pending'){cursor++;continue;}
     if(stable(record.localPose)){record.status='finished';record.reason='stable';cursor++;continue;}
     if(!record.localPose?.selected){record.status='finished';record.reason='missing_pose';cursor++;continue;}
     if(record.depth>=budget.maxDepth){record.status='finished';record.reason='max_depth';cursor++;continue;}
     if(added()>=budget.maxAddedParts){exhaustedReason='max_added_parts';break;}
     if(nativeJobs>=budget.maxJobs){exhaustedReason='max_jobs';break;}
     if(nativeJobs-first>=maxJobs)break;
     cursor++;begin(record);break;
    }
    if(exhaustedReason)break;
    if(!active){if(cursor===queue.length)complete=true;break;}
   }
   await guard();return state(true);
  }catch(error){
   if(error?.code==='EXACT_JOB_CANCEL_UNCONFIRMED'||error?.cancellationConfirmed===false||active?.batch.snapshot().stopReason==='cancellation_unconfirmed')stop('cancellation_unconfirmed');
   const deadlineError=error?.code==='EXACT_BATCH_RESUME_REJECTED'&&error.reason==='budget_exhausted'||error?.code==='EXACT_BATCH_REFINEMENT_REJECTED'&&error.reason==='aborted'||error?.code==='EXACT_REFINEMENT_SEARCH_REJECTED'&&['aborted','timeout'].includes(error.reason)||['EXACT_JOB_ABORTED','EXACT_JOB_TIMEOUT'].includes(error?.code)&&error.cancellationConfirmed===true;
   if(!stopReason&&exhaustedReason==='max_duration'&&deadlineError&&!['pending','unknown_failure'].includes(active?.nativeOutcome)){
    // This fallback is only for a confirmed/no-submission deadline before the
    // inner normal transition returned. It must finish, never discard, the
    // complete material subtree; any further error remains terminal.
    try{if(active){active.batch.requestBudgetStop('max_duration');await active.batch.step({maxJobs:1});await compose();}}catch(lateError){stop(lateError?.reason==='stale'?'stale':'failed');throw lateError;}
    try{await guard();}catch(lateError){if(!stopReason)stop(lateError?.reason==='stale'?'stale':'failed');throw lateError;}
    return state(true);
   }
   if(!stopReason)stop(error?.reason==='stale'||error?.code==='EXACT_JOB_STALE'?'stale':'failed');
   throw error;
  }finally{clearTimeout(deadline);busy=false;}
 }
 async function result(){
  if(busy)throw fail('busy');check();busy=true;
  try{
   await guard();if(!complete&&!exhaustedReason)throw fail('resume_incomplete');
   if(!normalCompletionBudget)normalCompletionBudget=createExactFinalizationBudget();proofBudget=exhaustedReason?finalBudget:normalCompletionBudget;finalizing=true;checkExactFinalizationBudget(proofBudget);
   const inherited=base.version===2?{repartitions:base.repartitions}:{},leaves=[...records.values()].map(r=>r.part),composed=createExactRefinementTreeReview({roots,splits,...inherited,leaves});await guard();
   return freeze({schema:'prinjekt-exact-batch-refinement-result-v1',mode:'resume',sourceRevision,planHash,history,roots,splits:[...splits],...inherited,leaves,tree:composed,search:state(true),orientationBeforeRefinement:true,finiteSearch:true,globalOptimumProven:false,reviewRequired:true,printable:false});
  }catch(error){if(error?.reason!=='resume_incomplete'&&!stopReason)stop(error?.reason==='stale'?'stale':'failed');throw error;}
  finally{finalizing=false;busy=false;}
 }
 function dispose(){stop('disposed');signal?.removeEventListener('abort',externalAbort);}
 return Object.freeze({planHash,step,snapshot:()=>state(),result,cancel(){externalAbort();signal?.removeEventListener('abort',externalAbort);},dispose});
}
