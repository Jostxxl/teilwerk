import {Matrix4} from 'three';
import {snapshotNativeGeometry,restoreNativeGeometry} from './native-geometry-transport.mjs';
import {inventNativeComponents,selectNativeComponents} from './native-snapshot-components.mjs';
import {absorbNativeFragments} from './absorb-native-fragments.mjs';
import {traceNativeProvenance} from './native-provenance.mjs';
import {fromSolid,transformData} from './engine.mjs';
import {connectedCutContactArea} from './cut-orientation.mjs';

const fatal=e=>e?.name==='RuntimeError'||/Aborted|memory access out of bounds|unreachable|RuntimeError/i.test(e?.message||'');
const touches=(a,b,t=0)=>a.min.every((x,i)=>x<=b.max[i]+t&&a.max[i]>=b.min[i]-t);
const sum=xs=>{let s=0,c=0;for(const x of xs){const y=x-c,t=s+y;c=t-s-y;s=t;}return s;};

/** Reassign complete positive remainder components to small adjacent parts.
 * This stage creates no new cutting plane. Both local print poses are chosen
 * again by the ordinary absorber before judging a join. Signed/zero shells and
 * all unselected faces stay in the same remainder, with literal coordinates.
 * Original handles are borrowed. Only committed replacements belong to this
 * result. Numeric material checks retain the existing provenance tolerances;
 * their success is not an assertion of exact Boolean set equality.
 */
