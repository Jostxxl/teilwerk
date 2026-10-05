import {exactHash} from './exact-geometry.mjs';
import {emitExactGridCandidate,exactGridCandidateNeighbors,createExactGridGrouping,materializeExactGridGrouping} from './exact-grid-grouping.mjs';
import {deriveExactSupportPlanes} from './exact-support-planes.mjs';
import {reviewExactPrintPoses} from './exact-pose-review.mjs';

const freeze=v=>{if(v&&typeof v==='object'&&!Object.isFrozen(v)){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const fail=(reason)=>Object.assign(Error(`Automatische Teilzusammenfassung: ${reason}.`),{code:'EXACT_GROUPING_SEARCH_REJECTED',reason});
const hash=/^[a-f0-9]{64}$/;
const key=ids=>ids.join(',');
const ordered=ids=>[...ids].sort((a,b)=>Number(a)-Number(b));
const needsRefinement=p=>!positive(p)||p.printStability.classification!=='stable';
const defaults=Object.freeze({tinyVolume:1000,supportTolerance:0.01,severeTolerance:0.01,tinySupportAbsolute:2,tinySupportRelative:0.001});
function quality(value={}){
 if(!value||Object.keys(value).some(k=>!(k in defaults)))throw fail('quality_policy');
 const p={...defaults,...value};
 if(!Object.values(p).every(x=>Number.isFinite(x)&&x>=0)||p.tinyVolume>1000||p.supportTolerance>0.01||p.severeTolerance>0.01||p.tinySupportAbsolute>2||p.tinySupportRelative>0.001)throw fail('quality_policy');
 return freeze(p);
}
function positive(p){const s=p?.printStability;return s?.valid===true&&s.stableUnderGravity===true&&Number.isFinite(s.minimumMargin)&&s.minimumMargin>0&&Number.isFinite(p.connectedBedContactArea)&&p.connectedBedContactArea>=50&&Number.isFinite(p.overhang?.supportArea)&&Number.isFinite(p.overhang?.severeArea);}
// This gate consumes freshly computed reviews inside the session. Exposing it
// separately permits deterministic policy tests; it never authorizes geometry.
export function assessExactGroupingQuality(parents,selected,policy={}){
 const p=quality(policy);if(!Array.isArray(parents)||parents.length!==2)throw fail('parents');
 if(!positive(selected))return freeze({accepted:false,reason:'no_positive_gravity_margin'});
 const previous=parents.map(g=>g.selected).filter(Boolean);
 if(previous.some(x=>x.printStability?.classification==='stable')&&selected.printStability.classification!=='stable')return freeze({accepted:false,reason:'stability_class_degraded'});
 const support=previous.reduce((s,x)=>s+x.overhang.supportArea,0),severe=previous.reduce((s,x)=>s+x.overhang.severeArea,0);
 if(!Number.isFinite(support)||!Number.isFinite(severe))return freeze({accepted:false,reason:'invalid_parent_metrics'});
 const supportIncrease=selected.overhang.supportArea-support,severeIncrease=selected.overhang.severeArea-severe;
 if(severeIncrease>p.severeTolerance)return freeze({accepted:false,reason:'severe_overhang_increased',supportIncrease,severeIncrease});
 const tiny=parents.some(g=>Number.isFinite(g.volumeEstimate)&&g.volumeEstimate>0&&g.volumeEstimate<=p.tinyVolume);
 const allowance=tiny&&selected.printStability.classification==='stable'?Math.max(p.tinySupportAbsolute,p.tinySupportRelative*support):p.supportTolerance;
 if(supportIncrease>allowance)return freeze({accepted:false,reason:'support_increased',supportIncrease,severeIncrease});
 return freeze({accepted:true,reason:supportIncrease>p.supportTolerance?'bounded_tiny_absorption':'quality_preserved',supportIncrease,severeIncrease,supportAllowance:allowance});
}

/** A resumable finite greedy search over whole original material bodies.
 * No cut is refined here: every candidate first receives a physical print-pose
 * review. Assembly-frame exact authority is never transformed or discarded.
 * Execute this CPU work in a worker; maxMillis is checked between candidates.
 */
export function createExactGroupingSearch(index,{sourceRevision,usableBed,qualityPolicy,budget={},getCurrentRevision,signal,onProgress}={}){
 exactGridCandidateNeighbors(index,['1']); // Authenticate opaque index first.
 if(!hash.test(sourceRevision??'')||typeof getCurrentRevision!=='function'||!Array.isArray(usableBed)||usableBed.length!==3||!Array.from(usableBed).every(n=>Number.isFinite(n)&&n>=1&&n<=10000))throw fail('configuration');
 if(!budget||Object.keys(budget).some(k=>!['maxCandidates','cacheBytes','cacheEntries','maxFrontierPairs'].includes(k)))throw fail('budget');
 const limits={maxCandidates:512,cacheBytes:64*1024*1024,cacheEntries:16,maxFrontierPairs:65536,...budget};
 if(!Number.isInteger(limits.maxCandidates)||limits.maxCandidates<1||limits.maxCandidates>10000||!Number.isInteger(limits.cacheEntries)||limits.cacheEntries<1||limits.cacheEntries>128||!Number.isInteger(limits.cacheBytes)||limits.cacheBytes<1024||limits.cacheBytes>256*1024*1024)throw fail('budget');
 if(!Number.isInteger(limits.maxFrontierPairs)||limits.maxFrontierPairs<1||limits.maxFrontierPairs>65536)throw fail('budget');
 const policy=quality(qualityPolicy),bed=[...usableBed],configuration=freeze({sourceRevision,planHash:index.planHash,indexHash:index.indexHash,usableBed:bed,qualityPolicy:policy,budget:limits,algorithm:'whole-body-greedy-v1',poseEvaluator:'exact-pose-review-v1'});
 const configurationHash=exactHash(JSON.stringify(configuration)),groups=new Map(),membership=new Map(),queue=new Map(),decisions=[],geometryCache=new Map(),cancelWaiters=new Set();
 let initialized=0,attempts=0,complete=false,busy=false,cancelled=false,stopReason=null,cacheBytes=0,cacheHits=0,poseEvaluations=0,merges=0;
 for(let i=1;i<=index.bodyCount;i++){const id=String(i);groups.set(id,{bodyIds:[id],initialized:false});membership.set(id,id);}
 const check=()=>{if(cancelled||signal?.aborted)throw fail('aborted');if(stopReason)throw fail(stopReason);exactGridCandidateNeighbors(index,['1']);};
 async function bounded(callback,timeoutReason){
  check();let timer,abort;
  try{
   const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>reject(fail(timeoutReason)),10000);});
   const stopped=new Promise((_,reject)=>{abort=()=>reject(fail('aborted'));cancelWaiters.add(abort);signal?.addEventListener('abort',abort,{once:true});});
   const value=await Promise.race([Promise.resolve().then(callback),deadline,stopped]);check();return value;
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);cancelWaiters.delete(abort);}
 }
 async function current(){
  const revision=await bounded(()=>getCurrentRevision(),'revision_timeout');
  if(revision?.sourceRevision!==sourceRevision||revision?.planHash!==index.planHash)throw fail('stale');
 }
 function candidate(ids){
  const k=key(ids),cached=geometryCache.get(k);
  if(cached){geometryCache.delete(k);geometryCache.set(k,cached);cacheHits++;return cached.value;}
  const value=emitExactGridCandidate(index,ids),bytes=value.geometry.meshText.length*2+value.faceCount*16;
  if(bytes<=limits.cacheBytes){while(geometryCache.size&&(geometryCache.size>=limits.cacheEntries||cacheBytes+bytes>limits.cacheBytes)){const oldest=geometryCache.keys().next().value;cacheBytes-=geometryCache.get(oldest).bytes;geometryCache.delete(oldest);}geometryCache.set(k,{value,bytes});cacheBytes+=bytes;}
  return value;
 }
 function evaluate(c,retained){
  const planes=[...new Map([...c.actualCutPlanes,...deriveExactSupportPlanes(c.geometry,{maximumPlanes:12,minimumArea:50})].map(p=>[p.planeHash,p])).values()];
  if(!planes.length)return {review:null,selected:null};
  poseEvaluations++;const review=reviewExactPrintPoses(c.geometry,{usableBed:bed,cutPlanes:planes,posePolicy:'search',...(retained?{retainedAssemblyToPrint:retained}:{})});
  return {review,selected:review.selected};
 }
 const summary=(c,pose)=>({bodyIds:c.bodyIds,initialized:true,authorityHash:c.authorityHash,meshHash:c.meshHash,volumeEstimate:c.volumeEstimate,...pose});
 function neighbors(g){
  return [...new Set(exactGridCandidateNeighbors(index,g.bodyIds).neighbors.map(n=>membership.get(n.bodyId)))].filter(k=>k!==key(g.bodyIds)).sort();
 }
 function enqueue(g){for(const other of neighbors(g)){const pair=[key(g.bodyIds),other].sort(),pk=pair.join('|');if(!queue.has(pk)){
  if(queue.size>=limits.maxFrontierPairs){stopReason='frontier_limit';complete=false;throw fail(stopReason);}queue.set(pk,pair);
 }}}
 function nextPair(){
  const available=[...queue].filter(([,pair])=>pair.every(k=>groups.has(k)));
  available.sort((a,b)=>{
   const rank=entry=>{const gs=entry[1].map(k=>groups.get(k)),v=gs.map(g=>g.volumeEstimate??Infinity);return [v.some(n=>n<=policy.tinyVolume)?0:1,-v.filter(Number.isFinite).reduce((x,y)=>x+y,0)];};
   const x=rank(a),y=rank(b);return x[0]-y[0]||x[1]-y[1]||a[0].localeCompare(b[0]);
  });
  return available[0]?.[1];
 }
 function snapshot(){
  const list=[...groups.values()].sort((a,b)=>Number(a.bodyIds[0])-Number(b.bodyIds[0]));
  const metadata={schema:'prinjekt-exact-grouping-search-v1',configuration,configurationHash,complete,budgetExhausted:attempts>=limits.maxCandidates&&!complete,cancelled,initializedBodies:initialized,sourceBodyCount:index.bodyCount,groupCount:list.length,bodyGroups:list.map(g=>[...g.bodyIds]),groups:list.map(g=>({bodyIds:[...g.bodyIds],initialized:g.initialized,authorityHash:g.authorityHash??null,meshHash:g.meshHash??null,volumeEstimate:g.volumeEstimate??null,poseReview:g.review??null,needsRefinement:needsRefinement(g.selected)})),decisions:[...decisions],statistics:{attempts,merges,poseEvaluations,cacheHits,cacheEntries:geometryCache.size,cacheBytes},orientationBeforeRefinement:true,finiteSearch:true,globalOptimumProven:false,reviewRequired:true,printable:false};
  const boundedMetadata={...metadata,stopReason};return freeze({...boundedMetadata,searchHash:exactHash(JSON.stringify(boundedMetadata))});
 }
 async function step({maxCandidates=8,maxMillis=1000}={}){
  if(busy)throw fail('busy');if(!Number.isInteger(maxCandidates)||maxCandidates<1||maxCandidates>10000||!Number.isFinite(maxMillis)||maxMillis<1||maxMillis>60000)throw fail('step_budget');
  busy=true;const start=Date.now();let operations=0;
  try{
   await current();
   while(initialized<index.bodyCount&&operations<maxCandidates&&Date.now()-start<maxMillis){
    const id=String(initialized+1),c=candidate([id]),pose=evaluate(c);await current();groups.set(id,summary(c,pose));initialized++;operations++;
   }
   if(initialized===index.bodyCount&&queue.size===0&&attempts===0)for(const g of groups.values())enqueue(g);
   while(initialized===index.bodyCount&&attempts<limits.maxCandidates&&operations<maxCandidates&&Date.now()-start<maxMillis){
    const pair=nextPair();if(!pair){complete=true;break;}
    const parents=pair.map(k=>groups.get(k)),ids=ordered(parents.flatMap(g=>g.bodyIds)),c=candidate(ids),host=[...parents].sort((a,b)=>(b.volumeEstimate??0)-(a.volumeEstimate??0))[0];
    const pose=evaluate(c,host.selected?.assemblyToPrint),decision=assessExactGroupingQuality(parents,pose.selected,policy);await current();
    queue.delete(pair.join('|'));
    attempts++;operations++;decisions.push(freeze({bodyIds:ids,parentGroups:parents.map(g=>g.bodyIds),candidateHash:c.candidateHash,authorityHash:c.authorityHash,poseReviewHash:pose.review?.reviewHash??null,...decision}));
    if(decision.accepted){
     const merged=summary(c,pose);for(const p of pair)groups.delete(p);groups.set(key(ids),merged);for(const id of ids)membership.set(id,key(ids));
     for(const [pk,p]of queue)if(p.some(k=>pair.includes(k)))queue.delete(pk);enqueue(merged);merges++;
    }
   }
   if(initialized===index.bodyCount&&![...queue.values()].some(pair=>pair.every(k=>groups.has(k))))complete=true;
   await current();const result=snapshot();if(onProgress)await bounded(()=>onProgress(result),'progress_timeout');await current();return result;
  }finally{busy=false;}
 }
 async function finalize(basePartition,options){
  if(busy)throw fail('busy');if(initialized!==index.bodyCount)throw fail('baselines_pending');busy=true;
  try{
   await current();if(basePartition?.authorityHash!==index.basePartitionHash||basePartition?.stateHash!==index.baseStateHash||options?.plan?.planHash!==index.planHash)throw fail('base_binding');
   const saved=snapshot(),grouping=createExactGridGrouping(basePartition,saved.bodyGroups,options),parts=materializeExactGridGrouping(grouping,basePartition,options),poses=[];
   for(const part of parts){
    const g=groups.get(key(part.bodyIds));if(part.authorityHash!==g.authorityHash||part.meshHash!==g.meshHash)throw fail('candidate_commit_mismatch');
    let poseReview=null;
    if(g.selected){poseReview=reviewExactPrintPoses(part.geometry,{...g.review.configuration,posePolicy:'retain',retainedAssemblyToPrint:g.selected.assemblyToPrint});
     if(!poseReview.selected||JSON.stringify(poseReview.selected.assemblyToPrint)!==JSON.stringify(g.selected.assemblyToPrint)||JSON.stringify(poseReview.selected.printStability)!==JSON.stringify(g.selected.printStability)||JSON.stringify(poseReview.selected.overhang)!==JSON.stringify(g.selected.overhang))throw fail('final_pose_mismatch');
    }
    poses.push({id:part.id,bodyIds:part.bodyIds,poseReview,needsRefinement:needsRefinement(poseReview?.selected)});
   }
   await current();return freeze({schema:'prinjekt-exact-grouping-result-v1',sourceRevision,planHash:index.planHash,search:saved,grouping,parts,poses,orientationBeforeRefinement:true,reviewRequired:true,printable:false});
  }finally{busy=false;}
 }
 return Object.freeze({step,snapshot,finalize,cancel(){cancelled=true;geometryCache.clear();cacheBytes=0;for(const stop of cancelWaiters)stop();}});
}
