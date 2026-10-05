import {exactHash,validateExactAuthority} from './exact-geometry.mjs';
import {validateExactPrintPoseReview,reviewExactPrintPoses} from './exact-pose-review.mjs';
import {validateExactSplitPoseReview} from './exact-split-pose-review.mjs';
import {validateExactAdjacentUnionReview} from './exact-adjacent-union.mjs';

const fail=reason=>Object.assign(Error(`Exakter Teilungsbaum: ${reason}.`),{code:'EXACT_REFINEMENT_TREE_REJECTED',reason});
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),hash=/^[a-f0-9]{64}$/;
const freeze=value=>{if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
export const EXACT_REFINEMENT_TREE_LIMITS=Object.freeze({roots:4096,splits:4096,nodes:12288,depth:64,idLength:512,bytes:256*1024*1024,aggregateVertices:4_000_000,aggregateFaces:8_000_000,jsonDepth:128,jsonObjects:1_000_000});
// Bound the FULL JSON graph before copying or hashing. Shared references count
// repeatedly, as they do in JSON; cycles, accessors and custom serialization do
// not get to run. No temporary UTF-8 copy of a potentially huge string is made.
function preflight(value){
 let bytes=0,objects=0,vertices=0,faces=0;const active=new Set();
 const add=n=>{bytes+=n;if(bytes>EXACT_REFINEMENT_TREE_LIMITS.bytes)throw fail('aggregate_bytes_limit');};
 function string(s){
  // Rational meshes are almost entirely ASCII. Count their base bytes once;
  // only escapes and multibyte characters need extra work, with no temporary
  // arrays or per-character function calls on the common path.
  add(s.length+2);let extra=0;
  for(let i=0;i<s.length;i++){
   const c=s.charCodeAt(i);
   if(c>=32&&c<128){if(c===34||c===92)extra++;continue;}
   if(c<32)extra+=c===8||c===9||c===10||c===12||c===13?1:5;
   else if(c<2048)extra++;
   else if(c>=0xd800&&c<=0xdbff&&i+1<s.length&&s.charCodeAt(i+1)>=0xdc00&&s.charCodeAt(i+1)<=0xdfff){extra+=2;i++;}
   else extra+=c>=0xd800&&c<=0xdfff?5:2;
  }
  add(extra);
 }
 function visit(v,depth){
  if(v===null){add(4);return;}if(typeof v==='string'){string(v);return;}if(typeof v==='boolean'){add(v?4:5);return;}if(typeof v==='number'){if(!Number.isFinite(v))throw fail('nonfinite_json_number');add(String(v).length);return;}
  if(typeof v!=='object')throw fail('plain_json_required');if(depth>EXACT_REFINEMENT_TREE_LIMITS.jsonDepth||++objects>EXACT_REFINEMENT_TREE_LIMITS.jsonObjects)throw fail('json_structure_limit');if(active.has(v))throw fail('cyclic_record');
  const list=Array.isArray(v),proto=Object.getPrototypeOf(v);if(list?proto!==Array.prototype:proto!==Object.prototype&&proto!==null)throw fail('plain_json_required');
  if(list&&v.length>EXACT_REFINEMENT_TREE_LIMITS.aggregateFaces)throw fail('json_array_limit');
  const names=Reflect.ownKeys(v);if(names.some(k=>typeof k!=='string'||k==='toJSON'))throw fail('custom_json');
  if(list&&names.length!==v.length+1)throw fail('dense_json_array');
  const descriptor=k=>{const d=Object.getOwnPropertyDescriptor(v,k);if(!d||!Object.hasOwn(d,'value')||(!list||k!=='length')&&!d.enumerable)throw fail('json_accessor_or_hidden_field');return d.value;};
  if(!list&&names.includes('kind')&&descriptor('kind')==='exactGeometry'){
   const nv=descriptor('vertexCount'),nf=descriptor('faceCount');if(!Number.isSafeInteger(nv)||nv<0||!Number.isSafeInteger(nf)||nf<0)throw fail('geometry_count');vertices+=nv;faces+=nf;if(vertices>EXACT_REFINEMENT_TREE_LIMITS.aggregateVertices||faces>EXACT_REFINEMENT_TREE_LIMITS.aggregateFaces)throw fail('aggregate_geometry_limit');
  }
  active.add(v);add(2);
  if(list){for(let i=0;i<v.length;i++){if(i)add(1);visit(descriptor(String(i)),depth+1);}}
  else for(let i=0;i<names.length;i++){if(i)add(1);const key=names[i];string(key);add(1);visit(descriptor(key),depth+1);}
  active.delete(v);
 }
 visit(value,0);
}
function shape(value,allowed,reason){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!allowed.includes(k)))throw fail(reason);}
function id(value){if(typeof value!=='string'||!value.length||value.length>EXACT_REFINEMENT_TREE_LIMITS.idLength||/[\x00-\x20\x7f]/.test(value))throw fail('node_id');return value;}
function copy(value){try{return JSON.parse(JSON.stringify(value));}catch{throw fail('serializable_record');}}
function array(value,limit,reason){if(!Array.isArray(value)||value.length>limit||Array.from(value).some(x=>!x||typeof x!=='object'))throw fail(reason);}
// Cache lifetime is ONE synchronous validation, after the full JSON preflight.
// A supplied hash selects only a bucket. Every hit also compares the complete
// literal input (including pose diagnostics and every matrix), not its claimed
// hash or a reduced physical signature. Only detached immutable records survive
// a miss; caller-owned mutable objects are never trusted as identity-cache keys.
function literalEqual(a,b){
 if(Object.is(a,b))return true;
 if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;
 const ak=Object.keys(a),bk=Object.keys(b);if(ak.length!==bk.length)return false;
 for(let i=0;i<ak.length;i++)if(ak[i]!==bk[i]||!literalEqual(a[ak[i]],b[bk[i]]))return false;
 return true;
}
function literalSnapshot(value){
 if(!value||typeof value!=='object')return value;
 return Object.freeze(Array.isArray(value)?value.map(literalSnapshot):Object.fromEntries(Object.keys(value).map(k=>[k,literalSnapshot(value[k])])));
}
function validationContext(){
 const buckets=new Map(),ownedAuthorities=new WeakMap();
 function authority(input){
  const owned=ownedAuthorities.get(input);if(owned)return owned;
  const key=input?.authorityHash,list=buckets.get(key)??[];
  for(const entry of list)if(literalEqual(input,entry.input))return entry;
  const value=validateExactAuthority(input),entry={input:literalEqual(input,value)?value:literalSnapshot(input),value,poses:new Map(),ownedPoses:new WeakMap()};
  list.push(entry);buckets.set(key,list);ownedAuthorities.set(value,entry);return entry;
 }
 function pose(input,source){
  const a=authority(source),owned=a.ownedPoses.get(input);if(owned)return owned;
  const key=input?.reviewHash,list=a.poses.get(key)??[];
  for(const entry of list)if(literalEqual(input,entry.input))return entry;
  const local=validateExactPrintPoseReview(input,a.value),stored=literalSnapshot(input),entry={input:stored,stored,local};
  list.push(entry);a.poses.set(key,list);a.ownedPoses.set(stored,entry);
  if(literalEqual(local,stored))a.ownedPoses.set(local,entry);
  return entry;
 }
 return {authority,pose};
}
function node(value,context){
 shape(value,['id','source','poseReview'],'node_fields');
 const source=context.authority(value.source).value,checked=value.poseReview===null?null:context.pose(value.poseReview,source),stored=checked?.stored??null,local=checked?.local??null;
 return {value:freeze({id:id(value.id),source,poseReview:stored}),local};
}
function poseIdentity(pose){return pose?{configuration:pose.configuration,authorityHash:pose.authorityHash,meshHash:pose.meshHash,bank:pose.candidates.map(p=>({origin:p.origin,assemblyToPrint:p.assemblyToPrint})),selectedIndex:pose.selectedIndex,selected:pose.selected?{origin:pose.selected.origin,assemblyToPrint:pose.selected.assemblyToPrint}:null}:null;}
function samePose(actual,expected,source,context){
 if(actual===null||expected===null){if(actual!==expected)throw fail('leaf_pose_missing_or_added');return null;}
 const checked=context.pose(actual,source).local,wanted=context.pose(expected,source).local;
 if(!same(poseIdentity(checked),poseIdentity(wanted)))throw fail('parent_or_leaf_pose_changed');
 return checked;
}
function branch(parent,record,context){
 shape(record,['parentId','poseReview','refinement','result'],'split_fields');
 if(record.parentId!==parent.id||!parent.poseReview||!record.poseReview)throw fail('split_parent');
 const storedPose=context.pose(record.poseReview,parent.source).stored,local=samePose(storedPose,parent.poseReview,parent.source,context);
 if(!local?.selected)throw fail('split_parent_pose_missing');
 const result=record.result;
 shape(result,['schema','sourceRevision','planHash','search','acceptedForRefinement','partition','poseReview','reviewRequired','printable'],'result_fields');
 if(result.schema!=='prinjekt-exact-refinement-result-v1'||result.acceptedForRefinement!==true||result.reviewRequired!==true||result.printable!==false||typeof result.sourceRevision!=='string'||!hash.test(result.sourceRevision)||typeof result.planHash!=='string'||!hash.test(result.planHash))throw fail('accepted_result');
 const refinement=copy(record.refinement),candidateId=result.poseReview?.candidateId;
 const fresh=validateExactSplitPoseReview(result.poseReview,result.partition,{source:parent.source,poseReview:storedPose,refinement,candidateId});
 if(!fresh.acceptedForRefinement||!fresh.selection.selected||fresh.children.length!==2)throw fail('split_not_accepted');
 if(!same(fresh.usableBed,local.configuration.usableBed)||!same(fresh.parentReview.selected.assemblyToPrint,local.selected.assemblyToPrint))throw fail('split_parent_frame_or_bed');
 const selected=fresh.selection.selected,children=fresh.children.map((child,index)=>{
  const chosen=child.poseReview?.candidates[selected.indexes[index]],matrix=selected.assemblyToPrint[index];
  if(!chosen||!same(chosen.assemblyToPrint,matrix))throw fail('joint_pose_missing');
  const source=child.part.geometry,poseReview=reviewExactPrintPoses(source,{usableBed:[...fresh.usableBed],cutPlanes:child.poseReview.configuration.cutPlanes,posePolicy:'retain',retainedAssemblyToPrint:[...matrix]});
  // Retaining a joint pose must never silently become another local optimum.
  if(!poseReview.selected||!same(poseReview.selected.assemblyToPrint,matrix)||poseReview.selected.printStability.stableUnderGravity!==true)throw fail('joint_pose_not_retained');
  return freeze({id:id(`${parent.id}/${child.part.id}`),source,poseReview});
 });
 if(children[0].id===children[1].id)throw fail('duplicate_child_id');
 return {children:freeze(children),record:freeze({parentId:parent.id,poseReview:storedPose,refinement,result:copy(result)}),fresh};
}

