import {sha256} from '@noble/hashes/sha2.js';

// Offline topology/volume inventory only. No coordinate welding, native calls,
// shell deletion, orientation repair, or saved geometric proof is performed.
const fail=reason=>Object.assign(Error(`Native Teilflächen konnten nicht sicher zugeordnet werden: ${reason}.`),{code:'NATIVE_COMPONENTS_REJECTED',reason});
const sign=n=>n<0n?'negative':n>0n?'positive':'zero';
// Array.every skips holes; malformed sparse arrays must never pass validation.
const everyValue=(array,predicate)=>{for(const value of array)if(!predicate(value))return false;return true;};
function limits(options={}){
 const defaults={maxVertices:2000000,maxTriangles:4000000,maxMergePairs:2000000,maxEdges:6000000,maxIntegerBits:536870912};
 if(!options||typeof options!=='object'||Array.isArray(options))throw fail('invalid_limits');
 const out={...defaults,...options};for(const key of Object.keys(defaults))if(!Number.isSafeInteger(out[key])||out[key]<1||out[key]>defaults[key])throw fail('invalid_limits');return out;
}
function validate(snapshot,options){
 const limit=limits(options);if(snapshot?.version!==1||snapshot.encoding!=='native-f64-triangles')throw fail('invalid_version');
 if(!['source','assembly'].includes(snapshot.frame))throw fail('invalid_frame');
 const {vertices:v,triangles:t,mergeFromVert:from=[],mergeToVert:to=[],contactPlanes:planes=[]}=snapshot;
 if(!Array.isArray(v)||v.length<9||v.length%3||v.length/3>limit.maxVertices||!everyValue(v,Number.isFinite)||!Array.isArray(t)||t.length<3||t.length%3||t.length/3>limit.maxTriangles)throw fail('invalid_mesh_arrays');
 const n=v.length/3,nf=t.length/3,index=i=>Number.isInteger(i)&&i>=0&&i<n;
 if(!everyValue(t,index)||!Array.isArray(from)||!Array.isArray(to)||from.length!==to.length||from.length>limit.maxMergePairs||!everyValue(from,index)||!everyValue(to,index))throw fail('invalid_mesh_indices');
 for(let i=0;i<t.length;i+=3)if(t[i]===t[i+1]||t[i]===t[i+2]||t[i+1]===t[i+2])throw fail('degenerate_triangle_indices');
 for(let i=0;i<from.length;i++)for(let j=0;j<3;j++)if(v[from[i]*3+j]!==v[to[i]*3+j])throw fail('unequal_merged_positions');
 if(!Array.isArray(planes)||planes.length>100000||!everyValue(planes,p=>Array.isArray(p?.normal)&&p.normal.length===3&&everyValue(p.normal,Number.isFinite)&&Number.isFinite(p.offset)&&Math.abs(Math.hypot(...p.normal)-1)<=1e-10))throw fail('invalid_contact_planes');
 return{v,t,from,to,planes,n,nf,frame:snapshot.frame,limit};
}
function fingerprint(d){
 const h=sha256.create(),buf=new Uint8Array(32768),view=new DataView(buf.buffer);let used=0;
 const add=x=>{view.setFloat64(used,x,true);used+=8;if(used===buf.length){h.update(buf);used=0;}};
 add(1);add(d.frame==='source'?0:1);for(const a of [d.v,d.t,d.from,d.to]){add(a.length);for(const x of a)add(x);}add(d.planes.length);for(const p of d.planes)for(const x of [...p.normal,p.offset])add(x);if(used)h.update(buf.subarray(0,used));return Array.from(h.digest(),b=>b.toString(16).padStart(2,'0')).join('');
}
function dsu(n){
 const parent=Uint32Array.from({length:n},(_,i)=>i),rank=new Uint8Array(n);
 const find=i=>{let r=i;while(parent[r]!==r)r=parent[r];while(parent[i]!==i){const next=parent[i];parent[i]=r;i=next;}return r;};
 return{find,union(a,b){a=find(a);b=find(b);if(a===b)return;if(rank[a]<rank[b])[a,b]=[b,a];parent[b]=a;if(rank[a]===rank[b])rank[a]++;}};
}
function topology(d){
 const vertices=dsu(d.n),faces=dsu(d.nf);for(let i=0;i<d.from.length;i++)vertices.union(d.from[i],d.to[i]);
 const roots=Uint32Array.from({length:d.n},(_,i)=>vertices.find(i)),edges=new Map(),collapsed=new Uint8Array(d.nf);
 for(let f=0;f<d.nf;f++)for(let j=0;j<3;j++){
  const a=roots[d.t[f*3+j]],b=roots[d.t[f*3+(j+1)%3]];
  if(a===b){collapsed[f]++;continue;}
  // <= (2,000,000)^2, so the integer edge key is exact as a JS number.
  const key=Math.min(a,b)*d.n+Math.max(a,b),edge=edges.get(key);
  if(edge){faces.union(f,edge.face);edge.count++;edge.winding+=a<b?1:-1;}
  else{if(edges.size>=d.limit.maxEdges)throw fail('edge_limit');edges.set(key,{face:f,count:1,winding:a<b?1:-1});}
 }
 const componentByRoot=new Map(),components=[],faceOwner=new Uint32Array(d.nf);
 for(let f=0;f<d.nf;f++){const root=faces.find(f);let c=componentByRoot.get(root);if(c===undefined){c=components.length;componentByRoot.set(root,c);components.push({index:c,triangles:[],boundaryEdges:0,nonManifoldEdges:0,inconsistentlyOrientedEdges:0,collapsedIndexEdges:0});}components[c].triangles.push(f);components[c].collapsedIndexEdges+=collapsed[f];faceOwner[f]=c;}
 for(const edge of edges.values()){const c=components[faceOwner[edge.face]];if(edge.count===1)c.boundaryEdges++;if(edge.count!==2)c.nonManifoldEdges++;if(edge.winding!==0)c.inconsistentlyOrientedEdges++;}
 for(const c of components)c.closed=c.nonManifoldEdges===0&&c.inconsistentlyOrientedEdges===0&&c.collapsedIndexEdges===0;
 return{roots,components,faceOwner};
}
function decode(x,view){
 if(x===0)return{n:0n,e:0};view.setFloat64(0,x,false);const bits=view.getBigUint64(0,false),exponent=Number(bits>>52n&2047n),mantissa=bits&((1n<<52n)-1n);
 return{n:(bits>>63n?-1n:1n)*(exponent?mantissa+(1n<<52n):mantissa),e:exponent?exponent-1075:-1074};
}
function exactCoordinates(d){
 const view=new DataView(new ArrayBuffer(8));let exponent=0;
 for(const x of d.v){const p=decode(x,view);if(p.n&&p.e<exponent)exponent=p.e;}
 let bits=0;const integers=[];
 for(const x of d.v){const p=decode(x,view);if(p.n){bits+=53+p.e-exponent;if(bits>d.limit.maxIntegerBits)throw fail('integer_work_limit');}integers.push(p.n?p.n<<BigInt(p.e-exponent):0n);}
 return{integers,exponent};
}
/** Edge-connected components of literal indexed faces. Vertex-only contacts
 * are deliberately separate components; selection cannot sever their shared
 * index/explicit-merge class. `closed` is an indexed oriented-edge test, not a
 * self-intersection, shell-containment or independent native-validity proof. */
