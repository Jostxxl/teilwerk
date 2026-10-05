import {encodeExactProjectPosePayload} from './exact-project-pose-payload.mjs';
export const EXACT_MODEL_CLIENT_LIMITS=Object.freeze({bytes:200*1024*1024,nodes:16000000,depth:64,callbackMs:10000,cancelMs:60000,prepareMs:180000,proofAndSetupMs:480000,progressQueue:64,revisionQueue:4});
const fail=(reason,extra={})=>Object.assign(Error(`Exakte Modellvorschau: ${reason}.`),{code:'EXACT_MODEL_CLIENT_REJECTED',reason,...extra});
const validToken=v=>typeof v==='string'&&v.length>0&&v.length<=200;
const freeze=v=>{if(v&&typeof v==='object'&&!ArrayBuffer.isView(v)&&!Object.isFrozen(v)){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const encoder=new TextEncoder();
function capture(value){
 let bytes=0,nodes=0;const seen=new Set();
 function inspect(v,depth){
  if(++nodes>EXACT_MODEL_CLIENT_LIMITS.nodes||depth>EXACT_MODEL_CLIENT_LIMITS.depth)throw fail('input_limit');
  if(v===null||v===undefined||typeof v==='boolean')return;
  if(typeof v==='number'){if(!Number.isFinite(v))throw fail('input_number');return;}
  if(typeof v==='string'){bytes+=encoder.encode(v).length;}
  else{
   if(!v||typeof v!=='object'||seen.has(v))throw fail('input_value');
   if(ArrayBuffer.isView(v)){
    if(![Float32Array,Float64Array,Uint32Array,Uint16Array,Uint8Array,Int32Array,Int16Array,Int8Array].some(C=>v.constructor===C))throw fail('input_value');
    bytes+=v.byteLength;
   }else{
    if(!Array.isArray(v)&&![Object.prototype,null].includes(Object.getPrototypeOf(v)))throw fail('input_value');
    seen.add(v);const array=Array.isArray(v),keys=Reflect.ownKeys(v);
    if(keys.some(k=>typeof k!=='string')||array&&keys.length!==v.length+1)throw fail('input_keys');
    for(const key of keys){
     if(array&&key==='length')continue;if(key==='__proto__'||array&&(!/^(0|[1-9]\d*)$/.test(key)||Number(key)>=v.length))throw fail('input_keys');
     const d=Object.getOwnPropertyDescriptor(v,key);if(!d?.enumerable||!Object.hasOwn(d,'value'))throw fail('input_accessor');bytes+=key.length;inspect(d.value,depth+1);
    }seen.delete(v);
   }
  }
  if(bytes>EXACT_MODEL_CLIENT_LIMITS.bytes)throw fail('input_limit');
 }
 inspect(value,0);return structuredClone(value);
}
const remote=value=>{
 const error=fail('worker_failed',{workerCode:typeof value?.code==='string'?value.code.slice(0,100):null,workerReason:typeof value?.reason==='string'?value.reason.slice(0,200):null,...(typeof value?.cancellationConfirmed==='boolean'?{cancellationConfirmed:value.cancellationConfirmed}:{})});
 if(value?.code==='EXACT_JOB_UNAVAILABLE')error.message='Der exakte Rechendienst ist nicht verfügbar. Teilwerk über Start-Teilwerk.cmd neu starten.';
 return error;
};

/** UI transport only. The owning worker retains all exact authority/history.
 * Display results become visible only after confirmed settlement and a final
 * current-project check. Unknown cancellation permanently locks this client. */
export function createExactModelClient({workerFactory,onProgress,getCurrentProjectToken}={}){
 if(typeof workerFactory!=='function'||typeof getCurrentProjectToken!=='function'||onProgress!==undefined&&typeof onProgress!=='function')throw fail('configuration');
 let worker=null,active=null,sequence=0,locked=false,disposed=false,terminated=false,projectToken=null,stage=null,sessionMode,poseToken=null,poseReady=false;
 function terminate(){if(worker&&!terminated){terminated=true;worker.removeEventListener('message',receive);worker.removeEventListener('error',crash);worker.removeEventListener('messageerror',crash);worker.terminate();}}
 function clearCallbacks(run){for(const cancel of run.waiters)cancel();run.waiters.clear();}
 function uncertain(run,reason){locked=true;run.uncertain=true;run.failure=fail(reason,{cancellationConfirmed:false});clearTimeout(run.timer);clearTimeout(run.cancelTimer);clearCallbacks(run);run.reject(run.failure);run.ackReject(run.failure);}
 function post(run,message){try{worker.postMessage(message);}catch{uncertain(run,'worker_transport_failed');}}
 function bounded(run,callback){return new Promise((resolve,reject)=>{
  let ended=false;const done=(fn,v)=>{if(ended)return;ended=true;clearTimeout(timer);run.waiters.delete(cancel);fn(v);};
  const cancel=()=>done(reject,fail('aborted')),timer=setTimeout(()=>done(reject,fail('callback_timeout')),EXACT_MODEL_CLIENT_LIMITS.callbackMs);
  run.waiters.add(cancel);Promise.resolve().then(callback).then(v=>done(resolve,v),()=>done(reject,fail('callback_failed')));
 });}
 function requestCancel(run,error=fail('aborted')){
  if(active!==run||run.finished)return;run.failure??=error;run.cancelled=true;clearCallbacks(run);if(run.terminal)return;
  if(!run.cancelSent){run.cancelSent=true;run.cancelTimer=setTimeout(()=>uncertain(run,'cancellation_unconfirmed'),EXACT_MODEL_CLIENT_LIMITS.cancelMs);post(run,{op:'cancel',runId:run.id});}
 }
 function notify(run,message){
  if(!onProgress||run.cancelled||run.uncertain)return;
  if(++run.notifications>EXACT_MODEL_CLIENT_LIMITS.progressQueue){run.notifications--;requestCancel(run,fail('progress_queue_limit'));return;}
  const event=freeze({...message,operation:run.operation,projectToken:run.token,reviewRequired:true,printable:false});
  run.progress=run.progress.then(()=>{if(!run.cancelled&&!run.uncertain)return bounded(run,()=>onProgress(event));}).catch(error=>requestCancel(run,error)).finally(()=>{run.notifications--;});
 }
 async function answer(run,message){
  if(message.projectToken!==run.token||message.operation!==run.operation){requestCancel(run,fail('revision_binding'));return;}
  if(!Number.isSafeInteger(message.requestId)||message.requestId<=run.lastRequest)return;run.lastRequest=message.requestId;
  if(run.revisions.size>=EXACT_MODEL_CLIENT_LIMITS.revisionQueue){requestCancel(run,fail('revision_queue_limit'));return;}run.revisions.add(message.requestId);
  let value,error;
  try{await run.progress;if(run.cancelled||run.uncertain)throw fail('aborted');value=await bounded(run,()=>getCurrentProjectToken(Object.freeze({projectToken:run.token,operation:run.operation})));if(!validToken(value))throw fail('revision_value');}
  catch(e){error=e.reason??'revision_failed';}finally{run.revisions.delete(message.requestId);}
  if(active!==run||run.terminal||run.uncertain)return;
  post(run,{op:'revision-result',runId:run.id,requestId:message.requestId,...(error?{error}:{projectToken:value})});
 }
 async function finish(run,message){
  if(run.terminal)return;run.terminal=true;clearTimeout(run.timer);clearTimeout(run.cancelTimer);
  const safe=message.safeToStart===true&&message.outcome!=='unconfirmed'&&!locked&&!run.uncertain;
  if(!safe||run.cancelled||message.outcome!=='completed')clearCallbacks(run);
  if(!safe){locked=true;run.failure=fail('cancellation_unconfirmed',{cancellationConfirmed:false});}
  try{
   if(!safe)throw run.failure;await run.progress;if(run.uncertain)throw run.failure;
   if(message.outcome!=='completed')throw run.failure??remote(message.error);
   if(run.cancelled||run.failure)throw run.failure??fail('aborted');if(!run.result)throw fail('missing_result');
   const current=await bounded(run,()=>getCurrentProjectToken(Object.freeze({projectToken:run.token,operation:run.operation})));
   if(current!==run.token)throw fail('stale');if(run.cancelled)throw run.failure??fail('aborted');
   post(run,{op:'accept-result',runId:run.id,projectToken:run.token});if(run.uncertain)throw run.failure;
   if(run.operation==='reviewPoses'){poseToken=run.token;poseReady=true;}else if(!['engrave','adoptPoses'].includes(run.operation)){projectToken=run.token;stage=run.operation==='adopt'?'review':run.result.stage;if(run.operation==='prepare')sessionMode=run.mode;}run.resolve(freeze(run.result));
  }catch(error){run.reject(error);}
  finally{
   run.finished=true;clearCallbacks(run);if(active===run)active=null;
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
  if(message.op==='revision'){void answer(run,message);return;}
  if(message.op==='error'){run.failure??=remote(message.error);if(message.error?.cancellationConfirmed===false||message.error?.code==='EXACT_JOB_CANCEL_UNCONFIRMED'||message.error?.reason==='cancellation_unconfirmed')locked=true;return;}
  if(message.op==='result'){
   const value=message.result;
   const adoption=run.operation==='adopt',engraving=run.operation==='engrave',poses=run.operation==='reviewPoses',poseAdoption=run.operation==='adoptPoses';
   if(run.result||value?.schema!=='prinjekt-exact-model-review-display-v1'||value.projectToken!==run.token||value.stage!==(poseAdoption?'pose-adoption':poses?'poses':engraving?'machined':adoption?'adoption':run.operation==='prepare'?'prepared':'review')||(poseAdoption?value.adoption?.schema!=='prinjekt-exact-project-pose-adoption-v1'||!Array.isArray(value.adoption?.replacements):poses?!Array.isArray(value.rows)||!Array.isArray(value.display?.parts)||Object.hasOwn(value,'adoption'):engraving?!value.part?.exactGeometry||Object.hasOwn(value,'adoption'):adoption?value.adoption?.schema!==(run.mode==='project-part'?'prinjekt-exact-local-part-adoption-v1':'prinjekt-exact-model-adoption-v1')||!Array.isArray(value.adoption?.parts):!Array.isArray(value.display?.parts)||Object.hasOwn(value,'adoption'))||value.reviewRequired!==true||value.printable!==false||['tree','capture','plan','source','prepared'].some(k=>Object.hasOwn(value,k))){requestCancel(run,fail('result_binding'));return;}
   run.result=value;return;
  }
  if(message.op==='progress'){if(message.projectToken!==run.token||message.operation!==run.operation){requestCancel(run,fail('progress_binding'));return;}notify(run,message);return;}
  if(message.op==='cancelling'){notify(run,message);return;}
  requestCancel(run,fail('worker_protocol'));
 }
 function crash(){if(active)uncertain(active,'worker_crashed');else locked=true;}
 function ensureWorker(){
  if(worker)return;let value;try{value=workerFactory();}catch{throw fail('worker_factory');}
  if(!value||!['addEventListener','removeEventListener','postMessage','terminate'].every(k=>typeof value[k]==='function'))throw fail('worker_factory');
  worker=value;worker.addEventListener('message',receive);worker.addEventListener('error',crash);worker.addEventListener('messageerror',crash);
 }
 async function execute(operation,input={}){
  if(disposed)throw fail('disposed');if(locked)throw fail('cancellation_unconfirmed',{cancellationConfirmed:false});if(active)throw fail('busy');
  if(operation==='reviewPoses')input=encodeExactProjectPosePayload(input);
  const fields=operation==='reviewPoses'?['document','projectToken']:operation==='adoptPoses'?[]:operation==='engrave'?['part','permissionSources','settings','projectToken']:operation==='prepare'?['part','usableBed','projectToken','mode','permissionSources']:operation==='calculate'?['budgets','refinementProfile']:operation==='adopt'?['metadata']:['budget','refinementProfile'];
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!fields.includes(k)))throw fail('input');
  if(operation==='prepare'&&(input.mode!==undefined&&input.mode!=='project-part'||input.permissionSources!==undefined&&input.mode!=='project-part'))throw fail('prepare_mode');
  if(operation==='adoptPoses'&&!poseReady)throw fail('no_pose_review');
  if(!['prepare','engrave','reviewPoses','adoptPoses'].includes(operation)&&!stage)throw fail('not_prepared');if(['improve','adopt'].includes(operation)&&stage!=='review')throw fail('no_review');
  const payload=capture({...input,projectToken:['prepare','engrave','reviewPoses'].includes(operation)?input.projectToken:operation==='adoptPoses'?poseToken:projectToken});if(!validToken(payload.projectToken))throw fail('input');
  ensureWorker();if(++sequence>Number.MAX_SAFE_INTEGER)throw fail('run_id_limit');
  let resolve,reject,ackResolve,ackReject;const result=new Promise((a,b)=>{resolve=a;reject=b;}),ack=new Promise((a,b)=>{ackResolve=a;ackReject=b;});ack.catch(()=>{});
  const run={id:`exact-model-${sequence}`,operation,mode:operation==='prepare'?payload.mode:sessionMode,token:payload.projectToken,resolve,reject,ackResolve,ackReject,ack,progress:Promise.resolve(),notifications:0,revisions:new Set(),lastRequest:0,waiters:new Set(),result:null,failure:null,cancelled:false,cancelSent:false,terminal:false,finished:false,uncertain:false,cancelTimer:null,timer:null};active=run;
  const duration=value=>Number.isSafeInteger(value)&&value>=1?Math.min(value,900000):300000;
  const ms=operation==='prepare'?EXACT_MODEL_CLIENT_LIMITS.prepareMs:EXACT_MODEL_CLIENT_LIMITS.proofAndSetupMs+(operation==='calculate'?duration(payload.budgets?.grouping?.maxMillis)+duration(payload.budgets?.batch?.maxDurationMs):duration(payload.budget?.maxDurationMs));
  run.timer=setTimeout(()=>requestCancel(run,fail('timeout')),ms);post(run,{op:operation,runId:run.id,...payload});return result;
 }
 async function cancel(){const run=active;if(!run){if(locked)throw fail('cancellation_unconfirmed',{cancellationConfirmed:false});return{settled:true,safeToStart:true,outcome:'idle'};}requestCancel(run);return run.ack;}
 async function dispose(){disposed=true;const run=active;if(run){requestCancel(run,fail('disposed'));await run.ack;if(active===run)return;}terminate();}
 return Object.freeze({reviewPoses:value=>execute('reviewPoses',value),adoptPoses:()=>execute('adoptPoses'),prepare:value=>execute('prepare',value),calculate:value=>execute('calculate',value),improve:value=>execute('improve',value),adopt:value=>execute('adopt',value),engrave:value=>execute('engrave',value),cancel,dispose,get busy(){return !!active;},get locked(){return locked;}});
}
