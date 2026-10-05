import {Matrix4,Vector3} from 'three';
import {fromSolid,bounds,transformData} from './engine.mjs';
import {orientOnCutFace,validatedSelectedCutPose} from './cut-orientation.mjs';
import {overhangMetrics} from './overhang-metrics.mjs';
import {printStability} from './print-stability.mjs';

const fatal=e=>e?.name==='RuntimeError'||/Aborted|memory access out of bounds|unreachable|RuntimeError/i.test(e?.message||'');
const identity=()=>new Matrix4().toArray();
const sum=values=>{let total=0,correction=0;for(const value of values){const next=value-correction,t=total+next;correction=(t-total)-next;total=t;}return total;};
const overlap=(a,b,t)=>a.min.every((v,i)=>v<=b.max[i]+t&&a.max[i]>=b.min[i]-t);
function planesUnique(planes){const unique=new Map();for(const p of planes||[]){if(!p||!Array.isArray(p.normal)||p.normal.length!==3||!p.normal.every(Number.isFinite)||!Number.isFinite(p.offset)||Math.abs(Math.hypot(...p.normal)-1)>.001)throw Error('Ungültige Schnittfläche für native Reststückzuordnung.');const sign=p.normal.find(v=>Math.abs(v)>1e-8)<0?-1:1;unique.set([...p.normal,p.offset].map(v=>Math.round(v*sign*1e6)).join(','),{normal:[...p.normal],offset:p.offset});}return [...unique.values()];}
function transform(value){if(value===undefined)return null;const a=value?.isMatrix4?value.toArray():value;if(!Array.isArray(a)||a.length!==16||!a.every(Number.isFinite))throw Error('Ungültige Druckausrichtung.');const m=new Matrix4().fromArray(a),axes=[0,1,2].map(i=>new Vector3().setFromMatrixColumn(m,i));if(Math.abs(m.determinant()-1)>1e-5||axes.some(v=>Math.abs(v.lengthSq()-1)>1e-5)||Math.max(Math.abs(axes[0].dot(axes[1])),Math.abs(axes[0].dot(axes[2])),Math.abs(axes[1].dot(axes[2])))>1e-5)throw Error('Die Druckausrichtung muss eine starre Drehung und Verschiebung sein.');return [...a];}
function contactArea(data){let area=0;const a=new Vector3(),b=new Vector3(),c=new Vector3();for(let f=0;f<data.triangles.length;f+=3){a.fromArray(data.vertices,data.triangles[f]*3);b.fromArray(data.vertices,data.triangles[f+1]*3);c.fromArray(data.vertices,data.triangles[f+2]*3);if(Math.max(Math.abs(a.z),Math.abs(b.z),Math.abs(c.z))>1e-4)continue;const cross=b.clone().sub(a).cross(c.clone().sub(a));if(cross.length()<1e-9||cross.z/cross.length()>-.9999)continue;if(!data.cutPlanes?.some(p=>[a,b,c].every(v=>Math.abs(v.x*p.normal[0]+v.y*p.normal[1]+v.z*p.normal[2]-p.offset)<.05)))continue;area+=cross.length()/2;}return area;}

/**
 * Absorb small/subordinate bodies in a material-disjoint native partition.
 * All input solids share assembly coordinates and remain borrowed/unmodified.
 * Returned solids are owned by the result: call dispose() exactly once after
 * final export. Meshes are read for orientation metrics, never re-imported.
 * A poisoned native kernel cannot preserve usable handles; partitionUsable is
 * false in that case and the caller must restart/replay its original source.
 */
