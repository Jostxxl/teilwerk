import {Matrix4} from 'three';
import {validateExactAuthority,createExactAuthority,parseExactMesh,exactRational,exactRationalString,exactHash,EXACT_GEOMETRY_LIMITS} from './exact-geometry.mjs';
import {reviewExactPrintPoses,validateExactPrintPoseReview} from './exact-pose-review.mjs';
import {validateExactMarkPlan} from './exact-mark-plan.mjs';
import {transferExactInteriorPermission} from './exact-interior-permission.mjs';
import {restoreExactProjectPart,serializeExactProjectPart,createExactProjectContext,getExactProjectPermission,createExactProjectPart} from './exact-project.mjs';

// Three trusted native results are retained, rather than a saved "engraved"
// flag. Their exact oriented surface chain is checked on every project load.
// This does not independently recompute the native arrangement or prove that
// an arbitrary input boundary is an embedded, physically printable solid.
export const EXACT_MACHINING_LIMITS=Object.freeze({bytes:256*1024*1024,faces:1_500_000,tests:4_000_000,durationMs:120_000,rationalBits:4096});
const fail=reason=>Object.assign(Error(`Exakte Gravur ungültig: ${reason}.`),{code:'EXACT_MACHINING_REJECTED',reason});
const freeze=v=>{if(v&&typeof v==='object'&&!Object.isFrozen(v)){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const zero=[0n,1n],add=(a,b)=>exactRational(a[0]*b[1]+b[0]*a[1],a[1]*b[1]),sub=(a,b)=>exactRational(a[0]*b[1]-b[0]*a[1],a[1]*b[1]),mul=(a,b)=>exactRational(a[0]*b[0],a[1]*b[1]);
const div=(a,b)=>{if(!b[0])throw fail('zero_divisor');return exactRational(a[0]*b[1]*(b[0]<0n?-1n:1n),a[1]*(b[0]<0n?-b[0]:b[0]));};
const delta=(a,b)=>a.map((x,k)=>sub(x,b[k])),dot=(a,b)=>a.reduce((s,x,k)=>add(s,mul(x,b[k])),zero);
const cross=(a,b)=>[sub(mul(a[1],b[2]),mul(a[2],b[1])),sub(mul(a[2],b[0]),mul(a[0],b[2])),sub(mul(a[0],b[1]),mul(a[1],b[0]))];
const normal=p=>cross(delta(p[1],p[0]),delta(p[2],p[0])),same=(a,b)=>a.every((q,k)=>q[0]===b[k][0]&&q[1]===b[k][1]);
function detached(value){let bytes=0,nodes=0;const active=new Set(),charge=n=>{bytes+=n;if(bytes>EXACT_MACHINING_LIMITS.bytes)throw fail('record_bytes');};function walk(v,depth){if(v===null||typeof v==='boolean'){charge(4);return v;}if(typeof v==='number'){if(!Number.isFinite(v))throw fail('nonfinite');charge(8);return v;}if(typeof v==='string'){charge(v.length*3+2);return v;}if(v===undefined)return undefined;if(!v||typeof v!=='object'||depth>80||++nodes>1_000_000||active.has(v))throw fail('record_structure');if(ArrayBuffer.isView(v)){if(!(v instanceof Float32Array||v instanceof Float64Array||v instanceof Uint32Array))throw fail('array_type');charge(v.length*8);return Array.from(v,x=>{if(!Number.isFinite(x))throw fail('nonfinite');return x;});}const array=Array.isArray(v),proto=Object.getPrototypeOf(v);if(array?proto!==Array.prototype:proto!==Object.prototype&&proto!==null)throw fail('record_prototype');const names=Reflect.ownKeys(v);if(array&&names.length!==v.length+1)throw fail('sparse_array');active.add(v);const out=array?[]:{};for(const k of names){if(array&&k==='length')continue;if(typeof k!=='string'||['__proto__','constructor','prototype','toJSON'].includes(k))throw fail('record_keys');const d=Object.getOwnPropertyDescriptor(v,k);if(!d?.enumerable||!Object.hasOwn(d,'value'))throw fail('record_accessor');charge(k.length*3+2);out[k]=walk(d.value,depth+1);}active.delete(v);return out;}return walk(value,0);}
function budget(options={}){const limits={...EXACT_MACHINING_LIMITS};if(options.limits)for(const[k,v]of Object.entries(options.limits)){if(!Object.hasOwn(limits,k)||!Number.isSafeInteger(v)||v<1||v>limits[k])throw fail('limits');limits[k]=v;}const start=Date.now();let tests=0;return{limits,check(){if(options.signal?.aborted)throw fail('aborted');if(Date.now()-start>limits.durationMs)throw fail('time_limit');},test(){if(++tests>limits.tests)throw fail('work_limit');if((tests&255)===0)this.check();},get tests(){return tests;}};}
function parsed(a,c){const m=parseExactMesh(a.meshText,{requireCanonical:true});if(m.faceCount>c.limits.faces)throw fail('face_limit');for(const p of m.vertices)for(const q of p)if(q.some(n=>(n<0n?-n:n).toString(2).length>c.limits.rationalBits))throw fail('rational_work_limit');return m;}
const nonzero=p=>p.length>=3&&p.slice(1,-1).some((x,i)=>normal([p[0],x,p[i+2]]).some(q=>q[0]!==0n));
function equalTriangle(a,b){return a.some((_,start)=>a.every((p,k)=>same(p,b[(start+k)%3])));}
// An oriented planar triangle chain has compact support. Its boundary uniquely
// determines its area multiplicity (the plane has no nonzero compact 2-cycle).
// Birth-subset and orientation checks run BEFORE this comparison. Thus equal
// boundary chains prove full pointwise coverage, including multiplicity, rather
// than merely equal total area. Rational line/endpoint events also cancel T-
// junctions and different triangulations without explosive polygon subtraction.
function samePlanarChain(parent,positive,negative,c){
 const n=normal(parent),drop=n.findIndex(q=>q[0]!==0n);if(drop<0)throw fail('degenerate_birth_face');const axes=[0,1,2].filter(k=>k!==drop),events=new Map();
 const event=(line,t,value)=>{const key=`${line}|${exactRationalString(t)}`,next=(events.get(key)||0)+value;if(next)events.set(key,next);else events.delete(key);};
 for(const [triangles,sign]of [[positive,1],[negative,-1]])for(const tri of triangles){c.test();for(let edge=0;edge<3;edge++){const p=tri[edge],q=tri[(edge+1)%3],a=axes.map(k=>p[k]),b=axes.map(k=>q[k]),dx=sub(b[0],a[0]),dy=sub(b[1],a[1]);if(!dx[0]&&!dy[0])throw fail('collapsed_boundary_edge');let line,t,u;if(dx[0]){const slope=div(dy,dx),intercept=sub(a[1],mul(slope,a[0]));line=`x:${exactRationalString(slope)}:${exactRationalString(intercept)}`;t=a[0];u=b[0];}else{line=`y:${exactRationalString(a[0])}`;t=a[1];u=b[1];}event(line,t,sign);event(line,u,-sign);}}
 return events.size===0;
}
function exactCover(parent,triangles,c){if(triangles.length===1&&equalTriangle(parent,triangles[0]))return;if(!samePlanarChain(parent,triangles,[parent],c))throw fail('source_surface_chain_mismatch');}
function reciprocal(parent,a,b,c){if(!a.length&&!b.length)return;if(!samePlanarChain(parent,a,b,c))throw fail('nonreciprocal_cutter_surface');}
function subset(tri,original,orientation){const n=normal(original),m=normal(tri);if(n.every(q=>q[0]===0n)||dot(n,m)[0]*BigInt(orientation)<=0n)throw fail('birth_orientation');for(const p of tri){if(dot(n,delta(p,original[0]))[0]!==0n)throw fail('birth_plane');for(let k=0;k<3;k++)if(dot(n,cross(delta(original[(k+1)%3],original[k]),delta(p,original[k])))[0]<0n)throw fail('birth_subset');}}
const floorDiv=(a,b)=>a>=0n?a/b:-((-a+b-1n)/b);
// Rigorous dyadic enclosure of each rational determinant avoids a global LCM.
// Neither the sign nor a nonempty result is inferred from Float64 volume.
function topology(mesh,c,{single=false,positiveComponents=false}={}){
 if(!mesh.faceCount||!mesh.vertexCount)throw fail('empty_material');
 const edges=new Map(),parent=Int32Array.from({length:mesh.faceCount},(_,i)=>i),incident=Array.from({length:mesh.vertexCount},()=>[]),root=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;};
 for(let f=0;f<mesh.faceCount;f++){c.test();const ids=mesh.triangles[f],tri=ids.map(i=>mesh.vertices[i]);if(!nonzero(tri))throw fail('degenerate_material_face');for(let k=0;k<3;k++){const a=ids[k],b=ids[(k+1)%3],key=Math.min(a,b)*mesh.vertexCount+Math.max(a,b);if(!edges.has(key))edges.set(key,[]);edges.get(key).push({face:f,direction:a<b?1:-1});incident[a].push(f);}}
 const neighbors=Array.from({length:mesh.faceCount},()=>[]);for(const es of edges.values()){if(es.length!==2||es[0].direction+es[1].direction)throw fail('nonmanifold_or_open_boundary');const a=root(es[0].face),b=root(es[1].face);parent[Math.max(a,b)]=Math.min(a,b);neighbors[es[0].face].push(es[1].face);neighbors[es[1].face].push(es[0].face);}
 // Edge manifoldness alone permits a vertex bow-tie. Every vertex link must
 // also be one fan; no coordinate welding or topology repair is performed.
 for(const faces of incident){if(!faces.length)throw fail('unused_material_vertex');const allowed=new Set(faces),seen=new Set([faces[0]]),stack=[faces[0]];while(stack.length)for(const n of neighbors[stack.pop()])if(allowed.has(n)&&!seen.has(n)){seen.add(n);stack.push(n);}if(seen.size!==allowed.size)throw fail('nonmanifold_vertex');}
 const scale=1n<<192n,components=new Map();let lower=0n,upper=0n;for(let f=0;f<mesh.faceCount;f++){c.test();const [a,b,d]=mesh.triangles[f].map(i=>mesh.vertices[i]),v=dot(a,cross(b,d)),numerator=v[0]*scale,lo=floorDiv(numerator,v[1]),hi=-floorDiv(-numerator,v[1]),r=root(f);if(!components.has(r))components.set(r,{lower:0n,upper:0n,faces:0});const component=components.get(r);component.lower+=lo;component.upper+=hi;component.faces++;lower+=lo;upper+=hi;}
 if(lower<=0n||single&&components.size!==1||positiveComponents&&[...components.values()].some(x=>x.lower<=0n))throw fail(single&&components.size!==1?'multiple_remaining_boundaries':'nonpositive_or_unresolved_volume');
 return{boundaryComponents:components.size,closedIndexedManifold:true,volume:{lower:exactRationalString(exactRational(lower,6n*scale)),upper:exactRationalString(exactRational(upper,6n*scale)),method:'rational-determinants-dyadic-enclosure-192'},componentFaces:[...components.values()].map(x=>x.faces)};
}
function operation(a,op,operands){if(a.origin.kind!=='boolean'||a.origin.operation!==op||JSON.stringify(a.origin.operands)!==JSON.stringify(operands))throw fail('boolean_operand_binding');}
const descriptor=(id,role,a)=>({id,meshHash:a.meshHash,faceCount:a.faceCount,role});
/** Complete oriented boundary balance, including multiplicity and arbitrary
 * coplanar retriangulation. Intended for saved trusted-native Boolean results. */
export function validateExactMachiningBoundary(input,options={}){
 const v=detached(input),c=budget(options);c.check();const source=validateExactAuthority(v.source),cutter=validateExactAuthority(v.cutter),result=validateExactAuthority(v.result),removed=validateExactAuthority(v.removedResult),operands=[descriptor('source','source',source),descriptor('cutter','cutter',cutter)];
 operation(result,'difference',operands);operation(removed,'intersection',operands);
 const original=parsed(source,c),tool=parsed(cutter,c),remaining=parsed(result,c),removal=parsed(removed,c);if(original.faceCount+tool.faceCount+remaining.faceCount+removal.faceCount>c.limits.faces)throw fail('aggregate_face_limit');
 const sourceFaces=Array.from({length:original.faceCount},()=>[]),cutFaces=Array.from({length:tool.faceCount},()=>[[],[]]);
 for(const [which,authority,mesh]of [[0,result,remaining],[1,removed,removal]])for(let f=0;f<mesh.faceCount;f++){c.test();const operand=authority.provenance.operandIndex[f],birth=authority.provenance.sourceFaceIndex[f],parent=(operand?tool:original).triangles[birth].map(i=>(operand?tool:original).vertices[i]),tri=mesh.triangles[f].map(i=>mesh.vertices[i]),orientation=operand&&which===0?-1:1;subset(tri,parent,orientation);if(operand)cutFaces[birth][which].push(orientation<0?[tri[0],tri[2],tri[1]]:tri);else sourceFaces[birth].push(tri);}
 for(let f=0;f<original.faceCount;f++){c.test();exactCover(original.triangles[f].map(i=>original.vertices[i]),sourceFaces[f],c);}for(let f=0;f<tool.faceCount;f++){c.test();reciprocal(tool.triangles[f].map(i=>tool.vertices[i]),...cutFaces[f],c);}
 const sourceTopology=topology(original,c),remainingTopology=topology(remaining,c,{single:true}),removedTopology=topology(removal,c,{positiveComponents:true});c.check();
 const ops=source.origin.operands.map(o=>({...o}));if(ops.length>=EXACT_GEOMETRY_LIMITS.operands)throw fail('operand_limit');let id='engraving-cutter',serial=1;while(ops.some(o=>o.id===id))id=`engraving-cutter:${serial++}`;ops.push(descriptor(id,'cutter',cutter));
 const provenance={operandIndex:[],sourceFaceIndex:[]};for(let f=0;f<result.faceCount;f++){const op=result.provenance.operandIndex[f],birth=result.provenance.sourceFaceIndex[f];provenance.operandIndex.push(op?ops.length-1:source.provenance.operandIndex[birth]);provenance.sourceFaceIndex.push(op?birth:source.provenance.sourceFaceIndex[birth]);}
 const authority=createExactAuthority({meshText:result.meshText,origin:{kind:'partition',operation:'partition',operands:ops},provenance});
 return freeze({authority,proof:{sourceAuthorityHash:source.authorityHash,cutterAuthorityHash:cutter.authorityHash,resultAuthorityHash:result.authorityHash,removedAuthorityHash:removed.authorityHash,sourceFaceCoverage:'exact-once',cutterInterfaces:'exact-opposite-coverage',sourceTopology,remainingTopology,removedTopology,proofScope:'trusted-native-booleans-with-exact-oriented-boundary-balance',globalEmbeddingCertified:false,printable:false}});
}
function sharedContext(options){return options.context??createExactProjectContext({permissionSources:options.permissionSources});}
function rebuild(raw,options){
 const v=detached(raw);if(!v||Object.keys(v).some(k=>!['schema','version','base','plan','guardResult','removedResult','result','recordHash'].includes(k))||v.schema!=='prinjekt-exact-machining-v1'||v.version!==1)throw fail('evidence_schema');
 if(v.base?.exactMachining!=null||v.base?.mark!=null)throw fail('recursive_or_repeated_machining');
 const context=sharedContext(options),base=restoreExactProjectPart(v.base,{context}),plan=validateExactMarkPlan(v.plan,base,{context}),source=base.exactGeometry.authority;
 const cutter=createExactAuthority({meshText:plan.cutter.meshText}),guard=createExactAuthority({meshText:plan.guard.meshText});if(cutter.meshHash!==plan.cutter.meshHash||guard.meshHash!==plan.guard.meshHash)throw fail('plan_mesh_hash');
 const guardResult=validateExactAuthority(v.guardResult);operation(guardResult,'difference',[descriptor('guard','cutter',guard),descriptor('source','source',source)]);if(guardResult.faceCount!==0||guardResult.vertexCount!==0)throw fail('insufficient_wall_guard');
 const verified=validateExactMachiningBoundary({source,cutter,result:v.result,removedResult:v.removedResult},options),authority=verified.authority;
 const before=validateExactPrintPoseReview(base.exactPoseReview,source);if(!before.selected)throw fail('missing_print_pose');
 const poseReview=reviewExactPrintPoses(authority,{...before.configuration,posePolicy:'retain',retainedAssemblyToPrint:before.selected.assemblyToPrint});if(!poseReview.selected||JSON.stringify(poseReview.selected.assemblyToPrint)!==JSON.stringify(before.selected.assemblyToPrint))throw fail('retained_pose_unavailable');
 if(poseReview.selected.printStability.stableUnderGravity!==true||!(poseReview.selected.printStability.minimumMargin>0))throw fail('retained_pose_unstable_refine_before_engraving');
 const assemblyMatrix=new Matrix4().fromArray(poseReview.selected.assemblyToPrint).invert().toArray();if(JSON.stringify(assemblyMatrix)!==JSON.stringify(base.assemblyMatrix))throw fail('changed_print_pose');
 if(!base.exactInteriorPermission)throw fail('original_permission_missing');const permission=transferExactInteriorPermission(getExactProjectPermission(context,base.exactInteriorPermission.sourceRevision),authority);
 const payload={schema:v.schema,version:v.version,base:detached(serializeExactProjectPart(base,{context})),plan,guardResult,removedResult:validateExactAuthority(v.removedResult),result:validateExactAuthority(v.result)};
 const evidence=freeze({...payload,recordHash:exactHash(`EXACT_MACHINING_1\n${JSON.stringify(payload)}`)});if(v.recordHash!==undefined&&v.recordHash!==evidence.recordHash)throw fail('evidence_hash');
 return {authority,poseReview,permission,mark:plan.mark,evidence,proof:verified.proof,base,context};
}
export function validateExactMachining(record,options={}){const value=detached(record);if(!value?.recordHash)throw fail('evidence_hash');return rebuild(value,options);}
export function createExactMachinedPart({base,plan,guardResult,removedResult,result},options={}){
 const context=sharedContext(options),v=rebuild({schema:'prinjekt-exact-machining-v1',version:1,base,plan,guardResult,removedResult,result},{...options,context,permissionSources:undefined});
 const metadata={id:v.base.id,name:v.base.name,color:v.base.color,note:v.base.note,...(v.base.exactLeafId!==undefined?{exactLeafId:v.base.exactLeafId}:{})};
 const part=createExactProjectPart({source:v.authority,poseReview:v.poseReview,permission:v.permission,metadata,context});
 return {...part,mark:freeze(v.mark),exactMachining:v.evidence,exactMachiningProof:v.proof};
}
