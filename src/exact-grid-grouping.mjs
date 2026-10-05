import {EXACT_GEOMETRY_LIMITS,exactHash,parseExactMesh,parseExactRational,exactRational,exactRationalString,exactRationalToNumber,createExactAuthority} from './exact-geometry.mjs';
import {materializeExactGridPartition} from './exact-grid-partition.mjs';
import {validateExactPlane} from './exact-planar-cutter.mjs';

// Group complete bodies of a validated, immutable native arrangement. This is
// a boundary re-emission, never a new Boolean or a print-pose decision. The
// caller must retain the authoritative base partition for validation/undo.
export const EXACT_GRID_GROUPING_LIMITS=Object.freeze({bodies:4096,bytes:EXACT_GEOMETRY_LIMITS.bytes,vertices:EXACT_GEOMETRY_LIMITS.vertices,faces:EXACT_GEOMETRY_LIMITS.faces});
const fail=reason=>Object.assign(Error(`Exakte Rastergruppierung ungültig: ${reason}`),{code:'EXACT_GRID_GROUPING_REJECTED',reason});
const hash=/^[a-f0-9]{64}$/;
function freeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const x of Object.values(value))freeze(x);Object.freeze(value);}return value;}
const cmp=(a,b)=>{const d=a[0]*b[1]-b[0]*a[1];return d<0n?-1:d>0n?1:0;};
const sub=(a,b)=>exactRational(a[0]*b[1]-b[0]*a[1],a[1]*b[1]);
const mul=(a,b)=>exactRational(a[0]*b[0],a[1]*b[1]);
function groupShape(bodyGroups,count){
 if(!Number.isSafeInteger(count)||count<1||count>EXACT_GRID_GROUPING_LIMITS.bodies||!Array.isArray(bodyGroups)||!bodyGroups.length||bodyGroups.length>count)throw fail('group_count');
 let total=0;const seen=new Set(),groups=[];
 for(const group of bodyGroups){
  if(!Array.isArray(group)||!group.length||group.length>count)throw fail('body_group');
  const ids=[];for(const id of group){if(typeof id!=='string'||!/^[1-9]\d{0,3}$/.test(id)||Number(id)>count||seen.has(id))throw fail('body_assignment');seen.add(id);ids.push(id);}
  total+=ids.length;if(total>count)throw fail('body_assignment');groups.push(ids.sort((a,b)=>Number(a)-Number(b)));
 }
 if(total!==count)throw fail('missing_body');
 return groups.sort((a,b)=>Number(a[0])-Number(b[0]));
}
function nonzeroTriangle(ids,points){
 const [a,b,c]=ids.map(i=>points[i].map(parseExactRational)),u=b.map((x,k)=>sub(x,a[k])),v=c.map((x,k)=>sub(x,a[k]));
 return [[1,2],[2,0],[0,1]].some(([i,j])=>sub(mul(u[i],v[j]),mul(u[j],v[i]))[0]!==0n);
}
function inventory(parts){
 const pointIds=new Map(),points=[],records=[],faces=new Map(),interfaces=[],adjacency=Array.from({length:parts.length},()=>new Set());let totalBytes=0,totalVertices=0,totalFaces=0;
 for(let body=0;body<parts.length;body++){
  const part=parts[body];totalBytes+=part.geometry.meshText.length;totalVertices+=part.vertexCount;totalFaces+=part.faceCount;
  if(totalBytes>EXACT_GRID_GROUPING_LIMITS.bytes||totalVertices>EXACT_GRID_GROUPING_LIMITS.vertices||totalFaces>EXACT_GRID_GROUPING_LIMITS.faces)throw fail('aggregate_geometry_limit');
  const mesh=parseExactMesh(part.geometry.meshText,{requireCanonical:true}),localIds=mesh.vertices.map(p=>{
   const point=p.map(exactRationalString),key=point.join(' ');let id=pointIds.get(key);
   if(id===undefined){id=points.length;pointIds.set(key,id);points.push(point);}return id;
  }),triangles=new Uint32Array(mesh.faceCount*3);
  for(let face=0;face<mesh.faceCount;face++){
   const tri=mesh.triangles[face].map(i=>localIds[i]);triangles.set(tri,face*3);
   const key=[...tri].sort((a,b)=>a-b).join(','),sign=((tri[0]>tri[1])+(tri[0]>tri[2])+(tri[1]>tri[2]))%2?-1:1,prior=faces.get(key);
   if(!prior){faces.set(key,[body,face,sign,0]);continue;}
   if(prior[0]===body||prior[2]===sign||prior[3])throw fail('ambiguous_shared_boundary');
   prior[3]=1;
   // A zero-area coincident face is neither a contact proof nor permission to
   // erase topology. It remains emitted and may make a requested merge fail.
   if(nonzeroTriangle(tri,points)){
    interfaces.push({a:prior[0],faceA:prior[1],b:body,faceB:face});adjacency[prior[0]].add(body);adjacency[body].add(prior[0]);
   }
  }
  records.push({part,triangles});
 }
 faces.clear();pointIds.clear();return {points,records,interfaces,adjacency};
}
function connected(members,adjacency){
 const selected=new Set(members),seen=new Set(),todo=[members[0]];
 while(todo.length){const at=todo.pop();if(seen.has(at))continue;seen.add(at);for(const next of adjacency[at])if(selected.has(next)&&!seen.has(next))todo.push(next);}
 return seen.size===members.length;
}
function boundaryChecks(triangles,ids,points){
 const edges=new Map();for(const tri of triangles)for(let k=0;k<3;k++){
  const a=tri[k],b=tri[(k+1)%3];if(a===b)throw fail('collapsed_boundary_edge');
  const key=`${Math.min(a,b)},${Math.max(a,b)}`,record=edges.get(key)||[0,0];record[0]++;record[1]+=a<b?1:-1;edges.set(key,record);
 }
 if(!triangles.length||!ids.length)throw fail('empty_material_body');
 for(const [count,balance]of edges.values())if(count!==2||balance!==0)throw fail('nonmanifold_or_open_boundary');
 let lo,hi;for(const id of ids){const point=points[id].map(parseExactRational);if(!lo){lo=[...point];hi=[...point];}else for(let k=0;k<3;k++){if(cmp(point[k],lo[k])<0)lo[k]=point[k];if(cmp(point[k],hi[k])>0)hi[k]=point[k];}}
 return [lo.map(exactRationalString),hi.map(exactRationalString)];
}
function emitGroup(members,records,points,removed){
 const triangles=[],used=new Set(),operandIndex=[],sourceFaceIndex=[];
 for(const body of members){const {part,triangles:source}=records[body],provenance=part.geometry.provenance;
  for(let face=0;face<part.faceCount;face++)if(!removed[body][face]){
   const tri=Array.from(source.subarray(face*3,face*3+3));triangles.push(tri);for(const id of tri)used.add(id);
   operandIndex.push(provenance.operandIndex[face]);sourceFaceIndex.push(provenance.sourceFaceIndex[face]);
  }
 }
 const ids=[...used].sort((a,b)=>a-b),bounds=boundaryChecks(triangles,ids,points);
 if(members.length===1)return {geometry:records[members[0]].part.geometry,bounds};
 const local=new Map(ids.map((id,i)=>[id,i])),lines=['PRINJEKT_EXACT_MESH_1',`${ids.length} ${triangles.length}`];let bytes=lines[0].length+lines[1].length+2;
 const append=line=>{bytes+=line.length+1;if(bytes>EXACT_GRID_GROUPING_LIMITS.bytes)throw fail('mesh_byte_limit');lines.push(line);};
 for(const id of ids)append(points[id].join(' '));for(const tri of triangles)append(tri.map(i=>local.get(i)).join(' '));
 const geometry=createExactAuthority({meshText:lines.join('\n')+'\n',origin:records[members[0]].part.geometry.origin,provenance:{operandIndex,sourceFaceIndex}});
 return {geometry,bounds};
}
function calculate(basePartition,bodyGroups,options,materialize){
 // Cheap assignment bounds precede parsing the full authoritative checkpoint.
 const groups=groupShape(bodyGroups,basePartition?.bodyCount),parts=materializeExactGridPartition(basePartition,options);
 if(parts.length!==basePartition.bodyCount||parts.some((part,i)=>part.id!==String(i+1)))throw fail('base_body_ids');
 const {points,records,interfaces,adjacency}=inventory(parts),membership=new Int32Array(parts.length).fill(-1),removed=parts.map(p=>new Uint8Array(p.faceCount));
 const members=groups.map((group,index)=>{const result=group.map(id=>Number(id)-1);if(!connected(result,adjacency))throw fail('no_positive_area_connection');for(const body of result)membership[body]=index;return result;});
 let cancelledInterfaces=0;const perGroup=new Uint32Array(groups.length);
 for(const face of interfaces)if(membership[face.a]===membership[face.b]){
  if(removed[face.a][face.faceA]||removed[face.b][face.faceB])throw fail('duplicate_interface');
  removed[face.a][face.faceA]=1;removed[face.b][face.faceB]=1;perGroup[membership[face.a]]++;cancelledInterfaces++;
 }
 const descriptors=[],result=[],allCells=new Set();let totalBytes=0,totalFaces=0;
 for(let index=0;index<groups.length;index++){
  const cells=members[index].flatMap(i=>parts[i].cells).sort((a,b)=>a-b);
  for(const cell of cells){if(allCells.has(cell))throw fail('duplicate_material_cell');allCells.add(cell);}
  const {geometry,bounds}=emitGroup(members[index],records,points,removed);totalBytes+=geometry.meshText.length;totalFaces+=geometry.faceCount;
  if(totalBytes>EXACT_GRID_GROUPING_LIMITS.bytes||totalFaces>EXACT_GRID_GROUPING_LIMITS.faces)throw fail('aggregate_geometry_limit');
  const descriptor={id:String(index+1),bodyIds:groups[index],cells,bounds,meshHash:geometry.meshHash,authorityHash:geometry.authorityHash,vertexCount:geometry.vertexCount,faceCount:geometry.faceCount,cancelledInterfaceTriangles:perGroup[index],closedOrientedEdges:true,edgeManifold:true};
  descriptors.push(descriptor);if(materialize)result.push({...descriptor,geometry});
 }
 if(allCells.size!==basePartition.materialCells)throw fail('missing_material_cell');
 const metadata={kind:'exactGridGrouping',version:1,frame:'assembly',basePartitionHash:basePartition.authorityHash,baseStateHash:basePartition.stateHash,sourceMeshHash:basePartition.sourceMeshHash,planHash:basePartition.planHash,sourceBodyCount:parts.length,groupCount:groups.length,materialCells:allCells.size,cancelledInterfaceTriangles:cancelledInterfaces,groups:descriptors};
 const review=freeze({...metadata,groupingHash:exactHash(`EXACT_GRID_GROUPING_1\n${JSON.stringify(metadata)}`),reviewRequired:true,printable:false,printPosePending:true});
 return {review,parts:materialize?freeze(result):undefined};
}
function storedGroups(value){
 if(!value||value.kind!=='exactGridGrouping'||!hash.test(value.groupingHash??'')||!Array.isArray(value.groups)||!value.groups.length||value.groups.length>EXACT_GRID_GROUPING_LIMITS.bodies)throw fail('grouping_binding');
 return Array.from(value.groups,g=>{if(!g||!Array.isArray(g.bodyIds))throw fail('body_group');return g.bodyIds;});
}
/** bodyGroups contains each basePartition.parts[].id exactly once. */
export function createExactGridGrouping(basePartition,bodyGroups,options){return calculate(basePartition,bodyGroups,options,false).review;}
export function validateExactGridGrouping(value,basePartition,options){
 const expected=calculate(basePartition,storedGroups(value),options,false).review;if(JSON.stringify(value)!==JSON.stringify(expected))throw fail('grouping_binding');return expected;
}
export function materializeExactGridGrouping(value,basePartition,options){
 const result=calculate(basePartition,storedGroups(value),options,true);if(JSON.stringify(value)!==JSON.stringify(result.review))throw fail('grouping_binding');return result.parts;
}

