import {captureExactRefinementProfile} from './exact-refinement-profile.mjs';
import {EXACT_GEOMETRY_LIMITS,exactHash,validateExactAuthority} from './exact-geometry.mjs';
import {validateExactPrintPoseReview} from './exact-pose-review.mjs';
import {createExactRefinementSearch,createExactFinalizationBudget,validateExactFinalizationBudget,checkExactFinalizationBudget,remainingExactFinalizationBudget} from './exact-refinement-search.mjs';
import {deriveExactRefinementChildren,createExactRefinementTreeReview,validateExactRefinementTreeReview} from './exact-refinement-tree.mjs';

const fail=reason=>Object.assign(Error(`Mehrteil-Schnittverfeinerung: ${reason}.`),{code:'EXACT_BATCH_REFINEMENT_REJECTED',reason});
const hash=/^[a-f0-9]{64}$/;
const freeze=v=>{if(v&&typeof v==='object'&&!Object.isFrozen(v)){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const defaults=Object.freeze({maxAddedParts:96,maxDepth:3,maxJobs:512,maxDurationMs:900000,maxParentDurationMs:180000,maxMassCandidates:8,maxStabilityCandidates:8});
const limits={...defaults,maxMassCandidates:32,maxStabilityCandidates:24};
const encoder=new TextEncoder();

// No caller-owned arrays, accessors, custom serializers or mutable metadata
// survive the capture. Limits apply to the complete batch, not per root.
function detached(value){
 let bytes=0,nodes=0;
 function copy(v,depth){
  if(depth>64||++nodes>16000000)throw fail('input_limit');
  if(v===null||typeof v==='boolean')return v;
  if(typeof v==='number'){if(!Number.isFinite(v))throw fail('input_number');return v;}
  if(typeof v==='string'){bytes+=encoder.encode(v).length;if(bytes>EXACT_GEOMETRY_LIMITS.bytes)throw fail('input_limit');return v;}
  if(!v||typeof v!=='object'||(!Array.isArray(v)&&![Object.prototype,null].includes(Object.getPrototypeOf(v))))throw fail('input_value');
  const keys=Reflect.ownKeys(v),array=Array.isArray(v);
  if(keys.some(k=>typeof k!=='string')||array&&keys.length!==v.length+1)throw fail('input_keys');
  const out=array?[]:{};
  for(const key of keys){
   if(array&&key==='length')continue;
   if(array&&(!/^(0|[1-9]\d*)$/.test(key)||Number(key)>=v.length)||key==='__proto__')throw fail('input_keys');
   const descriptor=Object.getOwnPropertyDescriptor(v,key);
   if(!descriptor?.enumerable||!Object.hasOwn(descriptor,'value'))throw fail('input_accessor');
   bytes+=key.length;if(bytes>EXACT_GEOMETRY_LIMITS.bytes)throw fail('input_limit');
   out[key]=copy(descriptor.value,depth+1);
  }
  return out;
 }
 return freeze(copy(value,0));
}
function configuration(value={}){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!Object.hasOwn(defaults,k)))throw fail('budget');
 const budget={...defaults,...detached(value)};
 for(const [key,n]of Object.entries(budget))if(!Number.isSafeInteger(n)||n<(['maxDurationMs','maxParentDurationMs'].includes(key)?1:0)||n>limits[key])throw fail('budget');
 if(budget.maxMassCandidates+budget.maxStabilityCandidates>32)throw fail('budget');
 return Object.freeze(budget);
}
const stable=pose=>pose?.selected?.printStability?.classification==='stable'&&pose.selected.printStability.stableUnderGravity===true;

/** A bounded, sequential forest of exact review operations. It never adopts
 * geometry into a project. Normal budget finalization may retain an already
 * fully checked best; cancellation keeps the shared job occupied until settlement.
 * Run this orchestration in a worker when reviewing large rational bodies. */