export function inventNativeComponents(snapshot,options={}){
 const d=validate(snapshot,options),graph=topology(d),{integers:p,exponent}=exactCoordinates(d);let total=0n;
 const components=graph.components.map(c=>{
  let six=0n;const bounds={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};
  for(const f of c.triangles){const ids=[d.t[f*3],d.t[f*3+1],d.t[f*3+2]],a=ids[0]*3,b=ids[1]*3,e=ids[2]*3;
   six+=p[a]*(p[b+1]*p[e+2]-p[b+2]*p[e+1])+p[a+1]*(p[b+2]*p[e]-p[b]*p[e+2])+p[a+2]*(p[b]*p[e+1]-p[b+1]*p[e]);
   for(const id of ids)for(let j=0;j<3;j++){bounds.min[j]=Math.min(bounds.min[j],d.v[id*3+j]);bounds.max[j]=Math.max(bounds.max[j],d.v[id*3+j]);}
  }
  total+=six;return{...c,bounds,volumeSign:sign(six),signedVolume:{numerator:six.toString(),binaryExponent:exponent*3,denominator:6}};
 });
 return{version:1,sourceHash:fingerprint(d),vertexCount:d.n,triangleCount:d.nf,explicitMergePairs:d.from.length,coordinateWeldingUsed:false,components,summary:{components:components.length,positive:components.filter(c=>c.volumeSign==='positive').length,negative:components.filter(c=>c.volumeSign==='negative').length,zero:components.filter(c=>c.volumeSign==='zero').length,nonClosed:components.filter(c=>!c.closed).length},totalVolumeSign:sign(total)};
}
/** Select entire components without changing points, winding or multiplicity.
 * Membership is rebuilt from source indices; no saved sign/proof flag controls
 * extraction. Fingerprints reject stale inputs but are not authorizations.
 * No native validity is implied: restoreNativeGeometry must still check output. */