// An index is an in-memory capability, not a serialized approval. Every call
// to prepare performs the complete authoritative base validation. Private
// arrays are never exposed, and independent full-commit APIs above stay intact.
const groupingIndexes=new WeakMap();
function indexRecord(index){const record=groupingIndexes.get(index);if(!record)throw fail('unknown_index');if(record.disposed)throw fail('disposed_index');return record;}
function subset(bodyIds,count){
 if(!Array.isArray(bodyIds)||!bodyIds.length||bodyIds.length>count)throw fail('candidate_bodies');
 const seen=new Set(),ids=[];for(const id of bodyIds){if(typeof id!=='string'||!/^[1-9]\d{0,3}$/.test(id)||Number(id)>count||seen.has(id))throw fail('candidate_bodies');seen.add(id);ids.push(id);}
 return ids.sort((a,b)=>Number(a)-Number(b));
}
function selectedMembers(record,bodyIds){const ids=subset(bodyIds,record.records.length),members=ids.map(id=>Number(id)-1);if(!connected(members,record.adjacency))throw fail('no_positive_area_connection');return {ids,members};}
function gridFacePlanes(records,points,cuts){
 const planes=[],lookups=cuts.map((axisCuts,axis)=>new Map(axisCuts.map(offset=>{
  const value={schema:'prinjekt-exact-plane-v1',normal:[0,1,2].map(k=>k===axis?'1/1':'0/1'),offset},plane=validateExactPlane({...value,planeHash:exactHash(JSON.stringify(value))}),index=planes.length;planes.push(plane);return [offset,index];
 })));
 const tags=records.map(({part,triangles})=>{
  const tagged=new Int16Array(part.faceCount).fill(-1);
  for(let face=0;face<part.faceCount;face++){
   const tri=Array.from(triangles.subarray(face*3,face*3+3)),[a,b,c]=tri.map(i=>points[i]);
   for(let axis=0;axis<3;axis++)if(lookups[axis].has(a[axis])&&a[axis]===b[axis]&&a[axis]===c[axis]){
    if(nonzeroTriangle(tri,points))tagged[face]=lookups[axis].get(a[axis]);break;
   }
  }
  return tagged;
 });
 return {planes,tags};
}
function volumeEstimate(record,members,removed,bounds){
 const numeric=id=>{
  if(!record.numericStatus[id]){
   try{for(let axis=0;axis<3;axis++)record.numericPoints[id*3+axis]=exactRationalToNumber(parseExactRational(record.points[id][axis])).number;record.numericStatus[id]=1;record.stats.numericVerticesConverted++;}
   catch{record.numericStatus[id]=2;}
  }
  return record.numericStatus[id]===1?record.numericPoints.subarray(id*3,id*3+3):null;
 };
 let center;try{center=[0,1,2].map(axis=>exactRationalToNumber(parseExactRational(bounds[0][axis])).number/2+exactRationalToNumber(parseExactRational(bounds[1][axis])).number/2);}catch{return null;}
 let sum=0,correction=0;
 for(const body of members){const {part,triangles}=record.records[body];for(let face=0;face<part.faceCount;face++)if(!removed[body][face]){
  const p=numeric(triangles[face*3]),q=numeric(triangles[face*3+1]),r=numeric(triangles[face*3+2]);if(!p||!q||!r)return null;
  const ax=p[0]-center[0],ay=p[1]-center[1],az=p[2]-center[2],bx=q[0]-center[0],by=q[1]-center[1],bz=q[2]-center[2],cx=r[0]-center[0],cy=r[1]-center[1],cz=r[2]-center[2];
  const signedSix=ax*(by*cz-bz*cy)+ay*(bz*cx-bx*cz)+az*(bx*cy-by*cx),adjusted=signedSix-correction,next=sum+adjusted;
  if(!Number.isFinite(next))return null;correction=(next-sum)-adjusted;sum=next;
 }}
 const volume=sum/6;return Number.isFinite(volume)&&volume>0?volume:null;
}
/** Prepare once per immutable base/source/plan. A lookalike JSON object cannot
 * reuse this preparation. No geometry cache or posed arrays are retained. */
