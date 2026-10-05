import {Matrix3,Matrix4,Vector3} from 'three';
import {fromSolid,bounds,transformData} from './engine.mjs';
import {orientOnCutFace,cutFacePrintPoses,connectedCutContactArea as contactArea,validatedSelectedCutPose} from './cut-orientation.mjs';
import {chooseCutPosePair,compareRefinementChoices,cutPoseSelection,STABLE_TRADEOFF_SEVERE_WEIGHT} from './cut-pose-pairs.mjs';
import {overhangMetrics} from './overhang-metrics.mjs';
import {printStability} from './print-stability.mjs';
import {massCutCandidates,massComplementCandidates,stabilityCutCandidates} from './mass-cut-candidates.mjs';

const fatal=e=>e?.name==='RuntimeError'||/Aborted|memory access out of bounds|unreachable|RuntimeError/i.test(e?.message||'');
const identity=()=>new Matrix4().toArray();
const tipsUnderGravity=record=>record.printStability?.valid===true&&record.printStability.stableUnderGravity===false&&Number.isFinite(record.printStability.minimumMargin)&&record.printStability.minimumMargin<=0;
const sum=values=>{let value=0,correction=0;for(const x of values){const y=x-correction,next=value+y;correction=(next-value)-y;value=next;}return value;};
function matrix(value){const array=value?.isMatrix4?value.toArray():value;if(array===undefined)return null;if(!Array.isArray(array)||array.length!==16||!array.every(Number.isFinite))throw Error('Ungültige Druckausrichtung.');const m=new Matrix4().fromArray(array),axes=[0,1,2].map(i=>new Vector3().setFromMatrixColumn(m,i));if(Math.abs(m.determinant()-1)>1e-5||axes.some(v=>Math.abs(v.lengthSq()-1)>1e-5)||Math.max(Math.abs(axes[0].dot(axes[1])),Math.abs(axes[0].dot(axes[2])),Math.abs(axes[1].dot(axes[2])))>1e-5||[3,7,11].some(i=>Math.abs(array[i])>1e-8)||Math.abs(array[15]-1)>1e-8)throw Error('Die Druckausrichtung muss eine starre Drehung und Verschiebung sein.');return [...array];}
function planesUnique(planes=[]){const map=new Map();for(const p of planes){if(!Array.isArray(p?.normal)||p.normal.length!==3||!p.normal.every(Number.isFinite)||!Number.isFinite(p.offset))throw Error('Ungültige Schnittebene.');const length=Math.hypot(...p.normal);if(length<1e-8)throw Error('Ungültige Schnittebene.');const normal=p.normal.map(x=>x/length),offset=p.offset/length,sign=normal.find(x=>Math.abs(x)>1e-8)<0?-1:1,key=[...normal,offset].map(x=>Math.round(x*sign*1e6)).join(',');if(!map.has(key))map.set(key,{normal,offset});}return [...map.values()];}
function planeInFrame(plane,m){const point=new Vector3(...plane.normal).multiplyScalar(plane.offset).applyMatrix4(m),normal=new Vector3(...plane.normal).applyMatrix3(new Matrix3().getNormalMatrix(m)).normalize();return {normal:normal.toArray(),offset:normal.dot(point)};}

/** Borrowed assembly-coordinate solids in, owned assembly-coordinate solids
 * out. Meshes are only read for orientation/quality; no Float32 re-import is
 * used for a split. Call result.dispose() after consuming its native handles.
 * A fatal kernel failure returns partitionUsable:false; replay the source in a
 * fresh kernel rather than committing any of those unusable native handles. */
