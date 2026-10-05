import {sha256} from '@noble/hashes/sha2.js';
import {validateExactBinding} from './exact-geometry-binding.mjs';
import {validateNativeBinding} from './native-geometry-binding.mjs';
import {EXACT_GEOMETRY_LIMITS,exactMeshFromNumbers,encodeExactMesh,createExactAuthority,binary64ExactRational,exactRational,exactHash} from './exact-geometry.mjs';
import {exactPlaneFromPrintPose} from './exact-planar-cutter.mjs';

// Source capture only. No geometry kernel, repair, coordinate weld, permission
// transfer to child faces, print approval or collision proof occurs here.
const fail=reason=>Object.assign(Error(`Exakte Modellquelle konnte nicht übernommen werden: ${reason}.`),{code:'EXACT_SOURCE_PART_REJECTED',reason});
const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
const permissionFields=['interiorRegion','interiorBaseRegion','interiorBaseRegionCount','interiorSeeds','interiorSeed','interiorAngle'];
const freeze=value=>{if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const sequence=a=>Array.isArray(a)||a instanceof Float32Array||a instanceof Float64Array||a instanceof Uint32Array;
function numbers(a,{max,multiple=1,indexLimit=null,empty=false}={}){if(!sequence(a)||(!empty&&!a.length)||a.length>max||a.length%multiple)throw fail('array_shape');const out=[];for(const x of a){if(!Number.isFinite(x)||indexLimit!==null&&(!Number.isSafeInteger(x)||x<0||x>=indexLimit))throw fail('array_values');out.push(x);}return out;}
function meshArrays(value){const vertices=numbers(value?.vertices,{max:3*EXACT_GEOMETRY_LIMITS.vertices,multiple:3}),triangles=numbers(value?.triangles,{max:3*EXACT_GEOMETRY_LIMITS.faces,multiple:3,indexLimit:vertices.length/3});return{vertices,triangles};}
function numbersHash(arrays){const hash=sha256.create(),buffer=new Uint8Array(32768),view=new DataView(buffer.buffer);let offset=0;const put=n=>{view.setFloat64(offset,n,true);offset+=8;if(offset===buffer.length){hash.update(buffer);offset=0;}};for(const a of arrays){put(a.length);for(const n of a)put(n);}if(offset)hash.update(buffer.subarray(0,offset));return Array.from(hash.digest(),n=>n.toString(16).padStart(2,'0')).join('');}
function pose(part){const value=part.assemblyMatrix===undefined?identity:part.assemblyMatrix;try{exactPlaneFromPrintPose({normal:[0,0,1],offset:0,assemblyToPrint:value});}catch{throw fail('assembly_matrix');}return [...value];}
function permission(part,matrix,faceCount){
 for(const key of Object.keys(part))if(key.startsWith('interior')&&!permissionFields.includes(key)&&part[key]!==undefined)throw fail('unknown_interior_permission_field');
 const selection={},fingerprint={};
 for(const key of ['interiorRegion','interiorBaseRegion'])if(part[key]!==undefined){
  if(part[key]===null){selection[key]=null;fingerprint[key]=null;continue;}
  if(!part[key]||typeof part[key]!=='object'||Object.keys(part[key]).some(k=>!['vertices','triangles'].includes(k)))throw fail('interior_region_schema');
  const region=meshArrays(part[key]);selection[key]=region;fingerprint[key]=numbersHash([region.vertices,region.triangles]);
 }
 if(part.interiorSeeds!==undefined){if(!Array.isArray(part.interiorSeeds)||part.interiorSeeds.length>64)throw fail('interior_seeds');const seeds=[];for(const p of part.interiorSeeds){if(!p||Object.keys(p).some(k=>!['seed','angle'].includes(k))||!Number.isInteger(p.seed)||p.seed<0||p.seed>=faceCount||!Number.isFinite(p.angle)||p.angle<0||p.angle>180)throw fail('interior_seeds');seeds.push({seed:p.seed,angle:p.angle});}selection.interiorSeeds=seeds;fingerprint.interiorSeeds=seeds;}
 for(const key of ['interiorBaseRegionCount','interiorSeed','interiorAngle'])if(part[key]!==undefined){const n=part[key];if(n!==null&&(!Number.isFinite(n)||n<0||key!=='interiorAngle'&&!Number.isInteger(n)||key==='interiorSeed'&&n>=faceCount||key==='interiorAngle'&&n>180||key==='interiorBaseRegionCount'&&n>1_000_000))throw fail('interior_selection_metadata');selection[key]=n;fingerprint[key]=n;}
 const permissionHash=exactHash(JSON.stringify({frame:'part-local',assemblyMatrixHash:numbersHash([matrix]),selection:fingerprint}));return freeze({frame:'part-local',assemblyMatrix:[...matrix],selection,permissionHash,grantsNewFaces:false,validatedOnNewGeometry:false});
}
function legacyClosed(mesh){
 const nv=mesh.vertices.length,nf=mesh.triangles.length,links=new Map(),first=new Int32Array(nv).fill(-1),degree=new Uint32Array(nv);
 // The numeric input is dyadic. A shared power-of-two denominator makes exact
 // nondegeneracy and total signed-volume checks bounded integer operations.
 let denominator=1n;for(const p of mesh.vertices)for(const q of p)if(q[1]>denominator)denominator=q[1];let bits=0;
 const points=mesh.vertices.map(p=>p.map(q=>{const n=q[0]*(denominator/q[1]);bits+=n? (n<0n?-n:n).toString(2).length:0;if(bits>536_870_912)throw fail('integer_work_limit');return n;}));let sixVolume=0n;
 for(const tri of mesh.triangles){
  const [a,b,c]=tri.map(i=>points[i]),u=b.map((x,k)=>x-a[k]),v=c.map((x,k)=>x-a[k]),cross=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];if(cross.every(x=>x===0n))throw fail('legacy_degenerate_face');sixVolume+=a[0]*cross[0]+a[1]*cross[1]+a[2]*cross[2];
  for(let k=0;k<3;k++){const a=tri[k],b=tri[(k+1)%3],c=tri[(k+2)%3],key=a*nv+b;if(links.has(key))throw fail('legacy_nonmanifold_or_winding');links.set(key,c);if(first[a]<0)first[a]=b;degree[a]++;}
 }
 for(const key of links.keys()){const a=Math.floor(key/nv),b=key-a*nv;if(!links.has(b*nv+a))throw fail('legacy_open_edge');}
 for(let a=0;a<nv;a++)if(first[a]>=0){let b=first[a],count=0;do{const next=links.get(a*nv+b);if(next===undefined||++count>degree[a])throw fail('legacy_vertex_fan');b=next;}while(b!==first[a]);if(count!==degree[a])throw fail('legacy_vertex_fan');}
 if(sixVolume<=0n)throw fail('legacy_nonpositive_volume');return{closedIndexedTwoManifold:true,vertexFansConnected:true,nondegenerateLiteralFaces:true,totalSignedVolumePositive:true,selfIntersectionsChecked:false,shellContainmentChecked:false,faceCount:nf,coordinateWeldingUsed:false};
}
const add=(a,b)=>exactRational(a[0]*b[1]+b[0]*a[1],a[1]*b[1]);
const multiply=(a,b)=>exactRational(a[0]*b[0],a[1]*b[1]);
function rationalAssembly(mesh,matrix){
 if(matrix.every((n,i)=>Object.is(n,identity[i])))return mesh;
 const m=matrix.map(binary64ExactRational),w=m[15];
 const vertices=mesh.vertices.map(p=>[0,1,2].map(axis=>{let value=m[12+axis];for(let k=0;k<3;k++)value=add(value,multiply(m[k*4+axis],p[k]));return exactRational(value[0]*w[1],value[1]*w[0]);}));
 return{...mesh,vertices};
}