export function prepareExactGridGroupingIndex(basePartition,options){
 const parts=materializeExactGridPartition(basePartition,options);
 if(parts.length!==basePartition.bodyCount||parts.some((part,i)=>part.id!==String(i+1)))throw fail('base_body_ids');
 const record=inventory(parts),incident=Array.from({length:parts.length},()=>[]);
 for(const face of record.interfaces){incident[face.a].push(face);incident[face.b].push(face);}
 // The full materializer above validated the entire supplied plan/source.
 // Copy just its exact cuts now; the caller may mutate its own object later.
 const cuts=options.plan.cuts.map(axis=>[...axis]),tagged=gridFacePlanes(record.records,record.points,cuts);
 const metadata={schema:'prinjekt-exact-grid-index-v1',version:1,frame:'assembly',basePartitionHash:basePartition.authorityHash,baseStateHash:basePartition.stateHash,sourceMeshHash:basePartition.sourceMeshHash,planHash:basePartition.planHash,bodyCount:parts.length,materialCells:basePartition.materialCells,interfaceTriangles:record.interfaces.length};
 const stats={baseValidations:1,indexedBodies:parts.length,indexedFaces:parts.reduce((sum,p)=>sum+p.faceCount,0),candidateEmissions:0,candidateBodiesVisited:0,candidateFacesVisited:0,neighborQueries:0,incidentInterfacesVisited:0,numericVerticesConverted:0,disposed:false};
 let handle;handle=Object.freeze({...metadata,indexHash:exactHash(`EXACT_GRID_INDEX_1\n${JSON.stringify(metadata)}`),get stats(){return Object.freeze({...groupingIndexes.get(handle).stats});}});
 groupingIndexes.set(handle,{...record,incident,...tagged,numericPoints:new Float64Array(record.points.length*3),numericStatus:new Uint8Array(record.points.length),stats,disposed:false});return handle;
}
/** Only the selected bodies are re-emitted. Candidate bytes and provenance use
 * the same emitter/global coordinate order as the independent full commit. */