/** Derive ALL children of one accepted split. The stored parent review is
 * validated separately from fresh diagnostics; exact assembly coordinates and
 * the selected joint matrices are never rounded or independently reoriented. */
export function deriveExactRefinementChildren(parent,split){preflight({parent,split});const context=validationContext();return branch(node(parent,context).value,split,context).children;}

// A repartition first proves a complete, non-overlapping union of two current
// leaves. Its merged body's chosen pose is fixed before the new cut is checked.
// The intermediate node records both parents; neither original root is erased.
function repartition(parents,record,context){
 shape(record,['afterSplitCount','parentIds','unionReview','merged','split'],'repartition_fields');
 if(!Number.isSafeInteger(record.afterSplitCount)||record.afterSplitCount<0||record.afterSplitCount>EXACT_REFINEMENT_TREE_LIMITS.splits)throw fail('repartition_chronology');
 if(!Array.isArray(record.parentIds)||record.parentIds.length!==2||record.parentIds[0]===record.parentIds[1]||!same(record.parentIds,parents.map(p=>p.id)))throw fail('repartition_parents');
 const merged=node(record.merged,context),pose=merged.local;
 if(!pose?.selected)throw fail('merged_pose_missing');
 for(const parent of parents){const prior=parent.poseReview===null?null:context.pose(parent.poseReview,parent.source).local;if(prior&&!same(prior.configuration.usableBed,pose.configuration.usableBed))throw fail('merged_bed_changed');}
 const unionReview=validateExactAdjacentUnionReview(record.unionReview,{sources:parents.map(p=>p.source),result:merged.value.source});
 if(record.split?.poseReview?.reviewHash!==merged.value.poseReview.reviewHash)throw fail('merged_pose_history_changed');
 const derived=branch(merged.value,record.split,context);
 return {merged:merged.value,children:derived.children,record:freeze({afterSplitCount:record.afterSplitCount,parentIds:[...record.parentIds],unionReview,merged:merged.value,split:derived.record})};
}

