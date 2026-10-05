export const EXACT_BATCH_WORKER_CLIENT_LIMITS=Object.freeze({bytes:200*1024*1024,nodes:16000000,depth:64,parts:2048,startupMs:180000,finalizationMs:300000,callbackMs:10000,cancelMs:60000,progressQueue:64,revisionQueue:4});
const hash=/^[a-f0-9]{64}$/;
const fail=(reason,extra={})=>Object.assign(Error(`Hintergrundberechnung: ${reason}.`),{code:'EXACT_BATCH_WORKER_CLIENT_REJECTED',reason,...extra});
const freeze=v=>{if(v&&typeof v==='object'&&!Object.isFrozen(v)){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const encoder=new TextEncoder();
function capture(value){
 let bytes=0,nodes=0;
 function copy(v,depth){
  if(++nodes>EXACT_BATCH_WORKER_CLIENT_LIMITS.nodes||depth>EXACT_BATCH_WORKER_CLIENT_LIMITS.depth)throw fail('input_limit');
  if(v===null||typeof v==='boolean')return v;
  if(typeof v==='number'){if(!Number.isFinite(v))throw fail('input_number');return v;}
  if(typeof v==='string'){bytes+=encoder.encode(v).length;if(bytes>EXACT_BATCH_WORKER_CLIENT_LIMITS.bytes)throw fail('input_limit');return v;}
  if(!v||typeof v!=='object'||(!Array.isArray(v)&&![Object.prototype,null].includes(Object.getPrototypeOf(v))))throw fail('input_value');
  const array=Array.isArray(v),keys=Reflect.ownKeys(v),out=array?[]:{};
  if(keys.some(k=>typeof k!=='string')||array&&keys.length!==v.length+1)throw fail('input_keys');
  for(const key of keys){
   if(array&&key==='length')continue;
   if(key==='__proto__'||array&&(!/^(0|[1-9]\d*)$/.test(key)||Number(key)>=v.length))throw fail('input_keys');
   const d=Object.getOwnPropertyDescriptor(v,key);if(!d?.enumerable||!Object.hasOwn(d,'value'))throw fail('input_accessor');
   bytes+=key.length;if(bytes>EXACT_BATCH_WORKER_CLIENT_LIMITS.bytes)throw fail('input_limit');out[key]=copy(d.value,depth+1);
  }
  return out;
 }
 return freeze(copy(value,0));
}
const remoteError=value=>fail('worker_failed',{workerCode:typeof value?.code==='string'?value.code.slice(0,100):null,workerReason:typeof value?.reason==='string'?value.reason.slice(0,200):null,...(typeof value?.cancellationConfirmed==='boolean'?{cancellationConfirmed:value.cancellationConfirmed}:{})});

/** Owns one dedicated worker. This is a transport/lifecycle bridge, not a new
 * geometry verifier or project-adoption gate. Results are released only after
 * safe settled AND a final actual UI revision check. Never terminate a worker
 * whose native cancellation outcome is still unknown. */
export function createExactBatchWorkerClient({workerFactory,onProgress,getCurrentRevision}={}){
 if(typeof workerFactory!=='function'||typeof getCurrentRevision!=='function'||onProgress!==undefined&&typeof onProgress!=='function')throw fail('configuration');
 let worker=null,active=null,sequence=0,locked=false,disposed=false,terminated=false;
 function terminate(){if(worker&&!terminated){terminated=true;worker.removeEventListener('message',receive);worker.removeEventListener('error',crash);worker.removeEventListener('messageerror',crash);worker.terminate();}}
 function clearCallbacks(run){for(const cancel of run.waiters)cancel();run.waiters.clear();}
 function uncertain(run,reason){
  locked=true;run.uncertain=true;run.failure=fail(reason,{cancellationConfirmed:false});clearTimeout(run.cancelTimer);clearTimeout(run.deadline);clearCallbacks(run);
  run.reject(run.failure);run.ackReject(run.failure);
 }
 function bounded(run,operation){
  return new Promise((resolve,reject)=>{
   let finished=false;const done=(fn,value)=>{if(finished)return;finished=true;clearTimeout(timer);run.waiters.delete(cancel);fn(value);};
   const cancel=()=>done(reject,fail('aborted'));const timer=setTimeout(()=>done(reject,fail('callback_timeout')),EXACT_BATCH_WORKER_CLIENT_LIMITS.callbackMs);
   run.waiters.add(cancel);Promise.resolve().then(operation).then(v=>done(resolve,v),()=>done(reject,fail('callback_failed')));
  });
 }
 function post(run,message){try{worker.postMessage(message);}catch{uncertain(run,'worker_transport_failed');}}
 function requestCancel(run,error=fail('aborted')){
  if(active!==run||run.finished)return;
  run.failure??=error;run.cancelled=true;clearCallbacks(run);
  if(run.terminal)return;
  if(!run.cancelSent){run.cancelSent=true;run.cancelTimer=setTimeout(()=>uncertain(run,'cancellation_unconfirmed'),EXACT_BATCH_WORKER_CLIENT_LIMITS.cancelMs);post(run,{op:'cancel',runId:run.id});}
 }
 function notify(run,message){
  if(!onProgress||run.cancelled||run.uncertain)return;
  if(++run.notifications>EXACT_BATCH_WORKER_CLIENT_LIMITS.progressQueue){run.notifications--;requestCancel(run,fail('progress_queue_limit'));return;}
  const event=freeze({...message,sourceRevision:run.sourceRevision,planHash:run.planHash,reviewRequired:true,printable:false});
  run.progress=run.progress.then(()=>{
   if(run.cancelled||run.uncertain)return;
   return bounded(run,()=>onProgress(event));
  }).catch(error=>requestCancel(run,error)).finally(()=>{run.notifications--;});
 }
 async function answerRevision(run,message){
  if(!run.planHash||message.sourceRevision!==run.sourceRevision||message.planHash!==run.planHash){requestCancel(run,fail('revision_binding'));return;}
  if(!Number.isSafeInteger(message.requestId)||message.requestId<=run.lastRequest)return;
  run.lastRequest=message.requestId;
  if(run.revisions.size>=EXACT_BATCH_WORKER_CLIENT_LIMITS.revisionQueue){requestCancel(run,fail('revision_queue_limit'));return;}
  run.revisions.add(message.requestId);let revision,error;
  try{
   await run.progress;if(run.cancelled||run.uncertain)throw fail('aborted');
   revision=await bounded(run,()=>getCurrentRevision(Object.freeze({sourceRevision:run.sourceRevision,planHash:run.planHash})));
   if(!revision||!hash.test(revision.sourceRevision??'')||!hash.test(revision.planHash??''))throw fail('revision_value');
   revision={sourceRevision:revision.sourceRevision,planHash:revision.planHash};
  }catch(e){error=e.reason??'revision_failed';}
  finally{run.revisions.delete(message.requestId);}
  if(active!==run||run.terminal||run.uncertain)return;
  // A changed UI revision is deliberately forwarded. The host batch and its
  // client cancel any running native job; captured revisions are never echoed.
  post(run,{op:'revision-result',runId:run.id,requestId:message.requestId,...(error?{error}:{revision})});
 }
 async function finish(run,message){
  if(run.terminal)return;run.terminal=true;clearTimeout(run.cancelTimer);clearTimeout(run.deadline);
  const safe=message.safeToStart===true&&message.outcome!=='unconfirmed'&&!locked&&!run.uncertain;
  if(!safe||run.cancelled||message.outcome!=='completed')clearCallbacks(run);
  if(!safe){locked=true;run.failure=fail('cancellation_unconfirmed',{cancellationConfirmed:false});}
  try{
   if(!safe)throw run.failure;
   await run.progress;
   if(run.uncertain)throw run.failure;
   if(message.outcome==='completed'){
    if(run.cancelled)throw run.failure??fail('aborted');
    if(!run.result||run.failure)throw run.failure??fail('missing_result');
    const current=await bounded(run,()=>getCurrentRevision(Object.freeze({sourceRevision:run.sourceRevision,planHash:run.planHash})));
    if(current?.sourceRevision!==run.sourceRevision||current?.planHash!==run.planHash)throw fail('stale');
    if(run.cancelled)throw run.failure??fail('aborted');
    run.resolve(freeze(run.result));
   }else throw run.failure??remoteError(message.error);
  }catch(error){run.reject(error);}
  finally{
   run.finished=true;clearCallbacks(run);run.signal?.removeEventListener('abort',run.abort);
   if(active===run)active=null;
   if(safe&&!run.uncertain)run.ackResolve({settled:true,safeToStart:!locked,outcome:message.outcome});else run.ackReject(run.failure??fail('cancellation_unconfirmed',{cancellationConfirmed:false}));
   if(disposed)terminate();
  }
 }
 function receive(event){
  const message=event?.data,run=active;if(!run||!message||typeof message!=='object'||message.runId!==run.id)return;
  if(message.op==='settled'){
   if(!['completed','cancelled','failed','unconfirmed'].includes(message.outcome)||typeof message.safeToStart!=='boolean'||message.reviewRequired!==true||message.printable!==false){requestCancel(run,fail('settled_protocol'));return;}
   void finish(run,message);return;
  }
  if(run.terminal||run.uncertain)return;
  if(message.op==='ready'){
   if(run.planHash||message.sourceRevision!==run.sourceRevision||!hash.test(message.planHash??'')||message.reviewRequired!==true||message.printable!==false){requestCancel(run,fail('ready_protocol'));return;}
   run.planHash=message.planHash;clearTimeout(run.deadline);
   run.deadline=setTimeout(()=>requestCancel(run,fail('timeout')),run.duration+EXACT_BATCH_WORKER_CLIENT_LIMITS.callbackMs);
   notify(run,message);return;
  }
  if(message.op==='revision'){void answerRevision(run,message);return;}
  if(message.op==='error'){
   run.failure??=remoteError(message.error);
   if(message.error?.cancellationConfirmed===false||message.error?.code==='EXACT_JOB_CANCEL_UNCONFIRMED'||message.error?.reason==='cancellation_unconfirmed')locked=true;
   return;
  }
  if(message.op==='result'){
   const r=message.result;
   if(run.result||!run.planHash||r?.schema!=='prinjekt-exact-batch-refinement-result-v1'||(r.mode==='resume')!==run.resume||r.sourceRevision!==run.sourceRevision||r.planHash!==run.planHash||r.reviewRequired!==true||r.printable!==false){requestCancel(run,fail('result_binding'));return;}
   run.result=r;return;
  }
  if(message.op==='snapshot'){
   const s=message.snapshot;
   if(!run.planHash||s?.schema!=='prinjekt-exact-batch-refinement-v1'||(s.mode==='resume')!==run.resume||s.sourceRevision!==run.sourceRevision||s.planHash!==run.planHash||typeof s.done!=='boolean'||s.reviewRequired!==true||s.printable!==false){requestCancel(run,fail('snapshot_binding'));return;}
   // Final whole-tree validation is outside the finite native-search budget.
   // Only the first bound, non-aborted done snapshot may start this phase.
   if(s.done&&s.stopReason==null&&!run.cancelled&&!run.finalizationStarted){
    run.finalizationStarted=true;clearTimeout(run.deadline);
    run.deadline=setTimeout(()=>requestCancel(run,fail('finalization_timeout')),EXACT_BATCH_WORKER_CLIENT_LIMITS.finalizationMs);
   }
   notify(run,message);return;
  }
  if(['progress','cancelling'].includes(message.op)){notify(run,message);return;}
  requestCancel(run,fail('worker_protocol'));
 }
 function crash(){if(active)uncertain(active,'worker_crashed');else locked=true;}
 function ensureWorker(){
  if(worker)return;
  let value;try{value=workerFactory();}catch{throw fail('worker_factory');}if(!value||!['addEventListener','removeEventListener','postMessage','terminate'].every(k=>typeof value[k]==='function'))throw fail('worker_factory');
  worker=value;worker.addEventListener('message',receive);worker.addEventListener('error',crash);worker.addEventListener('messageerror',crash);
 }
 async function execute(input,resume=false){
  if(disposed)throw fail('disposed');if(locked)throw fail('cancellation_unconfirmed',{cancellationConfirmed:false});if(active)throw fail('busy');
  const sourceKey=resume?'tree':'parts';
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>![sourceKey,'sourceRevision','budget','signal','refinementProfile'].includes(k)))throw fail('input');
  const {signal}=input;if(signal!==undefined&&(!signal||typeof signal.addEventListener!=='function'||typeof signal.removeEventListener!=='function'||typeof signal.aborted!=='boolean'))throw fail('signal');
  if(signal?.aborted)throw fail('aborted');
  const payload=capture({[sourceKey]:input[sourceKey],sourceRevision:input.sourceRevision,...(input.budget===undefined?{}:{budget:input.budget}),...(input.refinementProfile===undefined?{}:{refinementProfile:input.refinementProfile})});
  const parts=resume?payload.tree?.leaves:payload.parts;
  if(!hash.test(payload.sourceRevision)||!Array.isArray(parts)||!parts.length||parts.length>EXACT_BATCH_WORKER_CLIENT_LIMITS.parts)throw fail('input');
  ensureWorker();if(++sequence>Number.MAX_SAFE_INTEGER)throw fail('run_id_limit');
  let resolve,reject,ackResolve,ackReject;const result=new Promise((a,b)=>{resolve=a;reject=b;}),ack=new Promise((a,b)=>{ackResolve=a;ackReject=b;});ack.catch(()=>{});
  const duration=Number.isSafeInteger(payload.budget?.maxDurationMs)&&payload.budget.maxDurationMs>=1?Math.min(payload.budget.maxDurationMs,900000):900000;
  const r={id:`exact-batch-${sequence}`,resume,sourceRevision:payload.sourceRevision,planHash:null,duration,resolve,reject,ackResolve,ackReject,ack,signal,abort:null,progress:Promise.resolve(),notifications:0,revisions:new Set(),lastRequest:0,waiters:new Set(),result:null,failure:null,cancelled:false,cancelSent:false,terminal:false,finished:false,uncertain:false,finalizationStarted:false,cancelTimer:null,deadline:null};
  active=r;r.abort=()=>requestCancel(r);signal?.addEventListener('abort',r.abort,{once:true});
  // Batch input has its own stricter geometry/budget validator in the worker.
  // Initial root validation precedes the batch's own execution budget. Start
  // that separate watchdog only after ready; neither timer kills native work.
  r.deadline=setTimeout(()=>requestCancel(r,fail('startup_timeout')),EXACT_BATCH_WORKER_CLIENT_LIMITS.startupMs);
  post(r,{op:resume?'resume':'start',runId:r.id,...payload});return result;
 }
 async function cancel(){const r=active;if(!r){if(locked)throw fail('cancellation_unconfirmed',{cancellationConfirmed:false});return {settled:true,safeToStart:true,outcome:'idle'};}requestCancel(r);return r.ack;}
 async function dispose(){
  disposed=true;const r=active;
  if(r){requestCancel(r,fail('disposed'));await r.ack;if(active===r)return;}
  terminate();
 }
 return Object.freeze({run:input=>execute(input),resume:input=>execute(input,true),cancel,dispose,get busy(){return !!active;},get locked(){return locked;}});
}