/** Detached assembly source plus the UNCHANGED local interior selection.
 * A malformed existing binding never falls back to rounded display geometry.
 * Legacy input is exact only with respect to its current literal numeric mesh;
 * precision discarded before this call cannot be reconstructed. */
export function exactSourceFromPart(part){
 if(!part||typeof part!=='object'||Array.isArray(part))throw fail('part');
 const hasExact=part.exactGeometry!==undefined,hasNative=part.nativeGeometry!==undefined;if(hasExact&&hasNative)throw fail('mixed_bindings');
 const assemblyMatrix=pose(part),display=meshArrays(part),partId=part.id===undefined?null:part.id;if(!(partId===null||typeof partId==='string'&&partId.length<=200||typeof partId==='number'&&Number.isFinite(partId)))throw fail('part_id');
 let geometry,sourceKind,sourceAttachmentHash=null,sourceValidation=null,explicitMergeHash=null;
 if(hasExact){const binding=validateExactBinding(part);geometry=binding.authority;sourceKind='exact-binding';sourceAttachmentHash=binding.bindingHash;}
 else if(hasNative){const binding=validateNativeBinding(part);geometry=createExactAuthority({meshText:encodeExactMesh(exactMeshFromNumbers(binding.snapshot))});sourceKind='native-binding';sourceAttachmentHash=part.nativeGeometry.snapshotHash;sourceValidation={nativeSnapshotFrame:'assembly',explicitMergePairs:binding.snapshot.mergeFromVert.length,noNativeRestoreOrBoolean:true};}
 else{
  const from=part.mergeFromVert===undefined?[]:part.mergeFromVert,to=part.mergeToVert===undefined?[]:part.mergeToVert;
  // Explicit merge classes may be used only when their numeric positions are
  // identical; exactMeshFromNumbers enforces this without coordinate welding.
  const input={...display,mergeFromVert:numbers(from,{max:EXACT_GEOMETRY_LIMITS.vertices,indexLimit:display.vertices.length/3,empty:true}),mergeToVert:numbers(to,{max:EXACT_GEOMETRY_LIMITS.vertices,indexLimit:display.vertices.length/3,empty:true})};
  explicitMergeHash=numbersHash([input.mergeFromVert,input.mergeToVert]);
  const mesh=exactMeshFromNumbers(input);sourceValidation=legacyClosed(mesh);geometry=createExactAuthority({meshText:encodeExactMesh(rationalAssembly(mesh,assemblyMatrix))});sourceKind='legacy-numeric';
 }
 const interiorPermission=permission(part,assemblyMatrix,display.triangles.length/3),displayHash=numbersHash([display.vertices,display.triangles,assemblyMatrix]);
 const metadata={sourceKind,partId,assemblyMatrixHash:numbersHash([assemblyMatrix]),displayHash,sourceAttachmentHash,explicitMergeHash,authorityHash:geometry.authorityHash,meshHash:geometry.meshHash,permissionHash:interiorPermission.permissionHash};
 const sourceRevision=exactHash(`EXACT_PART_SOURCE_1\n${JSON.stringify(metadata)}`);
 return freeze({schema:'prinjekt-exact-part-source-v1',sourceKind,geometry,meshText:geometry.meshText,meshHash:geometry.meshHash,sourceRevision,metadataFingerprint:metadata,assemblyMatrix,partId,interiorPermission,sourceValidation,reviewRequired:true,printable:false,precisionReconstructed:false});
}
