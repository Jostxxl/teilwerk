import {restoreExactProjectPart} from './exact-project.mjs';
import {deriveExactDisplay} from './exact-geometry-binding.mjs';
import {printStability} from './print-stability.mjs';
import {overhangMetrics} from './overhang-metrics.mjs';

// This is an export-only conversion, never a new editable CSG operand. No face
// is removed, welded, repaired or imported into a floating geometry kernel.
// A single closed boundary is deliberately required in v1: multiple shells
// need a separate material/cavity containment proof, not a sign-count guess.
const fail=reason=>Object.assign(Error(`Exaktes Drucknetz kann nicht ausgegeben werden: ${reason}.`),{code:'EXACT_PRINT_MESH_REJECTED',reason});
const buffer=new ArrayBuffer(4),bits=new DataView(buffer);
const sub=(a,b)=>a.map((x,k)=>x-b[k]);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const freeze=v=>{if(v&&typeof v==='object'&&!ArrayBuffer.isView(v)&&!Object.isFrozen(v)){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
function dyadic(value){bits.setFloat32(0,value,false);const x=bits.getUint32(0,false),e=(x>>>23)&255,f=x&0x7fffff;return {n:BigInt((x>>>31?-1:1)*(e?f+0x800000:f)),e:e?e-150:-149};}
function box(v){const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(let i=0;i<v.length;i++){if(!Number.isFinite(v[i]))throw fail('nonfinite_coordinate');min[i%3]=Math.min(min[i%3],v[i]);max[i%3]=Math.max(max[i%3],v[i]);}return{min,max,size:max.map((n,k)=>n-min[k])};}
function volumeNumber(n,e){const shift=Math.max(0,n.toString(2).length-52);return Number(n>>BigInt(shift))*2**(3*e+shift)/6;}
function topology(vertices,triangles,reference){
 const nv=vertices.length/3,nf=triangles.length/3,encoded=new Array(nv),positions=new Set();let exponent=0;
 for(let i=0;i<nv;i++){const p=Array.from(vertices.subarray(i*3,i*3+3)),key=p.map(n=>n===0?'0':String(n)).join(',');if(positions.has(key))throw fail('coincident_export_vertices');positions.add(key);const q=p.map(dyadic);for(const d of q)if(d.n&&d.e<exponent)exponent=d.e;encoded[i]=q;}
 const points=encoded.map(p=>p.map(x=>x.n?x.n<<BigInt(x.e-exponent):0n));
 const links=new Map(),degree=new Uint32Array(nv),first=new Int32Array(nv).fill(-1),parents=Int32Array.from({length:nv},(_,i)=>i),find=i=>{while(parents[i]!==i){parents[i]=parents[parents[i]];i=parents[i];}return i;};
 let sixVolume=0n;
 for(let i=0;i<nf;i++){
  const tri=Array.from(triangles.subarray(i*3,i*3+3)),[a,b,c]=tri.map(v=>points[v]),normal=cross(sub(b,a),sub(c,a));if(normal.every(x=>x===0n))throw fail('collapsed_export_triangle');
  const source=tri.map(v=>Array.from(reference.subarray(v*3,v*3+3))),out=tri.map(v=>Array.from(vertices.subarray(v*3,v*3+3))),before=cross(sub(source[1],source[0]),sub(source[2],source[0])),after=cross(sub(out[1],out[0]),sub(out[2],out[0]));
  if(!Number.isFinite(dot(before,after))||dot(before,after)<=0)throw fail('triangle_orientation_changed');
  sixVolume+=dot(sub(a,points[0]),normal);
  for(let k=0;k<3;k++){const a=tri[k],b=tri[(k+1)%3],key=a*nv+b;if(links.has(key))throw fail('nonmanifold_or_inconsistent_winding');links.set(key,tri[(k+2)%3]);if(first[a]<0)first[a]=b;degree[a]++;const x=find(a),y=find(b);parents[Math.max(x,y)]=Math.min(x,y);}
 }
 for(const key of links.keys()){const a=Math.floor(key/nv),b=key-a*nv;if(!links.has(b*nv+a))throw fail('open_boundary');}
 for(let a=0;a<nv;a++){
  if(first[a]<0)throw fail('unused_vertex');let b=first[a],count=0;do{const next=links.get(a*nv+b);if(next===undefined||++count>degree[a])throw fail('disconnected_vertex_fan');b=next;}while(b!==first[a]);if(count!==degree[a])throw fail('disconnected_vertex_fan');
 }
 if(new Set(Array.from({length:nv},(_,i)=>find(i))).size!==1)throw fail('multiple_boundary_components');
 if(sixVolume<=0n)throw fail('nonpositive_export_volume');
 const volumeEstimate=volumeNumber(sixVolume,exponent);if(!Number.isFinite(volumeEstimate)||volumeEstimate<=0)throw fail('nonfinite_export_volume');
 return freeze({closedIndexedTwoManifold:true,vertexFansConnected:true,boundaryComponents:1,positiveSignedVolume:true,volumeSignMethod:'exact-dyadic-float32-determinants',volumeEstimate,faceCount:nf,allSourceFacesRetained:true,coordinateWeldingUsed:false,selfIntersectionsChecked:false,shellContainmentChecked:false});
}

/** Derive and check exactly the binary32 coordinates written by binary STL.
 * Export translation is explicit and returned; writers MUST NOT ground/pose
 * this copy again. The assembly authority and editable part remain untouched.
 * Topology/rounding checks do not independently certify self-intersections,
 * adhesion, printability, or the material semantics of an edited input file. */
export function prepareExactPrintMesh(part,options={}){
 if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>!['usableBed','context','permissionSources'].includes(k)))throw fail('options');
 const bed=options.usableBed;if(!Array.isArray(bed)||bed.length!==3||!Array.from(bed).every(n=>Number.isFinite(n)&&n>=1&&n<=10000))throw fail('usable_bed');
 const restored=restoreExactProjectPart(part,{...(options.context===undefined?{}:{context:options.context}),...(options.permissionSources===undefined?{}:{permissionSources:options.permissionSources})});
 if(restored.plannedMark&&!restored.mark)throw fail('pending_engraving');
 const binding=restored.exactGeometry,source=deriveExactDisplay(binding.authority,{assemblyMatrix:restored.assemblyMatrix,precision:'float64'});
 if(source.rounding.source.distinctExactPointsCollapsed||source.rounding.source.nonzeroCoordinatesRoundedToZero||source.rounding.additionalCollapsedSourcePoints||source.rounding.numericallyDegenerateTriangles)throw fail('source_precision_collapse');
 const inputBox=box(source.vertices),translation=[-inputBox.min[0]/2-inputBox.max[0]/2,-inputBox.min[1]/2-inputBox.max[1]/2,-inputBox.min[2]],reference=new Float64Array(source.vertices.length),vertices=new Float32Array(source.vertices.length),triangles=source.triangles.slice();let maxQuantizationError=0;
 for(let i=0;i<vertices.length;i++){const value=source.vertices[i]+translation[i%3];reference[i]=value;vertices[i]=value;maxQuantizationError=Math.max(maxQuantizationError,Math.abs(vertices[i]-value));}
 const outputBox=box(vertices);
 if(outputBox.min[2]!==0||outputBox.min[0]<-bed[0]/2||outputBox.max[0]>bed[0]/2||outputBox.min[1]<-bed[1]/2||outputBox.max[1]>bed[1]/2||outputBox.max[2]>bed[2])throw fail('outside_build_volume');
 const checked=topology(vertices,triangles,reference);
 if(!restored.printPoseAvailable)throw fail('print_pose_missing');
 const physical=printStability({vertices,triangles}),overhang=overhangMetrics({vertices,triangles});
 if(!physical.valid)throw fail('invalid_export_mass_properties');
 const printPreparation=freeze({method:'exact-authority-float32',sourceAuthorityHash:binding.authority.authorityHash,sourceMeshHash:binding.authority.meshHash,sourceBindingHash:binding.bindingHash,sourceAssemblyMatrix:[...restored.assemblyMatrix],exportTranslation:translation,rounding:{source:source.rounding.source,poseRounding:'floating-rigid-export-transform',translationRounding:'binary64',maximumFloat32QuantizationError:maxQuantizationError},bounds:outputBox,topology:checked,printStability:physical,overhang,reviewRequired:true,printabilityCertified:false});
 return {id:restored.id,name:restored.name,color:restored.color,note:restored.note,vertices,triangles,displayFaceToExactFace:source.displayFaceToExactFace.slice(),exactPrintMesh:true,exportOnly:true,printPreparation};
}
