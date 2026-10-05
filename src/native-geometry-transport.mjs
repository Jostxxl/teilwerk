// Conditional lossless transport of a native triangulated surface. The installed
// JS Mesh binding accepts Float32 positions only. A normalized carrier supplies
// topology; warp restores the saved binary64 positions. Distinct source points
// sharing a Float32 cell may use separate temporary carrier positions. Any final
// collapse or changed oriented triangle is an error, never rounded acceptance.
// This is geometry transport, NOT a saved collision/material/stability proof.
const fatal=e=>e?.name==='RuntimeError'||/Aborted|memory access out of bounds|unreachable|RuntimeError/i.test(e?.message||'');
const pointKey=p=>p.map(x=>Object.is(x,-0)?'0':String(x)).join(',');
const vector=p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite);
const samePoint=(a,b)=>a.every((x,i)=>x===b[i]);
function error(reason){return Object.assign(Error(`Native Geometrie konnte nicht exakt übertragen werden: ${reason}.`),{code:'NATIVE_TRANSPORT_REJECTED',reason});}
function lifecycle(){
 const owned=new Set();let poisoned=false;
 const call=fn=>{try{return fn();}catch(e){if(fatal(e))poisoned=true;throw e;}};
 const keep=s=>{owned.add(s);return s;};
 const drop=s=>{if(s&&owned.delete(s)&&!poisoned)call(()=>s.delete());};
 const dispose=()=>{if(poisoned)return;let ordinary;for(const s of [...owned].reverse())try{drop(s);}catch(e){if(poisoned)throw e;ordinary??=e;}if(ordinary)throw ordinary;};
 return{call,keep,drop,dispose,abandon:()=>{poisoned=true;owned.clear();}};
}
function metadata({frame,contactPlanes=[]}){
 if(!['assembly','source'].includes(frame)||!Array.isArray(contactPlanes)||contactPlanes.length>100000)throw error('invalid_frame_metadata');
 const planes=contactPlanes.map(p=>{if(!vector(p?.normal)||!Number.isFinite(p.offset)||Math.abs(Math.hypot(...p.normal)-1)>1e-10)throw error('invalid_contact_plane');return{normal:[...p.normal],offset:p.offset};});
 // Preserve literal source-frame planes. Renormalizing or converting them from
 // print coordinates would introduce precisely the seam error being avoided.
 return{frame,contactPlanes:planes};
}
function limits({maxVertices=2000000,maxTriangles=4000000}={}){
 if(!Number.isInteger(maxVertices)||maxVertices<4||maxVertices>16777216||!Number.isInteger(maxTriangles)||maxTriangles<4)throw error('invalid_limits');
 return{maxVertices,maxTriangles};
}
function triangleKeys(triangles,ids){
 const out=[];for(let i=0;i<triangles.length;i+=3){const p=[0,1,2].map(j=>ids?ids[triangles[i+j]]:triangles[i+j]);let k=0;if(p[1]<p[k])k=1;if(p[2]<p[k])k=2;out.push(`${p[k]},${p[(k+1)%3]},${p[(k+2)%3]}`);}return out.sort();
}
function sameTriangles(expected,triangles,ids){const actual=triangleKeys(triangles,ids);return actual.length===expected.length&&actual.every((v,i)=>v===expected[i]);}
function coordinateTriangles(vertices,triangles){
 const keys=Array.from({length:vertices.length/3},(_,i)=>pointKey(vertices.slice(i*3,i*3+3))),out=[];
 for(let i=0;i<triangles.length;i+=3){const p=[0,1,2].map(j=>keys[triangles[i+j]]);out.push([p.join('|'),[p[1],p[2],p[0]].join('|'),[p[2],p[0],p[1]].join('|')].sort()[0]);}
 // A sorted array, not a Set: duplicate oriented faces must not disappear.
 return out.sort();
}
function validateData(snapshot,options){
 const limit=limits(options);if(snapshot?.version!==1||snapshot.encoding!=='native-f64-triangles')throw error('invalid_version');
 const meta=metadata(snapshot),{vertices,triangles,mergeFromVert=[],mergeToVert=[]}=snapshot;
 if(!Array.isArray(vertices)||vertices.length%3||vertices.length<12||vertices.length/3>limit.maxVertices||!vertices.every(Number.isFinite)||!Array.isArray(triangles)||triangles.length%3||triangles.length<12||triangles.length/3>limit.maxTriangles)throw error('invalid_mesh_arrays');
 const count=vertices.length/3,index=i=>Number.isInteger(i)&&i>=0&&i<count;
 if(!triangles.every(index)||!Array.isArray(mergeFromVert)||!Array.isArray(mergeToVert)||mergeFromVert.length!==mergeToVert.length||!mergeFromVert.every(index)||!mergeToVert.every(index))throw error('invalid_mesh_indices');
 for(let i=0;i<triangles.length;i+=3)if(new Set(triangles.slice(i,i+3)).size!==3)throw error('degenerate_triangle_indices');
 for(let i=0;i<mergeFromVert.length;i++)if(![0,1,2].every(j=>vertices[3*mergeFromVert[i]+j]===vertices[3*mergeToVert[i]+j]))throw error('unequal_merged_positions');
 return{...meta,vertices,triangles,mergeFromVert,mergeToVert,count};
}

