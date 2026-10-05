import {requireLocalExactRuntime} from './runtime-mode.mjs';
import {EXACT_GEOMETRY_LIMITS, exactHash, parseExactMesh, validateExactAuthority} from './exact-geometry.mjs';
import {validateExactGridPlan} from './exact-grid-plan.mjs';
import {validateExactGridPartitionReview} from './exact-grid-partition.mjs';
import {validateExactSplitJob} from './exact-split-job.mjs';
import {validateExactSplitPartitionReview} from './exact-split-partition.mjs';

// Transport for review only. Neither matching revisions nor valid rational
// provenance establish a safe partition, interior permission, or printability.
// The caller must compute sourceRevision from the FULL current source and planHash
// from the FULL current plan, and recheck both before any later atomic adoption.
export const EXACT_CLIENT_LIMITS=Object.freeze({requestBytes:128*1024*1024,resultBytes:200*1024*1024,controlBytes:64*1024,timeoutMs:180_000,requestTimeoutMs:30_000,cancelTimeoutMs:30_000,pollMs:10_000});
const hash=/^[a-f0-9]{64}$/,uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const active=new Set(['queued','running','cancelling']),terminal=new Set(['completed','cancelled','timed_out','failed']);
const encoder=new TextEncoder(),ownErrors=new WeakSet();
const messages={INPUT:'Ungültiger exakter Rechenauftrag.',ORIGIN:'Der Rechendienst muss im selben lokalen Browser-Ursprung laufen.',BUSY:'Dieser Client bearbeitet bereits einen Auftrag.',UNAVAILABLE:'Der lokale exakte Rechendienst ist nicht verfügbar.',PROTOCOL:'Der lokale Rechendienst lieferte eine ungültige Antwort.',AUTHORITY:'Die exakte Ergebnisgeometrie stimmt nicht mit dem Auftrag überein.',NETWORK:'Die Verbindung zum lokalen Rechendienst wurde unterbrochen.',TIMEOUT:'Das Zeitlimit der exakten Berechnung wurde erreicht.',ABORTED:'Die exakte Berechnung wurde abgebrochen.',STALE:'Modell oder Schnittplan haben sich während der Berechnung geändert.',REVISION:'Der aktuelle Modell- und Planstand konnte nicht geprüft werden.',PROGRESS:'Die Fortschrittsanzeige konnte nicht aktualisiert werden.',FAILED:'Die exakte Berechnung ist fehlgeschlagen.',CANCEL_UNCONFIRMED:'Das Ende des lokalen Rechenauftrags konnte nicht bestätigt werden.'};
function problem(reason,details={}){const e=Object.assign(new Error(messages[reason]),{name:'ExactJobClientError',code:`EXACT_JOB_${reason}`,...details});ownErrors.add(e);return e;}
const isProblem=e=>e&&typeof e==='object'&&ownErrors.has(e);
function integer(n,max){return Number.isSafeInteger(n)&&n>0&&n<=max;}
function configured(n,max){if(!integer(n,max))throw problem('INPUT');return n;}
function localOrigin(baseURL,currentOrigin){
 if(typeof baseURL!=='string'||!/^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}\/?$/.test(baseURL))throw problem('ORIGIN');
 let url;try{url=new URL(baseURL);}catch{throw problem('ORIGIN');}
 if(!url.port||Number(url.port)>65535||currentOrigin!==url.origin)throw problem('ORIGIN');
 return url.origin;
}
function revisions(value){return value&&typeof value.sourceRevision==='string'&&hash.test(value.sourceRevision)&&typeof value.planHash==='string'&&hash.test(value.planHash);}
function status(value,job,capture){
 if(!value||value.schema!=='prinjekt-exact-job-status-v1'||value.id!==job.id||value.sourceRevision!==capture.sourceRevision||value.planHash!==capture.planHash||value.reviewRequired!==true||value.printable!==false||!Number.isFinite(value.createdAt)||value.createdAt<=0||!active.has(value.state)&&!terminal.has(value.state)||active.has(value.state)&&value.finishedAt!==null||terminal.has(value.state)&&(!Number.isFinite(value.finishedAt)||value.finishedAt<value.createdAt))throw problem('PROTOCOL');
 return {state:value.state,finishedAt:value.finishedAt};
}
function envelope(value,grid){
 if(!value||!(grid?value.operation==='grid':['union','intersection','difference'].includes(value.operation))||!revisions(value)||!Array.isArray(value.inputs)||value.inputs.length!==(grid?1:2)||typeof value.getCurrentRevision!=='function'||value.onProgress!==undefined&&typeof value.onProgress!=='function')throw problem('INPUT');
 const ids=new Set();let vertices=0,faces=0,bytes=0;const operands=[];
 const inputs=Array.from(value.inputs,input=>{
  if(!input||Object.keys(input).some(k=>!['id','role','meshText','meshHash'].includes(k))||typeof input.id!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(input.id)||ids.has(input.id)||!['source','cutter','intermediate'].includes(input.role)||typeof input.meshText!=='string'||typeof input.meshHash!=='string'||!hash.test(input.meshHash))throw problem('INPUT');
  if(grid&&(input.id!=='source'||input.role!=='source'))throw problem('INPUT');
  bytes+=input.meshText.length;if(bytes>EXACT_CLIENT_LIMITS.requestBytes)throw problem('INPUT');
  let mesh;try{mesh=parseExactMesh(input.meshText,{requireCanonical:true});}catch{throw problem('INPUT');}
  if(exactHash(input.meshText)!==input.meshHash)throw problem('INPUT');
  vertices+=mesh.vertexCount;faces+=mesh.faceCount;if(vertices>EXACT_GEOMETRY_LIMITS.vertices||faces>EXACT_GEOMETRY_LIMITS.faces)throw problem('INPUT');
  ids.add(input.id);operands.push(Object.freeze({id:input.id,role:input.role,meshHash:input.meshHash,faceCount:mesh.faceCount}));
  return Object.freeze({id:input.id,role:input.role,meshText:input.meshText,meshHash:input.meshHash});
 });
 let plan;
 if(grid){try{plan=validateExactGridPlan(value.plan,inputs[0].meshText);}catch{throw problem('INPUT');}if(plan.planHash!==value.planHash)throw problem('INPUT');}
 const capture=Object.freeze({schema:grid?'prinjekt-exact-grid-job-v1':'prinjekt-exact-boolean-job-v1',operation:value.operation,sourceRevision:value.sourceRevision,planHash:value.planHash,inputs:Object.freeze(inputs),...(grid?{plan}:{})}),body=JSON.stringify(capture);
 if(encoder.encode(body).length>EXACT_CLIENT_LIMITS.requestBytes)throw problem('INPUT');
 return {capture,body,operands};
}
function splitEnvelope(value){
 if(!value||value.operation!=='split'||!revisions(value)||typeof value.getCurrentRevision!=='function'||value.onProgress!==undefined&&typeof value.onProgress!=='function')throw problem('INPUT');
 let checked;
 try{checked=validateExactSplitJob({schema:'prinjekt-exact-split-job-v1',operation:value.operation,source:value.source,poseReview:value.poseReview,refinement:value.refinement,candidateId:value.candidateId,sourceRevision:value.sourceRevision,planHash:value.planHash});}catch{throw problem('INPUT');}
 const capture=checked.job,body=JSON.stringify(capture);
 if(encoder.encode(body).length>EXACT_CLIENT_LIMITS.requestBytes)throw problem('INPUT');
 // Keep the original stored pose hash. The helper recomputes physical metrics
 // locally without replacing the originating runtime's refinement binding.
 return {capture,body,cutter:checked.cutter,bindings:checked.bindings};
}
function sameBindings(actual,expected){return actual&&typeof actual==='object'&&!Array.isArray(actual)&&Object.keys(actual).length===Object.keys(expected).length&&Object.entries(expected).every(([key,value])=>Object.hasOwn(actual,key)&&actual[key]===value);}
// Race even an injected fetch/callback which ignores AbortSignal. All errors are
// our fixed messages: response text, capabilities and arbitrary callbacks' errors
// must never leak through a loggable Error/cause/result object.
async function bounded(operation,{milliseconds,signal,onAbort}={}){
 if(signal?.aborted)throw problem('ABORTED');
 let timer,listener;
 const stopped=new Promise((_,reject)=>{
  const stop=reason=>{try{onAbort?.();}catch{}reject(problem(reason));};
  listener=()=>stop('ABORTED');if(signal?.aborted)listener();else signal?.addEventListener('abort',listener,{once:true});
  timer=setTimeout(()=>stop('TIMEOUT'),Math.max(1,milliseconds));
 });
 try{return await Promise.race([stopped,Promise.resolve().then(operation)]);}finally{clearTimeout(timer);signal?.removeEventListener('abort',listener);}
}
async function pause(milliseconds,signal){let timer;try{await bounded(()=>new Promise(resolve=>{timer=setTimeout(resolve,milliseconds);}),{milliseconds:milliseconds+1000,signal});}finally{clearTimeout(timer);}}

