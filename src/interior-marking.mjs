import {BufferGeometry,BufferAttribute,Vector3,Matrix4,Matrix3,Ray,DoubleSide} from 'three';
import {MeshBVH} from 'three-mesh-bvh';
import {topology,textMesh} from './features.mjs';
import {bounds} from './engine.mjs';
import {validateMarkFootprint,validateMarkMaskCoverage,fatalMarkError} from './mark-validation.mjs';
import {referenceTextFrame} from './mark-alignment.mjs';
import {createInteriorMaskContext,transferInteriorMask} from './interior-mask-transfer.mjs';

export function subsetSurface(data,faces){const vertices=[],triangles=[],lookup=new Map();for(const f of faces)for(let k=0;k<3;k++){const source=data.triangles[f*3+k];let index=lookup.get(source);if(index===undefined){index=vertices.length/3;lookup.set(source,index);vertices.push(...data.vertices.subarray(source*3,source*3+3));}triangles.push(index);}return {vertices:new Float32Array(vertices),triangles:new Uint32Array(triangles)};}
export function selectInterior(data,seed,angle=60,seeds=[]){
 if(!Number.isInteger(seed)||seed<0||seed>=data.triangles.length/3||!Number.isFinite(angle)||angle<1||angle>89)throw Error('Innenseite anklicken und Auswahlweite von 1 bis 89° wählen.');
 const requests=[...seeds.filter(s=>s.seed!==seed),{seed,angle}];if(requests.length>64||requests.some(s=>!Number.isInteger(s.seed)||s.seed<0||s.seed>=data.triangles.length/3||!Number.isFinite(s.angle)||s.angle<1||s.angle>89))throw Error('Ungültige Startpunkte der Innenflächenauswahl.');
 const t=topology(data),neighbors=Array.from({length:t.triangles.length},()=>[]);
 for(const edge of t.edges.values())if(edge.faces.length===2){const [a,b]=edge.faces,dot=t.normals[a].dot(t.normals[b]);neighbors[a].push([b,dot]);neighbors[b].push([a,dot]);}
 const selected=new Uint8Array(t.triangles.length);
 for(const request of requests){const threshold=Math.cos(Math.min(request.angle,35)*Math.PI/180),seedThreshold=Math.cos(request.angle*Math.PI/180),seedNormal=t.normals[request.seed],seen=new Uint8Array(t.triangles.length),queue=[request.seed];seen[request.seed]=1;
  for(let i=0;i<queue.length;i++){selected[queue[i]]=1;for(const [neighbor,dot] of neighbors[queue[i]])if(!seen[neighbor]){seen[neighbor]=1;if(dot>=threshold&&t.normals[neighbor].dot(seedNormal)>=seedThreshold)queue.push(neighbor);}}
 }
 const faces=[];for(let f=0;f<selected.length;f++)if(selected[f])faces.push(f);return {faces,region:subsetSurface(data,faces),seeds:requests,fraction:faces.length/t.triangles.length};
}
function bvh(data){const g=new BufferGeometry();g.setAttribute('position',new BufferAttribute(data.vertices,3));g.setIndex(new BufferAttribute(data.triangles,1));return {geometry:g,tree:new MeshBVH(g,{indirect:true})};}
function triangle(data,f,a,b,c){a.fromArray(data.vertices,data.triangles[f*3]*3);b.fromArray(data.vertices,data.triangles[f*3+1]*3);c.fromArray(data.vertices,data.triangles[f*3+2]*3);}
export function autoMarkLocations(parts,interior,{size=8,depth=.4,rotation=0,generateMarks=true,referenceDirection=[1,0,0],fallbackDirection=[0,1,0]}={}){
 if(!interior?.data?.triangles?.length)throw Error('Zuerst die erlaubte Innenseite auswählen.');
 if(!Number.isFinite(size)||size<1||size>100||!Number.isFinite(depth)||depth<.1||depth>5||!Number.isFinite(rotation))throw Error('Ungültige Markierungseinstellungen.');
 const mask=createInteriorMaskContext(interior.data),a=new Vector3(),b=new Vector3(),c=new Vector3();let assigned=0;const failed=[],invalidMarks=[];
 try{const output=parts.map((part,index)=>{
  const inverse=new Matrix4().fromArray(part.transform||new Matrix4().toArray()).invert(),candidates=[],region=transferInteriorMask(part,mask,{toMask:inverse}).region;
  // Permissions are clipped polygons on surviving body faces, never complete
  // triangles admitted only because their centers happened to be selected.
  if(region)for(let f=0;f<region.triangles.length/3;f++){triangle(region,f,a,b,c);const cross=b.clone().sub(a).cross(c.clone().sub(a)),area=cross.length()/2;if(area<1e-8)continue;candidates.push({center:a.clone().add(b).add(c).multiplyScalar(1/3),normal:cross.normalize(),area});}
  const out={...part,interiorRegion:region};delete out.plannedMarkIssue;
  if(!generateMarks||part.plannedMark&&part.plannedMark.placement!=='automatic'){
   if(part.plannedMark){try{if(!out.interiorRegion)throw Error('Keine gewählte Innenfläche an der gespeicherten Markierungsstelle.');validateMarkFootprint(out,textMesh(part.plannedMark.text,part.plannedMark.point,part.plannedMark.normal,part.plannedMark.size,part.plannedMark.depth,part.plannedMark.rotation,part.plannedMark.emboss),part.plannedMark);assigned++;}catch(e){out.plannedMarkIssue=e.message;invalidMarks.push({part:index,id:part.id,reason:e.message});}}
   return out;
  }
  // A regenerated part ID may be wider than its preview label. Revalidate an
  // automatic anchor against the actual final footprint before keeping it.
  if(part.plannedMark)delete out.plannedMark;
  const model=bvh(part),allowed=out.interiorRegion?bvh(out.interiorRegion):null,text=part.id||String(index+1),alignment={referenceDirection,fallbackDirection,rotation,transform:part.transform};let mark=null;
  try{const center=new Vector3(),totalArea=candidates.reduce((sum,candidate)=>{center.addScaledVector(candidate.center,candidate.area);return sum+candidate.area;},0);if(totalArea)center.divideScalar(totalArea);
   const central=allowed?.tree.closestPointToPoint(center);if(central){triangle(out.interiorRegion,central.faceIndex,a,b,c);candidates.push({center:central.point.clone(),normal:b.clone().sub(a).cross(c.clone().sub(a)).normalize(),area:Infinity});}
   const target=central?.point||center,seen=new Set(),spacing=Math.max(1,size*.35),attempts=candidates.sort((a,b)=>a.center.distanceToSquared(target)-b.center.distanceToSquared(target)||b.area-a.area).filter(candidate=>{const key=candidate.center.toArray().map(x=>Math.round(x/spacing)).join(',');if(seen.has(key))return false;seen.add(key);return true;}).slice(0,200);
   // All automatic labels use exactly the requested common size. If no safe
   // central location fits, report it instead of silently making tiny labels.
   const fontSize=size;
    const textBounds=bounds(textMesh(text,[0,0,0],[0,0,1],fontSize,depth,0,false)),width=textBounds.size[0]+2,height=textBounds.size[1]+2,glyphOffset=[(textBounds.min[0]+textBounds.max[0])/2,(textBounds.min[1]+textBounds.max[1])/2];
    // The padded rectangle is only an inexpensive first-pass filter. Empty
    // spaces around curved glyphs must not veto a fully safe actual footprint.
    // If it finds no location, retry the same bounded central candidate set.
    for(let pass=0;pass<2&&!mark;pass++)for(const candidate of attempts){const {center,normal}=candidate,{u,v,rotation:localRotation}=referenceTextFrame(normal,alignment);let valid=true;
     for(let x=0;pass===0&&x<=6&&valid;x++)for(let y=0;y<=2&&valid;y++){
      const point=center.clone().addScaledVector(u,width*(x/6-.5)).addScaledVector(v,height*(y/2-.5)),hit=model.tree.raycastFirst(new Ray(point.clone().addScaledVector(normal,2),normal.clone().negate()),DoubleSide);
      if(!hit||Math.abs(hit.point.clone().sub(point).dot(normal))>Math.min(.15,depth*.25)||hit.face.normal.dot(normal)<.9){valid=false;break;}
      const original=hit.point.clone().applyMatrix4(inverse),selected=mask.tree.closestPointToPoint(original,{},0,.12);if(!selected||selected.distance>.12){valid=false;break;}
      const exit=model.tree.raycastFirst(new Ray(hit.point.clone().addScaledVector(normal,-.02),normal.clone().negate()),DoubleSide);if(!exit||exit.distance<depth+.15||exit.face.normal.dot(normal)>-.1){valid=false;break;}
     }
     // Keep textMesh's established anchor convention for saved manual marks.
     // Only a new automatic anchor compensates the glyph's true tangent center.
     if(valid){const point=center.clone().addScaledVector(u,-glyphOffset[0]).addScaledVector(v,-glyphOffset[1]),proposed={point:point.toArray(),normal:normal.toArray(),text,size:fontSize,depth,rotation:localRotation,emboss:false,autoId:true,placement:'automatic'};try{validateMarkFootprint(out,textMesh(text,proposed.point,proposed.normal,fontSize,depth,localRotation,false),proposed,{modelTree:model.tree,maskTree:allowed?.tree});mark=proposed;break;}catch(e){if(e.code!=='MARK_PLACEMENT')throw e;}}
    }
  }finally{model.geometry.dispose();allowed?.geometry.dispose();}
  if(mark){out.plannedMark=mark;assigned++;}else{const reason=candidates.length?`Keine sichere zentrale Innenfläche für die gemeinsame Schriftgröße ${size.toLocaleString('de-DE')} mm gefunden. Größe für alle ändern oder diese Stelle manuell festlegen.`:'Keine ausgewählte Innenseite in diesem Teil.';out.plannedMarkIssue=reason;failed.push({part:index,id:text,reason});}return out;
 });return {parts:output,assigned,unassigned:failed.length,failed,invalidMarks,masksOnly:!generateMarks};}finally{mask.dispose();}
}