export async function absorbNativeFragments(api,owners,bed,{smallVolume=1000,smallSpan=Math.min(...bed)*.15,contactTolerance=.02,maxAttempts=512,volumeRelativeTolerance=1e-9,maxAtomLossFraction=1e-5,overhangTolerance=1e-4,stop=()=>false,progress=()=>{}}={}){
 if(!api||!Array.isArray(owners)||!Array.isArray(bed)||bed.length!==3||bed.some(v=>!Number.isFinite(v)||v<=0)||[smallVolume,smallSpan,contactTolerance,volumeRelativeTolerance,maxAtomLossFraction,overhangTolerance].some(v=>!Number.isFinite(v)||v<0)||!Number.isInteger(maxAttempts)||maxAttempts<0||typeof stop!=='function'||typeof progress!=='function')throw Error('Ungültige Einstellungen für native Reststückzuordnung.');
 const seenOwners=new Set();for(const owner of owners){if(!owner?.solid||!['string','number'].includes(typeof owner.ownerId)||typeof owner.ownerId==='number'&&!Number.isFinite(owner.ownerId))throw Error('Jeder native Eigentümer benötigt eine eindeutige ownerId.');const key=JSON.stringify(owner.ownerId);if(seenOwners.has(key))throw Error('Doppelte native ownerId.');seenOwners.add(key);}
 let groups=[],nextKey=0,merges=0,attempted=0,stopped=false,kernelFailure=null,disposed=false;const originalAtoms=[],tested=new Set(),history=[],rejections=[];
 const tolerance=(expected,atoms)=>Math.min(Math.max(1e-9,Math.abs(expected)*volumeRelativeTolerance),Math.min(...atoms.map(a=>a.volume))*maxAtomLossFraction);
 const check=solid=>{const status=solid.status();if(status!=='NoError')throw Error(`Geometriekern: ${status}`);return solid;};
 const dispose=solid=>{if(solid&&!kernelFailure)try{solid.delete();}catch(e){if(fatal(e))kernelFailure=e.message;throw e;}};
 const compact=solid=>{const result=solid.asOriginal();try{return check(result);}catch(e){if(fatal(e))kernelFailure=e.message;else dispose(result);throw e;}};
 const small=g=>g.subordinate||g.volume<smallVolume||Math.max(...g.box.max.map((v,i)=>v-g.box.min[i]))<smallSpan;
 async function pause(){progress(`Native Reststücke zuordnen: ${groups.length} Körper · ${merges} Verbindungen · ${attempted} Prüfungen`);await new Promise(resolve=>setTimeout(resolve,0));if(stop()){stopped=true;return true;}return false;}
 function metrics(g){if(g.overhang)return;const data={...fromSolid(g.solid),cutPlanes:g.cutPlanes},outside=!g.printTransform&&Math.max(...bounds(data).size)>Math.hypot(...bed)+.005;let oriented=data,notice=null;
  if(g.printPoseSelection){const preserved=validatedSelectedCutPose(data,bed,g.printTransform,g.printPoseSelection);if(preserved)oriented=preserved;else{delete g.printPoseSelection;try{oriented=orientOnCutFace(data,bed);}catch(e){if(fatal(e))throw e;notice=e.message;}}}
  else if(g.printTransform)oriented=transformData(data,new Matrix4().fromArray(g.printTransform));
  else if(outside)notice='Restkörper überschreitet die Bauraumdiagonale und muss weiter aufgeteilt werden.';
  else if(g.cutPlanes.length)try{oriented=orientOnCutFace(data,bed);}catch(e){if(fatal(e))throw e;notice=e.message;}
  g.printTransform=oriented.transform||identity();g.size=bounds(oriented).size;g.overhang=overhangMetrics(oriented);g.bedContactArea=contactArea(oriented);g.bedFace=g.bedContactArea>=1?'cut':undefined;g.requiresCutFace=outside||g.bedFace!=='cut';g.orientationNotice=notice;
  g.printStability=printStability(oriented);g.cutOrientation=oriented.cutOrientation;
 }
 // Initialization is transactional with respect to the borrowed inputs. If it
 // fails, all new handles are disposed and the caller still owns every source.
 try{
  for(const owner of owners){check(owner.solid);const sourceVolume=owner.solid.volume();if(!Number.isFinite(sourceVolume)||sourceVolume<=0)throw Error('Native Eigentümer benötigen positives Materialvolumen.');const planes=planesUnique(owner.cutPlanes),pose=transform(owner.printTransform),components=owner.solid.decompose();let prepared=[];
   try{const info=components.map(s=>{check(s);return {solid:s,volume:s.volume(),box:s.boundingBox()};});if(info.some(p=>!Number.isFinite(p.volume)))throw Error('Ungültiges natives Komponenten-Volumen.');const signed=info.some(p=>p.volume<=0);info.sort((a,b)=>b.volume-a.volume||a.box.min[0]-b.box.min[0]||a.box.min[1]-b.box.min[1]||a.box.min[2]-b.box.min[2]);const bodies=signed?[{solid:owner.solid,volume:sourceVolume,box:owner.solid.boundingBox()}]:info;
    const atoms=bodies.map((p,i)=>Object.freeze({id:JSON.stringify([owner.ownerId,signed?'whole':i]),ownerId:owner.ownerId,component:signed?null:i,volume:p.volume,signedGroup:signed}));if(Math.abs(sum(atoms.map(a=>a.volume))-sourceVolume)>tolerance(sourceVolume,atoms))throw Error('Komponentenzerlegung verändert das native Materialvolumen.');
    for(let i=0;i<bodies.length;i++){const body=bodies[i],solid=compact(body.solid);prepared.push({key:nextKey++,solid,atoms:[atoms[i]],ownerIds:[owner.ownerId],cutPlanes:planes,volume:body.volume,box:body.box,subordinate:!signed&&i>0,signedGroup:signed,positiveComponents:signed?info.filter(p=>p.volume>0).length:1,printTransform:pose,printPoseSelection:bodies.length===1?owner.printPoseSelection:undefined,sourceMetadata:[{ownerId:owner.ownerId,metadata:owner.metadata}]});}
    groups.push(...prepared);prepared=[];originalAtoms.push(...atoms);
   }catch(e){if(fatal(e))kernelFailure=e.message;throw e;}finally{prepared.forEach(g=>dispose(g.solid));components.forEach(dispose);}
  }
 }catch(e){if(fatal(e))kernelFailure=e.message;groups.forEach(g=>dispose(g.solid));throw e;}
 const volumeBefore=sum(originalAtoms.map(a=>a.volume));
 try{
  while(!stopped&&!kernelFailure){if(await pause())break;const candidates=[];
   for(let i=0;i<groups.length;i++)for(let j=i+1;j<groups.length;j++){const a=groups[i],b=groups[j],key=`${a.key}:${b.key}`;if(tested.has(key)||(!small(a)&&!small(b))||!overlap(a.box,b.box,contactTolerance))continue;const span=a.box.max.map((v,k)=>Math.max(v,b.box.max[k])-Math.min(a.box.min[k],b.box.min[k]));if(Math.max(...span)>Math.hypot(...bed)+.005)continue;candidates.push({i,j,key,donor:Math.min(small(a)?a.volume:Infinity,small(b)?b.volume:Infinity),volume:a.volume+b.volume});}
   candidates.sort((a,b)=>a.donor-b.donor||b.volume-a.volume||a.i-b.i||a.j-b.j);let accepted=false;
   for(const pair of candidates){if(attempted>=maxAttempts){stopped=true;break;}if(await pause())break;attempted++;tested.add(pair.key);const a=groups[pair.i],b=groups[pair.j],atoms=[...a.atoms,...b.atoms],expected=sum(atoms.map(p=>p.volume));let union=null,compactUnion=null,components=[],reunited=null,reunitedComponents=[],intersection=null,reunionProof=null;
    const reject=(reason,message,diagnostics={})=>rejections.push({atoms:atoms.map(p=>p.id),reason,...(message?{message}:{}),...(reunionProof?{reunion:reunionProof}:{}),...diagnostics});
    try{
     union=a.solid.add(b.solid);check(union);const volume=union.volume();if(!Number.isFinite(volume)||Math.abs(volume-expected)>tolerance(expected,atoms)){reject('volume_change');continue;}
     components=union.decompose();let volumes=components.map(s=>{check(s);return s.volume();});if(volumes.some(v=>!Number.isFinite(v))||volumes.filter(v=>v>0).length!==1||Math.abs(sum(volumes)-volume)>tolerance(volume,atoms)){
      const diagnostics={positiveComponentCount:volumes.filter(v=>v>0).length,signedComponents:volumes,decompositionVolumeDelta:sum(volumes)-volume,volumeTolerance:tolerance(volume,atoms)};let recovered=false;
      // Re-union every positive shell, never select a largest body or discard
      // signed cavities. Native booleans can create coincident zero-thickness
      // shells; a fresh union may resolve them, but must prove both owners in
      // full, including the tolerance cap of their smallest original atom.
      if(volumes.length>1&&volumes.every(v=>Number.isFinite(v)&&v>0)){
       const recovery=diagnostics.reunion={attempted:true,sourceChecks:[]};
       try{
        reunited=api.Manifold.union(components);check(reunited);const reunitedVolume=reunited.volume();recovery.volumeDelta=reunitedVolume-expected;recovery.volume=reunitedVolume;
        if(Number.isFinite(reunitedVolume)&&Math.abs(reunitedVolume-expected)<=tolerance(expected,atoms)){
         reunitedComponents=reunited.decompose();const reunitedVolumes=reunitedComponents.map(s=>{check(s);return s.volume();});recovery.signedComponents=reunitedVolumes;
         if(reunitedVolumes.length===1&&Number.isFinite(reunitedVolumes[0])&&reunitedVolumes[0]>0&&Math.abs(sum(reunitedVolumes)-reunitedVolume)<=tolerance(reunitedVolume,atoms)){
          for(const source of [a,b]){
           intersection=reunited.intersect(source.solid);check(intersection);const contribution=intersection.volume(),allowed=tolerance(source.volume,atoms),ok=Number.isFinite(contribution)&&Math.abs(contribution-source.volume)<=allowed;
           recovery.sourceChecks.push({atoms:source.atoms.map(p=>p.id),volume:source.volume,contribution,delta:contribution-source.volume,tolerance:allowed,ok});dispose(intersection);intersection=null;
           if(kernelFailure)throw new WebAssembly.RuntimeError(kernelFailure);
           if(!ok)break;
          }
          recovered=recovery.sourceChecks.length===2&&recovery.sourceChecks.every(p=>p.ok);
          if(recovered){reunionProof=recovery;[union,reunited]=[reunited,union];[components,reunitedComponents]=[reunitedComponents,components];volumes=reunitedVolumes;}
         }
        }
       }catch(e){if(fatal(e))throw e;recovery.error=e.message;}
      }
      if(!recovered){reject('disconnected',undefined,diagnostics);continue;}
     }
     const planes=planesUnique([...a.cutPlanes,...b.cutPlanes]);if(!planes.length){reject('no_cut_face');continue;}const data={...fromSolid(union),cutPlanes:planes};let oriented;
     try{oriented=orientOnCutFace(data,bed);}catch(e){if(fatal(e))throw e;reject('no_fitting_cut_face',e.message);continue;}
     const size=bounds(oriented).size,area=contactArea(oriented);if(oriented.bedFace!=='cut'||area<1||size.some((v,i)=>v>bed[i]+.005)){reject('no_fitting_cut_face');continue;}
     if(!oriented.printStability?.valid||!oriented.printStability.stableUnderGravity){reject('unstable_print_pose');continue;}
     metrics(a);metrics(b);const overhang=overhangMetrics(oriented),oldSevere=a.overhang.severeArea+b.overhang.severeArea,oldSupport=a.overhang.supportArea+b.overhang.supportArea;
     if(overhang.severeArea>oldSevere+overhangTolerance||overhang.supportArea>oldSupport+overhangTolerance){reject('overhang_increase',undefined,{oldSevere,newSevere:overhang.severeArea,severeDelta:overhang.severeArea-oldSevere,oldSupport,newSupport:overhang.supportArea,supportDelta:overhang.supportArea-oldSupport});continue;}
     compactUnion=compact(union);const compactVolume=compactUnion.volume();if(Math.abs(compactVolume-expected)>tolerance(expected,atoms)){reject('compact_volume_change');continue;}
     const ownerIds=[...new Set(atoms.map(p=>p.ownerId))],group={key:nextKey++,solid:compactUnion,atoms,ownerIds,cutPlanes:planes,volume:compactVolume,box:compactUnion.boundingBox(),subordinate:a.subordinate&&b.subordinate,signedGroup:volumes.some(v=>v<=0),positiveComponents:1,printTransform:oriented.transform,size,overhang,bedFace:'cut',bedContactArea:area,requiresCutFace:false,sourceMetadata:[...a.sourceMetadata,...b.sourceMetadata].filter((p,i,all)=>all.findIndex(q=>q.ownerId===p.ownerId)===i)};
     group.printStability=oriented.printStability;group.cutOrientation=oriented.cutOrientation;
     // No current owner is released until every candidate check succeeds.
     groups[pair.i]=group;groups.splice(pair.j,1);compactUnion=null;dispose(a.solid);dispose(b.solid);merges++;history.push({atoms:atoms.map(p=>p.id),ownerIds,volume:group.volume,severeArea:overhang.severeArea,supportArea:overhang.supportArea,...(reunionProof?{reunion:reunionProof}:{})});accepted=true;break;
    }catch(e){if(fatal(e)){kernelFailure=e.message;break;}reject('geometry_error',e.message);}
    finally{components.forEach(dispose);reunitedComponents.forEach(dispose);dispose(intersection);dispose(union);dispose(reunited);dispose(compactUnion);}
   }
   if(!accepted)break;
  }
 }catch(e){if(fatal(e))kernelFailure=e.message;else{stopped=true;rejections.push({reason:'interrupted',message:e.message});}}
 const unresolved=[];
 if(!kernelFailure)for(let i=0;i<groups.length;i++){const g=groups[i],base={part:i,atoms:g.atoms.map(a=>a.id),ownerIds:g.ownerIds,retained:true};try{metrics(g);}catch(e){if(fatal(e)){kernelFailure=e.message;break;}unresolved.push({...base,reason:'metrics_unavailable',message:e.message});}
  if(small(g)&&groups.length>1)unresolved.push({...base,reason:'small_component',volume:g.volume});if(g.positiveComponents!==1)unresolved.push({...base,reason:'disconnected_signed_group',components:g.positiveComponents});if(g.requiresCutFace)unresolved.push({...base,reason:'no_fitting_cut_face'});if(g.size?.some((v,j)=>v>bed[j]+.005))unresolved.push({...base,reason:'outside_bed'});if(g.overhang?.needsFurtherSplit)unresolved.push({...base,reason:'severe_overhang',area:g.overhang.severeArea});
 }
 const finalIds=groups.flatMap(g=>g.atoms.map(a=>a.id)),atomInvariant=finalIds.length===originalAtoms.length&&new Set(finalIds).size===originalAtoms.length&&originalAtoms.every(a=>finalIds.includes(a.id)),volumeAfter=sum(groups.map(g=>g.volume));
 const perPartVolumeInvariant=groups.every(g=>Math.abs(g.volume-sum(g.atoms.map(a=>a.volume)))<=tolerance(g.volume,g.atoms));
 return {parts:groups.map(({key,box,subordinate,...part})=>part),atoms:originalAtoms,merges,attempted,stopped,kernelFailure,partitionUsable:!kernelFailure,atomInvariant,perPartVolumeInvariant,volumeBefore,volumeAfter,unresolved,rejections,history,heuristic:true,dispose(){if(disposed)return;disposed=true;let ordinary;for(const g of groups){if(kernelFailure)break;try{dispose(g.solid);}catch(e){if(kernelFailure)throw e;ordinary??=e;}}if(ordinary)throw ordinary;}};
}