/** No storage, query-string credentials, global session cache, network fallback
 * or adoption is performed. One client permits one in-flight review. */
export function createExactJobClient({baseURL=globalThis.location?.origin,currentOrigin=globalThis.location?.origin,fetchImpl=globalThis.fetch,timeoutMs=180_000,requestTimeoutMs=30_000,cancelTimeoutMs=30_000,pollMs=250}={}){
 requireLocalExactRuntime();
 const origin=localOrigin(baseURL,currentOrigin);
 if(typeof fetchImpl!=='function')throw problem('INPUT');
 configured(timeoutMs,EXACT_CLIENT_LIMITS.timeoutMs);configured(requestTimeoutMs,EXACT_CLIENT_LIMITS.requestTimeoutMs);configured(cancelTimeoutMs,EXACT_CLIENT_LIMITS.cancelTimeoutMs);configured(pollMs,EXACT_CLIENT_LIMITS.pollMs);
 let busy=false;
 async function request(route,{method='GET',headers={},body,limit=EXACT_CLIENT_LIMITS.controlBytes,deadline,signal}={}){
  const controller=new AbortController();let reader;
  const milliseconds=Math.min(requestTimeoutMs,deadline-Date.now());if(milliseconds<=0)throw problem('TIMEOUT');
  const stop=()=>{controller.abort();if(reader)Promise.resolve(reader.cancel()).catch(()=>{});};
  try{
   const result=await bounded(async()=>{
    const response=await fetchImpl(origin+route,{method,headers,body,signal:controller.signal,mode:'same-origin',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer'});
    if(!response||!Number.isInteger(response.status)||response.status<100||response.status>599||response.redirected||response.url&&response.url!==origin+route||!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(response.headers?.get('content-type')??''))throw problem('PROTOCOL');
    const length=response.headers.get('content-length');if(length!==null&&(!/^(0|[1-9]\d*)$/.test(length)||!Number.isSafeInteger(Number(length))||Number(length)>limit))throw problem('PROTOCOL');
    if(!response.body?.getReader)throw problem('PROTOCOL');reader=response.body.getReader();
    let size=0,count=0,text='';const decoder=new TextDecoder('utf-8',{fatal:true});
    const decode=(bytes,options)=>{try{return decoder.decode(bytes,options);}catch{throw problem('PROTOCOL');}};
    for(;;){const item=await reader.read();if(item.done)break;if(!(item.value instanceof Uint8Array)||++count>65536)throw problem('PROTOCOL');size+=item.value.byteLength;if(size>limit)throw problem('PROTOCOL');text+=decode(item.value,{stream:true});}
    text+=decode();if(length!==null&&Number(length)!==size)throw problem('PROTOCOL');
    let value;try{value=JSON.parse(text);}catch{throw problem('PROTOCOL');}
    if(Date.now()>deadline)throw problem('TIMEOUT');return {status:response.status,value};
   },{milliseconds,signal,onAbort:stop});
   return result;
  }catch(e){stop();throw isProblem(e)?e:problem('NETWORK');}
  finally{try{reader?.releaseLock();}catch{}}
 }
 async function runReview(value,mode){
   const grid=mode==='grid',split=mode==='split';
   if(busy)throw problem('BUSY');busy=true;
   const started=Date.now(),deadline=started+timeoutMs;
   let sessionToken,job,capture,postPending=false,postRejected=false;
   const signal=value?.signal;
   // Only the original error code and confirmed lifecycle facts are public.
   async function cleanup(){
    const end=Date.now()+cancelTimeoutMs,headers={'X-Prinjekt-Session':sessionToken,'X-Prinjekt-Job':job.capability},route=`/api/exact-jobs/${job.id}`;
    const response=await request(route,{method:'DELETE',headers,deadline:end});
    if(response.status===200&&response.value?.deleted===true)return true;
    if(response.status!==202)throw problem('PROTOCOL');
    let state=status(response.value,job,capture);
    while(!terminal.has(state.state)){
     if(Date.now()>=end)throw problem('TIMEOUT');
     await pause(Math.min(pollMs,end-Date.now()));
     const next=await request(route,{headers,deadline:end});if(next.status!==200)throw problem('PROTOCOL');state=status(next.value,job,capture);
    }
    return true;
   }
   try{
    if(signal!==undefined&&(!signal||typeof signal.addEventListener!=='function'||typeof signal.removeEventListener!=='function'||typeof signal.aborted!=='boolean'))throw problem('INPUT');
    if(signal?.aborted)throw problem('ABORTED');
    const prepared=split?splitEnvelope(value):envelope(value,grid);capture=prepared.capture;
    // Capture the callbacks too; later mutation of the caller's options cannot
    // replace the revision guard or the operation already being reviewed.
    const getCurrentRevision=value.getCurrentRevision,onProgress=value.onProgress;
    async function guard(){
     if(signal?.aborted)throw problem('ABORTED');if(Date.now()>=deadline)throw problem('TIMEOUT');
     let current;try{current=await bounded(()=>getCurrentRevision(),{milliseconds:deadline-Date.now(),signal});}catch(e){throw isProblem(e)?e:problem('REVISION');}
     if(!revisions(current))throw problem('REVISION');
     if(current.sourceRevision!==capture.sourceRevision||current.planHash!==capture.planHash)throw problem('STALE');
     if(Date.now()>=deadline)throw problem('TIMEOUT');
    }
    async function progress(state){
     if(onProgress){try{await bounded(()=>onProgress(Object.freeze({state,elapsedMs:Date.now()-started,reviewRequired:true,printable:false})),{milliseconds:Math.max(1,deadline-Date.now()),signal});}catch(e){throw isProblem(e)?e:problem('PROGRESS');}}
     await guard();
    }
    await guard();
    const session=await request('/api/exact-session',{headers:{'X-Prinjekt-Client':'1'},deadline,signal});
    if(session.status===503)throw problem('UNAVAILABLE');
    const info=session.value;
    if(session.status!==200||!info||info.schema!=='prinjekt-exact-session-v1'||typeof info.available!=='boolean'||info.automaticClosure!==false||typeof info.sessionToken!=='string'||!hash.test(info.sessionToken)||!Array.isArray(info.capabilities))throw problem('PROTOCOL');
    if(!info.available)throw problem('UNAVAILABLE');
    if(!info.capabilities.includes(split?'split-review-v1':grid?'grid-review-v1':'boolean-review-v1'))throw problem('PROTOCOL');
    if(!info.limits||!integer(info.limits.requestBytes,EXACT_CLIENT_LIMITS.requestBytes)||!integer(info.limits.resultBytes,EXACT_CLIENT_LIMITS.resultBytes)||!integer(info.limits.durationMs,EXACT_CLIENT_LIMITS.timeoutMs)||encoder.encode(prepared.body).length>info.limits.requestBytes)throw problem('PROTOCOL');
    sessionToken=info.sessionToken;
    await progress('submitting'); // Includes the mandatory immediate pre-POST guard.
    postPending=true;
    // Do not discard the POST reply merely because the caller aborts meanwhile:
    // first acquire its capability, then cancel the owned job and await exit.
    const accepted=await request('/api/exact-jobs',{method:'POST',headers:{'Content-Type':'application/json','X-Prinjekt-Session':sessionToken},body:prepared.body,deadline});
    if(accepted.status>=400&&accepted.status<500||accepted.status===503){postRejected=true;throw problem(accepted.status===409?'BUSY':accepted.status===503?'UNAVAILABLE':'PROTOCOL');}
    if(typeof accepted.value?.id==='string'&&uuid.test(accepted.value.id)&&typeof accepted.value.capability==='string'&&hash.test(accepted.value.capability))job={id:accepted.value.id,capability:accepted.value.capability};
    if(accepted.status!==202||!job)throw problem('PROTOCOL');
    let state=status(accepted.value,job,capture);await guard();
    const headers={'X-Prinjekt-Session':sessionToken,'X-Prinjekt-Job':job.capability},route=`/api/exact-jobs/${job.id}`;
    for(;;){
     await progress(state.state);
     if(terminal.has(state.state))break;
     await pause(Math.min(pollMs,Math.max(1,deadline-Date.now())),signal);await guard();
     const next=await request(route,{headers,deadline,signal});if(next.status!==200)throw problem('PROTOCOL');state=status(next.value,job,capture);await guard();
    }
    if(state.state!=='completed')throw problem(state.state==='timed_out'?'TIMEOUT':state.state==='cancelled'?'ABORTED':'FAILED');
    await guard();
    const response=await request(route+'/result',{headers,limit:info.limits.resultBytes,deadline,signal});
    const result=response.value;
    if(response.status!==200||!result||result.schema!==(split?'prinjekt-exact-split-result-v1':grid?'prinjekt-exact-grid-result-v1':'prinjekt-exact-boolean-result-v1')||result.sourceRevision!==capture.sourceRevision||result.planHash!==capture.planHash||result.operation!==capture.operation||result.reviewRequired!==true||result.printable!==false)throw problem('PROTOCOL');
    let reviewed;
    if(split){
     if(!sameBindings(result.bindings,prepared.bindings))throw problem('AUTHORITY');
     let partition;try{partition=validateExactSplitPartitionReview(result.partition,{source:capture.source,cutter:prepared.cutter,poseReviewHash:capture.poseReview.reviewHash,refinementHash:capture.refinement.refinementHash});}catch{throw problem('AUTHORITY');}
     reviewed={partition,bindings:prepared.bindings};
    }else if(grid){
     let partition;try{partition=validateExactGridPartitionReview(result.partition,{sourceMeshText:capture.inputs[0].meshText,plan:capture.plan});}catch{throw problem('AUTHORITY');}
     reviewed={partition};
    }else{
     let geometry;try{geometry=validateExactAuthority(result.geometry);}catch{throw problem('AUTHORITY');}
     if(geometry.origin.kind!=='boolean'||geometry.origin.operation!==capture.operation||geometry.origin.operands.length!==prepared.operands.length||geometry.origin.operands.some((x,i)=>['id','role','meshHash','faceCount'].some(k=>x[k]!==prepared.operands[i][k])))throw problem('AUTHORITY');
     reviewed={geometry};
    }
    await guard();await progress('review-ready');
    // A completed server job is retained by its bounded TTL. No capability is
    // returned or persisted; later calls acquire a new in-memory session.
    return Object.freeze({schema:split?'prinjekt-exact-split-review-v1':grid?'prinjekt-exact-grid-review-v1':'prinjekt-exact-review-v1',...reviewed,sourceRevision:capture.sourceRevision,planHash:capture.planHash,operation:capture.operation,reviewRequired:true,printable:false,proofStatus:Object.freeze({materialConservation:false,interiorPermission:false,printability:false,adoption:false})});
   }catch(e){
    const original=isProblem(e)?e:problem('INPUT');
    if(job){try{await cleanup();}catch{throw problem('CANCEL_UNCONFIRMED',{reasonCode:original.code,cancellationConfirmed:false});}throw Object.assign(original,{cancellationConfirmed:true});}
    if(postPending&&!postRejected)throw problem('CANCEL_UNCONFIRMED',{reasonCode:original.code,cancellationConfirmed:false,submissionOutcomeUnknown:true});
    throw original;
   }finally{sessionToken=undefined;job=undefined;capture=undefined;busy=false;}
 }
 return Object.freeze({runBooleanReview:value=>runReview(value,'boolean'),runGridReview:value=>runReview(value,'grid'),runSplitReview:value=>runReview(value,'split')});
}