export function createExactBreadthRefinement({parts,tree,sourceRevision,runSplitReview,getCurrentRevision,signal,onProgress,refinementProfile,budget:requestedBudget,finalizationBudget,completionBudget}={}){
 if(!hash.test(sourceRevision??'')||typeof runSplitReview!=='function'||typeof getCurrentRevision!=='function'||onProgress!==undefined&&typeof onProgress!=='function')throw fail('configuration');
 if(signal!==undefined&&(!signal||typeof signal.addEventListener!=='function'||typeof signal.removeEventListener!=='function'||typeof signal.aborted!=='boolean'))throw fail('configuration');
 const profile=captureExactRefinementProfile(refinementProfile),budget=configuration(requestedBudget);
 if(refinementProfile!=='stability-breadth-v3')throw fail('breadth_profile');
 const base=tree===undefined?null:validateExactRefinementTreeReview(tree);
 if(base&&parts!==undefined)throw fail('mixed_roots');
 if(base)parts=base.leaves;
 const depths=new Map(base?.lineage.map(n=>[n.id,n.depth])??[]),priorAdded=base?base.leafCount-base.rootCount:0;
 if(priorAdded>budget.maxAddedParts||Math.max(0,...depths.values())>budget.maxDepth)throw fail('budget_below_history');
 const history=base?freeze({baseTreeHash:base.reviewHash,priorSplitCount:base.splitCount,...(base.version===2?{priorRepartitionCount:base.repartitionCount}:{}),priorAddedParts:priorAdded,priorMaxDepth:Math.max(0,...depths.values()),depthAndPartLimits:'cumulative',jobAndTimeLimits:'this-continuation'}):null;
 if(!Array.isArray(parts)||!parts.length||parts.length>2048)throw fail('parts');
 const initial=detached(parts),roots=base?.roots??initial,records=new Map(),allIds=new Set();let vertices=0,faces=0;
 for(const root of initial){
  if(!root||Object.keys(root).some(k=>!['id','source','poseReview'].includes(k))||typeof root.id!=='string'||!root.id.length||root.id.length>160||/[\x00-\x20\x7f]/.test(root.id)||allIds.has(root.id)||!Object.hasOwn(root,'poseReview'))throw fail('part');
  const source=validateExactAuthority(root.source);vertices+=source.vertexCount;faces+=source.faceCount;
  if(vertices>EXACT_GEOMETRY_LIMITS.vertices||faces>EXACT_GEOMETRY_LIMITS.faces)throw fail('input_limit');
  const localPose=root.poseReview===null?null:validateExactPrintPoseReview(root.poseReview,source);
  allIds.add(root.id);records.set(root.id,{part:root,depth:depths.get(root.id)??0,generation:0,rounds:0,localPose,status:'pending',reason:null});
 }
 for(const node of base?.lineage??[])allIds.add(node.id);
 const queuePolicy='initial-leaves-before-children-one-candidate-round-robin-v3';
 const plan=freeze({schema:'prinjekt-exact-batch-refinement-plan-v1',...profile,sourceRevision,...(history?{history}:{}),roots:initial.map(r=>({id:r.id,sourceAuthorityHash:r.source.authorityHash,poseReviewHash:r.poseReview?.reviewHash??null})),budget,queuePolicy});
 const planHash=exactHash(JSON.stringify(plan)),splits=[...(base?.splits??[])],parentSearches=[],queue=initial.map(r=>r.id),controller=new AbortController();
 const finalBudget=validateExactFinalizationBudget(finalizationBudget??createExactFinalizationBudget()),normalCompletionBudget=validateExactFinalizationBudget(completionBudget??createExactFinalizationBudget());
 let proofBudget=finalBudget;
 const parked=new Map();
 let cursor=0,busy=false,started=null,active=null,nativeInFlight=false,nativeJobs=0,addedParts=priorAdded,complete=false,exhaustedReason=null,stopReason=null,finalizing=false;
 function prioritize(){
  const priority=r=>!r.localPose?.selected?2:stable(r.localPose)?3:r.localPose.selected.printStability.stableUnderGravity===true?1:0;
  const pending=queue.slice(cursor).map((id,index)=>({id,index,r:records.get(id)})).filter(x=>x.r?.status==='pending');
  pending.sort((a,b)=>a.r.generation-b.r.generation||a.r.rounds-b.r.rounds||priority(a.r)-priority(b.r)||a.r.part.source.faceCount-b.r.part.source.faceCount||a.index-b.index);
  queue.splice(cursor,queue.length-cursor,...pending.map(x=>x.id));
 }
 prioritize();
 const remaining=()=>started===null?budget.maxDurationMs:budget.maxDurationMs-(Date.now()-started);
 function stop(reason){if(!stopReason||reason==='cancellation_unconfirmed')stopReason=reason;controller.abort();active?.search.cancel();for(const owned of parked.values())owned.search.cancel();}
 function exhaust(reason){if(stopReason)return;if(!exhaustedReason)exhaustedReason=reason;active?.search.requestBudgetStop(reason);for(const owned of parked.values())owned.search.requestBudgetStop(reason);}
 function requestBudgetStop(reason='max_duration'){if(!['max_jobs','max_duration','max_added_parts'].includes(reason))throw fail('budget_reason');if(!stopReason)exhaust(reason);return snapshot();}
 const externalAbort=()=>stop('aborted');signal?.addEventListener('abort',externalAbort,{once:true});if(signal?.aborted)externalAbort();
 function check(){if(stopReason)throw fail(stopReason);if(finalizing){checkExactFinalizationBudget(proofBudget);if(exhaustedReason)checkExactFinalizationBudget(finalBudget);}}
 async function bounded(callback){
  check();let timer,listener;
  try{return await Promise.race([Promise.resolve().then(callback),new Promise((_,reject)=>{
   timer=setTimeout(()=>reject(fail('callback_timeout')),finalizing?Math.min(10000,remainingExactFinalizationBudget(proofBudget),exhaustedReason?remainingExactFinalizationBudget(finalBudget):Infinity):10000);
   listener=()=>reject(fail(stopReason??'aborted'));controller.signal.addEventListener('abort',listener,{once:true});
  })]);}finally{clearTimeout(timer);controller.signal.removeEventListener('abort',listener);}
 }
 async function guard(){
  check();const revision=await bounded(getCurrentRevision);check();
  if(revision?.sourceRevision!==sourceRevision||revision?.planHash!==planHash){stop('stale');throw fail('stale');}
 }
 function expired(){if(!complete&&!exhaustedReason&&remaining()<=0)exhaust('max_duration');return !!exhaustedReason;}
 function unresolved(){return [...records.values()].filter(r=>!stable(r.localPose)).map(r=>({id:r.part.id,depth:r.depth,reason:!r.localPose?.selected?'missing_pose':r.reason??(exhaustedReason?`budget_${exhaustedReason}`:stopReason??'pending')}));}
 function snapshot(settled=false){return freeze({schema:'prinjekt-exact-batch-refinement-v1',...profile,...(history?{mode:'resume',history}:{}),sourceRevision,planHash,budget,queuePolicy,done:complete||!!exhaustedReason||!!stopReason,complete,exhaustedReason,stopReason,busy:settled?false:busy,activeParentId:active?.id??null,parkedParents:[...parked.values()].map(x=>({id:x.id,reviewed:x.search.snapshot().reviewed,hasBest:!!x.search.snapshot().best})),nativeJobs,addedParts,...(history?{newAddedParts:addedParts-priorAdded}:{}),rootCount:roots.length,leafCount:records.size,splitCount:splits.length,allStable:[...records.values()].every(r=>stable(r.localPose)),unresolved:unresolved(),parentSearches:[...parentSearches],orientationBeforeRefinement:true,finiteSearch:true,globalOptimumProven:false,reviewRequired:true,printable:false});}
 async function progress(phase,extra={}){if(onProgress)await bounded(()=>onProgress(freeze({phase,...extra,snapshot:snapshot()})));await guard();}
 function retire(reason,errorCode){
  if(!active)return;
  const record=records.get(active.id),search=active.search.snapshot();
  if(record){record.status='finished';record.reason=reason;}
  parentSearches.push(freeze({parentId:active.id,depth:record?.depth,reason,...(errorCode?{errorCode}:{}),search}));
  active.search.dispose();active=null;
 }
 function begin(record){
  const existing=parked.get(record.part.id);if(existing){parked.delete(record.part.id);active=existing;record.status='searching';return;}
  let search;
  search=createExactRefinementSearch({...profile,source:record.part.source,poseReview:record.part.poseReview,sourceRevision,maxMassCandidates:budget.maxMassCandidates,maxStabilityCandidates:budget.maxStabilityCandidates,maxDurationMs:Math.max(1,Math.min(budget.maxParentDurationMs,remaining())),signal:undefined,
   getCurrentRevision:async()=>{await guard();return {sourceRevision,planHash:search.planHash};},
   onProgress:event=>progress('parent-progress',{parentId:record.part.id,event}),
   runSplitReview:async request=>{
    await guard();if(expired())throw Object.assign(fail('budget_exhausted'),{nativeSubmission:false,cancellationConfirmed:true});
    if(nativeJobs>=budget.maxJobs){exhaust('max_jobs');throw Object.assign(fail('budget_exhausted'),{nativeSubmission:false,cancellationConfirmed:true});}
    if(nativeInFlight)throw fail('native_slot_busy');
    nativeJobs++;nativeInFlight=true;active.nativeOutcome='pending';
    try{const result=await runSplitReview(request);active.nativeOutcome='returned';return result;}
    catch(error){
     const notSubmitted=['EXACT_BATCH_RESUME_REJECTED','EXACT_BATCH_REFINEMENT_REJECTED'].includes(error?.code)&&error.reason==='budget_exhausted'&&error.nativeSubmission===false&&error.cancellationConfirmed===true;
     if(notSubmitted){nativeJobs--;active.nativeOutcome='none';}
     else active.nativeOutcome=error?.cancellationConfirmed===true?'confirmed_failure':'unconfirmed_failure';
     throw error;
    }
    finally{nativeInFlight=false;}
   }
  });
  active={id:record.part.id,search,nativeOutcome:'none'};record.status='searching';
 }
 async function recover(error){
  if(error?.code==='EXACT_JOB_CANCEL_UNCONFIRMED'||error?.cancellationConfirmed===false){stop('cancellation_unconfirmed');return false;}
  if(stopReason)return false;
  if(error?.reason==='stale'||error?.code==='EXACT_JOB_STALE'){stop('stale');return false;}
  const ownDeadline=['EXACT_REFINEMENT_SEARCH_REJECTED','EXACT_BATCH_REFINEMENT_REJECTED'].includes(error?.code)&&['budget_exhausted','aborted','timeout'].includes(error.reason);
  const clientDeadline=['EXACT_JOB_TIMEOUT','EXACT_JOB_ABORTED'].includes(error?.code)&&error.cancellationConfirmed===true;
  if((ownDeadline||clientDeadline)&&expired()){
   if(!nativeInFlight&&!['pending','unconfirmed_failure'].includes(active?.nativeOutcome)){await finishActiveAtBudget(exhaustedReason);return true;}
   stop('cancellation_unconfirmed');return false;
  }
  if(error?.cancellationConfirmed===true&&['EXACT_JOB_FAILED','EXACT_JOB_TIMEOUT'].includes(error.code)){
   if(error.code==='EXACT_JOB_TIMEOUT')await finishActiveAtBudget('parent_timeout');else retire('parent_failed',error.code);return true;
  }
  if(error?.code==='EXACT_REFINEMENT_SEARCH_REJECTED'&&error.reason==='timeout'&&!nativeInFlight&&!['pending','unconfirmed_failure'].includes(active?.nativeOutcome)){
   await finishActiveAtBudget('parent_timeout');return true;
  }
  stop(error?.reason==='callback_timeout'?'callback_timeout':'failed');return false;
 }
 async function commitResult(selected,result,childProofBudget){
  if(active!==selected)throw fail('active_parent_changed');
  const record=records.get(selected.id);await guard();
  // Expiry ends candidate submission. It does not invalidate a result whose
  // complete geometry proof has already succeeded. Recheck under the shared
  // finalization cap before any actual replacement.
  if(expired()){finalizing=true;proofBudget=finalBudget;checkExactFinalizationBudget(finalBudget);}
  if(childProofBudget)checkExactFinalizationBudget(childProofBudget);
  if(!result.acceptedForRefinement){retire(exhaustedReason?'batch_budget':result.search.exhaustedReason??'no_accepted_candidate');return;}
  const split=freeze({parentId:record.part.id,poseReview:record.part.poseReview,refinement:selected.search.refinement,result});
  const children=deriveExactRefinementChildren(record.part,split);
  if(children.length!==2||children.some(child=>allIds.has(child.id))||children[0].id===children[1].id)throw fail('child_identity');
  if(record.depth+1>budget.maxDepth||addedParts+children.length-1>budget.maxAddedParts)throw fail('cumulative_limit');
  const childRecords=children.map(part=>({part,depth:record.depth+1,generation:record.generation+1,rounds:0,localPose:validateExactPrintPoseReview(part.poseReview,part.source),status:'pending',reason:null}));
  await guard();if(expired()){finalizing=true;proofBudget=finalBudget;checkExactFinalizationBudget(finalBudget);}if(childProofBudget)checkExactFinalizationBudget(childProofBudget);
  // Every fallible proof and child-pose measurement finishes before replacing
  // the parent. No candidate, failed job or half-complete search deletes a leaf.
  const search=selected.search.snapshot();selected.search.dispose();active=null;
  records.delete(record.part.id);
  for(const child of childRecords){allIds.add(child.part.id);records.set(child.part.id,child);queue.push(child.part.id);}
  prioritize();
  splits.push(split);addedParts++;parentSearches.push(freeze({parentId:record.part.id,depth:record.depth,reason:'accepted',childIds:children.map(c=>c.id),search}));
  await progress('parent-replaced',{parentId:record.part.id,childIds:children.map(c=>c.id)});
 }
 async function commitCompleted(){const selected=active,result=await selected.search.result();await commitResult(selected,result);}
 async function finishActiveAtBudget(reason){
  if(!active)return;
  if(nativeInFlight||['pending','unconfirmed_failure'].includes(active.nativeOutcome)){stop('cancellation_unconfirmed');throw fail('cancellation_unconfirmed');}
  const selected=active,proofBudget=exhaustedReason?finalBudget:createExactFinalizationBudget();
  const previous=finalizing;if(exhaustedReason)finalizing=true;
  try{
   const result=await selected.search.finishAtBudget({reason,finalizationBudget:proofBudget});
   await commitResult(selected,result,proofBudget);
  }finally{finalizing=previous;}
 }
 function parkActive(){
  if(!active||nativeInFlight||active.search.snapshot().nativeOutcome==='pending')throw fail('park_with_native');
  const record=records.get(active.id);record.status='pending';record.rounds++;parked.set(active.id,active);queue.push(active.id);active=null;prioritize();
 }
 async function finishAllAtBudget(reason){
  if(nativeInFlight)throw fail('native_slot_busy');
  const previous=finalizing;finalizing=true;proofBudget=finalBudget;
  try{checkExactFinalizationBudget(finalBudget);for(;;){
   await guard();if(!active){const next=parked.values().next().value;if(!next)break;parked.delete(next.id);active=next;}
   if(addedParts>=budget.maxAddedParts){retire('max_added_parts');continue;}
   await finishActiveAtBudget(reason);
  }}finally{finalizing=previous;}
 }
 async function step({maxJobs=1}={}){
  if(busy)throw fail('busy');check();if(!Number.isSafeInteger(maxJobs)||maxJobs<1||maxJobs>512)throw fail('step_budget');
  busy=true;if(started===null)started=Date.now();const firstJobs=nativeJobs;
  let timer;
  try{
   await guard();if(complete)return snapshot(true);
   if(expired()){await finishAllAtBudget(exhaustedReason);return snapshot(true);}
   timer=setTimeout(()=>exhaust('max_duration'),Math.max(1,remaining()));
   for(;;){
    await guard();if(expired()){await finishAllAtBudget(exhaustedReason);break;}
    if(!active){
     while(cursor<queue.length){
      const record=records.get(queue[cursor]);
      if(!record||record.status!=='pending'){cursor++;continue;}
      if(stable(record.localPose)){record.status='finished';record.reason='stable';cursor++;continue;}
      if(!record.localPose?.selected){record.status='finished';record.reason='missing_pose';cursor++;continue;}
      if(record.depth>=budget.maxDepth){record.status='finished';record.reason='max_depth';cursor++;continue;}
      if(addedParts>=budget.maxAddedParts){exhaust('max_added_parts');break;}
      if(nativeJobs>=budget.maxJobs){exhaust('max_jobs');break;}
      if(nativeJobs-firstJobs>=maxJobs)break;
      cursor++;begin(record);break;
     }
     if(exhaustedReason)break;
     if(!active){if(cursor===queue.length)complete=true;break;}
    }
    if(nativeJobs>=budget.maxJobs){exhaust('max_jobs');await finishAllAtBudget('max_jobs');break;}
    if(nativeJobs-firstJobs>=maxJobs)break;
    try{
     const state=await active.search.step({maxJobs:1});
     if(state.exhaustedReason)await finishActiveAtBudget(exhaustedReason??state.exhaustedReason);
     else if(state.complete)await commitCompleted();
     else parkActive();
    }catch(error){if(!await recover(error))throw error;}
   }
   if(exhaustedReason)await finishAllAtBudget(exhaustedReason);
   await guard();return snapshot(true);
  }catch(error){if(!stopReason)stop(error?.reason==='stale'?'stale':'failed');throw error;}
  finally{clearTimeout(timer);busy=false;}
 }
 async function result(){
  if(busy)throw fail('busy');check();busy=true;
  try{
   await guard();if(!complete&&!exhaustedReason)throw fail('batch_incomplete');
   if(active||parked.size)await finishAllAtBudget(exhaustedReason);
   proofBudget=exhaustedReason?finalBudget:normalCompletionBudget;finalizing=true;checkExactFinalizationBudget(proofBudget);
   const leaves=[...records.values()].map(r=>r.part),tree=createExactRefinementTreeReview({roots,splits,...(base?.version===2?{repartitions:base.repartitions}:{}),leaves});await guard();
   return freeze({schema:'prinjekt-exact-batch-refinement-result-v1',...(history?{mode:'resume',history}:{}),sourceRevision,planHash,roots,splits:[...splits],...(base?.version===2?{repartitions:base.repartitions}:{}),leaves,tree,search:snapshot(true),orientationBeforeRefinement:true,finiteSearch:true,globalOptimumProven:false,reviewRequired:true,printable:false});
  }catch(error){if(error?.reason!=='batch_incomplete'&&!stopReason)stop(error?.reason==='stale'?'stale':'failed');throw error;}
  finally{finalizing=false;busy=false;}
 }
 function dispose(){stop('disposed');for(const owned of parked.values())owned.search.dispose();parked.clear();active?.search.dispose();signal?.removeEventListener('abort',externalAbort);}
 return Object.freeze({planHash,step,snapshot:()=>snapshot(),result,requestBudgetStop,cancel(){externalAbort();signal?.removeEventListener('abort',externalAbort);},dispose});
}
