import {decodeExactProjectPosePayload} from './exact-project-pose-payload.mjs';
import {captureExactRefinementProfile} from './exact-refinement-profile.mjs';
const problem=reason=>Object.assign(Error(`Exakte Modellvorschau: ${reason}.`),{code:'EXACT_MODEL_WORKER_REJECTED',reason});
const token=v=>typeof v==='string'&&v.length>0&&v.length<=200;
const id=v=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(v);
const uncertain=e=>e?.cancellationConfirmed===false||e?.code==='EXACT_JOB_CANCEL_UNCONFIRMED'||e?.reason==='cancellation_unconfirmed';
const record=e=>({message:String(e?.message??'Unbekannter Fehler').slice(0,500),code:String(e?.code??'EXACT_MODEL_WORKER_ERROR').slice(0,100),reason:e?.reason==null?null:String(e.reason).slice(0,200),...(typeof e?.cancellationConfirmed==='boolean'?{cancellationConfirmed:e.cancellationConfirmed}:{})});
const defaults={
 reviewPoses:async value=>(await import('./exact-project-poses.mjs')).reviewExactProjectPoses(value),
 adoptPoses:async value=>(await import('./exact-project-poses.mjs')).stageExactProjectPoseReview(value),
 prepare:async value=>value.mode==='project-part'?(await import('./exact-part-workflow.mjs')).prepareExactPartReview(value):(await import('./exact-model-preview.mjs')).prepareExactModelPreview(value),
 calculate:async value=>value.prepared?.kind==='exactLocalPartPreparation'?(await import('./exact-part-workflow.mjs')).calculateExactPartReview({...value,budget:value.budgets?.batch}):(await import('./exact-model-workflow.mjs')).calculateExactModelReview(value),
 improve:async value=>value.previous?.schema==='prinjekt-exact-local-part-review-v1'?(await import('./exact-part-workflow.mjs')).resumeExactPartReview(value):(await import('./exact-model-workflow.mjs')).resumeExactModelReview(value),
 adopt:async value=>value.previous?.schema==='prinjekt-exact-local-part-review-v1'?(await import('./exact-part-workflow.mjs')).createExactPartAdoption(value):(await import('./exact-model-workflow.mjs')).createExactModelAdoption(value),
 engrave:async value=>(await import('./exact-engrave-workflow.mjs')).engraveExactProjectPart(value),
 createClient:async value=>(await import('./exact-job-client.mjs')).createExactJobClient(value)
};

// Only explicit display fields cross the worker boundary. Exact operands,
// permission capsules, grid arrangements and complete trees stay private.
const displayKeys=['index','vertices','triangles','assemblyMatrix','id','name','color','exactLeafId','displayNumber','printPoseAvailable','displayOnly','exactReviewOnly','openPreview','closed','poseIssue','printStability','overhang','bedFace','bedContactArea'];
function publicDisplay(display){
 if(!display||!Array.isArray(display.parts)||display.parts.length>4096)throw problem('display');
 const parts=display.parts.map(part=>Object.fromEntries(displayKeys.filter(k=>part[k]!==undefined).map(k=>[k,part[k]])));
 return {parts,...Object.fromEntries(['cutPlanes','bounds','open','limited','reason','mode','frame','completeSourceShown','surfacePartitionShown'].filter(k=>display[k]!==undefined).map(k=>[k,display[k]])),displayOnly:true};
}
function publicPoseRows(rows){
 if(!Array.isArray(rows)||rows.length>4096)throw problem('pose_rows');
 const physical=v=>v==null?null:Object.fromEntries(['classification','minimumMargin','criticalTiltDegrees','stableUnderGravity','severeArea','supportArea','bedContactArea','fits','poseAvailable'].filter(k=>typeof v[k]==='string'||typeof v[k]==='boolean'||v[k]===null||typeof v[k]==='number'&&Number.isFinite(v[k])).map(k=>[k,v[k]]));
 return rows.map(r=>({index:r.index,id:r.id,changed:r.changed===true,status:r.status,reason:r.reason??null,before:physical(r.before),after:physical(r.after),alternative:physical(r.alternative)}));
}
// Progress is intentionally scalar/count-only: never copy a nested batch tree
// or an authority through a casually expanded progress record.
const progressKeys=['phase','stage','message','parentId','candidateId','completed','total','nativeJobs','addedParts','rootCount','leafCount','partCount','unresolvedCount','initializedBodies','splitCount','groupCount','sourceBodyCount','attempts','merges','done','complete','budgetExhausted','exhaustedReason','stopReason','activeParentId'];
function publicProgress(value){
 const result={};for(const k of progressKeys){const v=value?.[k];if(v===null||typeof v==='boolean'||typeof v==='number'&&Number.isFinite(v)||typeof v==='string'&&v.length<=500)result[k]=v;}
 const snapshot=value?.snapshot;if(snapshot&&typeof snapshot==='object')result.snapshot=publicProgress({...snapshot,snapshot:undefined});
 return result;
}

/** One worker owns one private active-model review session and its native jobs.
 * Preparation is geometry/display work only; native clients are created only
 * after the explicit calculate operation. Results are transactional. */
