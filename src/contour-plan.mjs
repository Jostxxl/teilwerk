import {cuttingPlanes,orientOnCutFace} from './cut-orientation.mjs';
import {Matrix4} from 'three';
import {bestOrientation,bounds,toSolid,fromSolid} from './engine.mjs';
import {prepareSurfaceCutter,cutterFromDefinition,cutSurfaceSolids} from './features.mjs';

// Candidates refer to the original mesh. Their cutters stay in assembly space
// while each successful cut updates only the remainder. No stale triangle IDs
// are ever applied to that changed remainder, and no planar fallback is hidden.
export function* contourPlanSteps(api,source,proposals,bed,depth=20,maxCuts=32,progress=()=>{},lineTolerance=0){
  if(!Array.isArray(proposals)||!proposals.length)throw Error('Zuerst Schnittvorschläge erzeugen.');
  if(!Number.isInteger(maxCuts)||maxCuts<1||maxCuts>512)throw Error('1–512 Konturschnitte pro Durchlauf wählen.');
  if(!Array.isArray(bed)||bed.length!==3||bed.some(v=>!Number.isFinite(v)||v<=0))throw Error('Ungültiger Bauraum.');
  const fits=data=>!data.requiresRegroup&&!data.requiresCutFace&&bounds(data).size.every((v,i)=>v<=bed[i]+.005);
  let remainingSolid=toSolid(api,source);const originalVolume=remainingSolid.volume();let kernelFailure=null;
  try{
  const orient=d=>{
    if(Math.max(...bounds(d).size)>Math.hypot(...bed)+.01)return {...d,transform:d.transform||new Matrix4().toArray(),volume:d.volume??originalVolume};
    try{return {...d,...orientOnCutFace(d,bed),requiresCutFace:false,volume:d.volume??originalVolume};}
    catch{return {...d,transform:d.transform||new Matrix4().toArray(),requiresCutFace:true,volume:d.volume??originalVolume};}
  };
  const parts=[],accepted=[],rejected=[];let remainder=source,attempted=0,stopped=false;
  for(let i=0;i<proposals.length&&accepted.length<maxCuts;i++){
    const orientedRest=orient(remainder);
    if(fits(orientedRest)){parts.push(orientedRest);remainder=null;break;}
    if(yield {attempted,accepted:accepted.length,checkpoint:{parts:[...parts,remainder],originalVolume,accepted:[...accepted],rejected:[...rejected]}}){stopped=true;break;}
    attempted++;progress(`Kontur ${i+1}/${proposals.length} · ${parts.length} passende Teile abgetrennt`);
    let split,solidResult;
    try{
      let prepared,tolerance=lineTolerance;
      for(let retry=0;retry<4;retry++){
        try{prepared=proposals[i].cutDefinition?cutterFromDefinition(api,proposals[i].cutDefinition):prepareSurfaceCutter(api,source,proposals[i].faces,depth,tolerance);break;}
        catch(e){if(!/Ausgleichslinie|Linientoleranz/.test(e.message)||!tolerance||retry===3)throw e;tolerance=Math.max(.1,tolerance/2);progress(`Kontur ${i+1}: Glättung automatisch auf ${tolerance} mm verringert.`);}
      }
      progress(`Kontur ${i+1}/${proposals.length}: Volumenkörper schneiden und schließen · ${parts.length} passende Teile`);
      try{solidResult=cutSurfaceSolids(remainingSolid,prepared.solid,true);split=solidResult.pieces.map((s,i)=>({...fromSolid(s),cutPlanes:cuttingPlanes(prepared),numericalCleanupVolume:0,partitionFaithful:solidResult.partitionFaithful,requiresRegroup:i===solidResult.pieces.length-1&&solidResult.remainingComponents>1,remainingComponents:i===solidResult.pieces.length-1?solidResult.remainingComponents:undefined}));}finally{prepared.solid.delete();}
    }catch(e){
      const fatal=/Aborted|memory access out of bounds|unreachable|RuntimeError/i.test(e.message)||e.name==='RuntimeError';
      if(fatal){kernelFailure=`Geometriekern bei Kontur ${i+1} abgebrochen. Die zuvor geprüften Teile wurden erhalten.`;rejected.push({proposal:i,reason:kernelFailure});progress(kernelFailure);break;}
      solidResult?.pieces.forEach(s=>s.delete());rejected.push({proposal:i,reason:e.message});progress(`Kontur ${i+1} übersprungen: ${e.message}`);continue;
    }
    progress(`Kontur ${i+1}/${proposals.length}: Druckausrichtung prüfen · ${parts.length} passende Teile`);
    try{
    let candidates;try{candidates=split.slice(0,-1).map(orient);}catch(e){rejected.push({proposal:i,reason:e.message});progress(`Kontur ${i+1} übersprungen: ${e.message}`);continue;}
    if(candidates.some(p=>!fits(p))){progress(`Kontur ${i+1} übersprungen: mindestens ein Bereich passt nach Ausrichtung nicht in den Bauraum.`);rejected.push({proposal:i,reason:'Mindestens ein abgetrennter Bereich passt auch nach Ausrichtung nicht in den Bauraum.'});continue;}
    if(candidates.every(p=>p.volume<Math.max(1,originalVolume*1e-7))){rejected.push({proposal:i,reason:'Nur sehr kleine Restbereiche; kein sinnvoller Konturschnitt.'});continue;}
    // Collapse Boolean ancestry in the native double-precision body. Export/re-import here loses seam precision.
    const compact=solidResult.pieces.at(-1).asOriginal();parts.push(...candidates);accepted.push(i);remainder=split.at(-1);remainingSolid.delete();remainingSolid=compact;
    }finally{solidResult.pieces.forEach(s=>s.delete());}
  }
  let remainingCount=0;
  if(remainder){const oriented=orient(remainder);remainingCount=fits(oriented)?0:1;parts.push(oriented);}
  if(!accepted.length&&remainingCount&&!stopped&&!kernelFailure)throw Error('Keiner der Vorschläge ließ sich als passendes Konturteil abtrennen. Tiefe oder Kontur anpassen. Modell unverändert.');
  const volume=parts.reduce((sum,p)=>sum+p.volume,0);
  if(!Number.isFinite(volume)||Math.abs(volume-originalVolume)>Math.max(1,originalVolume*1e-7)*Math.max(1,accepted.length))throw Error('Volumenprüfung der gesamten Konturteilung fehlgeschlagen.');
  return {parts,accepted,rejected,attempted,stopped,kernelFailure,remainingCount,complete:remainingCount===0,originalVolume,resultVolume:volume};
  }finally{if(!kernelFailure)remainingSolid?.delete();}
}

// Synchronous callers retain the same API; browser workers can yield between
// candidates to receive a request to finish with the current verified results.
export function contourPlan(...args){const iterator=contourPlanSteps(...args);let step=iterator.next();while(!step.done)step=iterator.next(false);return step.value;}
export async function contourPlanAsync(args,shouldStop=()=>false){
 const iterator=contourPlanSteps(...args);
 try{let step=iterator.next();while(!step.done){await new Promise(resolve=>setTimeout(resolve,0));step=iterator.next(shouldStop());}return step.value;}
 finally{iterator.return();}
}