export async function absorbLocalRemainder(api,input,bed,{
 maxAttempts=32,maxMillis=20000,smallVolume=1000,smallSpan=Math.min(...bed)*.15,
 contactTolerance=.02,minContactArea=50,stop=()=>false,progress=()=>{},
}={}){
 if(!api||!Array.isArray(input)||!Array.isArray(bed)||bed.length!==3||bed.some(x=>!Number.isFinite(x)||x<=0)||!Number.isInteger(maxAttempts)||maxAttempts<0||!Number.isFinite(maxMillis)||maxMillis<=0||[smallVolume,smallSpan,contactTolerance,minContactArea].some(x=>!Number.isFinite(x)||x<0)||typeof stop!=='function'||typeof progress!=='function')throw Error('Ungültige lokale Reststückzuordnung.');
 const ids=new Set();for(const o of input){if(!o?.solid||!['string','number'].includes(typeof o.ownerId)||typeof o.ownerId==='number'&&!Number.isFinite(o.ownerId)||ids.has(JSON.stringify(o.ownerId)))throw Error('Die lokale Zuordnung benötigt eindeutige native Teile.');ids.add(JSON.stringify(o.ownerId));}
 const owners=input.map(o=>({...o})),leases=new Map(),active=new Set(),history=[],uncommittedHistory=[],rejections=[],started=performance.now();let attempted=0,stopped=false,stopReason=null,poisoned=false,disposed=false,partitionProvenance=null,rollbackReason=null;
 const call=fn=>{try{return fn();}catch(e){if(fatal(e))poisoned=true;throw e;}};
 const release=h=>{if(!h||!active.delete(h))return;if(poisoned)h.abandon();else call(()=>h.dispose());};
 const cleanup=fns=>{let ordinary;for(const fn of fns){if(poisoned)break;try{fn();}catch(e){if(poisoned)throw e;ordinary??=e;}}if(ordinary)throw ordinary;};
 const abandon=()=>{for(const h of active)h.abandon();active.clear();};
 const check=s=>{if(call(()=>s.status())!=='NoError')throw Error('Ungültiger nativer Teilkörper.');return s;};
 const volume=s=>{check(s);const v=call(()=>s.volume());if(!Number.isFinite(v)||v<=0)throw Error('Ungültiges positives Materialvolumen.');return v;};
 const snapshot=s=>call(()=>snapshotNativeGeometry(api,s,{frame:'source'}));
 const restore=s=>{const h=call(()=>restoreNativeGeometry(api,s));active.add(h);return h;};
 const volumeBefore=sum(input.map(o=>volume(o.solid)));
 const budget=(checkAttempts=true)=>{if(stop()){stopped=true;stopReason='requested';}else if(performance.now()-started>=maxMillis){stopped=true;stopReason='time_budget';}else if(checkAttempts&&attempted>=maxAttempts){stopped=true;stopReason='attempt_budget';}return stopped;};
 try{
  for(let r=0;r<owners.length;r++){
   if(!owners[r]?.metadata?.remaining||budget())continue;
   const originalSnapshot=snapshot(owners[r].solid),inventory=inventNativeComponents(originalSnapshot),remaining=new Set(inventory.components.map(c=>c.index));
   const protectedComponents=inventory.components.filter(c=>!c.closed||c.volumeSign!=='positive');
   const candidates=[],assignedBounds=owners.map((o,i)=>i===r||o.metadata?.remaining?null:{box:call(()=>o.solid.boundingBox()),volume:volume(o.solid)});
   for(const c of inventory.components){
    if(budget())break;
    if(!c.closed||c.volumeSign!=='positive'||protectedComponents.some(p=>touches(c.bounds,p.bounds)))continue;
    for(let i=0;i<owners.length;i++){
     const o=owners[i];if(i===r||o.metadata?.remaining)continue;
     const {box,volume:v}=assignedBounds[i];
     if(v>=smallVolume&&Math.max(...box.max.map((x,k)=>x-box.min[k]))>=smallSpan||!touches(box,c.bounds,contactTolerance))continue;
     const span=box.max.map((x,k)=>Math.max(x,c.bounds.max[k])-Math.min(box.min[k],c.bounds.min[k]));
     if(Math.max(...span)>Math.hypot(...bed)+.005)continue;
     candidates.push({component:c.index,owner:i,donorVolume:v});
    }
   }
   candidates.sort((a,b)=>a.donorVolume-b.donorVolume||a.component-b.component||a.owner-b.owner);
   for(const candidate of candidates){
    if(!remaining.has(candidate.component)||budget())continue;
    await progress(`Lokale Reststücke zuordnen: ${history.length} Verbindungen · ${attempted} Prüfungen`);await new Promise(resolve=>setTimeout(resolve,0));if(budget())break;
    attempted++;const i=candidate.owner,assigned=owners[i],restOwner=owners[r];let component=null,joined=null,residual=null,result=null,committed=false;
    const reject=(reason,details={})=>rejections.push({ownerId:assigned.ownerId,remainderId:restOwner.ownerId,component:candidate.component,reason,...details});
    try{
     const componentSnapshot=selectNativeComponents(originalSnapshot,inventory,[candidate.component]);component=restore(componentSnapshot);
     // A neighboring assigned part supplies possible existing bed faces, never
     // an invented window cap. The whole remainder's identity pose is not used.
     const localId=JSON.stringify(['local-remainder',restOwner.ownerId,candidate.component]);
     if(assigned.ownerId===localId)throw Error('Mehrdeutige lokale Teilekennung.');
     const local=[{...assigned,printTransform:undefined,printPoseSelection:undefined},{ownerId:localId,solid:component.solid,cutPlanes:assigned.cutPlanes||[],metadata:{remaining:true}}];
     result=await absorbNativeFragments(api,local,bed,{smallVolume,smallSpan,maxAttempts:1,stop:()=>stop()||performance.now()-started>=maxMillis});
     if(result.kernelFailure||!result.partitionUsable)throw new WebAssembly.RuntimeError(result.kernelFailure||'Lokale native Zuordnung nicht mehr verwendbar.');
     if(result.merges!==1||result.parts.length!==1||!result.atomInvariant||!result.perPartVolumeInvariant){reject('join_rejected',{checks:result.rejections});continue;}
     const part=result.parts[0],printed=transformData({...fromSolid(part.solid),cutPlanes:part.cutPlanes},new Matrix4().fromArray(part.printTransform)),contact=connectedCutContactArea(printed);
     if(contact<minContactArea||!part.printStability?.stableUnderGravity){reject('insufficient_stable_contact',{contact});continue;}
     const provenance=await traceNativeProvenance(api,[part],local,{stop:()=>stop()||performance.now()-started>=maxMillis});
     if(!provenance.invariant.ok||!provenance.invariant.complete){reject('local_provenance',{invariant:provenance.invariant});continue;}
     const nextRemaining=[...remaining].filter(x=>x!==candidate.component),restSnapshot=selectNativeComponents(originalSnapshot,inventory,nextRemaining);
     if(!restSnapshot){reject('whole_remainder_requires_global_assignment');continue;}
     residual=restore(restSnapshot);joined=restore(snapshot(part.solid));
     // Check the new union against the complete retained remainder and every
     // other current owner whose box can touch it. Do not call small/negative
     // intersection volumes empty: record the native geometry diagnostics.
     const allowed=Math.min(Math.max(1e-9,volume(part.solid)*1e-9),...local.map(o=>volume(o.solid)*1e-5)),box=call(()=>joined.solid.boundingBox()),collisions=[];
     for(let j=0;j<owners.length;j++){
      if(budget(false))break;
      if(j===i)continue;const other=j===r?residual.solid:owners[j].solid;
      if(!touches(box,call(()=>other.boundingBox())))continue;
      let overlap;
      try{overlap=call(()=>joined.solid.intersect(other));check(overlap);const v=call(()=>overlap.volume());collisions.push({ownerId:owners[j].ownerId,volume:v,triangles:call(()=>overlap.numTri()),empty:call(()=>overlap.isEmpty()),tolerance:Math.min(allowed,volume(other)*1e-5),ok:Number.isFinite(v)&&Math.abs(v)<=Math.min(allowed,volume(other)*1e-5)});}
      finally{if(overlap&&!poisoned)call(()=>overlap.delete());}
     }
     if(collisions.some(x=>!x.ok)){reject('remaining_overlap',{collisions});continue;}
     const before=sum([volume(assigned.solid),volume(restOwner.solid)]),after=sum([volume(joined.solid),volume(residual.solid)]);
     if(Math.abs(after-before)>allowed){reject('partition_volume',{delta:after-before,tolerance:allowed});continue;}
     const entry={ownerId:assigned.ownerId,remainderId:restOwner.ownerId,component:candidate.component,retainedOriginalFaces:restSnapshot.triangles.length/3,assignedVolume:volume(joined.solid),componentVolume:volume(component.solid),connectedContactArea:contact,printTransform:part.printTransform,printStability:part.printStability,overhang:part.overhang,provenance:provenance.invariant,collisions,volumeDelta:after-before};
     if(budget(false)){reject('stopped_before_commit');break;}
     const priorAssigned=leases.get(i),priorRemainder=leases.get(r);
     owners[i]={...assigned,solid:joined.solid,cutPlanes:part.cutPlanes,printTransform:part.printTransform,printPoseSelection:undefined};
     owners[r]={...restOwner,solid:residual.solid};leases.set(i,joined);leases.set(r,residual);joined=null;residual=null;remaining.delete(candidate.component);committed=true;
     history.push(entry);
     cleanup([()=>release(priorAssigned),()=>release(priorRemainder)]);
    }catch(e){if(fatal(e)){poisoned=true;throw e;}reject('geometry_error',{message:e.message});}
    finally{if(poisoned){abandon();}else cleanup([()=>call(()=>result?.dispose()),()=>release(component),()=>release(joined),()=>release(residual)]);}
    if(!committed&&stopped)break;
   }
  }
 }catch(e){if(fatal(e)){poisoned=true;abandon();throw e;}rejections.push({reason:'interrupted',message:e.message});stopped=true;stopReason='error';}
 // The complete immutable baseline is the commit boundary. A local proof can
 // pass while distant owners already overlap or the kernel cannot reproduce
 // their self-intersections. In that case roll back ONLY this new stage and
 // let the caller keep its previous optimization path; never loosen its gates.
 if(history.length){
  try{
   partitionProvenance=await traceNativeProvenance(api,owners,input,{stop,progress});
   if(!partitionProvenance.invariant.ok||!partitionProvenance.invariant.complete)rollbackReason='partition_provenance';
  }catch(e){if(fatal(e)){poisoned=true;abandon();throw e;}rollbackReason='partition_provenance_error';rejections.push({reason:rollbackReason,message:e.message});}
  if(rollbackReason){
   uncommittedHistory.push(...history);history.length=0;
   owners.splice(0,owners.length,...input.map(o=>({...o})));leases.clear();
   try{cleanup([...active].map(h=>()=>release(h)));}finally{if(poisoned)abandon();}
  }
 }
 let volumeAfter;
 try{volumeAfter=sum(owners.map(o=>volume(o.solid)));}catch(e){if(poisoned)abandon();else cleanup([...active].map(h=>()=>release(h)));throw e;}
 return{owners,changes:history.length,attempted,stopped,stopReason,history,uncommittedHistory,partitionProvenance,rollbackReason,rejections,volumeBefore,volumeAfter,materialPreserved:Math.abs(volumeAfter-volumeBefore)<=Math.max(1e-9,volumeBefore*1e-9),elapsedMs:performance.now()-started,dispose(){if(disposed)return;disposed=true;try{cleanup([...active].map(h=>()=>release(h)));}finally{if(poisoned)abandon();leases.clear();}}};
}
