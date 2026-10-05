/** Private display worker. Native checks own no project or external job state. */
export function createFinPreviewClient({onResult,onClear=()=>{},delay=200,validationDelay=600,validationTimeout=15000,workerFactory}){
 let worker=null,model=null,inFlight=null,pending=null,latest=null,nativeReady=null,timer=null,settleTimer=null,watchdog=null,lastStart=0,disposed=false,clearing=false,epoch=0,sequence=0,configuration=null;
 const cancelTimers=()=>{for(const id of [timer,settleTimer,watchdog])if(id!==null)clearTimeout(id);timer=settleTimer=watchdog=null;};
 function stop(){if(watchdog!==null)clearTimeout(watchdog);watchdog=null;worker?.terminate();worker=null;model=null;inFlight=null;}
 function matches(request){return !disposed&&request.epoch===epoch&&latest?.token.id===request.token.id&&latest?.token.revision===request.token.revision&&latest?.token.generation===request.token.generation;}
 function current(request){return matches(request)&&latest?.token.sequence===request.token.sequence;}
 function boot(part,revision,bed){
  stop();const currentWorker=workerFactory?workerFactory():new Worker(new URL('./fin-preview.worker.mjs',import.meta.url),{type:'module'});worker=currentWorker;
  currentWorker.onmessage=({data})=>{
   if(worker!==currentWorker||!inFlight||data.requestId!==inFlight.id)return;
   const request=inFlight.request,stage=inFlight.stage;if(watchdog!==null)clearTimeout(watchdog);watchdog=null;inFlight=null;
   if(data.fatal)stop();
   if(matches(request)&&(stage===0||current(request)))onResult({...request.token,...data.result,previewStage:stage});
   if(!data.fatal)schedule();
  };
  currentWorker.onerror=()=>{if(worker!==currentWorker)return;const failed=inFlight;stop();pending=nativeReady=null;cancelTimers();if(failed&&current(failed.request))onResult({...failed.request.token,previewStage:1,valid:false,message:'Die Finnenvorschau konnte nicht geprüft werden. Bitte die Stelle erneut wählen.'});};
  model={part,revision,bed:JSON.stringify(bed)};
  // Clone the full original, including native binding/assembly pose and existing
  // fins. Display Float32 geometry is never substituted for its authority.
  currentWorker.postMessage({op:'model',data:part,bed});
 }
 function send(request,stage){
  if(!worker||!matches(request))return;
  const id=++sequence;inFlight={id,request,stage};if(stage===0)lastStart=performance.now();
  worker.postMessage({op:stage===0?'preview':'validate',requestId:id,token:request.token,settings:request.settings});
  if(stage===1)watchdog=setTimeout(()=>{if(inFlight?.id!==id)return;stop();pending=nativeReady=null;cancelTimers();if(current(request))onResult({...request.token,previewStage:1,valid:false,message:'Die Kontaktprüfung der Vorschau dauert zu lange. Eine kürzere Linie wählen.'});},validationTimeout);
 }
 function schedule(){
  if(disposed||inFlight||timer||!worker)return;
  if(pending){timer=setTimeout(()=>{timer=null;if(disposed||inFlight||!pending)return;const next=pending;pending=null;send(next,0);},Math.max(0,delay-(performance.now()-lastStart)));}
  else if(nativeReady&&current(nativeReady)){const next=nativeReady;nativeReady=null;send(next,1);}
 }
 function request(part,token,settings,bed){
  if(disposed)return;
  const config=JSON.stringify([settings.tool,settings.material,settings.layerHeight,settings.width,settings.footLength,settings.thickness,settings.angle,settings.tines,settings.tineDensity,bed]);
  if(configuration!==config){configuration=config;epoch++;}
  if(!model||model.part!==part||model.revision!==token.revision||model.bed!==JSON.stringify(bed))boot(part,token.revision,bed);
  latest={token:{...token},settings:structuredClone(settings),epoch};pending=latest;nativeReady=null;
  if(settleTimer!==null)clearTimeout(settleTimer);
  settleTimer=setTimeout(()=>{settleTimer=null;if(latest){nativeReady=latest;schedule();}},validationDelay);schedule();
 }
 function clear(){
  if(clearing)return;clearing=true;
  try{epoch++;pending=latest=nativeReady=null;cancelTimers();
   // This is an isolated in-memory preview kernel, never a project mutation or
   // HTTP job. Discard its entire worker if a native preview is still running.
   if(inFlight?.stage===1)stop();onClear();
  }finally{clearing=false;}
 }
 function dispose(){disposed=true;clear();stop();}
 return {request,clear,dispose};
}