export function selectNativeComponents(snapshot,inventory,indices,options={}){
 const d=validate(snapshot,options);
 if(!inventory||inventory.version!==1||inventory.sourceHash!==fingerprint(d)||inventory.vertexCount!==d.n||inventory.triangleCount!==d.nf||!Array.isArray(inventory.components))throw fail('stale_or_invalid_inventory');
 if(!Array.isArray(indices)||indices.length>inventory.components.length||!everyValue(indices,i=>Number.isInteger(i)&&i>=0&&i<inventory.components.length)||new Set(indices).size!==indices.length)throw fail('invalid_selection');
 const graph=topology(d);if(inventory.components.length!==graph.components.length)throw fail('invalid_component_membership');
 for(let i=0;i<graph.components.length;i++){const actual=graph.components[i],given=inventory.components[i];if(given?.index!==i||!Array.isArray(given.triangles)||given.triangles.length!==actual.triangles.length)throw fail('invalid_component_membership');for(let j=0;j<actual.triangles.length;j++)if(given.triangles[j]!==actual.triangles[j])throw fail('invalid_component_membership');}
 if(!indices.length)return null;
 const selected=new Set(indices),classSelection=new Uint8Array(d.n),usedClass=new Uint8Array(d.n);
 for(let f=0;f<d.nf;f++){const state=selected.has(graph.faceOwner[f])?1:2;for(let j=0;j<3;j++){const root=graph.roots[d.t[f*3+j]];classSelection[root]|=state;if(classSelection[root]===3)throw fail('shared_vertex_class_crosses_selection');if(state===1)usedClass[root]=1;}}
 const remap=new Int32Array(d.n).fill(-1),vertices=[],triangles=[],mergeFromVert=[],mergeToVert=[];
 // Include all records of each selected merge class, even when a particular
 // record is not referenced by a triangle. Never silently cut a merge relation.
 for(let i=0;i<d.n;i++)if(usedClass[graph.roots[i]]){remap[i]=vertices.length/3;vertices.push(d.v[i*3],d.v[i*3+1],d.v[i*3+2]);}
 for(let f=0;f<d.nf;f++)if(selected.has(graph.faceOwner[f]))triangles.push(remap[d.t[f*3]],remap[d.t[f*3+1]],remap[d.t[f*3+2]]);
 for(let i=0;i<d.from.length;i++){const a=remap[d.from[i]],b=remap[d.to[i]];if((a<0)!==(b<0))throw fail('partial_merge_class');if(a>=0){mergeFromVert.push(a);mergeToVert.push(b);}}
 return{version:1,encoding:'native-f64-triangles',frame:d.frame,contactPlanes:d.planes.map(p=>({normal:[...p.normal],offset:p.offset})),vertices,triangles,mergeFromVert,mergeToVert};
}