// This only gives aliased Float32 carrier records distinct temporary addresses.
// It never changes source points/triangles. All native constructor, warp and
// exact post-warp checks below remain mandatory; no native retry is attempted.
function separateCarrierAliases(points,props,lookup,collisionKeys){
 const maxAliases=65536,maxAttempts=2000000,spacing=1e-7,groups=new Map(),occupied=new Set(lookup.keys());
 let aliases=0,attempts=0;
 for(let i=0;i<points.length;i++){
  const carrier=Array.from(props.subarray(i*4,i*4+3)),key=pointKey(carrier);if(!collisionKeys.has(key))continue;
  let bucket=groups.get(key);if(!bucket){bucket=new Map();groups.set(key,bucket);}
  const exactKey=pointKey(points[i]);let entry=bucket.get(exactKey);
  if(!entry){if(++aliases>maxAliases)throw error('carrier_alias_limit');entry={point:points[i],carrier,indices:[]};bucket.set(exactKey,entry);}
  entry.indices.push(i);
 }
 // Keep every original cell reserved, including colliding ones, throughout the
 // search. Earlier assignments can therefore never be overwritten by a later
 // group's bookkeeping. Unexpected old-cell vertices also fail the warp lookup.
 for(const key of collisionKeys)lookup.delete(key);
 for(const bucket of groups.values()){
  const entries=[...bucket.values()],lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
  for(const {point}of entries)for(let j=0;j<3;j++){lo[j]=Math.min(lo[j],point[j]);hi[j]=Math.max(hi[j],point[j]);}
  let axis=0;for(let j=1;j<3;j++)if(hi[j]-lo[j]>hi[axis]-lo[axis])axis=j;
  entries.sort((a,b)=>{for(let j=0;j<3;j++)if(a.point[j]!==b.point[j])return a.point[j]<b.point[j]?-1:1;return 0;});
  for(let rank=0;rank<entries.length;rank++){
   const entry=entries[rank];let chosen=null,key;
   for(let attempt=0;attempt<128;attempt++){
    if(++attempts>maxAttempts)throw error('carrier_search_limit');
    const carrier=[...entry.carrier],offset=rank-(entries.length-1)/2+attempt*entries.length;
    carrier[axis]=Math.fround(carrier[axis]+offset*spacing);key=pointKey(carrier);
    if(carrier.every(Number.isFinite)&&!occupied.has(key)){chosen=carrier;break;}
   }
   if(!chosen)throw error('carrier_collision');occupied.add(key);lookup.set(key,entry.point);
   // Identical original positions/property-seam records share one carrier but
   // retain their individual ID properties and merge records.
   for(const id of entry.indices)props.set(chosen,id*4);
  }
 }
}

