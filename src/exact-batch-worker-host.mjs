import {captureExactRefinementProfile} from './exact-refinement-profile.mjs';
import {createExactBatchRefinement} from './exact-batch-refinement.mjs';
import {createExactBatchRefinementResume} from './exact-batch-resume.mjs';
import {createExactJobClient} from './exact-job-client.mjs';

const identifier=/^[a-zA-Z0-9_-]{1,80}$/;
const problem=reason=>Object.assign(Error(`Automatische Hintergrundberechnung: ${reason}.`),{code:'EXACT_BATCH_WORKER_REJECTED',reason});
const errorRecord=e=>({message:String(e?.message??'Unbekannter Fehler').slice(0,500),code:String(e?.code??'EXACT_BATCH_WORKER_ERROR').slice(0,100),reason:e?.reason==null?null:String(e.reason).slice(0,200),...(typeof e?.cancellationConfirmed==='boolean'?{cancellationConfirmed:e.cancellationConfirmed}:{})});

/** A dedicated worker owns the entire batch and local native-job lifecycle.
 * The UI answers revision requests from its CURRENT project; this host never
 * treats its own captured version as evidence that the UI remained unchanged.
 * A cancel message only requests cancellation. The settled message confirms
 * that all awaited work ended, or explicitly reports uncertain cancellation.
 */
export function installExactBatchWorker(scope,{createBatch=createExactBatchRefinement,createResume=createExactBatchRefinementResume,createClient=createExactJobClient}={}){
 if(!scope||typeof scope.addEventListener!=='function'||typeof scope.removeEventListener!=='function'||typeof scope.postMessage!=='function')throw problem('scope');
 let active=null,locked=false,disposed=false,sequence=0;
 const post=value=>scope.postMessage(value);
 const sendError=(runId,error)=>post({op:'error',runId,error:errorRecord(error),reviewRequired:true,printable:false});
 function stop(run){
  run.controller.abort();
  try{run.batch?.cancel();}catch{run.cleanupFailed=true;}
  finally{for(const pending of run.pending.values()){clearTimeout(pending.timer);pending.reject(problem('aborted'));}run.pending.clear();}
 }
 function revision(run){
  if(run.controller.signal.aborted)return Promise.reject(problem('aborted'));
  if(run.pending.size>=4)return Promise.reject(problem('revision_queue_limit'));
  const requestId=++sequence;
  return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{run.pending.delete(requestId);reject(problem('revision_timeout'));},10000);
   run.pending.set(requestId,{resolve,reject,timer});
   try{post({op:'revision',runId:run.id,requestId,sourceRevision:run.sourceRevision,planHash:run.batch.planHash});}
   catch(error){clearTimeout(timer);run.pending.delete(requestId);reject(error);}
  });
 }
 async function execute(run,input){
  let outcome='failed',failure=null;
  try{
   captureExactRefinementProfile(input.refinementProfile);
   const origin=scope.location?.origin;
   const client=createClient({baseURL:origin,currentOrigin:origin,pollMs:100});
   const resume=input.op==='resume';
   run.batch=(resume?createResume:createBatch)({...(resume?{tree:input.tree}:{parts:input.parts}),sourceRevision:input.sourceRevision,budget:input.budget,...(input.refinementProfile===undefined?{}:{refinementProfile:input.refinementProfile}),signal:run.controller.signal,
    runSplitReview:request=>client.runSplitReview(request),getCurrentRevision:()=>revision(run),
    onProgress:progress=>post({op:'progress',runId:run.id,progress,reviewRequired:true,printable:false})});
   post({op:'ready',runId:run.id,sourceRevision:run.sourceRevision,planHash:run.batch.planHash,reviewRequired:true,printable:false});
   let state;
   do{state=await run.batch.step({maxJobs:1});post({op:'snapshot',runId:run.id,snapshot:state});}while(!state.done);
   const result=await run.batch.result();
   if(run.controller.signal.aborted)throw problem('aborted');
   post({op:'result',runId:run.id,result});outcome='completed';
  }catch(error){
   failure=errorRecord(error);
   if(error?.code==='EXACT_JOB_CANCEL_UNCONFIRMED'||error?.reason==='cancellation_unconfirmed'||error?.cancellationConfirmed===false){locked=true;outcome='unconfirmed';}
   else if(run.controller.signal.aborted)outcome='cancelled';
   try{sendError(run.id,error);}catch{}
  }finally{
   try{run.batch?.dispose();}catch{run.cleanupFailed=true;}
   for(const pending of run.pending.values()){clearTimeout(pending.timer);pending.reject(problem('settled'));}run.pending.clear();
   if(run.cleanupFailed){locked=true;outcome='unconfirmed';failure=errorRecord(Object.assign(problem('cleanup_failed'),{cancellationConfirmed:false}));try{sendError(run.id,Object.assign(problem('cleanup_failed'),{cancellationConfirmed:false}));}catch{}}
   active=null;
   try{post({op:'settled',runId:run.id,outcome,safeToStart:!locked,error:failure,reviewRequired:true,printable:false});}catch{locked=true;}
  }
 }
 function receive(event){
  const input=event?.data;if(!input||typeof input!=='object'||typeof input.runId!=='string'||!identifier.test(input.runId))return;
  if(input.op==='revision-result'){
   if(!active||active.id!==input.runId||!Number.isSafeInteger(input.requestId))return;
   const pending=active.pending.get(input.requestId);if(!pending)return;
   active.pending.delete(input.requestId);clearTimeout(pending.timer);
   if(input.error)pending.reject(problem('revision_failed'));else pending.resolve(input.revision);
   return;
  }
  if(input.op==='cancel'){
   if(active?.id===input.runId){stop(active);post({op:'cancelling',runId:input.runId});}
   return;
  }
  if(!['start','resume'].includes(input.op))return;
  if(disposed||locked||active){sendError(input.runId,problem(disposed?'disposed':locked?'cancellation_unconfirmed':'busy'));return;}
  const sourceKey=input.op==='resume'?'tree':'parts';
  if(!Object.hasOwn(input,sourceKey)||Object.keys(input).some(k=>!['op','runId',sourceKey,'sourceRevision','budget','refinementProfile'].includes(k))){sendError(input.runId,problem('input'));return;}
  const run={id:input.runId,sourceRevision:input.sourceRevision,controller:new AbortController(),pending:new Map(),batch:null,task:null,cleanupFailed:false};
  active=run;run.task=execute(run,input);
 }
 scope.addEventListener('message',receive);
 return Object.freeze({
  get busy(){return !!active;},get locked(){return locked;},
  async dispose(){disposed=true;const run=active;if(run){stop(run);await run.task;}scope.removeEventListener('message',receive);}
 });
}