/** Explicit common-size search. A shared source mask uses the existing preview
 * transform convention; without it, each committed part uses its local mask
 * and its assembly pose for the common lettering direction. No mesh changes. */
export function findUniformMarkSize(api,parts,interior=null,options={}){
 const {size:requestedSize=8,minSize=3,step=.5,generateMarks=true,progress,...settings}=options;
 if(!api?.CrossSection||!Array.isArray(parts)||!parts.length)throw Error('Für die einheitliche Schriftgröße werden Teile und der Geometriekern benötigt.');
 if(!generateMarks||![requestedSize,minSize,step].every(Number.isFinite)||requestedSize<1||requestedSize>100||minSize<1||minSize>requestedSize||step<.5||Math.ceil((requestedSize-minSize)/step)>200)throw Error('Ungültiger Suchbereich für die gemeinsame Schriftgröße.');
 const update=message=>{if(typeof progress==='function')progress(message);};
 const engraved=parts.filter(p=>p.mark),engravingSizes=[...new Set(engraved.map(p=>p.mark.size).filter(v=>Number.isFinite(v)&&v>=1&&v<=100))],lockedByEngraving=engraved.length>0;
 const automatic=parts.map((p,index)=>({part:p,index})).filter(({part})=>!part.mark&&(!part.plannedMark||part.plannedMark.placement==='automatic')),manualCount=parts.filter(p=>!p.mark&&p.plannedMark&&p.plannedMark.placement!=='automatic').length;
 if(lockedByEngraving&&(engravingSizes.length!==1||engraved.some(p=>!Number.isFinite(p.mark.size)||p.mark.size<1||p.mark.size>100))){
  const reason=engravingSizes.length>1?'Vorhandene Gravuren haben unterschiedliche Schriftgrößen. Eine einheitliche neue Größe würde vorhandene Geometrie nicht ändern.':'Eine vorhandene Gravur hat keine verlässlich gespeicherte Schriftgröße. Die gemeinsame Größe kann nicht sicher bestimmt werden.';
  return {parts:[...parts],assigned:engraved.length,unassigned:automatic.length,size:null,requestedSize,lockedByEngraving,engravingSizes,engravedCount:engraved.length,manualCount,automaticAssigned:0,eligible:automatic.length,failed:automatic.map(({part,index})=>({part:index,id:part.id,reason})),invalidMarks:[],attemptedSizes:[],blocked:true,notice:reason};
 }
 const sizes=lockedByEngraving?[engravingSizes[0]]:Array.from({length:Math.floor((requestedSize-minSize)/step)+1},(_,i)=>Number((requestedSize-i*step).toFixed(8)));
 if(!lockedByEngraving&&sizes.at(-1)>minSize+1e-8)sizes.push(minSize);
 const indices=parts.map((p,i)=>p.mark?-1:i).filter(i=>i>=0),attemptedSizes=[];let best=null;
 for(const size of sizes){
  update(`Gemeinsame Schriftgröße ${size.toLocaleString('de-DE')} mm prüfen …`);
  const output=[...parts],failed=[],invalidMarks=[];let manualAssigned=0,automaticAssigned=0,eligible=0;
  if(interior?.data?.triangles?.length){const mapped=autoMarkLocations(indices.map(i=>parts[i]),interior,{...settings,size});mapped.parts.forEach((p,i)=>output[indices[i]]=p);}
  else for(const index of indices){
   update(`Schrift ${size.toLocaleString('de-DE')} mm · Stelle für Teil ${index+1}/${parts.length} prüfen …`);
   const part=parts[index];if(!part.interiorRegion?.triangles?.length){const out={...part};if(out.plannedMark?.placement==='automatic')delete out.plannedMark;out.plannedMarkIssue='Keine ausgewählte Innenseite in diesem Teil.';output[index]=out;continue;}
   const inverse=new Matrix4().fromArray(part.assemblyMatrix||new Matrix4().toArray()).invert(),referenceDirection=new Vector3(...(settings.referenceDirection||[1,0,0])).transformDirection(inverse).toArray(),fallbackDirection=new Vector3(...(settings.fallbackDirection||[0,1,0])).transformDirection(inverse).toArray();
   const mapped=autoMarkLocations([{...part,transform:undefined}],{data:part.interiorRegion},{...settings,size,referenceDirection,fallbackDirection}).parts[0];
   // Ignore a historical import/print transform only while interpreting the
   // local mask. Preserve that metadata on the returned part itself.
   output[index]={...mapped,transform:part.transform,interiorRegion:part.interiorRegion};
  }
  for(const index of indices){const part=output[index],isManual=parts[index].plannedMark&&parts[index].plannedMark.placement!=='automatic';if(!isManual&&part.interiorRegion?.triangles?.length)eligible++;
   update(`Schrift ${size.toLocaleString('de-DE')} mm · Innenfläche für Teil ${index+1}/${parts.length} prüfen …`);
   const mark=part.plannedMark;let reason=part.plannedMarkIssue;
   if(mark&&!reason)try{
    let glyph=textMesh(mark.text,mark.point,mark.normal,mark.size,mark.depth,mark.rotation,mark.emboss),checkMark=mark,exactMask=parts[index].interiorRegion;
    if(interior?.data?.triangles?.length){
     const inverse=new Matrix4().fromArray(part.transform||new Matrix4().toArray()).invert(),point=new Vector3(),vertices=new Float64Array(glyph.vertices.length);
     for(let i=0;i<vertices.length;i+=3)point.fromArray(glyph.vertices,i).applyMatrix4(inverse).toArray(vertices,i);
     glyph={vertices,triangles:glyph.triangles};checkMark={...mark,point:new Vector3(...mark.point).applyMatrix4(inverse).toArray(),normal:new Vector3(...mark.normal).applyMatrix3(new Matrix3().getNormalMatrix(inverse)).normalize().toArray()};exactMask=interior.data;
    }
    // Centroid matching is useful for candidates, but must not fill a small
    // unselected hole. Prove coverage against the original permission mask.
    validateMarkMaskCoverage(api,{interiorRegion:exactMask},glyph,checkMark);
   }catch(error){if(fatalMarkError(error))throw error;reason=error.message;part.plannedMarkIssue=reason;if(!isManual)delete part.plannedMark;}
   if(mark&&!reason){if(isManual)manualAssigned++;else automaticAssigned++;}
   else{const issue={part:index,id:part.id,reason:reason||'Keine sichere Innenmarkierung gefunden.'};if(isManual)invalidMarks.push(issue);else failed.push(issue);}
  }
  attemptedSizes.push(size);const result={parts:output,assigned:engraved.length+manualAssigned+automaticAssigned,unassigned:failed.length+invalidMarks.length,size,requestedSize,lockedByEngraving,engravingSizes,engravedCount:engraved.length,manualCount,automaticAssigned,eligible,failed,invalidMarks,blocked:false};
  // Descending search keeps the largest size when coverage is tied. Missing
  // masks and manual exceptions are reported but cannot improve by shrinking.
  if(!best||automaticAssigned>best.automaticAssigned)best=result;
  if(automaticAssigned===eligible)break;
 }
 return {...best,attemptedSizes,notice:lockedByEngraving?`Vorhandene Gravuren legen die gemeinsame Schriftgröße auf ${best.size.toLocaleString('de-DE')} mm fest.`:''};
}