function fragileCarrierTriangle(props,triangles,{allowThin=true}={}){
 // Installed Manifold 3.2.1 Impl::SetEpsilon(useSingle) uses float epsilon
 // times Box::Scale() (maximum absolute bound coordinate) as its minimum
 // simplification tolerance. A nonzero but thinner carrier triangle can change
 // vertices or faces BEFORE warp. This only selects a temporary
 // representation; final coordinates/topology still require exact equality.
 let scale=0;for(let i=0;i<props.length;i++)if(i%4<3)scale=Math.max(scale,Math.abs(props[i]));
 const tolerance=2**-23*scale;
 for(let i=0;i<triangles.length;i+=3){
  const a=triangles[i]*4,b=triangles[i+1]*4,c=triangles[i+2]*4,
   ux=props[b]-props[a],uy=props[b+1]-props[a+1],uz=props[b+2]-props[a+2],
   vx=props[c]-props[a],vy=props[c+1]-props[a+1],vz=props[c+2]-props[a+2];
  const cross=Math.hypot(uy*vz-uz*vy,uz*vx-ux*vz,ux*vy-uy*vx),
   longest=Math.max(Math.hypot(ux,uy,uz),Math.hypot(vx,vy,vz),Math.hypot(vx-ux,vy-uy,vz-uz));
  if(cross===0||allowThin&&cross<=tolerance*longest)return true;
 }
 return false;
}

// Native surfaces can retain distinct topological vertices at identical actual
// positions, including literal zero-edge triangles. The Float32 constructor
// would simplify those triangles before warp. Give every topological vertex a
// distinct temporary address, sharing ONLY explicit mergeFrom/to classes. The
// final original positions, winding and all zero-area faces must still survive
// every exact check below. This embedding is not itself a geometry-validity proof.
function topologicalCarrier(points,props,lookup,mergeFromVert,mergeToVert){
 const parent=Uint32Array.from({length:points.length},(_,i)=>i),byClass=new Map();let attempts=0;
 const root=id=>{let at=id;while(parent[at]!==at)at=parent[at];while(parent[id]!==id){const next=parent[id];parent[id]=at;id=next;}return at;};
 for(let i=0;i<mergeFromVert.length;i++){const a=root(mergeFromVert[i]),b=root(mergeToVert[i]);if(a!==b)parent[Math.max(a,b)]=Math.min(a,b);}
 const hash32=x=>{x^=x>>>16;x=Math.imul(x,0x7feb352d);x^=x>>>15;x=Math.imul(x,0x846ca68b);x^=x>>>16;return x>>>0;};
 lookup.clear();
 for(let i=0;i<points.length;i++){
  const id=root(i);let carrier=byClass.get(id);
  if(!carrier){
   const index=byClass.size;if(index>=2000000)throw error('topological_carrier_limit');
   for(let attempt=0;attempt<16;attempt++){
    if(++attempts>4000000)throw error('topological_carrier_search_limit');
    // These dyadic addresses are exactly representable as Float32 and stay in
    // [-.5,.5), matching the normalized carrier scale. Larger temporary bounds
    // would permanently inflate the native tolerance inherited through warp.
    // Seed and class order are fixed; occupied addresses are never reassigned.
    const candidate=[0,1,2].map(j=>((hash32(1^Math.imul(index+1,0x9e3779b9)^Math.imul(j+1,0x85ebca6b)^Math.imul(attempt,0xc2b2ae35))&16383)-8192)/16384),key=pointKey(candidate);
    if(!lookup.has(key)){carrier=candidate;lookup.set(key,points[i]);byClass.set(id,carrier);break;}
   }
   if(!carrier)throw error('topological_carrier_collision');
  }
  props.set(carrier,i*4);
 }
}

/** Borrowed source handle is unchanged. Returns JSON-compatible source-frame
 * coordinates and topology, with no reusable native handle or proof flag. */
export function snapshotNativeGeometry(api,solid,options={}){
 const meta=metadata(options),limit=limits(options);if(!api?.Manifold||!solid?.setProperties)throw error('invalid_native_source');
 const life=lifecycle(),{call,keep,drop}=life;let failure;
 try{
  if(call(()=>solid.status())!=='NoError')throw error('invalid_native_source');
  const volume=call(()=>solid.volume());if(!Number.isFinite(volume)||volume<=0)throw error('invalid_native_source');
  if(call(()=>solid.numVert())>limit.maxVertices||call(()=>solid.numTri())>limit.maxTriangles)throw error('mesh_limit');
  const positions=[];const tagged=keep(call(()=>solid.setProperties(1,(prop,p)=>{prop[0]=positions.length;positions.push([...p]);}))),mesh=call(()=>tagged.getMesh());
  if(mesh.numVert>limit.maxVertices||mesh.numTri>limit.maxTriangles||positions.length>16777216)throw error('mesh_limit');
  const vertices=[];for(let i=0;i<mesh.numVert;i++){const id=mesh.vertProperties[i*mesh.numProp+3];if(!Number.isInteger(id)||!positions[id])throw error('invalid_native_vertex_tag');vertices.push(...positions[id]);}
  const snapshot={version:1,encoding:'native-f64-triangles',...meta,vertices,triangles:Array.from(mesh.triVerts),mergeFromVert:Array.from(mesh.mergeFromVert||[]),mergeToVert:Array.from(mesh.mergeToVert||[])};
  validateData(snapshot,options);drop(tagged);return snapshot;
 }catch(e){failure=e;throw e;}finally{try{life.dispose();}catch(e){if(!failure||fatal(e))throw e;}}
}