export function installExactModelWorker(scope,dependencies={}){
 if(!scope||!['addEventListener','removeEventListener','postMessage'].every(k=>typeof scope[k]==='function'))throw problem('scope');
 const helpers={...defaults,...dependencies};if(!Object.values(helpers).every(v=>typeof v==='function'))throw problem('dependencies');
 let active=null,prepared=null,review=null,poseReview=null,poseProjectToken=null,publication=null,projectToken=null,nativeClient=null,disposed=false,locked=false,sequence=0;
 const post=value=>scope.postMessage(value);
 function stop(run){run.controller.abort();for(const p of run.pending.values()){clearTimeout(p.timer);p.reject(problem('aborted'));}run.pending.clear();}
 async function current(run){
  if(run.controller.signal.aborted)throw problem('aborted');
  if(run.pending.size>=4)throw problem('revision_queue_limit');
  const requestId=++sequence;
  const value=await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{run.pending.delete(requestId);reject(problem('revision_timeout'));},10000);
   run.pending.set(requestId,{resolve,reject,timer});
   try{post({op:'revision',runId:run.id,requestId,projectToken:run.token,operation:run.operation});}
   catch(error){clearTimeout(timer);run.pending.delete(requestId);reject(error);}
  });
  if(run.controller.signal.aborted)throw problem('aborted');
  if(value!==run.token)throw problem('stale');
 }
 function native(run,method,request){
  // Register before the first revision await, not only after a job is posted.
  const concurrent=run.native.size>0;
  const promise=Promise.resolve().then(async()=>{
   if(concurrent)throw problem('native_busy');await current(run);
   if(!nativeClient)nativeClient=await helpers.createClient({baseURL:scope.location?.origin,currentOrigin:scope.location?.origin,pollMs:100});
   if(run.controller.signal.aborted)throw problem('aborted');
   const signal=request.signal&&request.signal!==run.controller.signal?AbortSignal.any([request.signal,run.controller.signal]):run.controller.signal;
   return await nativeClient[method]({...request,signal});
  }).catch(error=>{if(uncertain(error)){run.unconfirmed=true;run.nativeError=error;}throw error;}).finally(()=>run.native.delete(promise));
  run.native.add(promise);promise.catch(()=>{});return promise;
 }
 async function execute(run,input){
  let outcome='failed',failure=null,candidate=null,response=null;
  try{
   await current(run);
   if(run.operation==='prepare'){
    candidate=await helpers.prepare({part:input.part,usableBed:input.usableBed,...(input.mode===undefined?{}:{mode:input.mode}),...(input.permissionSources===undefined?{}:{permissionSources:input.permissionSources})});
    response={stage:'prepared',display:publicDisplay(candidate.display),summary:candidate.descriptor,descriptor:candidate.descriptor};
   }else{
    const callbacks={runGridReview:value=>native(run,'runGridReview',value),runSplitReview:value=>native(run,'runSplitReview',value),runBooleanReview:value=>native(run,'runBooleanReview',value),signal:run.controller.signal,
     getCurrentRevision:async value=>{await current(run);return {sourceRevision:value.sourceRevision,planHash:value.planHash};},
     onProgress:value=>{post({op:'progress',runId:run.id,operation:run.operation,projectToken:run.token,progress:publicProgress(value),reviewRequired:true,printable:false});}};
    if(run.operation==='reviewPoses'){
     const project=decodeExactProjectPosePayload(input.document);
     candidate=await helpers.reviewPoses({...project,limits:{maxDurationMs:750000},signal:callbacks.signal,getCurrentRevision:callbacks.getCurrentRevision,onProgress:callbacks.onProgress});
     response={stage:'poses',display:publicDisplay({parts:candidate.displayParts}),rows:publicPoseRows(candidate.rows),summary:candidate.summary};
    }else if(run.operation==='adoptPoses'){
     candidate=await helpers.adoptPoses({previous:poseReview,limits:{maxDurationMs:750000},signal:callbacks.signal,getCurrentRevision:callbacks.getCurrentRevision,onProgress:callbacks.onProgress});
     response={stage:'pose-adoption',adoption:candidate,summary:candidate.summary};
    }else if(run.operation==='engrave'){
     candidate=await helpers.engrave({...callbacks,part:input.part,permissionSources:input.permissionSources,settings:input.settings});
     response={stage:'machined',part:candidate.part,summary:candidate.summary};
    }else if(run.operation==='adopt'){
     candidate=await helpers.adopt({previous:review,...callbacks,metadata:input.metadata});
     response={stage:'adoption',adoption:candidate,summary:candidate.summary};
    }else{
     candidate=run.operation==='calculate'?await helpers.calculate({prepared,...callbacks,...(input.budgets===undefined?{}:{budgets:input.budgets}),...(input.refinementProfile===undefined?{}:{refinementProfile:input.refinementProfile})}):await helpers.improve({previous:review,...callbacks,...(input.budget===undefined?{}:{budget:input.budget}),...(input.refinementProfile===undefined?{}:{refinementProfile:input.refinementProfile})});
     response={stage:'review',display:publicDisplay({parts:candidate.displayParts}),summary:candidate.summary};
    }
   }
   // Even a defective helper that forgets to await its owned native request
   // cannot release a result or the next session's ownership slot early.
   while(run.native.size)await Promise.allSettled([...run.native]);
   if(run.unconfirmed)throw run.nativeError;
   await current(run);
   post({op:'result',runId:run.id,result:{schema:'prinjekt-exact-model-review-display-v1',...response,projectToken:run.token,reviewRequired:true,printable:false}});
   // The UI still performs its final live revision check after settlement.
   // Keep the old private tree until that successful release is acknowledged.
   publication={runId:run.id,token:run.token,operation:run.operation,candidate};
   outcome='completed';
  }catch(error){
   failure=record(error);if(uncertain(error)||run.unconfirmed){locked=true;outcome='unconfirmed';}else if(run.controller.signal.aborted)outcome='cancelled';
   try{post({op:'error',runId:run.id,error:failure});}catch{}
  }finally{
   if(outcome!=='completed')run.controller.abort();
   while(run.native.size)await Promise.allSettled([...run.native]);
   if(run.unconfirmed){locked=true;outcome='unconfirmed';failure=record(Object.assign(problem('cancellation_unconfirmed'),{cancellationConfirmed:false}));}
   for(const pending of run.pending.values()){clearTimeout(pending.timer);pending.reject(problem('settled'));}run.pending.clear();
   active=null;
   try{post({op:'settled',runId:run.id,outcome,safeToStart:!locked,error:failure,reviewRequired:true,printable:false});}catch{locked=true;}
  }
 }
 function receive(event){
  const input=event?.data;if(!input||typeof input!=='object'||!id(input.runId))return;
  if(input.op==='accept-result'){
   if(!active&&!disposed&&!locked&&publication?.runId===input.runId&&publication.token===input.projectToken){
    if(publication.operation==='reviewPoses'){poseReview=publication.candidate;poseProjectToken=publication.token;}else if(publication.operation==='adoptPoses'){}else if(publication.operation==='prepare'){prepared=publication.candidate;review=null;projectToken=publication.token;}else if(!['adopt','engrave'].includes(publication.operation))review=publication.candidate;
    publication=null;
   }return;
  }
  if(input.op==='revision-result'){
   if(active?.id!==input.runId||!Number.isSafeInteger(input.requestId))return;const p=active.pending.get(input.requestId);if(!p)return;
   active.pending.delete(input.requestId);clearTimeout(p.timer);input.error?p.reject(problem('revision_failed')):p.resolve(input.projectToken);return;
  }
  if(input.op==='cancel'){if(publication?.runId===input.runId)publication=null;if(active?.id===input.runId){stop(active);post({op:'cancelling',runId:input.runId});}return;}
  if(!['prepare','calculate','improve','adopt','engrave','reviewPoses','adoptPoses'].includes(input.op))return;
  const fields=input.op==='reviewPoses'?['document','projectToken']:input.op==='adoptPoses'?['projectToken']:input.op==='engrave'?['part','permissionSources','settings','projectToken']:input.op==='prepare'?['part','usableBed','projectToken','mode','permissionSources']:input.op==='calculate'?['budgets','refinementProfile','projectToken']:input.op==='adopt'?['metadata','projectToken']:['budget','refinementProfile','projectToken'];
  let reason=disposed?'disposed':locked?'cancellation_unconfirmed':active?'busy':null;
  if(!reason&&(Object.keys(input).some(k=>!['op','runId',...fields].includes(k))||!token(input.projectToken)))reason='input';
  if(!reason&&input.op==='prepare'&&(input.mode!==undefined&&input.mode!=='project-part'||input.permissionSources!==undefined&&input.mode!=='project-part'))reason='prepare_mode';
  if(!reason&&['calculate','improve'].includes(input.op))try{captureExactRefinementProfile(input.refinementProfile);}catch{reason='refinement_profile';}
  if(!reason&&!['prepare','engrave','reviewPoses','adoptPoses'].includes(input.op)&&(!prepared||projectToken!==input.projectToken))reason='not_prepared';
  if(!reason&&['improve','adopt'].includes(input.op)&&!review)reason='no_review';
  if(!reason&&input.op==='adoptPoses'&&(!poseReview||poseProjectToken!==input.projectToken))reason='no_pose_review';
  if(reason){post({op:'error',runId:input.runId,error:record(problem(reason))});if(reason!=='busy')post({op:'settled',runId:input.runId,outcome:'failed',safeToStart:!locked,error:record(problem(reason)),reviewRequired:true,printable:false});return;}
  publication=null;
  const run={id:input.runId,operation:input.op,token:input.projectToken,controller:new AbortController(),pending:new Map(),native:new Set(),nativeError:null,unconfirmed:false,task:null};
  active=run;run.task=execute(run,input);
 }
 scope.addEventListener('message',receive);
 return Object.freeze({get busy(){return !!active;},get locked(){return locked;},async dispose(){disposed=true;const run=active;if(run){stop(run);await run.task;}scope.removeEventListener('message',receive);prepared=null;review=null;poseReview=null;poseProjectToken=null;publication=null;nativeClient=null;}});
}
