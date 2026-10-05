import {overhangMetrics} from './overhang-metrics.mjs';
import {consolidateParts} from './consolidate-parts.mjs';
import {supportFins} from './supports.mjs';
import {orientOnCutFace} from './cut-orientation.mjs';
import {Matrix4} from 'three';
import {bounds,bestOrientation,transformData,toSolid} from './engine.mjs';
import {suggestRegions} from './suggestions.mjs';
import {contourPlanAsync} from './contour-plan.mjs';

// Run the entire workflow without requiring individual proposal selection.
// Re-analyze only the residual geometry. Already printable parts stay untouched.
export async function automaticContours(api,source,bed,{initialProposals=null,depth=20,lineTolerance=2,stop=()=>false,progress=()=>{},restartKernel=null,maxRounds=8,supports=false,finOptions={}}={}){
  let output=[];const accepted=[],rejected=[];let remainder=source,stopped=false,kernelFailure=null,rounds=0,previousVolume=Infinity;
  const fits=p=>bounds(p).size.every((v,i)=>v<=bed[i]+.005);
  for(let round=0;round<maxRounds;round++){
    if(stop()){stopped=true;break;}
    if(Math.max(...bounds(remainder).size)<=Math.hypot(...bed)){
      try{const oriented=orientOnCutFace(remainder,bed);if(fits(oriented)){output.push(oriented);remainder=null;break;}}catch{/* The remainder still needs a usable flat cut face. */}
    }
    rounds++;progress(`Automatik ${round+1}: Verbleibende Modellbereiche erkennen …`);
    const proposals=round===0&&initialProposals?.length?initialProposals:suggestRegions(remainder,bed,message=>progress(`Automatik ${round+1}: ${message}`),512);
    if(!proposals.length){rejected.push({round:round+1,reason:'Keine weiteren geeigneten Konturen erkannt.'});break;}
    let plan;
    try{plan=await contourPlanAsync([api,remainder,proposals,bed,depth,512,progress,lineTolerance],stop);}
    catch(e){rejected.push({round:round+1,reason:e.message});break;}
    accepted.push(...plan.accepted.map(proposal=>({round:round+1,proposal})));
    rejected.push(...plan.rejected.map(p=>({...p,round:round+1})));
    const fitted=plan.remainingCount?plan.parts.slice(0,-1):plan.parts;output.push(...fitted);
    if(plan.remainingCount){const last=plan.parts.at(-1);remainder=transformData(last,new Matrix4().fromArray(last.transform||new Matrix4().toArray()).invert());delete remainder.transform;remainder.volume=last.volume;}
    else remainder=null;
    if(plan.kernelFailure){
      kernelFailure=plan.kernelFailure;
      if(restartKernel){progress('Geometriekern neu laden; geprüfte Teile bleiben erhalten …');api=await restartKernel();}
      else break;
    }
    if(plan.stopped||stop()){stopped=true;break;}
    if(!remainder)break;
    if(!plan.accepted.length||remainder.volume>=previousVolume-1){rejected.push({round:round+1,reason:'Kein weiterer Fortschritt entlang der erkannten Konturen möglich.'});break;}
    previousVolume=remainder.volume;
  }
  if(remainder)output.push({...remainder,transform:new Matrix4().toArray()});
  let consolidation=null;
  if(!stopped&&output.length>1){
    progress('Benachbarte Teile zu größeren Druckteilen zusammenfassen …');
    consolidation=consolidateParts(api,output,bed,{progress,stop});output=consolidation.parts;
    if(consolidation.kernelFailure){kernelFailure=consolidation.kernelFailure;if(restartKernel)api=await restartKernel();}
    if(consolidation.stopped)stopped=true;
  }
  // Check the exported meshes in a usable kernel, including a recovered kernel.
  for(let i=0;i<output.length;i++){
    progress(`Automatik: Teil ${i+1}/${output.length} auf geschlossenes Volumen prüfen …`);
    const solid=toSolid(api,output[i]);solid.delete();output[i].overhang=overhangMetrics(output[i]);
    if(supports&&fits(output[i])){progress(`Automatik: Support Fins für Teil ${i+1}/${output.length} prüfen …`);try{output[i].supports=supportFins(output[i],bed,finOptions);}catch(e){output[i].supportNotice=e.message;}}
  }
  const unresolved=[...(consolidation?.unresolved||[])];
  output.forEach((p,i)=>{if(p.overhang.needsFurtherSplit&&!unresolved.some(x=>x.part===i&&x.reason==='severe_overhang'))unresolved.push({part:i,reason:'severe_overhang',area:p.overhang.severeArea});if(p.requiresCutFace)unresolved.push({part:i,reason:'no_fitting_cut_face'});});
  return {parts:output,accepted,rejected,rounds,stopped,kernelFailure,remainingCount:remainder?1:0,complete:!remainder&&!unresolved.length,merges:consolidation?.merges||0,unresolved,consolidation:consolidation?{attempted:consolidation.attempted,criteria:consolidation.criteria,heuristic:true}:null};
}
