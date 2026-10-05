import {Matrix4,Vector3} from 'three';
import {toSolid,fromSolid,bounds,transformData} from './engine.mjs';
import {cutterFromDefinition} from './features.mjs';
import {cuttingPlanes,orientOnCutFace} from './cut-orientation.mjs';
import {overhangMetrics} from './overhang-metrics.mjs';
import {printStability} from './print-stability.mjs';
import {componentCutQuality} from './part-quality.mjs';
import {absorbNativeFragments} from './absorb-native-fragments.mjs';
import {absorbLocalRemainder} from './absorb-local-remainder.mjs';
import {refineNativeOverhangs} from './refine-native-overhangs.mjs';
import {repartitionNativeFragments} from './repartition-native-fragments.mjs';
import {traceNativeProvenance} from './native-provenance.mjs';

const fatal=e=>/Aborted|memory access out of bounds|unreachable|RuntimeError/i.test(e.message)||e.name==='RuntimeError';
const identity=()=>new Matrix4().toArray();
function overlap(a,b){return a.min.every((x,i)=>x<=b.max[i]+.05&&a.max[i]>=b.min[i]-.05);}
function definitionBox(d){const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity],xs=d.contours.flat().map(p=>p[0]),ys=d.contours.flat().map(p=>p[1]);for(const x of [Math.min(...xs),Math.max(...xs)])for(const y of [Math.min(...ys),Math.max(...ys)])for(const z of [d.min,d.max])for(let j=0;j<3;j++){const p=d.u[j]*x+d.v[j]*y+d.n[j]*z;min[j]=Math.min(min[j],p);max[j]=Math.max(max[j],p);}return {min,max};}
function definitionPlanes(d){const prepared={...d,u:new Vector3(...d.u),v:new Vector3(...d.v)};return [...cuttingPlanes(prepared),{normal:d.n,offset:d.min},{normal:d.n,offset:d.max}];}

