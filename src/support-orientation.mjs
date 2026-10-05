import {Matrix3,Matrix4,Vector3} from 'three';
import {bounds,ground,transformData} from './engine.mjs';
import {orientOnCutFace} from './cut-orientation.mjs';
import {orientOnLargestFace} from './largest-face.mjs';
import {convexHull2D,fitPlanarHull} from './planar-bed-fit.mjs';
import {overhangMetrics} from './overhang-metrics.mjs';
import {printStability} from './print-stability.mjs';
import {comparePrintPoses} from './print-pose-ranking.mjs';
import {rebindNativePose} from './native-geometry-binding.mjs';
import {transferInteriorSelection,transformMarkLocation} from './mark-locations.mjs';
import {buildTopology} from './vendor/support-fins/overhangs.js';
import {suggestOrientations} from './vendor/support-fins/orient.js';

export function supportBedContact(data,{requireCut=!!data.cutPlanes?.length}={}){
 if(requireCut&&!data.cutPlanes?.some(p=>Math.abs(Math.abs(p.normal[2])-1)<1e-5&&Math.abs(p.offset)<.05))return 0;
 let area=0;const a=new Vector3(),b=new Vector3(),c=new Vector3();
 for(let f=0;f<data.triangles.length;f+=3){
  a.fromArray(data.vertices,data.triangles[f]*3);b.fromArray(data.vertices,data.triangles[f+1]*3);c.fromArray(data.vertices,data.triangles[f+2]*3);
  if(Math.max(Math.abs(a.z),Math.abs(b.z),Math.abs(c.z))>.05)continue;
  const cross=b.sub(a).cross(c.sub(a));if(cross.lengthSq()>1e-12&&cross.z/cross.length()<-.9999)area+=cross.length()/2;
 }return area;
}

/** PrintFins contributes ranked face-normal proposals. Our final acceptance
 * additionally requires a real flat bed contact, the user's cut face and a
 * continuous diagonal fit. Assembly coordinates and annotations are preserved. */
export function preparePartForSupports(part,bed,{usePrintFins=true,requireStable=false}={}){
 if(!Array.isArray(bed)||bed.length!==3||bed.some(v=>!Number.isFinite(v)||v<=0))throw Error('Gültigen Bauraum für die Druckausrichtung wählen.');
 const source={...part};delete source.transform;delete source.supports;
 const candidates=[];let proposalCount=0,confidence='none';
 const add=(data,method)=>{
  const planar=[];for(let i=0;i<data.vertices.length;i+=3)planar.push([data.vertices[i],data.vertices[i+1]]);
  const fit=fitPlanarHull(convexHull2D(planar),bed.slice(0,2));if(!fit)return;
  const fitted=ground(transformData(data,new Matrix4().makeRotationZ(fit.angle))),box=bounds(fitted);if(box.size.some((v,i)=>v>bed[i]+.005))return;
  const bedArea=supportBedContact(fitted);if(bedArea<1)return;
  const overhang=overhangMetrics(fitted),score=overhang.severeArea*1e6+overhang.supportArea*100+Math.max(0,300-bedArea)*.5+box.size[2]*3;
  candidates.push({data:fitted,method,bedArea,overhang,score,size:box.size,printStability:printStability(fitted)});
 };
 add(ground(source),'current');
 try{add(source.cutPlanes?.length?orientOnCutFace(source,bed):orientOnLargestFace(source),'flat-face');}catch(error){if(error.name==='RuntimeError')throw error;}
 if(usePrintFins){
  const soup=new Float32Array(source.triangles.length*3);for(let i=0;i<source.triangles.length;i++)for(let k=0;k<3;k++)soup[i*3+k]=source.vertices[source.triangles[i]*3+k];
  const topology=buildTopology({getAttribute:()=>({array:soup})}),suggested=suggestOrientations(topology,{top:5,threshold:45});confidence=suggested.confidence;proposalCount=suggested.candidates.length;
  for(const candidate of suggested.candidates){if(candidate.seating==='point')continue;const matrix=new Matrix4().setFromMatrix3(new Matrix3().fromArray(candidate.rot));add(ground(transformData(source,matrix)),'printfins');}
 }
 if(!candidates.length)throw Error('Keine Drucklage mit ebener Auflage innerhalb des Bauraums gefunden. Auflagefläche wählen oder Teil weiter aufteilen.');
 candidates.sort(comparePrintPoses);const best=candidates[0],local=new Matrix4().fromArray(best.data.transform),history=new Matrix4().fromArray(part.transform||new Matrix4().toArray());
 if(requireStable&&(!best.printStability.valid||!best.printStability.stableUnderGravity))throw Error(`Keine standfeste Drucklage unter ${candidates.length} passenden Kandidaten gefunden. Die bisherige Lage bleibt erhalten. Schnittführung ändern oder Teil weiter aufteilen; der Schwerpunkt muss innerhalb der Auflage liegen.`);
 const result={...part,...best.data,...transferInteriorSelection(part,local.toArray(),true),plannedMark:transformMarkLocation(part.plannedMark,local),mark:transformMarkLocation(part.mark,local),bedFace:source.cutPlanes?.length?'cut':'surface',bedContactArea:best.bedArea,requiresCutFace:false,overhang:best.overhang,supports:undefined,supportOrientation:{method:best.method,candidates:candidates.length,printFinsProposals:proposalCount,confidence,bedArea:best.bedArea,severeArea:best.overhang.severeArea,supportArea:best.overhang.supportArea,height:best.size[2]}};
 result.supportNotice=part.supports?'Die Drucklage wurde geprüft. Support Fins für diese Lage neu berechnen.':undefined;
 result.printStability=best.printStability;
 result.supportOrientation.objective='stability-overhang-fit';
 delete result.largestFace;
 if(part.assemblyMatrix){result.assemblyMatrix=new Matrix4().fromArray(part.assemblyMatrix).multiply(local.clone().invert()).toArray();if(part.transform)result.transform=local.multiply(history).toArray();else delete result.transform;}
 else result.transform=local.multiply(history).toArray();
 if(part.nativeGeometry!==undefined){if(!part.assemblyMatrix)result.assemblyMatrix=new Matrix4().fromArray(part.transform||new Matrix4().toArray()).multiply(new Matrix4().fromArray(result.transform).invert()).toArray();result.nativeGeometry=rebindNativePose(part,result);}
 return result;
}