/** Returns a newly owned native solid; dispose() is idempotent. After a fatal
 * downstream WASM error abandon() instead: a poisoned kernel must not be called.
 * Stored flags, volumes and validation fields are ignored. Contact planes are
 * frame-preserved hints, not proof that a face or a free insertion path exists.
 * Temporary carrier ID properties are removed before returning the solid;
 * retaining them would create property seams in subsequent native booleans.
 * Exact surface equality and native topology are checked; as with native warp,
 * this is not an independent self-intersection proof for arbitrary edited files.
 * Some native alias/property-seam combinations remain untransportable and are
 * rejected if repeated materialization yields an inconsistent merge table. */
export function restoreNativeGeometry(api,snapshot,options={}){
 const data=validateData(snapshot,options);if(typeof api?.Mesh!=='function'||typeof api?.Manifold!=='function')throw error('invalid_native_api');
 const points=Array.from({length:data.count},(_,i)=>data.vertices.slice(i*3,i*3+3)),lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
 for(const p of points)for(let j=0;j<3;j++){lo[j]=Math.min(lo[j],p[j]);hi[j]=Math.max(hi[j],p[j]);}
 const center=lo.map((x,i)=>x+(hi[i]-x)/2),scale=Math.max(...hi.map((x,i)=>x-lo[i]));if(!Number.isFinite(scale)||scale<=0||!center.every(Number.isFinite))throw error('unrepresentable_bounds');
 const props=new Float32Array(data.count*4),lookup=new Map(),collisionKeys=new Set();
 for(let i=0;i<data.count;i++){
  const carrier=points[i].map((x,j)=>Math.fround((x-center[j])/scale));if(!carrier.every(Number.isFinite))throw error('nonfinite_carrier');
  const key=pointKey(carrier),old=lookup.get(key);if(old&&!samePoint(old,points[i]))collisionKeys.add(key);lookup.set(key,points[i]);props.set([...carrier,i],i*4);
 }
 if(collisionKeys.size)separateCarrierAliases(points,props,lookup,collisionKeys);
 // Select before entering the kernel; never retry a failed native constructor.
 // Preserve existing nonzero property-seam carrier behavior: topological
 // restoration cannot yet safely retain residual explicit merge tables.
 // Nonthin normalized/alias-separated carriers remain byte-identical.
 const usesTopologicalCarrier=fragileCarrierTriangle(props,data.triangles,{allowThin:data.mergeFromVert.length===0});
 if(usesTopologicalCarrier)topologicalCarrier(points,props,lookup,data.mergeFromVert,data.mergeToVert);
 const expected=triangleKeys(data.triangles),life=lifecycle(),{call,keep,drop}=life;let success=false,failure;
 function checkTaggedMesh(solid,{exact=false}={}){
  const actualById=new Map();let badPosition=false;let tagged=solid;
  if(exact)tagged=keep(call(()=>solid.setProperties(1,(prop,p,old)=>{const id=old[0];prop[0]=id;if(!Number.isInteger(id)||id<0||id>=data.count||!samePoint(points[id],p)||actualById.has(id)&&!samePoint(actualById.get(id),p))badPosition=true;actualById.set(id,[...p]);})));
  try{
   const mesh=call(()=>tagged.getMesh());if(mesh.numVert!==data.count||mesh.numTri!==data.triangles.length/3)throw error('changed_topology_count');
   const ids=[];for(let i=0;i<mesh.numVert;i++){const id=mesh.vertProperties[i*mesh.numProp+3];if(!Number.isInteger(id)||id<0||id>=data.count)throw error('unknown_vertex_tag');ids.push(id);}
   if(new Set(ids).size!==data.count||badPosition||exact&&actualById.size!==data.count)throw error('changed_exact_vertices');
   if(!sameTriangles(expected,mesh.triVerts,ids))throw error('changed_oriented_triangles');
  }finally{if(tagged!==solid)drop(tagged);}
 }
 try{
  const mesh=call(()=>new api.Mesh({numProp:4,vertProperties:props,triVerts:new Uint32Array(data.triangles),mergeFromVert:new Uint32Array(data.mergeFromVert),mergeToVert:new Uint32Array(data.mergeToVert),faceID:Uint32Array.from({length:data.triangles.length/3},(_,i)=>i)}));
  const carrier=keep(call(()=>new api.Manifold(mesh)));if(call(()=>carrier.status())!=='NoError')throw error('invalid_carrier_topology');checkTaggedMesh(carrier);
  let unknown=false;const taggedSolid=keep(call(()=>carrier.warp(p=>{const exact=lookup.get(pointKey(p));if(!exact){unknown=true;return;}for(let i=0;i<3;i++)p[i]=exact[i];})));
  if(unknown||call(()=>taggedSolid.status())!=='NoError')throw error('invalid_restored_geometry');checkTaggedMesh(taggedSolid,{exact:true});
  const solid=keep(call(()=>taggedSolid.setProperties(0,()=>{})));
  const volume=call(()=>solid.volume()),box=call(()=>solid.boundingBox());if(!Number.isFinite(volume)||volume<=0)throw error('invalid_restored_volume');
  if(!samePoint(box.min,lo)||!samePoint(box.max,hi))throw error('changed_exact_bounds');
  // Property seams may collapse coincident vertex records. Verify material
  // coordinates and winding independently of vertex IDs/counts after stripping.
  const cleanSnapshot=call(()=>snapshotNativeGeometry(api,solid,{...options,frame:data.frame,contactPlanes:data.contactPlanes})),before=coordinateTriangles(data.vertices,data.triangles),after=coordinateTriangles(cleanSnapshot.vertices,cleanSnapshot.triangles);
  if(before.length!==after.length||before.some((key,i)=>key!==after[i]))throw error('changed_stripped_oriented_triangles');
  // Residual property seams in this new representation have shown unstable
  // merge indices across later getMesh calls in the installed kernel. Refuse
  // that combination rather than promising stability after an arbitrary number
  // of reads. Normalized and alias-only carrier behavior remains unchanged.
  if(usesTopologicalCarrier&&(cleanSnapshot.mergeFromVert.length||cleanSnapshot.mergeToVert.length))throw error('unsupported_topological_merge_table');
  if(collisionKeys.size||usesTopologicalCarrier){
   // In the installed kernel, aliasing combined with property seams can expose
   // an inconsistent merge table only AFTER the first getMesh materialization.
   // Re-read and validate it before returning success. Do not fix/weld the table
   // or reuse the first snapshot when the second native observation disagrees.
   const repeated=call(()=>snapshotNativeGeometry(api,solid,{...options,frame:data.frame,contactPlanes:data.contactPlanes})),again=coordinateTriangles(repeated.vertices,repeated.triangles);
   if(before.length!==again.length||before.some((key,i)=>key!==again[i]))throw error('changed_repeated_oriented_triangles');
   if(usesTopologicalCarrier&&(repeated.mergeFromVert.length||repeated.mergeToVert.length))throw error('unsupported_topological_merge_table');
  }
  drop(taggedSolid);drop(carrier);success=true;return{solid,frame:data.frame,contactPlanes:data.contactPlanes,validation:{exactVertices:true,orientedTrianglesUnchanged:true,transportPropertiesRemoved:true,nativeStatus:'NoError',vertices:cleanSnapshot.vertices.length/3,triangles:data.triangles.length/3,volume,bounds:box,precision:'native-float64',savedProofsUsed:false},dispose:life.dispose,abandon:life.abandon};
 }catch(e){failure=e;throw e;}finally{if(!success)try{life.dispose();}catch(e){if(!failure||fatal(e))throw e;}}
}