/** Derive the complete replacement pair without changing the source leaves. */
export function deriveExactRepartitionChildren(parents,record){
 preflight({parents,record});array(parents,2,'repartition_parents');if(parents.length!==2)throw fail('repartition_parents');
 const context=validationContext();return repartition(parents.map(p=>node(p,context).value),record,context).children;
}

function unresolved(value,local){
 if(!local?.selected)return {id:value.id,reason:local?'no_fitting_pose':'pose_missing'};
 const p=local.selected,s=p.printStability;
 if(!s?.valid||s.stableUnderGravity!==true)return {id:value.id,reason:'nonpositive_stability'};
 if(!Number.isFinite(s.volume)||s.volume<1000)return {id:value.id,reason:'below_minimum_volume'};
 if(s.classification!=='stable')return {id:value.id,reason:'marginal_stability'};
 return null;
}

/** Proves complete replacement relative to the supplied trusted roots. It does
 * not prove that the roots themselves cover an original roof without overlap,
 * or grant engraving permissions, assembly access or printing approval.
 * `result.search` is retained historical diagnostics, not a search optimality
 * certificate. Only the complete bound partition and fresh child pair decide. */
export function createExactRefinementTreeReview(input){
 preflight(input);
 const context=validationContext();
 shape(input,['roots','splits','repartitions','leaves'],'tree_fields');
 array(input.roots,EXACT_REFINEMENT_TREE_LIMITS.roots,'roots');array(input.splits,EXACT_REFINEMENT_TREE_LIMITS.splits,'splits');array(input.leaves,EXACT_REFINEMENT_TREE_LIMITS.nodes,'leaves');
 const regroup=Object.hasOwn(input,'repartitions')?input.repartitions:[];array(regroup,EXACT_REFINEMENT_TREE_LIMITS.splits,'repartitions');
 if(input.splits.length+regroup.length>EXACT_REFINEMENT_TREE_LIMITS.splits)throw fail('split_limit');
 let lastIndex=0;for(const record of regroup){if(!Number.isSafeInteger(record.afterSplitCount)||record.afterSplitCount<lastIndex||record.afterSplitCount>input.splits.length)throw fail('repartition_chronology');lastIndex=record.afterSplitCount;}
 const version=regroup.length?2:1;
 if(!input.roots.length)throw fail('roots_empty');
 const roots=[],splits=[],repartitions=[],leaves=new Map(),seen=new Set(),lineage=[],rootIds=new Set();
 const ancestry=(value,parentIds,ancestors,depth,operation)=>version===1?{id:value.id,parentId:parentIds[0]??null,rootId:ancestors[0],depth,sourceAuthorityHash:value.source.authorityHash}:{id:value.id,parentIds:[...parentIds],rootIds:[...ancestors],depth,operation,sourceAuthorityHash:value.source.authorityHash};
 for(const value of input.roots){const parsed=node(value,context),r=parsed.value;if(seen.has(r.id))throw fail('duplicate_root_id');seen.add(r.id);rootIds.add(r.id);roots.push(r);leaves.set(r.id,{value:r,rootIds:[r.id],depth:0});lineage.push(ancestry(r,[],[r.id],0,'root'));}
 let repartitionIndex=0;
 for(let splitIndex=0;splitIndex<=input.splits.length;splitIndex++){
  while(repartitionIndex<regroup.length&&regroup[repartitionIndex].afterSplitCount===splitIndex){
   const record=regroup[repartitionIndex++];
   if(!Array.isArray(record.parentIds)||record.parentIds.length!==2||record.parentIds[0]===record.parentIds[1])throw fail('repartition_parents');
   const parents=record.parentIds.map(key=>leaves.get(key));if(parents.some(p=>!p))throw fail('repartition_parent_is_not_current_leaf');
   const depth=Math.max(...parents.map(p=>p.depth));if(depth>=EXACT_REFINEMENT_TREE_LIMITS.depth)throw fail('depth_limit');
   if(seen.has(record.merged?.id))throw fail('merged_id_collision');if(seen.size+3>EXACT_REFINEMENT_TREE_LIMITS.nodes)throw fail('node_limit');
   const derived=repartition(parents.map(p=>p.value),record,context),merged=derived.merged;
   if(derived.children.some(child=>seen.has(child.id)||child.id===merged.id))throw fail('child_id_collision');
   const ancestors=[...new Set(parents.flatMap(p=>p.rootIds))].sort();
   for(const parent of parents)leaves.delete(parent.value.id);
   seen.add(merged.id);lineage.push(ancestry(merged,record.parentIds,ancestors,depth,'union'));repartitions.push(derived.record);
   for(const child of derived.children){seen.add(child.id);leaves.set(child.id,{value:child,rootIds:ancestors,depth:depth+1});lineage.push(ancestry(child,[merged.id],ancestors,depth+1,'split'));}
  }
  if(splitIndex===input.splits.length)break;
  const record=input.splits[splitIndex];
  const parent=leaves.get(record?.parentId);if(!parent)throw fail('parent_is_not_current_leaf');
  if(parent.depth>=EXACT_REFINEMENT_TREE_LIMITS.depth)throw fail('depth_limit');
  // The first branch must refer to the ORIGINAL root review, not a rehashed
  // local substitute. Nested reviews may have portable diagnostic differences,
  // but their full bank/configuration and chosen joint pose must remain exact.
  if(rootIds.has(parent.value.id)&&record.poseReview?.reviewHash!==parent.value.poseReview?.reviewHash)throw fail('root_pose_history_changed');
  const derived=branch(parent.value,record,context);
  for(const child of derived.children)if(seen.has(child.id))throw fail('child_id_collision');
  if(seen.size+derived.children.length>EXACT_REFINEMENT_TREE_LIMITS.nodes)throw fail('node_limit');
  leaves.delete(parent.value.id);splits.push(derived.record);
  for(const child of derived.children){seen.add(child.id);leaves.set(child.id,{value:child,rootIds:parent.rootIds,depth:parent.depth+1});lineage.push(ancestry(child,[parent.value.id],parent.rootIds,parent.depth+1,'split'));}
 }
 if(input.leaves.length!==leaves.size)throw fail('leaf_count');
 const claims=new Map();for(const claim of input.leaves){const parsed=node(claim,context),expected=leaves.get(parsed.value.id);if(!expected||claims.has(parsed.value.id))throw fail('unknown_or_duplicate_leaf');if(parsed.value.source.authorityHash!==expected.value.source.authorityHash)throw fail('leaf_source_changed');const local=samePose(parsed.value.poseReview,expected.value.poseReview,expected.value.source,context);claims.set(parsed.value.id,{value:parsed.value,local});}
 const finalLeaves=[],unresolvedLeaves=[];for(const key of leaves.keys()){const claim=claims.get(key);if(!claim)throw fail('missing_leaf');finalLeaves.push(claim.value);const issue=unresolved(claim.value,claim.local);if(issue)unresolvedLeaves.push(issue);}
 const metadata={kind:'exactRefinementTreeReview',version,frame:'assembly',roots,splits,...(version===2?{repartitions}:{}),leaves:finalLeaves,lineage,rootCount:roots.length,splitCount:splits.length,...(version===2?{repartitionCount:repartitions.length}:{}),leafCount:finalLeaves.length,unresolvedLeaves,completeRootCoverage:true,coverageScope:'complete-leaf-replacement-relative-to-trusted-roots-and-native-arrangements',originalRoofCoverageProven:false,allMaterialComponentsPreserved:true,orientationBeforeRefinement:true,interiorPermissionTransferred:false,searchOptimalityProven:false,reviewRequired:true,printable:false};
 return freeze({...metadata,reviewHash:exactHash(`EXACT_REFINEMENT_TREE_REVIEW_${version}\n${JSON.stringify(metadata)}`)});
}

/** Revalidates every original parent-pose/plane/partition branch and every
 * claimed final leaf. Cached summaries or a self-consistent hash cannot grant
 * completeness. Historical parent reviews remain unchanged in the tree. */
export function validateExactRefinementTreeReview(value){
 preflight(value);
 if(!value||value.kind!=='exactRefinementTreeReview'||![1,2].includes(value.version))throw fail('tree_review');
 const {reviewHash,...metadata}=value;if(reviewHash!==exactHash(`EXACT_REFINEMENT_TREE_REVIEW_${value.version}\n${JSON.stringify(metadata)}`))throw fail('tree_review_hash');
 const fresh=createExactRefinementTreeReview({roots:value.roots,splits:value.splits,...(value.version===2?{repartitions:value.repartitions}:{}),leaves:value.leaves});
 if(!same(fresh,value))throw fail('tree_review_changed');
 return fresh;
}
