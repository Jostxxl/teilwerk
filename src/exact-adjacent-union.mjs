// Exact two-source boundary union with a separating support plane.
// No CSG, display coordinates, tolerance, cached approval or shell removal.
import {validateExactAuthority,parseExactMesh,exactRational,exactRationalString,parseExactRational,exactHash} from './exact-geometry.mjs';
import {validateExactPlane} from './exact-planar-cutter.mjs';
const fail=reason=>Object.assign(Error(`Exakte benachbarte Vereinigung ungültig: ${reason}`),{code:'EXACT_ADJACENT_UNION_REJECTED',reason});
export const EXACT_ADJACENT_UNION_LIMITS=Object.freeze({bytes:200*1024*1024,faces:500000,vertices:500000,objects:2000000,array:2000000,depth:80});
const freeze=x=>{if(x&&typeof x==='object'&&!Object.isFrozen(x)){Object.values(x).forEach(freeze);Object.freeze(x);}return x;};
function detach(raw){let bytes=0,objects=0;const active=new Set(),budget=n=>{bytes+=n;if(bytes>EXACT_ADJACENT_UNION_LIMITS.bytes)throw fail('byte_limit');};
 const copy=(x,depth)=>{
  if(x===null||typeof x==='boolean'){budget(4);return x;}if(typeof x==='string'){budget(2*x.length+2);return x;}if(typeof x==='number'){if(!Number.isFinite(x))throw fail('nonfinite_number');budget(8);return x;}
  if(!x||typeof x!=='object'||depth>EXACT_ADJACENT_UNION_LIMITS.depth||++objects>EXACT_ADJACENT_UNION_LIMITS.objects)throw fail('record_structure');if(active.has(x))throw fail('cyclic_record');
  // Proof inputs are plain JSON. Do not read a typed view's overridable length,
  // iterator or custom properties; packed inputs must first use their normal
  // authority decoder. No caller code executes through this special case.
  if(ArrayBuffer.isView(x))throw fail('typed_array_not_supported');
  const array=Array.isArray(x),proto=Object.getPrototypeOf(x);if(array?proto!==Array.prototype:proto!==Object.prototype&&proto!==null)throw fail('plain_record');
  const keys=Reflect.ownKeys(x);if(keys.some(k=>typeof k!=='string'||['__proto__','constructor','prototype','toJSON'].includes(k)))throw fail('record_keys');
  if(array&&(x.length>EXACT_ADJACENT_UNION_LIMITS.array||keys.length!==x.length+1||keys.some(k=>k!=='length'&&(!/^(0|[1-9]\d*)$/.test(k)||Number(k)>=x.length))))throw fail('dense_array');
  active.add(x);budget(2);const out=array?[]:{};for(const key of keys){if(array&&key==='length')continue;const d=Object.getOwnPropertyDescriptor(x,key);if(!d||!Object.hasOwn(d,'value')||!d.enumerable)throw fail('record_accessor');if(!array)budget(key.length*2+2);out[key]=copy(d.value,depth+1);}active.delete(x);return out;
 };return copy(raw,0);
}
function shape(x,keys,reason){if(!x||typeof x!=='object'||Array.isArray(x)||Object.keys(x).length!==keys.length||keys.some(k=>!Object.hasOwn(x,k)))throw fail(reason);}
const add=(a,b)=>exactRational(a[0]*b[1]+b[0]*a[1],a[1]*b[1]),sub=(a,b)=>add(a,[-b[0],b[1]]),mul=(a,b)=>exactRational(a[0]*b[0],a[1]*b[1]);
const dot=(a,b)=>a.reduce((sum,x,i)=>add(sum,mul(x,b[i])),[0n,1n]);
const cmp=(a,b)=>{const n=a[0]*b[1]-b[0]*a[1];return n<0n?-1:n>0n?1:0;};
function triangleNormal(points){const u=points[1].map((x,k)=>sub(x,points[0][k])),v=points[2].map((x,k)=>sub(x,points[0][k]));return [[1,2],[2,0],[0,1]].map(([i,j])=>sub(mul(u[i],v[j]),mul(u[j],v[i])));}
function topology(faces){
 const edges=new Map(),vertexFaces=new Map(),parent=Int32Array.from({length:faces.length},(_,i)=>i),root=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;},union=(a,b)=>{a=root(a);b=root(b);if(a!==b)parent[b]=a;};
 for(let i=0;i<faces.length;i++)for(let k=0;k<3;k++){const a=faces[i].ids[k],b=faces[i].ids[(k+1)%3],key=`${Math.min(a,b)}:${Math.max(a,b)}`,entry=edges.get(key)||[];entry.push({face:i,sign:a<b?1:-1});edges.set(key,entry);let list=vertexFaces.get(a);if(!list){list=[];vertexFaces.set(a,list);}list.push(i);}
 const fanEdges=new Map();for(const [key,entries]of edges){if(entries.length!==2||entries[0].sign+entries[1].sign!==0)throw fail('open_or_nonmanifold_edge');union(entries[0].face,entries[1].face);for(const vertex of key.split(':').map(Number)){let list=fanEdges.get(vertex);if(!list){list=[];fanEdges.set(vertex,list);}list.push(entries.map(x=>x.face));}}
 // A closed edge set alone can contain a pinched nonmanifold vertex. Check
 // that the incident faces make one connected fan at every exact point.
 for(const [vertex,faceIds]of vertexFaces){const adj=new Map(faceIds.map(f=>[f,[]]));for(const [a,b]of fanEdges.get(vertex)){adj.get(a).push(b);adj.get(b).push(a);}const seen=new Set(),todo=[faceIds[0]];while(todo.length){const f=todo.pop();if(seen.has(f))continue;seen.add(f);todo.push(...adj.get(f).filter(j=>!seen.has(j)));}if(seen.size!==faceIds.length)throw fail('nonmanifold_vertex');}
 return {closedOrientedEdges:true,edgeManifold:true,vertexManifold:true,boundaryComponents:new Set(faces.map((_,i)=>root(i))).size};
}
function build(input){
 shape(input,['sources','result','plane'],'input_fields');if(!Array.isArray(input.sources)||input.sources.length!==2)throw fail('two_sources_required');
 const sources=input.sources.map(validateExactAuthority),result=validateExactAuthority(input.result),plane=validateExactPlane(input.plane);
 if(sources[0].authorityHash===sources[1].authorityHash)throw fail('duplicate_source');
 const authorities=[...sources,result];if(authorities.some(x=>!x.faceCount||!x.vertexCount))throw fail('empty_source_or_result');if(authorities.reduce((n,x)=>n+x.faceCount,0)>EXACT_ADJACENT_UNION_LIMITS.faces||authorities.reduce((n,x)=>n+x.vertexCount,0)>EXACT_ADJACENT_UNION_LIMITS.vertices)throw fail('geometry_limit');
 if(authorities.some(x=>JSON.stringify(x.origin)!==JSON.stringify(sources[0].origin)))throw fail('different_origin');
 const normal=plane.normal.map(parseExactRational),offset=parseExactRational(plane.offset),points=[],pointKeys=new Map();
 const pointId=p=>{const key=p.map(exactRationalString).join(' ');let id=pointKeys.get(key);if(id===undefined){id=points.length;pointKeys.set(key,id);points.push(p);}return id;};
 const parsed=authorities.map((authority,index)=>{
  const mesh=parseExactMesh(authority.meshText,{requireCanonical:true}),ids=mesh.vertices.map(pointId),distances=mesh.vertices.map(p=>sub(dot(normal,p),offset));let lo=distances[0],hi=distances[0],negative=0,positive=0,on=0;
  for(const d of distances){if(cmp(d,lo)<0)lo=d;if(cmp(d,hi)>0)hi=d;if(d[0]<0n)negative++;else if(d[0]>0n)positive++;else on++;}
  if(index===0&&(positive||!negative)||index===1&&(negative||!positive))throw fail('not_separated');
  const unique=new Set(),faces=mesh.triangles.map((tri,face)=>{const global=tri.map(i=>ids[i]),n=triangleNormal(tri.map(i=>mesh.vertices[i]));if(new Set(global).size!==3||!n.some(q=>q[0]!==0n))throw fail('degenerate_face');const key=[...global].sort((a,b)=>a-b).join(',');if(unique.has(key))throw fail('duplicate_source_face');unique.add(key);const sign=((global[0]>global[1])+(global[0]>global[2])+(global[1]>global[2]))%2?-1:1,onPlane=tri.every(i=>distances[i][0]===0n),facing=onPlane?dot(n,normal)[0]:0n;return {ids:global,key,sign,face,onPlane,planeFacing:facing<0n?-1:facing>0n?1:0,operandIndex:authority.provenance.operandIndex[face],sourceFaceIndex:authority.provenance.sourceFaceIndex[face]};});
  return {faces,topology:topology(faces),range:{minimum:exactRationalString(lo),maximum:exactRationalString(hi),negative,on,positive}};
 });
 const inputFaces=new Map();for(let source=0;source<2;source++)for(const face of parsed[source].faces){const list=inputFaces.get(face.key)||[];list.push({...face,source});inputFaces.set(face.key,list);}
 const retained=new Map(),interfaces=[];
 for(const [key,list]of inputFaces){
  if(list.length===1){retained.set(key,list[0]);continue;}
  if(list.length!==2||list[0].source===list[1].source)throw fail('ambiguous_interface');const [a,b]=list;
  if(a.sign!==-b.sign||!a.onPlane||!b.onPlane)throw fail('nonreciprocal_interface');if(a.operandIndex!==b.operandIndex||a.sourceFaceIndex!==b.sourceFaceIndex)throw fail('interface_provenance');
  // A occupies the negative halfspace, so its material boundary must face
  // toward positive normal. Merely opposite winding would also admit two
  // globally inverted solids. This exact sign gate has no area tolerance.
  if(a.planeFacing!==1||b.planeFacing!==-1)throw fail('cut_material_side');
  if(sources[0].origin.operands[a.operandIndex].role!=='cutter')throw fail('interface_is_not_a_cut');
  interfaces.push([a.face,b.face,a.operandIndex,a.sourceFaceIndex]);
 }
 if(!interfaces.length)throw fail('no_positive_area_cut_contact');
 const faceMap=[];for(const face of parsed[2].faces){const source=retained.get(face.key);if(!source)throw fail('extra_or_duplicate_result_face');if(face.sign!==source.sign||face.operandIndex!==source.operandIndex||face.sourceFaceIndex!==source.sourceFaceIndex)throw fail('result_face_or_birth_changed');faceMap.push([source.source,source.face]);retained.delete(face.key);}
 if(retained.size)throw fail('missing_result_face');if(faceMap.length+2*interfaces.length!==sources[0].faceCount+sources[1].faceCount)throw fail('incomplete_boundary_ledger');
 const record={kind:'exactAdjacentUnionReview',version:1,frame:'assembly',sourceAuthorityHashes:sources.map(x=>x.authorityHash),sourceMeshHashes:sources.map(x=>x.meshHash),resultAuthorityHash:result.authorityHash,resultMeshHash:result.meshHash,originHash:exactHash(JSON.stringify(result.origin)),plane,sourceSides:['nonpositive','nonnegative'],sourceRanges:parsed.slice(0,2).map(x=>x.range),sourceFaceCounts:sources.map(x=>x.faceCount),resultFaceCount:result.faceCount,interfaces,faceMap,sourceTopology:parsed.slice(0,2).map(x=>x.topology),resultTopology:parsed[2].topology,completeFaceCoverage:true,unchangedOrientedFaceBirth:true,noInteriorOverlap:true,nonOverlapScope:'exact-opposite-support-halfspaces-of-trusted-closed-input-material',connectedContactProven:true,materialScope:'complete-boundary-union-relative-to-trusted-input-solids',independentInputSolidValidityProven:false,reviewRequired:true,printable:false};
 return freeze({...record,reviewHash:exactHash(`EXACT_ADJACENT_UNION_REVIEW_1\n${JSON.stringify(record)}`)});
}
/** Inputs must be current trusted exact solids; this is not mesh repair. A lies
 * on the nonpositive plane side and B on the nonnegative side. */
export function createExactAdjacentUnionReview(options){return build(detach(options));}
export function validateExactAdjacentUnionReview(value,options){const saved=detach(value),input=detach(options);shape(input,['sources','result'],'validation_input_fields');const fresh=build({...input,plane:saved.plane});if(JSON.stringify(fresh)!==JSON.stringify(saved))throw fail('review_changed');return fresh;}
