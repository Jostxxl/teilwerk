import {Vector3,Matrix4,Matrix3,Quaternion,Triangle} from 'three';
const vector = value => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);

// Project files are untrusted; reject malformed annotations before attempting to render text.
export function restoreMarkLocation(value){
 if(value == null)return undefined;
 if(!vector(value.point)||!vector(value.normal)||Math.hypot(...value.normal)<1e-8)throw Error('Ungültige Markierungsposition im Projekt.');
 const {text,size=8,depth=.4,rotation=0,emboss=false,autoId=false}=value;
 if(typeof text!=='string'||!/^[A-Za-z0-9 ._-]{1,24}$/.test(text)||!Number.isFinite(size)||size<1||size>100||!Number.isFinite(depth)||depth<.1||depth>5||!Number.isFinite(rotation)||typeof emboss!=='boolean'||typeof autoId!=='boolean')throw Error('Ungültige Markierungseinstellungen im Projekt.');
 if(value.placement!==undefined&&!['manual','automatic'].includes(value.placement))throw Error('Ungültige Herkunft der Markierungsposition.');
 return {point:[...value.point],normal:new Vector3(...value.normal).normalize().toArray(),text,size,depth,rotation,emboss,autoId,...(value.placement?{placement:value.placement}:{})};
}

// TextGeometry constructs its tangent frame by rotating +Z onto the surface normal.
// Preserve the in-plane text direction too: transforming only the normal loses roll.
export function transformMarkLocation(value,transform){
 if(!value)return undefined;
 const mark=restoreMarkLocation(value),matrix=transform instanceof Matrix4?transform:new Matrix4().fromArray(transform);
 const originalNormal=new Vector3(...mark.normal),normal=originalNormal.clone().applyNormalMatrix(new Matrix3().getNormalMatrix(matrix));
 const frame=new Quaternion().setFromUnitVectors(new Vector3(0,0,1),originalNormal);
 const angle=mark.rotation*Math.PI/180,tangent=new Vector3(Math.cos(angle),Math.sin(angle),0).applyQuaternion(frame);
 const linear=new Matrix3().setFromMatrix4(matrix),sizeScale=tangent.clone().applyMatrix3(linear).length(),depthScale=originalNormal.clone().applyMatrix3(linear).length();
 tangent.applyMatrix3(linear).normalize().applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0,0,1),normal).invert());
 return restoreMarkLocation({...mark,point:new Vector3(...mark.point).applyMatrix4(matrix).toArray(),normal:normal.toArray(),rotation:Math.atan2(tangent.y,tangent.x)*180/Math.PI,size:mark.size*(Math.abs(sizeScale-1)<1e-10?1:sizeScale),depth:mark.depth*(Math.abs(depthScale-1)<1e-10?1:depthScale)});
}

// Match source-space locations to actual surviving surfaces in the closed parts.
// A contact shared by two parts is deliberately left unresolved rather than engraved arbitrarily.
export function assignMarkLocations(parts,locations){
 let assigned=0;const triangle=new Triangle(),closest=new Vector3(),surfaceNormal=new Vector3();
 // A user-selected anchor has precedence when a rebuild merges several old
 // pieces. Legacy locations without provenance remain user-owned as well.
 const ordered=[...locations].sort((a,b)=>Number(a.placement==='automatic')-Number(b.placement==='automatic'));
 for(const value of ordered){const location=restoreMarkLocation(value),candidates=[];
  for(const part of parts){const mark=part.transform?transformMarkLocation(location,part.transform):location,point=new Vector3(...mark.point),normal=new Vector3(...mark.normal);let distance=Infinity,match;
   for(let f=0;f<part.triangles.length;f+=3){triangle.a.fromArray(part.vertices,part.triangles[f]*3);triangle.b.fromArray(part.vertices,part.triangles[f+1]*3);triangle.c.fromArray(part.vertices,part.triangles[f+2]*3);triangle.getNormal(surfaceNormal);if(surfaceNormal.dot(normal)<.5)continue;triangle.closestPointToPoint(point,closest);const d=closest.distanceToSquared(point);if(d<distance){distance=d;match=closest.toArray();}if(distance<1e-10)break;}
   if(distance<1)candidates.push({part,distance,mark:{...mark,point:match}});
  }
  candidates.sort((a,b)=>a.distance-b.distance);const best=candidates[0];
  if(best&&!best.part.plannedMark&&(!candidates[1]||candidates[1].distance-best.distance>1e-8)){best.part.plannedMark=best.mark;assigned++;}
 }
 return {assigned,unassigned:locations.length-assigned};
}
export function restoreInteriorRegion(value){
 if(value==null)return undefined;
 const {vertices,triangles}=value;
 if(!(Array.isArray(vertices)||ArrayBuffer.isView(vertices))||!(Array.isArray(triangles)||ArrayBuffer.isView(triangles))||!vertices.length||vertices.length%3||!triangles.length||triangles.length%3||vertices.length>27000000||triangles.length>9000000||vertices.some(v=>!Number.isFinite(v))||triangles.some(i=>!Number.isInteger(i)||i<0||i>=vertices.length/3))throw Error('Ungültige Innenflächenauswahl im Projekt.');
 return {vertices:new Float64Array(vertices),triangles:new Uint32Array(triangles)};
}