export function emitExactGridCandidate(index,bodyIds){
 const record=indexRecord(index),{ids,members}=selectedMembers(record,bodyIds),selected=new Set(members),removed=new Array(record.records.length);let cancelledInterfaceTriangles=0;
 for(const body of members)removed[body]=new Uint8Array(record.records[body].part.faceCount);
 for(const body of members)for(const face of record.incident[body]){
  record.stats.incidentInterfacesVisited++;
  if(face.a!==body||!selected.has(face.b))continue;
  if(removed[face.a][face.faceA]||removed[face.b][face.faceB])throw fail('duplicate_interface');
  removed[face.a][face.faceA]=1;removed[face.b][face.faceB]=1;cancelledInterfaceTriangles++;
 }
 const cells=members.flatMap(body=>record.records[body].part.cells).sort((a,b)=>a-b),planeIds=new Set();
 for(const body of members)for(let face=0;face<record.tags[body].length;face++)if(!removed[body][face]&&record.tags[body][face]>=0)planeIds.add(record.tags[body][face]);
 const {geometry,bounds}=emitGroup(members,record.records,record.points,removed),actualCutPlanes=[...planeIds].sort((a,b)=>a-b).map(i=>record.planes[i]);
 const metadata={schema:'prinjekt-exact-grid-candidate-v1',version:1,frame:'assembly',indexHash:index.indexHash,bodyIds:ids,cells,bounds,meshHash:geometry.meshHash,authorityHash:geometry.authorityHash,vertexCount:geometry.vertexCount,faceCount:geometry.faceCount,actualCutPlanes,cancelledInterfaceTriangles,closedOrientedEdges:true,edgeManifold:true,volumeEstimate:volumeEstimate(record,members,removed,bounds),volumeEstimateScope:'scheduling-only'};
 record.stats.candidateEmissions++;record.stats.candidateBodiesVisited+=members.length;record.stats.candidateFacesVisited+=members.reduce((sum,body)=>sum+record.records[body].part.faceCount,0);
 return freeze({...metadata,geometry,candidateHash:exactHash(`EXACT_GRID_CANDIDATE_1\n${JSON.stringify(metadata)}`),reviewRequired:true,printable:false,printPosePending:true});
}
/** Positive-area contacts with original bodies outside this candidate. The
 * search layer maps these IDs to its current complete group assignment. */
export function exactGridCandidateNeighbors(index,bodyIds){
 const record=indexRecord(index),{ids,members}=selectedMembers(record,bodyIds),selected=new Set(members),counts=new Map();
 for(const body of members)for(const face of record.incident[body]){record.stats.incidentInterfacesVisited++;const other=face.a===body?face.b:face.a;if(!selected.has(other))counts.set(other,(counts.get(other)||0)+1);}
 record.stats.neighborQueries++;
 return freeze({schema:'prinjekt-exact-grid-neighbors-v1',indexHash:index.indexHash,bodyIds:ids,neighbors:[...counts].sort((a,b)=>a[0]-b[0]).map(([body,count])=>({bodyId:String(body+1),interfaceTriangles:count})),reviewRequired:true,printable:false});
}
/** Releases private geometry once; immutable candidates already returned remain
 * valid review data. Late requests on a disposed index fail without rebuilding. */
export function disposeExactGridGroupingIndex(index){
 const record=groupingIndexes.get(index);if(!record)throw fail('unknown_index');if(record.disposed)return false;
 groupingIndexes.set(index,{disposed:true,stats:{...record.stats,disposed:true}});return true;
}
