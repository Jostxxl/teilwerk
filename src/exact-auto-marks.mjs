import {findUniformMarkSize} from './interior-marking.mjs';
import {createExactProjectContext,restoreExactProjectPart} from './exact-project.mjs';
import {deriveExactDisplay} from './exact-geometry-binding.mjs';
import {createExactMarkPlan} from './exact-mark-plan.mjs';

/** Numeric surfaces only propose label anchors. They are never CSG operands or
 * saved permissions. Every exact label is checked against the original rational
 * surface rights before it is returned; the original mask remains untouched. */
export function planExactAutomaticMarks(api,{parts,permissionSources,size=8,minSize=3,depth=.4,fitSize=true,onProgress}={}){
 if(!Array.isArray(parts)||!parts.length||parts.length>2048||![size,minSize,depth].every(Number.isFinite)||size<1||size>100||minSize<1||minSize>size||depth<.1||depth>5)throw Error('Ungültige Vorgaben für automatische Nummern.');
 const context=createExactProjectContext({permissionSources}),original=parts.map(p=>p.exactGeometry===undefined?p:restoreExactProjectPart(p,{context}));
 const candidates=original.map(p=>{
  if(p.exactGeometry===undefined)return p;
  const view=deriveExactDisplay(p.exactGeometry.authority,{assemblyMatrix:p.assemblyMatrix,precision:'float64'});
  return {vertices:view.vertices,triangles:view.triangles,assemblyMatrix:p.assemblyMatrix,id:p.id,interiorRegion:p.interiorRegion,mark:p.mark,plannedMark:p.plannedMark};
 });
 const engraved=original.filter(p=>p.mark),lockedSizes=[...new Set(engraved.map(p=>p.mark.size))];
 if(lockedSizes.length>1)throw Error('Vorhandene Gravuren haben unterschiedliche Größen. Eine gemeinsame neue Schriftgröße würde sie nicht verändern.');
 const sizes=lockedSizes.length?lockedSizes:fitSize?Array.from({length:Math.floor((size-minSize)/.5)+1},(_,i)=>size-i*.5):[size];
 if(fitSize&&!lockedSizes.length&&sizes.at(-1)>minSize)sizes.push(minSize);
 let best;const attemptedSizes=[];
 for(const fontSize of sizes){
  onProgress?.(`Gemeinsame Nummerngröße ${fontSize.toLocaleString('de-DE')} mm prüfen …`);
  const proposal=findUniformMarkSize(api,candidates,null,{size:fontSize,minSize:fontSize,depth,rotation:0,progress:onProgress});
  if(proposal.blocked)throw Error(proposal.notice);
  const failed=[],invalidMarks=[],output=[];let automaticAssigned=0,manualAssigned=0,eligible=0;
  for(let i=0;i<original.length;i++){
   const p=original[i],proposed=proposal.parts[i],manual=p.plannedMark?.placement!=='automatic'&&!!p.plannedMark;
   if(p.mark){output.push(p);continue;}
   if(!manual&&p.interiorRegion?.triangles?.length)eligible++;
   let mark=manual?p.plannedMark:proposed.plannedMark,issue=proposed.plannedMarkIssue;
   if(mark&&p.exactGeometry!==undefined)try{createExactMarkPlan(p,mark,{context});issue=null;}catch(error){issue=error.message;}
   const next={...p};delete next.plannedMarkIssue;
   if(mark&&!issue){next.plannedMark=mark;if(manual)manualAssigned++;else automaticAssigned++;}
   else{
    issue||='Keine sichere zentrale Innenfläche für diese gemeinsame Schriftgröße gefunden.';
    if(!manual)delete next.plannedMark;
    next.plannedMarkIssue=issue;const entry={part:i,id:p.id,reason:issue};(manual?invalidMarks:failed).push(entry);
   }
   output.push(next);
  }
  attemptedSizes.push(fontSize);
  const result={parts:output,assigned:engraved.length+automaticAssigned+manualAssigned,unassigned:failed.length+invalidMarks.length,automaticAssigned,eligible,failed,invalidMarks,size:fontSize,requestedSize:size,engravedCount:engraved.length,lockedByEngraving:!!engraved.length,blocked:false};
  if(!best||automaticAssigned>best.automaticAssigned)best=result;
  if(automaticAssigned===eligible)break;
 }
 return {...best,attemptedSizes};
}
