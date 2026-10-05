import {Matrix4,Vector3} from 'three';
import {bounds,bestOrientation,splitPlane,toSolid,fromSolid,transformData} from './engine.mjs';
import {orientOnCutFace,connectedCutContactArea} from './cut-orientation.mjs';
import {overhangMetrics} from './overhang-metrics.mjs';
import {printStability} from './print-stability.mjs';
import {restoreBoundNative,bindNativeGeometry} from './native-geometry-binding.mjs';
import {unionInteriorRegions,transferInteriorSelection} from './mark-locations.mjs';
import {componentCutQuality,normalizeCutQuality} from './part-quality.mjs';

export function fitParts(api,data,bed,progress=()=>{}){
  const queue=[data],result=[];let cuts=0;
  while(queue.length){const source=queue.shift(),d=bestOrientation(source,bed),b=bounds(d);if(b.size.every((s,i)=>s<=bed[i]+.005)){result.push(d);continue;}
    if(result.length+queue.length>254)throw Error('Mehr als 256 Teile nötig. Größeren Bauraum wählen oder Baugruppen getrennt bearbeiten.');
    const ratios=b.size.map((s,i)=>s/bed[i]),axis=ratios.indexOf(Math.max(...ratios)),n=[0,0,0];n[axis]=1;
    // Fill the first section as much as possible; each remainder gets its own orientation search.
    const offset=b.min[axis]+bed[axis]-.002;
    const parts=splitPlane(api,d,n,offset).map(p=>({...p,transform:d.transform}));queue.push(...parts);cuts++;progress(`${result.length} passende Teile · ${queue.length} Bereiche verbleiben`);
  }
  return{parts:result,cuts};
}
export function mergePrintable(api,parts,bed,progress=()=>{}){
  if(!Array.isArray(parts)||!Array.isArray(bed)||bed.length!==3||bed.some(value=>!Number.isFinite(value)||value<=0)||typeof progress!=='function')throw Error('Ungültige Teile oder Bauraummaße.');
  if(parts.some(part=>part.mark||part.plannedMark))throw Error('Teile vor dem Festlegen von Markierungen zusammenfassen.');
  const groups=[],rejections=[],tested=new Set(),owned=new Set(),fatal=error=>error?.name==='RuntimeError'||/Aborted|memory access out of bounds|unreachable|RuntimeError/i.test(error?.message||'');
  let poisoned=false,merges=0,nextKey=0,best=null;
  const own=solid=>{owned.add(solid);return solid;};
  // Consume ownership before delete: a throwing native destructor may already
  // have destroyed its handle. Never retry it through a group/candidate alias.
  const release=solid=>{if(solid&&owned.delete(solid)&&!poisoned)try{solid.delete();}catch(error){if(fatal(error))poisoned=true;throw error;}};
  const cleanup=handles=>{let failure;for(const solid of handles)try{release(solid);}catch(error){if(!failure||fatal(error))failure=error;}if(failure)throw failure;};
  const check=solid=>{if(solid.status()!=='NoError')throw Error('Ungültiger nativer Volumenkörper.');return solid;};
  const tolerance=(volume,smallest)=>Math.min(Math.max(1e-9,volume*1e-9),smallest*1e-5);
  const exportTolerance=(volume,smallest)=>Math.min(Math.max(1e-6,volume*5e-6),smallest*1e-5);
  function compact(solid){let output=null;try{output=own(solid.asOriginal());return check(output);}catch(error){if(fatal(error))poisoned=true;else release(output);throw error;}}
  function classify(solid){let components=[];try{components=solid.decompose();components.forEach(own);const volumes=components.map(component=>{check(component);return component.volume();});if(volumes.some(volume=>!Number.isFinite(volume)))throw Error('Ungültiges Komponenten-Volumen.');return{positive:volumes.filter(volume=>volume>0).length,signed:volumes.some(volume=>volume<=0)};}catch(error){if(fatal(error))poisoned=true;throw error;}finally{cleanup(components);}}
  function assembly(part){const value=part.assemblyMatrix||new Matrix4().toArray();if(!Array.isArray(value)||value.length!==16||value.some(v=>!Number.isFinite(v)))throw Error('Ungültige Montagelage.');const matrix=new Matrix4().fromArray(value),axes=[0,1,2].map(i=>new Vector3().setFromMatrixColumn(matrix,i));if(Math.abs(matrix.determinant()-1)>1e-5||axes.some(axis=>Math.abs(axis.lengthSq()-1)>1e-5)||Math.max(Math.abs(axes[0].dot(axes[1])),Math.abs(axes[0].dot(axes[2])),Math.abs(axes[1].dot(axes[2])))>1e-5||[3,7,11].some(i=>Math.abs(value[i])>1e-8)||Math.abs(value[15]-1)>1e-8)throw Error('Die Montagelage muss eine starre Drehung und Verschiebung sein.');return matrix;}
  function quality(output,members,classification){
    const retained=members.flatMap(index=>normalizeCutQuality(parts[index].cutQuality)?.issues||[]).filter(issue=>!['small_component','disconnected_group','signed_components','no_fitting_cut_face','outside_bed','severe_overhang','unstable_print_pose','metrics_unavailable'].includes(issue.reason)),area=connectedCutContactArea(output),overhang=overhangMetrics(output),issues=[...retained];
    output.bedContactArea=area;output.bedFace=area>=50?'cut':undefined;output.requiresCutFace=area<50;output.overhang=overhang;output.printStability=printStability(output);
    if(!output.printStability.valid||!output.printStability.stableUnderGravity)issues.push({reason:'unstable_print_pose'});
    if(classification.positive!==1)issues.push({reason:'disconnected_group',components:classification.positive});if(classification.signed)issues.push({reason:'signed_components'});if(output.requiresCutFace)issues.push({reason:'no_fitting_cut_face'});if(bounds(output).size.some((size,axis)=>size>bed[axis]+.005))issues.push({reason:'outside_bed'});if(overhang.needsFurtherSplit)issues.push({reason:'severe_overhang',area:overhang.severeArea});if(output.volume<1000)issues.push({reason:'small_component',volume:output.volume});if(members.some(index=>parts[index].remaining)){output.remaining=true;issues.push({reason:'unallocated_material'});}output.cutQuality=componentCutQuality(issues);return output;
  }
  try{
    // Bound geometry is already in assembly coordinates. Restore it exactly;
    // only legacy meshes use Float32 import. Neither path reimports a union.
    for(let index=0;index<parts.length;index++){
      const part=parts[index],matrix=assembly(part);let source=null,moved=null,solid=null,restored=null;
      try{let volume,planes;
        if(part.nativeGeometry!==undefined){restored=restoreBoundNative(api,part);volume=restored.solid.volume();solid=compact(restored.solid);planes=restored.contactPlanes;}
        else{source=own(toSolid(api,part));volume=source.volume();moved=own(source.transform(matrix.toArray()));solid=compact(moved);planes=transformData(part,matrix).cutPlanes||[];}
        if(Math.abs(solid.volume()-volume)>tolerance(volume,volume))throw Error('Die Montagelage verändert das Materialvolumen.');const classified=classify(solid),output=quality({...part,volume,transform:matrix.clone().invert().toArray()},[index],classified);
        groups.push({key:nextKey++,solid,volume,smallest:volume,members:[index],planes,mask:part.interiorRegion?transformData(part.interiorRegion,matrix):null,output,box:solid.boundingBox(),classified});solid=null;
      }catch(error){if(fatal(error))poisoned=true;throw error;}finally{
        let cleanupError;if(restored){if(poisoned)restored.abandon();else try{restored.dispose();}catch(error){if(fatal(error))poisoned=true;cleanupError=error;}}
        for(const handle of [solid,moved,source])try{release(handle);}catch(error){cleanupError=error;}
        if(cleanupError)throw cleanupError;
      }
    }
    const volumeBefore=groups.reduce((sum,group)=>sum+group.volume,0);
    while(true){
      best=null;
      for(let i=0;i<groups.length;i++)for(let j=i+1;j<groups.length;j++){
        const a=groups[i],b=groups[j],key=`${a.key}:${b.key}`;if(tested.has(key)||a.classified.positive!==1||b.classified.positive!==1||!a.box.min.every((value,axis)=>value<=b.box.max[axis]+.02&&a.box.max[axis]>=b.box.min[axis]-.02))continue;
        const span=a.box.max.map((value,axis)=>Math.max(value,b.box.max[axis])-Math.min(a.box.min[axis],b.box.min[axis]));if(Math.max(...span)>Math.hypot(...bed)+.005)continue;
        tested.add(key);progress(`${merges} Nachbargruppen zusammengeführt · ${groups.length} Teile · ebene Druckauflage prüfen`);
        const members=[...a.members,...b.members].sort((x,y)=>x-y),expected=a.volume+b.volume,smallest=Math.min(a.smallest,b.smallest);let union=null,verified=null,kept=null;
        const reject=reason=>rejections.push({members,reason});
        try{
          union=own(a.solid.add(b.solid));check(union);const volume=union.volume();if(!Number.isFinite(volume)||Math.abs(volume-expected)>tolerance(expected,smallest)){reject('volume_change');continue;}const classified=classify(union);if(classified.positive!==1){reject('disconnected');continue;}
          const planes=[...a.planes,...b.planes];if(!planes.length){reject('no_cut_face');continue;}let oriented;
          try{oriented=orientOnCutFace({...fromSolid(union),cutPlanes:planes},bed);}catch(error){if(fatal(error))throw error;reject('no_fitting_cut_face');continue;}
          if(oriented.bedFace!=='cut'||connectedCutContactArea(oriented)<50||bounds(oriented).size.some((size,axis)=>size>bed[axis]+.005)){reject('no_substantial_cut_bed');continue;}
          if(!oriented.printStability?.valid||!oriented.printStability.stableUnderGravity){reject('unstable_print_pose');continue;}
          const overhang=overhangMetrics(oriented);if(overhang.severeArea>a.output.overhang.severeArea+b.output.overhang.severeArea+1e-4||overhang.supportArea>a.output.overhang.supportArea+b.output.overhang.supportArea+1e-4){reject('overhang_increase');continue;}
          verified=own(toSolid(api,oriented));const exportedVolume=verified.volume();if(Math.abs(exportedVolume-expected)>exportTolerance(expected,smallest)){reject('export_volume_change');continue;}
          if(best&&volume<=best.group.volume)continue;
          const mask=unionInteriorRegions(a.mask,b.mask),output=quality({...oriented,volume,exportedVolume,members,assemblyMatrix:new Matrix4().fromArray(oriented.transform).invert().toArray(),...mergedQualityMetadata(parts,members)},members,classified);
          if(mask)Object.assign(output,transferInteriorSelection({interiorRegion:mask,interiorSeeds:[]},oriented.transform,false));
          if(members.some(index=>parts[index].supports))output.supportNotice='Nach dem Zusammenfassen Support Fins bei Bedarf neu erzeugen.';
          kept=compact(union);if(Math.abs(kept.volume()-volume)>tolerance(volume,smallest))throw Error('Die native Vereinigung verändert das Materialvolumen.');
          // Bind only this accepted native candidate, before releasing it. A
          // failed attachment rejects the candidate without replacing inputs.
          output.nativeGeometry=bindNativeGeometry(api,kept,output,{contactPlanes:planes});
          const group={key:nextKey++,solid:kept,volume,smallest,members,planes,mask,output,box:kept.boundingBox(),classified},previous=best;best=null;release(previous?.group.solid);best={i,j,group};kept=null;
        }catch(error){if(fatal(error)){poisoned=true;throw error;}reject(`geometry_error: ${error.message}`);}finally{cleanup([kept,verified,union]);}
      }
      if(!best)break;
      const {i,j,group}=best,previous=[groups[i].solid,groups[j].solid];best=null;groups[i]=group;groups.splice(j,1);cleanup(previous);merges++;
    }
    return{groups:groups.map(group=>({...group.output,members:group.members})),merges,rejections,volumeBefore,volumeAfter:groups.reduce((sum,group)=>sum+group.volume,0),materialPreserved:true};
  }catch(error){if(fatal(error))poisoned=true;throw error;}finally{cleanup([...owned].reverse());}
}

function mergedQualityMetadata(parts,members){
  const result={groupIndices:[...new Set(members.flatMap(index=>parts[index].groupIndices||[parts[index].groupIndex]).filter(Number.isInteger))],proposalMembers:[...new Set(members.flatMap(index=>parts[index].proposalMembers||[]))].sort((a,b)=>a-b)};
  result.groupIndex=result.groupIndices[0];
  const lineage=new Map();for(const index of members)for(const entry of parts[index].cutLineage||[]){const key=JSON.stringify([entry.ownerId,entry.component,entry.signedGroup===true,entry.sourceOwnerIds,entry.refinementBranch]),old=lineage.get(key);lineage.set(key,{...entry,volume:entry.volume+(old?.volume||0)});}if(lineage.size)result.cutLineage=[...lineage.values()];if(members.every(index=>parts[index].cutLineageMethod==='native-intersection'))result.cutLineageMethod='native-intersection';
  const notes=members.filter(index=>parts[index].note).map(index=>`${parts[index].id}: ${parts[index].note}`);if(notes.length)result.note=notes.join('\n');return result;
}