export async function refineNativeOverhangs(api,owners,bed,{policy='strict',maxExtraParts=2,maxCandidatesPerOwner=8,maxMassComplementCandidates=0,maxStabilityCandidates=16,maxMillis=20000,minChildVolume=1000,minContactArea=50,minSevereGain=50,minRelativeGain=.15,overhangTolerance=.01,volumeRelativeTolerance=1e-9,stop=()=>false,progress=()=>{}}={}){
 if(!api||!Array.isArray(owners)||!['strict','stability-first'].includes(policy)||!Array.isArray(bed)||bed.length!==3||bed.some(x=>!Number.isFinite(x)||x<=0)||!Number.isInteger(maxExtraParts)||maxExtraParts<0||!Number.isInteger(maxCandidatesPerOwner)||maxCandidatesPerOwner<1||!Number.isInteger(maxMassComplementCandidates)||maxMassComplementCandidates<0||maxMassComplementCandidates>8||!Number.isInteger(maxStabilityCandidates)||maxStabilityCandidates<0||maxStabilityCandidates>24||!Number.isFinite(maxMillis)||maxMillis<=0||[minChildVolume,minContactArea,minSevereGain,minRelativeGain,overhangTolerance,volumeRelativeTolerance].some(x=>!Number.isFinite(x)||x<0)||minRelativeGain>1||typeof stop!=='function'||typeof progress!=='function')throw Error('Ungültige Einstellungen für die Überhangverbesserung.');
 const ids=new Set();for(const owner of owners){if(!owner?.solid||!['number','string'].includes(typeof owner.ownerId)||typeof owner.ownerId==='number'&&!Number.isFinite(owner.ownerId)||ids.has(JSON.stringify(owner.ownerId)))throw Error('Native Teile benötigen eindeutige ownerIds.');ids.add(JSON.stringify(owner.ownerId));}
 const started=performance.now(),records=[],history=[],rejections=[],sourceVolumes=[],orientationOwnerIds=new Set(),orientationsBeforeCut=new Map();let splits=0,attempted=0,extraParts=0,stopped=false,stopReason=null,kernelFailure=null,disposed=false,sequence=0,posesReviewed=0,posePairsReviewed=0;
 const tolerance=volume=>Math.max(1e-7,Math.abs(volume)*volumeRelativeTolerance);
 const check=solid=>{if(solid.status()!=='NoError')throw Error('Ungültiger nativer Volumenkörper.');return solid;};
 const dispose=solid=>{if(solid&&!kernelFailure)try{solid.delete();}catch(e){if(fatal(e))kernelFailure=e.message;throw e;}};
 const compact=solid=>{let out=null;try{out=solid.asOriginal();check(out);return out;}catch(e){if(fatal(e))kernelFailure=e.message;else dispose(out);throw e;}};
 async function pause(){progress(`Standfestigkeit und Überhänge verbessern: ${records.length} Teile · ${splits} zusätzliche Schnitte · ${attempted} Prüfungen`);await new Promise(resolve=>setTimeout(resolve,0));if(stop()){stopped=true;stopReason='requested';return true;}if(performance.now()-started>=maxMillis){stopped=true;stopReason='time_budget';return true;}return false;}
 function quality(record){const data={...fromSolid(record.solid),cutPlanes:record.cutPlanes};let printed,notice=null;
  if(record.referenceOverhang===undefined){const prior=record.printTransform?transformData(data,new Matrix4().fromArray(record.printTransform)):data;record.referenceOverhang=bounds(prior).size.every((size,i)=>size<=bed[i]+.005)&&contactArea(prior)>=1?overhangMetrics(prior):null;}
  // Native material and planes stay in assembly coordinates. Reconsider the
  // current body's printing pose BEFORE proposing a finer cut; a stale pose
  // must not manufacture an overhang that could be removed by rotation alone.
  orientationOwnerIds.add(record.ownerId);try{printed=validatedSelectedCutPose(data,bed,record.printTransform,record.printPoseSelection,{minContactArea,overhangTolerance});if(!printed){delete record.printPoseSelection;printed=orientOnCutFace(data,bed);posesReviewed+=printed.cutOrientation?.candidates||1;}}catch(e){if(fatal(e))throw e;notice=e.message;}
  if(!printed)printed=data;record.printTransform=printed.transform||identity();record.printStability=printed.printStability||printStability(printed);record.overhang=overhangMetrics(printed);record.size=bounds(printed).size;record.bedContactArea=contactArea(printed);record.bedFace=record.bedContactArea>=minContactArea?'cut':undefined;record.requiresCutFace=record.bedFace!=='cut';record.orientationNotice=notice;
  orientationsBeforeCut.set(record.ownerId,{ownerId:record.ownerId,sourceOwnerIds:[...record.sourceOwnerIds],candidates:printed.cutOrientation?.candidates||0,preservedJointPose:!!record.printPoseSelection,printTransform:[...record.printTransform],classification:record.printStability.classification,minimumMargin:record.printStability.minimumMargin,overhang:{...record.overhang},referenceOverhang:record.referenceOverhang,notice});return printed;
 }
 function candidates(record,printed){const box=bounds(printed),existing=planesUnique(record.cutPlanes.map(p=>planeInFrame(p,new Matrix4().fromArray(record.printTransform)))),inside=[];
  for(const plane of existing){let lo=Infinity,hi=-Infinity;for(let i=0;i<printed.vertices.length;i+=3){const p=printed.vertices,x=p[i]*plane.normal[0]+p[i+1]*plane.normal[1]+p[i+2]*plane.normal[2];lo=Math.min(lo,x);hi=Math.max(hi,x);}if(plane.offset>lo+.1&&plane.offset<hi-.1)inside.push({...plane,balance:Math.min(plane.offset-lo,hi-plane.offset)/(hi-lo),kind:'existing_plane'});}
  inside.sort((a,b)=>b.balance-a.balance);const mass=record.printStability?.valid?massCutCandidates(printed,{centerOfMass:record.printStability.centerOfMass,maxCandidates:maxCandidatesPerOwner}):[],selected=[...inside.slice(0,1),...mass,...inside.slice(1)];for(let axis=0;axis<3;axis++)if(box.size[axis]>.2){const normal=[0,0,0];normal[axis]=1;selected.push({normal,offset:(box.min[axis]+box.max[axis])/2,kind:'axis_midpoint'});}
  const unique=planesUnique(selected);return unique.slice(0,maxCandidatesPerOwner).map(p=>{const entry=selected.find(q=>Math.abs(Math.abs(q.normal.reduce((s,x,i)=>s+x*p.normal[i],0))-1)<1e-5&&Math.abs(q.offset-p.offset)<1e-5);return {...p,kind:entry?.kind||'axis_midpoint',offsetKind:entry?.offsetKind};});
 }
 // Transactional copying leaves every borrowed owner usable on ordinary error.
 try{for(const owner of owners){check(owner.solid);const volume=owner.solid.volume();if(!Number.isFinite(volume)||volume<=0)throw Error('Native Teile benötigen positives Materialvolumen.');const cutPlanes=planesUnique(owner.cutPlanes),printTransform=matrix(owner.printTransform);let solid=null;try{solid=compact(owner.solid);if(Math.abs(solid.volume()-volume)>tolerance(volume))throw Error('Native Kopie verändert das Materialvolumen.');records.push({solid,ownerId:owner.ownerId,cutPlanes,printTransform,printPoseSelection:owner.printPoseSelection,metadata:owner.metadata&&typeof owner.metadata==='object'?{...owner.metadata}:owner.metadata,sourceOwnerIds:[...(owner.sourceOwnerIds||[owner.ownerId])],lineage:owner.lineage||{ancestors:[],branch:[]},volume,blocked:false});sourceVolumes.push(volume);solid=null;}catch(e){if(fatal(e))kernelFailure=e.message;throw e;}finally{dispose(solid);}}}
 catch(e){if(fatal(e))kernelFailure=e.message;else{records.forEach(r=>dispose(r.solid));throw e;}}
 try{
  if(!kernelFailure){for(const record of records){if(await pause())break;quality(record);}}
  while(!stopped&&!kernelFailure&&extraParts<maxExtraParts){if(await pause())break;const eligible=records.filter(r=>!r.blocked&&r.overhang&&(tipsUnderGravity(r)||r.overhang.severeArea>=minSevereGain)).sort((a,b)=>Number(tipsUnderGravity(b))-Number(tipsUnderGravity(a))||b.overhang.severeArea-a.overhang.severeArea);if(!eligible.length)break;const record=eligible[0],printed=quality(record),stabilityRepair=tipsUnderGravity(record);let sourceComponents=[],best=null;
   try{
    sourceComponents=record.solid.decompose();const componentVolumes=sourceComponents.map(s=>{check(s);return s.volume();});if(componentVolumes.length!==1||componentVolumes.some(x=>!Number.isFinite(x)||x<=0)){record.blocked=true;rejections.push({ownerId:record.ownerId,reason:'signed_or_disconnected_source',volumes:componentVolumes});continue;}
    function* candidateStages(){
     const protectedSuccess=()=>best&&!best.tradeoff&&(policy!=='stability-first'||!stabilityRepair||best.worstStabilityRank===0);
     const primary=candidates(record,printed);yield {name:'primary',planes:primary};
     // Strict mode protects its earlier behavior. For a tipping parent's
     // explicit stability-first repair, a marginal strict pair still gets
     // the bounded search for a robust pair at the SAME two-child count.
     if(protectedSuccess()||!stabilityRepair||stopped||kernelFailure)return;
     if(performance.now()-started>=maxMillis){stopped=true;stopReason='time_budget';return;}
     if(maxMassComplementCandidates)yield {name:'mass_complement',planes:massComplementCandidates(printed,{centerOfMass:record.printStability.centerOfMass,testedPlanes:primary,maxCandidates:maxMassComplementCandidates})};
     if(protectedSuccess()||!maxStabilityCandidates||stopped||kernelFailure)return;
     if(performance.now()-started>=maxMillis){stopped=true;stopReason='time_budget';return;}
     yield {name:'stability_fallback',planes:stabilityCutCandidates(printed,{centerOfMass:record.printStability.centerOfMass,contactHull:record.printStability.contact.hull,maxCandidates:maxStabilityCandidates})};
    }
    for(const stage of candidateStages()){
    for(const printPlane of stage.planes){
     if(await pause())break;attempted++;const plane=planeInFrame(printPlane,new Matrix4().fromArray(record.printTransform).invert()),planes=planesUnique([...record.cutPlanes,plane]);let halves=[],candidateRecords=[],committed=false;
     const reject=(reason,message)=>rejections.push({ownerId:record.ownerId,plane,candidateStage:stage.name,reason,...(message?{message}:{})});
     try{
      halves=record.solid.splitByPlane(plane.normal,plane.offset);if(halves.length!==2){reject('split_count');continue;}const volumes=halves.map(s=>{check(s);return s.volume();});if(volumes.some(x=>!Number.isFinite(x)||x<=minChildVolume)){reject('small_child');continue;}if(Math.abs(sum(volumes)-record.volume)>tolerance(record.volume)){reject('volume_change');continue;}
      let valid=true;const banks=[];for(let i=0;i<halves.length;i++){let components=[];try{components=halves[i].decompose();const signed=components.map(s=>{check(s);return s.volume();});if(signed.length!==1||signed.some(x=>!Number.isFinite(x)||x<=0)){reject('signed_or_disconnected_child');valid=false;break;}}catch(e){if(fatal(e))kernelFailure=e.message;throw e;}finally{components.forEach(dispose);}
       const data={...fromSolid(halves[i]),cutPlanes:planes};let poses;try{poses=cutFacePrintPoses(data,bed);}catch(e){if(fatal(e))throw e;reject('no_fitting_cut_face',e.message);valid=false;break;}posesReviewed+=poses.length;
       if(!poses.length){reject('no_fitting_cut_face');valid=false;break;}
       const bearing=poses.map(oriented=>({oriented,size:bounds(oriented).size,area:oriented.connectedBedContactArea})).filter(p=>p.size.every((x,k)=>x<=bed[k]+.005)&&p.area>=minContactArea);
       if(!bearing.length){reject('insufficient_cut_bed');valid=false;break;}
       const positive=bearing.filter(p=>p.oriented.printStability.valid&&p.oriented.printStability.stableUnderGravity===true);
       if(!positive.length){reject('unstable_child','Keine passende Schnittflächenlage hat einen Schwerpunkt mit positiver Reserve über der tatsächlichen Auflage.');valid=false;break;}
       banks.push(positive.map(({oriented,size,area})=>({solid:null,cutPlanes:planes,printTransform:oriented.transform,printStability:oriented.printStability,volume:volumes[i],size,overhang:oriented.overhang,bedContactArea:area,bedFace:'cut',requiresCutFace:false,cutPose:oriented.cutPose})));
      }
      if(!valid)continue;if(await pause())break;
      const choice=chooseCutPosePair(banks,{policy,stabilityRepair,parent:record.overhang,reference:record.referenceOverhang,minSevereGain,minRelativeGain,overhangTolerance});posePairsReviewed+=choice.reviewed;
      if(!choice.selection){reject(choice.reason);continue;}
      const selected=choice.selection,{severe,support,gain,balance}=selected;
      if(best&&compareRefinementChoices(selected,best,{policy,stabilityRepair})>=0){reject('dominated');continue;}
      candidateRecords=selected.pair.map(p=>({...p,printPoseSelection:cutPoseSelection(p,policy)}));
      for(let i=0;i<halves.length;i++){candidateRecords[i].solid=compact(halves[i]);const volume=candidateRecords[i].solid.volume();if(Math.abs(volume-volumes[i])>tolerance(volumes[i]))throw Error('Native Kindkopie verändert das Materialvolumen.');candidateRecords[i].volume=volume;}
      best?.records.forEach(r=>dispose(r.solid));best={records:candidateRecords,plane,printPlane,candidateStage:stage.name,gain,severe,support,balance,tradeoff:selected.tradeoff,strictRejection:selected.strictRejection,overhangObjective:selected.overhangObjective,worstStabilityRank:selected.worstStabilityRank,marginalChildren:selected.marginalChildren,posePairsReviewed:choice.reviewed,poseCounts:banks.map(b=>b.length)};committed=true;
     }catch(e){if(fatal(e)){kernelFailure=e.message;break;}reject('geometry_error',e.message);}
     finally{halves.forEach(dispose);if(!committed)candidateRecords.forEach(r=>dispose(r.solid));}
    }
    if(stopped||kernelFailure)break;
    }
    if(stopped||kernelFailure){best?.records.forEach(r=>dispose(r.solid));best=null;break;}
    if(!best){record.blocked=true;continue;}
    // The full candidate partition is committed only after every child passed.
    const childIds=best.records.map((_,side)=>{let id;do{id=JSON.stringify(['refined',record.ownerId,++sequence,side]);}while(ids.has(JSON.stringify(id)));ids.add(JSON.stringify(id));return id;});
    const children=best.records.map((child,side)=>({...child,ownerId:childIds[side],metadata:record.metadata&&typeof record.metadata==='object'?{...record.metadata}:record.metadata,sourceOwnerIds:[...record.sourceOwnerIds],lineage:{ancestors:[...(record.lineage.ancestors||[]),record.ownerId],branch:[...(record.lineage.branch||[]),side]},blocked:false}));
    records.splice(records.indexOf(record),1,...children);history.push({reason:stabilityRepair?'stability':'overhang',policy,tradeoff:best.tradeoff,strictRejection:best.strictRejection,overhangObjective:best.overhangObjective,parentOwnerId:record.ownerId,sourceOwnerIds:[...record.sourceOwnerIds],childOwnerIds:childIds,plane:best.plane,printPlane:best.printPlane,candidateStage:best.candidateStage,severeBefore:record.overhang.severeArea,severeAfter:best.severe,supportBefore:record.overhang.supportArea,supportAfter:best.support,referenceOverhang:record.referenceOverhang,deltaOptimized:{severeArea:best.severe-record.overhang.severeArea,supportArea:best.support-record.overhang.supportArea},deltaReference:record.referenceOverhang?{severeArea:best.severe-record.referenceOverhang.severeArea,supportArea:best.support-record.referenceOverhang.supportArea}:null,minimumMarginBefore:record.printStability?.minimumMargin,minimumMarginsAfter:children.map(p=>p.printStability.minimumMargin),stabilityClassesAfter:children.map(p=>p.printStability.classification),childPrintTransforms:children.map(p=>[...p.printTransform]),poseCounts:best.poseCounts,posePairsReviewed:best.posePairsReviewed,volumes:children.map(p=>p.volume)});dispose(record.solid);splits++;extraParts++;best=null;
   }catch(e){if(fatal(e))kernelFailure=e.message;throw e;}finally{sourceComponents.forEach(dispose);best?.records.forEach(r=>dispose(r.solid));}
  }
 }catch(e){if(fatal(e))kernelFailure=e.message;else{stopped=true;stopReason='interrupted';rejections.push({reason:'interrupted',message:e.message});}}
 const unresolved=[];if(!kernelFailure)for(const record of records){if(record.overhang?.needsFurtherSplit)unresolved.push({ownerId:record.ownerId,sourceOwnerIds:record.sourceOwnerIds,reason:'severe_overhang',area:record.overhang.severeArea,retained:true});if(record.requiresCutFace)unresolved.push({ownerId:record.ownerId,reason:'no_substantial_cut_face',retained:true});if(record.size?.some((x,i)=>x>bed[i]+.005))unresolved.push({ownerId:record.ownerId,reason:'outside_bed',retained:true});if(!record.overhang)unresolved.push({ownerId:record.ownerId,reason:'quality_unchecked',retained:true});if(record.printStability&&(!record.printStability.valid||record.printStability.stableUnderGravity!==true))unresolved.push({ownerId:record.ownerId,reason:'unstable_print_pose',classification:record.printStability.classification,retained:true});}
 const volumeBefore=sum(sourceVolumes),volumeAfter=sum(records.map(r=>r.volume)),partitionUsable=!kernelFailure&&sourceVolumes.length===owners.length,materialPreserved=partitionUsable&&Math.abs(volumeAfter-volumeBefore)<=sum(sourceVolumes.map(tolerance));
 return {owners:records.map(({blocked,...owner})=>owner),splits,attempted,extraParts,stopped,stopReason,kernelFailure,partitionUsable,materialPreserved,volumeBefore,volumeAfter,history,rejections,unresolved,orientationReviews:orientationOwnerIds.size,orientationsBeforeCut:[...orientationsBeforeCut.values()],posesReviewed,posePairsReviewed,tradeoffs:history.filter(h=>h.tradeoff).length,elapsedMs:performance.now()-started,criteria:{policy,stableTradeoffObjective:'support-plus-severe-surface-area',stableTradeoffSevereWeight:STABLE_TRADEOFF_SEVERE_WEIGHT,maxExtraParts,maxCandidatesPerOwner,maxMassComplementCandidates,maxStabilityCandidates,maxMillis,minChildVolume,minContactArea,minSevereGain,minRelativeGain,overhangTolerance},dispose(){if(disposed)return;disposed=true;records.forEach(r=>dispose(r.solid));}};
}