// Preserve the original sequential ownership exactly: Q_i = C_i minus every
// earlier cutter, then intersect the immutable source with unions of Q_i.
// Every positive component is retained, including tiny ones. Unemitted groups
// stay in the remainder; stopping or testing a prefix never removes material.
export async function closeGroupedPlan(api,source,proposals,groups,bed,{stop=()=>false,progress=()=>{},maxGroups=Infinity,smallVolume=1,absorbFragments=false,absorptionOptions={},localRemainderOptions={},refineOverhangs=false,refinementOptions={},repartitionFragments=false,repartitionOptions={},captureNativePart=null,onNativePartition=null}={}){
 if(!Array.isArray(proposals)||!Array.isArray(groups)||!groups.length||!Array.isArray(bed)||bed.length!==3||bed.some(v=>!Number.isFinite(v)||v<=0)||!(maxGroups===Infinity||Number.isInteger(maxGroups)&&maxGroups>=0)||!Number.isFinite(smallVolume)||smallVolume<0)throw Error('Ungültiger gruppierter Schnittplan.');
 if(captureNativePart!==null&&typeof captureNativePart!=='function')throw Error('Ungültige native Geometrieübernahme.');
 if(onNativePartition!==null&&typeof onNativePartition!=='function')throw Error('Ungültige native Partitionsaufnahme.');
 const parentAssemblyMatrix=[...(source.assemblyMatrix||identity())],capturedParts=new WeakSet();let nativeCaptureFinalized=false;
 const owners=new Int32Array(proposals.length).fill(-1),details=groups.map((members,g)=>{if(!Array.isArray(members)||!members.length)throw Error('Eine Schnittgruppe benötigt Konturen.');for(const i of members){if(!Number.isInteger(i)||i<0||i>=proposals.length||owners[i]!==-1||!proposals[i].cutDefinition)throw Error('Konturen müssen eindeutig genau einer gültigen Schnittgruppe zugeordnet sein.');owners[i]=g;}return {members:[...members].sort((a,b)=>a-b),status:'pending',partIndices:[],volume:0,components:0};});
 const selectedCount=Math.min(groups.length,maxGroups),target=new Set(Array.from({length:selectedCount},(_,i)=>i)),lastProposal=selectedCount?Math.max(...details.slice(0,selectedCount).flatMap(g=>g.members)):-1;
 const masks=Array(groups.length).fill(null),proposalInfo=[],parts=[],unresolved=[],rejected=[],emptyGroups=[],nativeOwners=[];let occupied=null,covered=null,original=null,kernelFailure=null,preparationFailure=null,stopped=false,preparedThrough=-1,originalVolume=0,remainingCount=1,remainingComponents=0,resultVolume=0;
 const started=performance.now(),diagnostics={preparedCells:0,emptyCells:0,closedGroups:0,prismTriangles:0,peakPrismTriangles:0,unmappedProposals:[...owners].flatMap((g,i)=>g<0?[i]:[]),smallComponents:0,volumeTolerance:0,materialPreserved:false};
 function status(s){const error=s.status();if(error!=='NoError')throw Error(`Geometriekern: ${error}`);return s;}
 function compact(s){try{const out=s.asOriginal();try{return status(out);}catch(e){if(fatal(e))kernelFailure=e.message;else out.delete();throw e;}}catch(e){if(fatal(e))kernelFailure=e.message;throw e;}finally{if(!kernelFailure)s.delete();}}
 function unite(a,b){return compact(a.add(b));}
 async function pause(message){progress(message);await new Promise(resolve=>setTimeout(resolve,0));if(stop()){stopped=true;return true;}return false;}
 function validateMesh(data){const verified=toSolid(api,data);try{if(verified.status()!=='NoError')throw Error('Exportnetz ist kein gültiger Volumenkörper.');return verified.volume();}catch(e){if(fatal(e))kernelFailure=e.message;throw e;}finally{if(!kernelFailure)verified.delete();}}
 // The callback only creates detached transport data. It must not register or
 // retain the borrowed handle. Binding/serialization belong to the caller.
 // Capture all final bodies before attaching anything, while native ownership
 // is still alive. An ordinary transport failure never replaces valid geometry.
 function captureFinal(pairs){
  if(!captureNativePart)return;
  try{
   const pending=pairs.map(({part,native})=>{
    if(!native?.solid)throw Error('Der endgültige native Teilkörper fehlt.');
    const assemblyMatrix=new Matrix4().fromArray(parentAssemblyMatrix).multiply(new Matrix4().fromArray(part.transform||identity()).invert()).toArray();
    const attachment=captureNativePart({solid:native.solid,part,contactPlanes:native.cutPlanes||[],parentAssemblyMatrix:[...parentAssemblyMatrix],assemblyMatrix});
    if(!attachment||typeof attachment.then==='function'||!attachment.nativeGeometry||typeof attachment.nativeGeometry!=='object')throw Error('Die native Geometrieübernahme lieferte keine synchrone Momentaufnahme.');
    return attachment.nativeGeometry;
   });
   pairs.forEach(({part},i)=>{part.nativeGeometry=pending[i];capturedParts.add(part);});
   diagnostics.nativeTransport={applied:true,count:pairs.length,frame:'assembly'};
  }catch(e){if(fatal(e)){kernelFailure=e.message;throw e;}diagnostics.nativeTransport={applied:false,error:e.message};}
 }
 function abandonedParts(){
  if(captureNativePart)diagnostics.nativeTransport={applied:false,error:'Neue native Momentaufnahmen wurden nach einem Geometriekernfehler verworfen.'};
  return parts.map(part=>{if(!capturedParts.has(part))return part;const copy={...part};delete copy.nativeGeometry;return copy;});
 }
 function orient(data,planes,group,component){
  const base={...data,cutPlanes:planes,groupIndex:group,proposalMembers:details[group].members,remaining:false};let result;
  try{result={...base,...orientOnCutFace(base,bed),requiresCutFace:false,volume:data.volume};}
  catch(e){result={...base,transform:identity(),requiresCutFace:true,orientationNotice:e.message};unresolved.push({group,component,reason:'no_fitting_cut_face',message:e.message});}
  result.overhang=overhangMetrics(result);if(result.overhang.needsFurtherSplit)unresolved.push({group,component,reason:'severe_overhang',area:result.overhang.severeArea});
  result.printStability=printStability(result);if(!result.printStability.stableUnderGravity)unresolved.push({group,component,reason:'unstable_print_pose'});
  if(bounds(result).size.some((s,i)=>s>bed[i]+.005))unresolved.push({group,component,reason:'outside_bed'});
  if(data.volume<smallVolume){diagnostics.smallComponents++;unresolved.push({group,component,reason:'small_component',volume:data.volume});}
  result.exportedVolume=validateMesh(result);return result;
 }
 try{
  original=toSolid(api,source);originalVolume=original.volume();diagnostics.volumeTolerance=Math.max(.001,originalVolume*1e-7);
  // Only cutter solids participate in this phase. Force every result and reset
  // its native ancestry before releasing the preceding result.
  for(let i=0;i<=lastProposal;i++){
   if(await pause(`Schnittzuordnung ${i+1}/${lastProposal+1}: gemeinsame Teilgruppen vorbereiten …`))break;
   const d=proposals[i].cutDefinition;if(!d){preparationFailure=`Kontur ${i+1} besitzt keine Schnittdefinition.`;break;}
   let cutter=null,cell=null,nextOccupied=null;
   try{
    cutter=cutterFromDefinition(api,d).solid;status(cutter);proposalInfo[i]={box:definitionBox(d),planes:definitionPlanes(d)};
    cell=occupied?compact(cutter.subtract(occupied)):compact(cutter.translate([0,0,0]));
    nextOccupied=occupied?unite(occupied,cutter):compact(cutter.translate([0,0,0]));
    const group=owners[i];if(cell.isEmpty())diagnostics.emptyCells++;else if(target.has(group)){
     const next=masks[group]?unite(masks[group],cell):compact(cell.translate([0,0,0]));masks[group]?.delete();masks[group]=next;
    }
    occupied?.delete();occupied=nextOccupied;nextOccupied=null;preparedThrough=i;diagnostics.preparedCells++;
    diagnostics.prismTriangles=occupied.numTri();diagnostics.peakPrismTriangles=Math.max(diagnostics.peakPrismTriangles,diagnostics.prismTriangles+masks.reduce((s,m)=>s+(m?.numTri()||0),0));
   }catch(e){if(fatal(e))kernelFailure=e.message;else preparationFailure=e.message;break;}
   finally{if(!kernelFailure){cutter?.delete();cell?.delete();nextOccupied?.delete();}}
  }
  if(!stopped&&!kernelFailure&&!preparationFailure){
   // Keep output groups in the draft order, independently of cutter ownership.
   for(let g=0;g<selectedCount;g++){
    if(await pause(`Gruppe ${g+1}/${selectedCount}: berechnen und schließen …`))break;
    const mask=masks[g];if(!mask||mask.isEmpty()){details[g].status='empty';emptyGroups.push(g);continue;}
    let solid=null,components=[],nextCovered=null,pendingNative=[];const unresolvedStart=unresolved.length;
    try{
     solid=compact(original.intersect(mask));
     if(solid.isEmpty()){details[g].status='empty';emptyGroups.push(g);continue;}
     const volume=solid.volume();if(!Number.isFinite(volume)||volume<=0)throw Error('Ungültiges Gruppenvolumen.');
     components=solid.decompose();const volumes=components.map(s=>s.volume());if(volumes.some(v=>!Number.isFinite(v)))throw Error('Ungültiges Teilvolumen.');
     const preserveWhole=volumes.some(v=>v<=0),bodies=preserveWhole?[solid]:components;
     if(preserveWhole)unresolved.push({group:g,reason:'signed_components',volumes});
     if(components.length>1)unresolved.push({group:g,reason:'disconnected_group',components:components.length});
     const candidates=[];
     for(let j=0;j<bodies.length;j++){
      const data=fromSolid(bodies[j]),box=bounds(data),last=Math.max(...details[g].members),planes=[...(source.cutPlanes||[])];
      for(let i=0;i<=last;i++)if(proposalInfo[i]&&overlap(box,proposalInfo[i].box))planes.push(...proposalInfo[i].planes);
      candidates.push(orient(data,planes,g,j));
      if(absorbFragments||refineOverhangs||repartitionFragments||captureNativePart||onNativePartition)pendingNative.push({solid:compact(bodies[j].translate([0,0,0])),ownerId:parts.length+j,cutPlanes:planes,printTransform:candidates.at(-1).transform,metadata:{group:g,component:j,signedGroup:preserveWhole,proposalMembers:details[g].members,remaining:false}});
     }
     candidates.forEach((part,j)=>{part.cutQuality=componentCutQuality(unresolved.slice(unresolvedStart),j);});
     // Covered masks are committed only after every exported component passes.
     nextCovered=covered?unite(covered,mask):compact(mask.translate([0,0,0]));
     const first=parts.length;parts.push(...candidates);details[g]={...details[g],status:unresolved.length>unresolvedStart?'unresolved':'closed',partIndices:candidates.map((_,j)=>first+j),volume,components:components.length};diagnostics.closedGroups++;
     nativeOwners.push(...pendingNative);pendingNative=[];
     covered?.delete();covered=nextCovered;nextCovered=null;
    }catch(e){unresolved.splice(unresolvedStart);if(fatal(e)){kernelFailure=e.message;break;}details[g].status='rejected';rejected.push({group:g,reason:e.message});}
    finally{if(!kernelFailure){pendingNative.forEach(p=>p.solid.delete());components.forEach(s=>s.delete());solid?.delete();nextCovered?.delete();}}
   }
  }
  if(kernelFailure){
   // A poisoned kernel cannot compute an honest complement. Preserve the source
   // as the only committable result and expose generated meshes separately.
   const uncommittedParts=abandonedParts();parts.length=0;parts.push({...source,volume:originalVolume,transform:identity(),remaining:true});remainingCount=1;resultVolume=originalVolume;diagnostics.materialPreserved=true;
   return {parts,groups:details,remainingCount,complete:false,stopped,kernelFailure,preparationFailure,uncommittedParts,unresolved,rejected,emptyGroups,originalVolume,resultVolume,diagnostics:{...diagnostics,preparedThrough,elapsedMs:performance.now()-started}};
  }
  let rest=null,components=[];
  try{
   rest=covered?compact(original.subtract(covered)):compact(original.translate([0,0,0]));
   if(!rest.isEmpty()){
    const data=fromSolid(rest);data.exportedVolume=validateMesh(data);components=rest.decompose();remainingComponents=components.length;remainingCount=1;parts.push({...data,transform:identity(),remaining:true,cutPlanes:proposalInfo.flatMap(p=>p?.planes||[])});
    if(absorbFragments||refineOverhangs||repartitionFragments||captureNativePart||onNativePartition)nativeOwners.push({solid:compact(rest.translate([0,0,0])),ownerId:'remainder',cutPlanes:parts.at(-1).cutPlanes,metadata:{remaining:true,proposalMembers:[]}});
   }else remainingCount=0;
  }catch(e){if(fatal(e))kernelFailure=e.message;throw e;}finally{if(!kernelFailure){components.forEach(s=>s.delete());rest?.delete();}}
  if(onNativePartition){
   // A synchronous, read-only checkpoint opportunity before expensive native
   // optimizers. Solids and mesh arrays are borrowed ONLY for this call: callers
   // must serialize detached snapshots here, never retain/delete native handles
   // or start asynchronous work with them. Literal source-frame solids/planes
   // and source-to-print poses are preserved; no assembly transform is applied.
   // Callback completion is not a durable-write, reloadability or fit proof.
   const checkpoint={stage:'before-optimization',frame:'source',ownerCount:nativeOwners.length};
   try{
    const receipt=onNativePartition({stage:checkpoint.stage,frame:checkpoint.frame,
     owners:nativeOwners.map(owner=>({...owner,cutPlanes:structuredClone(owner.cutPlanes),printTransform:[...(owner.printTransform||identity())],metadata:structuredClone(owner.metadata)})),
     parts:parts.map(part=>({...part})),parentAssemblyMatrix:[...parentAssemblyMatrix],bed:[...bed],originalVolume,
     groups:structuredClone(details),remainingCount,remainingComponents,preparedThrough,stopped,preparationFailure,
     unresolved:structuredClone(unresolved),rejected:structuredClone(rejected),emptyGroups:[...emptyGroups],volumeTolerance:diagnostics.volumeTolerance});
    if(receipt&&typeof receipt.then==='function')throw Error('Die native Partitionsaufnahme muss synchron abgeschlossen werden.');
    diagnostics.nativePartitionCheckpoint={...checkpoint,completed:true};
   }catch(e){diagnostics.nativePartitionCheckpoint={...checkpoint,completed:false,error:e.message};if(fatal(e)){kernelFailure=e.message;throw e;}}
  }
  if((absorbFragments||refineOverhangs||repartitionFragments)&&!stopped&&!preparationFailure&&nativeOwners.length){
   let absorption,localRemainder,refinement,repartition,provenance;
   try{
    let optimizedOwners=nativeOwners;
    if(absorbFragments){
     localRemainder=await absorbLocalRemainder(api,optimizedOwners,bed,{...localRemainderOptions,stop,progress});
     if(!localRemainder.materialPreserved)throw Error('Die lokale Reststückzuordnung hat das Materialvolumen verändert.');
     optimizedOwners=localRemainder.owners;
    }
    if(refineOverhangs){
     refinement=await refineNativeOverhangs(api,optimizedOwners,bed,{...refinementOptions,stop,progress});
     if(refinement.kernelFailure||!refinement.partitionUsable)throw new WebAssembly.RuntimeError(refinement.kernelFailure||'Native Überhangaufteilung ist nicht mehr verwendbar.');
     if(!refinement.materialPreserved)throw Error('Die Überhangaufteilung hat das Materialvolumen verändert.');
     optimizedOwners=refinement.owners.map((owner,i)=>({...owner,ownerId:i,metadata:{...owner.metadata,sourceOwnerIds:owner.sourceOwnerIds,refinementBranch:owner.lineage.branch}}));
    }
    absorption=await absorbNativeFragments(api,optimizedOwners,bed,{...absorptionOptions,...(!absorbFragments?{maxAttempts:0}:{}),stop,progress});
    if(absorption.kernelFailure||!absorption.partitionUsable)throw new WebAssembly.RuntimeError(absorption.kernelFailure||'Native Reststückzuordnung ist nicht mehr verwendbar.');
    if(!absorption.atomInvariant||!absorption.perPartVolumeInvariant)throw Error('Die Reststückzuordnung hat die Materialherkunft nicht vollständig erhalten.');
    let finalNative=absorption.parts;
    if(repartitionFragments&&!stop()){
     const inputs=absorption.parts.map((owner,i)=>({...owner,ownerId:i,metadata:{sourceMetadata:owner.sourceMetadata}}));
     repartition=await repartitionNativeFragments(api,inputs,bed,{...repartitionOptions,stop,progress});
     if(repartition.kernelFailure||!repartition.partitionUsable)throw new WebAssembly.RuntimeError(repartition.kernelFailure||'Native Grenzkorrektur ist nicht mehr verwendbar.');
     if(!repartition.materialPreserved)throw Error('Die Grenzkorrektur hat das Materialvolumen verändert.');
     if(repartition.changes){
      // Reallocation splits previous owners, so a simple list of old atom IDs
      // no longer proves ownership. Intersect every resulting body with the
      // immutable native baseline and balance each source separately.
      finalNative=repartition.owners;
     }
    }
    if(repartition?.changes||localRemainder?.changes){
     provenance=await traceNativeProvenance(api,finalNative,nativeOwners,{progress});
     if(!provenance.invariant.ok||!provenance.invariant.complete)throw Error('Die neue Teilzuordnung hat die Materialherkunft nicht vollständig erhalten.');
    }
    const rebuilt=[],issues=[];
    for(let i=0;i<finalNative.length;i++){
     const native=finalNative[i],metadata=provenance?provenance.perPart[i].map(p=>nativeOwners.find(o=>o.ownerId===p.ownerId).metadata):native.sourceMetadata.map(p=>p.metadata),groupIndices=[...new Set(metadata.map(m=>m.group).filter(Number.isInteger))],remaining=metadata.every(m=>m.remaining),data=fromSolid(native.solid);
     const lineage=provenance?provenance.perPart[i]:native.atoms.map(({ownerId,component,volume,signedGroup})=>{const meta=native.sourceMetadata.find(m=>m.ownerId===ownerId)?.metadata;return {ownerId,component,volume,signedGroup,...(meta?.sourceOwnerIds?{sourceOwnerIds:meta.sourceOwnerIds,refinementBranch:meta.refinementBranch}: {})};});
     const part={...transformData({...data,cutPlanes:native.cutPlanes},new Matrix4().fromArray(native.printTransform)),volume:data.volume,remaining,groupIndex:groupIndices[0],groupIndices,proposalMembers:[...new Set(metadata.flatMap(m=>m.proposalMembers))].sort((a,b)=>a-b),cutLineage:lineage,...(provenance?{cutLineageMethod:'native-intersection'}:{}),bedFace:native.bedFace,bedContactArea:native.bedContactArea,requiresCutFace:native.requiresCutFace,overhang:native.overhang};
     const partIssues=provenance?[]:absorption.unresolved.filter(issue=>issue.part===i).map(issue=>({...issue,group:groupIndices[0],component:undefined,reason:issue.reason==='disconnected_signed_group'?'disconnected_group':issue.reason}));
     if(provenance){
      const add=(reason,extra={})=>partIssues.push({part:i,group:groupIndices[0],reason,...extra});
      if(data.volume<(repartitionOptions.smallVolume??1000)||Math.max(...bounds(data).size)<Math.min(...bed)*.15)add('small_component',{volume:data.volume});
      if(native.positiveComponents!==1)add('disconnected_group',{components:native.positiveComponents});
      if(native.signedGroup)add('signed_components');
      if(!native.overhang)add('metrics_unavailable');
      if(native.requiresCutFace||native.bedFace!=='cut')add('no_fitting_cut_face');
      if(bounds(part).size.some((v,j)=>v>bed[j]+.005))add('outside_bed');
      if(native.overhang?.needsFurtherSplit)add('severe_overhang',{area:native.overhang.severeArea});
     }
     part.printStability=printStability(part);part.cutOrientation=native.cutOrientation;part.printPoseSelection=native.printPoseSelection;
     if(!part.printStability.stableUnderGravity)partIssues.push({part:i,reason:'unstable_print_pose'});
     if(remaining)partIssues.push({part:i,reason:'unallocated_material'});
     part.cutQuality=componentCutQuality(partIssues);part.exportedVolume=validateMesh(part);rebuilt.push(part);issues.push(...partIssues);
    }
    const volume=rebuilt.reduce((sum,p)=>sum+p.volume,0),exportedVolume=rebuilt.reduce((sum,p)=>sum+p.exportedVolume,0);
    if(Math.abs(volume-originalVolume)>diagnostics.volumeTolerance||Math.abs(exportedVolume-originalVolume)>diagnostics.volumeTolerance)throw Error('Volumenprüfung nach der Reststückzuordnung fehlgeschlagen.');
    // Capture the selected native bodies before the optimizers release them.
    // Earlier candidates never receive snapshots of subsequently abandoned cuts.
    captureFinal(rebuilt.map((part,i)=>({part,native:finalNative[i]})));nativeCaptureFinalized=true;
    // Commit only after EVERY reoriented export and the native lineage pass.
    parts.splice(0,parts.length,...rebuilt);unresolved.splice(0,unresolved.length,...issues);remainingCount=parts.filter(p=>p.remaining).length;remainingComponents=finalNative.reduce((sum,p,i)=>sum+(parts[i].remaining?p.positiveComponents:0),0);stopped||=stop();
    details.forEach((detail,g)=>{if(!['closed','unresolved'].includes(detail.status))return;detail.partIndices=parts.flatMap((p,i)=>p.groupIndices.includes(g)?[i]:[]);detail.components=detail.partIndices.length;detail.status=detail.partIndices.some(i=>parts[i].cutQuality.issues.length)?'unresolved':'closed';});
    diagnostics.smallComponents=issues.filter(p=>p.reason==='small_component').length;
    diagnostics.absorption={applied:true,merges:absorption.merges,attempted:absorption.attempted,stopped:absorption.stopped,atomInvariant:absorption.atomInvariant,perPartVolumeInvariant:absorption.perPartVolumeInvariant,volumeBefore:absorption.volumeBefore,volumeAfter:absorption.volumeAfter,history:absorption.history,rejections:absorption.rejections};
    if(localRemainder)diagnostics.localRemainder={applied:!localRemainder.rollbackReason,changes:localRemainder.changes,attempted:localRemainder.attempted,stopped:localRemainder.stopped,stopReason:localRemainder.stopReason,materialPreserved:localRemainder.materialPreserved,volumeBefore:localRemainder.volumeBefore,volumeAfter:localRemainder.volumeAfter,history:localRemainder.history,uncommittedHistory:localRemainder.uncommittedHistory,rollbackReason:localRemainder.rollbackReason,provenance:localRemainder.partitionProvenance,rejections:localRemainder.rejections};
    if(refinement)diagnostics.refinement={applied:true,orientationsBeforeCut:refinement.orientationsBeforeCut,orientationReviews:refinement.orientationReviews,posesReviewed:refinement.posesReviewed,posePairsReviewed:refinement.posePairsReviewed,tradeoffs:refinement.tradeoffs,splits:refinement.splits,attempted:refinement.attempted,stopReason:refinement.stopReason,materialPreserved:refinement.materialPreserved,volumeBefore:refinement.volumeBefore,volumeAfter:refinement.volumeAfter,history:refinement.history,rejections:refinement.rejections,criteria:refinement.criteria};
    if(repartition)diagnostics.repartition={applied:true,changes:repartition.changes,attempted:repartition.attempted,stopReason:repartition.stopReason,materialPreserved:repartition.materialPreserved,history:repartition.history,rejections:repartition.rejections};
    if(provenance)diagnostics.provenance={invariant:provenance.invariant,partChecks:provenance.partChecks,ownerChecks:provenance.ownerChecks,attempted:provenance.attempted,skipped:provenance.skipped};
   }catch(e){if(fatal(e)){kernelFailure=e.message;throw e;}diagnostics.absorption={applied:false,error:e.message};if(refineOverhangs)diagnostics.refinement={applied:false,error:e.message};if(repartitionFragments)diagnostics.repartition={applied:false,error:e.message};}
   finally{if(!kernelFailure){repartition?.dispose();absorption?.dispose();refinement?.dispose();localRemainder?.dispose();}}
  }
  resultVolume=parts.reduce((sum,p)=>sum+p.volume,0);diagnostics.exportedResultVolume=parts.reduce((sum,p)=>sum+(p.exportedVolume??p.volume),0);diagnostics.exportedVolumeDifference=diagnostics.exportedResultVolume-originalVolume;diagnostics.materialPreserved=Number.isFinite(resultVolume)&&Math.abs(resultVolume-originalVolume)<=diagnostics.volumeTolerance;
  if(!diagnostics.materialPreserved||Math.abs(diagnostics.exportedVolumeDifference)>diagnostics.volumeTolerance)throw Error('Volumenprüfung der gruppierten Schnittaufteilung fehlgeschlagen.');
  if(!nativeCaptureFinalized)captureFinal(parts.map((part,i)=>({part,native:nativeOwners[i]})));
  const pendingGroups=details.filter(g=>g.status==='pending').length,complete=!stopped&&!preparationFailure&&!remainingCount&&!pendingGroups&&!unresolved.length&&!rejected.length&&diagnostics.absorption?.applied!==false&&!diagnostics.absorption?.stopped&&diagnostics.nativeTransport?.applied!==false;
  return {parts,groups:details,remainingCount,remainingComponents,pendingGroups,complete,stopped,kernelFailure,preparationFailure,unresolved,rejected,emptyGroups,originalVolume,resultVolume,merges:diagnostics.absorption?.merges||0,diagnostics:{...diagnostics,preparedThrough,elapsedMs:performance.now()-started}};
 }catch(e){if(!fatal(e)||!original)throw e;kernelFailure=e.message;return {parts:[{...source,volume:originalVolume,transform:identity(),remaining:true}],groups:details,remainingCount:1,complete:false,stopped,kernelFailure,preparationFailure,uncommittedParts:abandonedParts(),unresolved,rejected,emptyGroups,originalVolume,resultVolume:originalVolume,diagnostics:{...diagnostics,materialPreserved:true,preparedThrough,elapsedMs:performance.now()-started}};}finally{if(!kernelFailure){nativeOwners.forEach(p=>p.solid.delete());masks.forEach(m=>m?.delete());occupied?.delete();covered?.delete();original?.delete();}}
}