// Union open selection masks by exact geometric triangles. No tolerance snapping:
// reloading and extending a selection must never shave off the user's old region.
export function unionInteriorRegions(base,addition){
 if(!base)return addition;if(!addition)return base;
 const vertices=[],triangles=[],vertexMap=new Map(),faces=new Set();
 for(const region of [base,addition]){const remap=new Int32Array(region.vertices.length/3).fill(-1);
  const index=old=>{if(remap[old]>=0)return remap[old];const p=Array.from(region.vertices.subarray(old*3,old*3+3)),key=p.join(',');let id=vertexMap.get(key);if(id===undefined){id=vertices.length/3;vertices.push(...p);vertexMap.set(key,id);}return remap[old]=id;};
  for(let f=0;f<region.triangles.length;f+=3){const ids=[index(region.triangles[f]),index(region.triangles[f+1]),index(region.triangles[f+2])],key=[...ids].sort((a,b)=>a-b).join(',');if(faces.has(key))continue;faces.add(key);triangles.push(...ids);}
 }
 return {vertices:new Float64Array(vertices),triangles:new Uint32Array(triangles)};
}
function sameMeshLayout(a,b){return a?.vertices?.length===b?.vertices?.length&&a?.triangles?.length===b?.triangles?.length&&a.vertices.every((v,i)=>v===b.vertices[i])&&a.triangles.every((v,i)=>v===b.triangles[i]);}
function validSeeds(value,count){return Array.isArray(value)&&value.length>0&&value.length<=64&&value.every(p=>p&&Number.isInteger(p.seed)&&p.seed>=0&&p.seed<count&&Number.isFinite(p.angle)&&p.angle>=1&&p.angle<=89)&&new Set(value.map(p=>p.seed)).size===value.length;}
const validRegionCount=count=>Number.isInteger(count)&&count>0&&count<=10000?count:undefined;
function frozenRegionCount(part){const base=validRegionCount(part.interiorBaseRegionCount),seeds=part.interiorSeeds?.length||0;return part.interiorBaseRegion&&!base?undefined:validRegionCount((base||0)+seeds);}
export function restoreInteriorSelection(saved,validated){
 const interiorRegion=restoreInteriorRegion(saved.interiorRegion);if(!interiorRegion)return {};
 if(validSeeds(saved.interiorSeeds,validated.triangles.length/3)&&sameMeshLayout(saved,validated)){
  const interiorSeeds=saved.interiorSeeds.map(({seed,angle})=>({seed,angle})),last=interiorSeeds.find(p=>p.seed===saved.interiorSeed)||interiorSeeds.at(-1);
  return {interiorRegion,interiorBaseRegion:restoreInteriorRegion(saved.interiorBaseRegion),interiorBaseRegionCount:validRegionCount(saved.interiorBaseRegionCount),interiorSeeds,interiorSeed:last.seed,interiorAngle:last.angle};
 }
 // Older projects saved only the mask. A changed importer can also reorder faces.
 // Keep the entire region as an immutable base rather than trusting stale indices.
 return {interiorRegion,interiorBaseRegion:interiorRegion,interiorBaseRegionCount:validSeeds(saved.interiorSeeds,validated.triangles.length/3)?frozenRegionCount(saved):!saved.interiorSeeds?.length?validRegionCount(saved.interiorBaseRegionCount):undefined,interiorSeeds:[],interiorSeed:undefined,interiorAngle:Number.isFinite(saved.interiorAngle)?saved.interiorAngle:undefined};
}
export function transferInteriorSelection(part,transform,preserveSeeds=true){
 if(!part?.interiorRegion)return {};
 const matrix=transform?new Matrix4().fromArray(transform):null,move=region=>{if(!region)return undefined;if(!matrix)return region;const vertices=new Float64Array(region.vertices.length),p=new Vector3();for(let i=0;i<vertices.length;i+=3)p.fromArray(region.vertices,i).applyMatrix4(matrix).toArray(vertices,i);return {vertices,triangles:new Uint32Array(region.triangles)};};
 const interiorRegion=move(part.interiorRegion),hasSeeds=preserveSeeds&&part.interiorSeeds?.length;
 return {interiorRegion,interiorBaseRegion:hasSeeds?move(part.interiorBaseRegion):interiorRegion,interiorBaseRegionCount:hasSeeds?validRegionCount(part.interiorBaseRegionCount):frozenRegionCount(part),interiorSeeds:hasSeeds?part.interiorSeeds.map(p=>({...p})):[],interiorSeed:hasSeeds?part.interiorSeed:undefined,interiorAngle:part.interiorAngle};
}
