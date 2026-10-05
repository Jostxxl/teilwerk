import {Matrix4} from 'three';
import {createExactAuthority} from './exact-geometry.mjs';
import {bindExactGeometry,deriveExactDisplay,validateExactBinding} from './exact-geometry-binding.mjs';
import {validateExactPrintPoseReview} from './exact-pose-review.mjs';
import {prepareExactInteriorPermission,validateTransferredExactInteriorPermission} from './exact-interior-permission.mjs';
import {restoreMarkLocation,transformMarkLocation} from './mark-locations.mjs';
import {validateExactMachining} from './exact-machining.mjs';

// Exact project persistence is a separate backend. The numeric mesh is checked
// against its rational authority, never imported into the legacy solid kernel.
// Saved quality flags and numeric interior masks are not permission evidence.
const fail=reason=>Object.assign(Error(`Exaktes Projektteil konnte nicht übernommen werden: ${reason}.`),{code:'EXACT_PROJECT_REJECTED',reason});
const identity=Object.freeze(new Matrix4().toArray()),hash=/^[a-f0-9]{64}$/;
const contexts=new WeakMap();
const freeze=value=>{if(value&&typeof value==='object'&&!Object.isFrozen(value)&&!ArrayBuffer.isView(value)){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
export const EXACT_PROJECT_LIMITS=Object.freeze({bytes:256*1024*1024,objects:1_000_000,depth:80,sources:2048,array:12_000_000});

// Reject accessors/custom serializers before copying. Typed numeric arrays from
// the packed codec become ordinary detached arrays; no supplied mutable identity
// or claimed hash is sufficient to populate the private permission cache.
// Count logical payload, not engine heap use: UTF-16 text, numeric/undefined
// values and record keys. Dense array indices are implicit, as in typed arrays.
function detached(value){
 let bytes=0,objects=0;const active=new Set();
 const add=n=>{bytes+=n;if(bytes>EXACT_PROJECT_LIMITS.bytes)throw fail('record_byte_limit');};
 function copy(v,depth){
  if(v===undefined){add(8);return undefined;}
  if(v===null||typeof v==='boolean'){add(4);return v;}
  if(typeof v==='number'){if(!Number.isFinite(v))throw fail('nonfinite_number');add(8);return v;}
  if(typeof v==='string'){add(v.length*2+2);return v;}
  if(typeof v!=='object'||depth>EXACT_PROJECT_LIMITS.depth||++objects>EXACT_PROJECT_LIMITS.objects)throw fail('record_structure');
  if(active.has(v))throw fail('cyclic_record');
  if(ArrayBuffer.isView(v)){
   if(!(v instanceof Float32Array||v instanceof Float64Array||v instanceof Uint32Array)||v.length>EXACT_PROJECT_LIMITS.array)throw fail('numeric_array_type');
   add(v.length*8);const out=new Array(v.length);for(let i=0;i<v.length;i++){if(!Number.isFinite(v[i]))throw fail('nonfinite_number');out[i]=v[i];}return out;
  }
  const list=Array.isArray(v),prototype=Object.getPrototypeOf(v);
  if(list?prototype!==Array.prototype:prototype!==Object.prototype&&prototype!==null)throw fail('plain_record');
  if(list&&v.length>EXACT_PROJECT_LIMITS.array)throw fail('array_limit');
  const names=Reflect.ownKeys(v);if(names.some(k=>typeof k!=='string'||['__proto__','constructor','prototype','toJSON'].includes(k)))throw fail('record_keys');
  if(list&&(names.length!==v.length+1||names.some(k=>k!=='length'&&(!/^(0|[1-9]\d*)$/.test(k)||Number(k)>=v.length))))throw fail('dense_array');
  active.add(v);add(2);const out=list?[]:{};
  for(const k of names){if(list&&k==='length')continue;const d=Object.getOwnPropertyDescriptor(v,k);if(!d||!Object.hasOwn(d,'value')||!d.enumerable)throw fail('record_accessor');if(!list)add(k.length*2+2);out[k]=copy(d.value,depth+1);}
  active.delete(v);return out;
 }
 return copy(value,0);
}
function record(value,reason){if(!value||typeof value!=='object'||Array.isArray(value))throw fail(reason);return value;}
function sourceEntries(input){
 if(input===undefined)return [];
 if(input instanceof Map){if(Object.getPrototypeOf(input)!==Map.prototype||Reflect.ownKeys(input).length)throw fail('permission_sources');if(input.size>EXACT_PROJECT_LIMITS.sources)throw fail('source_count');return [...Map.prototype.entries.call(input)];}
 record(input,'permission_sources');const descriptors=Object.getOwnPropertyDescriptors(input),prototype=Object.getPrototypeOf(input);
 if(prototype!==Object.prototype&&prototype!==null||Reflect.ownKeys(input).length>EXACT_PROJECT_LIMITS.sources)throw fail('permission_sources');
 return Reflect.ownKeys(input).map(key=>{const d=descriptors[key];if(typeof key!=='string'||!d||!Object.hasOwn(d,'value')||!d.enumerable)throw fail('source_accessor');return [key,d.value];});
}
/** A private per-save/load context shares one fully checked original selection
 * among all children. It is intentionally not serializable and has no saved
 * validity flag. Mutation of the caller's source map cannot affect this call. */
export function createExactProjectContext({permissionSources}={}){
 const entries=detached(sourceEntries(permissionSources)),sources=new Map();
 for(const [key,capture]of entries){if(!hash.test(key)||capture?.sourceRevision!==key||sources.has(key))throw fail('permission_source_key');sources.set(key,freeze(capture));}
 const token=Object.freeze({kind:'exact-project-context'});contexts.set(token,{sources,permissions:new Map()});return token;
}
function context(options){
 if(options.context!==undefined){if(options.permissionSources!==undefined||!contexts.has(options.context))throw fail('project_context');return contexts.get(options.context);}
 return contexts.get(createExactProjectContext({permissionSources:options.permissionSources}));
}
function preparedPermission(ctx,sourceRevision){
 if(!hash.test(sourceRevision??''))throw fail('permission_source_key');
 const capture=ctx.sources.get(sourceRevision);if(!capture)throw fail('permission_source_missing');
 let prepared=ctx.permissions.get(sourceRevision);
 if(!prepared){prepared=prepareExactInteriorPermission(capture);ctx.permissions.set(sourceRevision,prepared);}
 return prepared;
}
/** Reuse the same authenticated original-surface index while staging children
 * and while checking their saved rights; no second roof-mask preparation. */
export function getExactProjectPermission(token,sourceRevision){
 const ctx=contexts.get(token);if(!ctx)throw fail('project_context');return preparedPermission(ctx,sourceRevision);
}
function permission(saved,authority,assemblyMatrix,ctx){
 if(saved===null)return {exactInteriorPermission:null};
 if(!saved||!hash.test(saved.sourceRevision))throw fail('interior_permission');
 const prepared=preparedPermission(ctx,saved.sourceRevision);
 const checked=validateTransferredExactInteriorPermission(saved,prepared,authority),region=checked.rationalRegion;
 if(!region)return {exactInteriorPermission:checked};
 const selection=createExactAuthority({meshText:region.meshText});
 if(selection.meshHash!==region.meshHash||selection.faceCount!==region.faceCount||selection.vertexCount!==region.vertexCount)throw fail('permission_region');
 const view=deriveExactDisplay(selection,{assemblyMatrix,precision:'float64'});
 return {exactInteriorPermission:checked,interiorRegion:{vertices:view.vertices,triangles:view.triangles}};
}
function metadata(value){
 const id=value.id;if(!(typeof id==='string'&&id.length>0&&id.length<=512&&!/[\x00-\x1f\x7f]/.test(id)))throw fail('part_id');
 const text=(key,max,fallback)=>{const v=value[key]??fallback;if(typeof v!=='string'||v.length>max)throw fail('part_'+key);return v;};
 const color=text('color',7,'#bde780');if(!/^#[0-9a-f]{6}$/i.test(color))throw fail('part_color');
 const out={id,name:text('name',200,'Teil'),color,note:text('note',8000,'')};
 if(value.exactLeafId!==undefined){if(typeof value.exactLeafId!=='string'||!value.exactLeafId.length||value.exactLeafId.length>512)throw fail('leaf_id');out.exactLeafId=value.exactLeafId;}
 if(value.plannedMark!=null){
  restoreMarkLocation(value.plannedMark); // Validate without shifting a stored manual anchor/normal.
  const allowed=['point','normal','text','size','depth','rotation','emboss','autoId','placement'];
  if(Object.keys(value.plannedMark).some(k=>!allowed.includes(k)))throw fail('planned_mark_fields');
  out.plannedMark=freeze(value.plannedMark);
  out.plannedMarkIssue='Markierung vorgemerkt. Vor dem Druckexport wird sie als echte Gravur berechnet.';
 }
 if(value.plannedMarkIssue!==undefined){if(typeof value.plannedMarkIssue!=='string'||value.plannedMarkIssue.length>1000)throw fail('planned_mark_issue');out.plannedMarkIssue=value.plannedMarkIssue;}
 return out;
}
function refreshedQuality(pose){
 const selected=pose?.selected,issues=[];
 if(!selected)issues.push({reason:'metrics_unavailable'},{reason:'no_fitting_cut_face'});
 else{
  if(selected.printStability.volume<1000)issues.push({reason:'small_component',volume:selected.printStability.volume});
  if(selected.printStability.stableUnderGravity!==true)issues.push({reason:'unstable_print_pose'});
  if(selected.overhang.needsFurtherSplit)issues.push({reason:'severe_overhang',area:selected.overhang.severeArea});
 }
 return {printPoseAvailable:!!selected,printStability:selected?.printStability??null,overhang:selected?.overhang??null,bedContactArea:selected?.connectedBedContactArea??0,bedFace:selected?'cut':undefined,requiresCutFace:!selected,cutQuality:{version:1,issues},cutOrientation:selected?{candidates:pose.candidates.length,objective:'stability-overhang-fit',revalidated:true}:undefined};
}
function restore(raw,ctx){
 const value=record(detached(raw),'part');
 if(value.exactProjectVersion!==undefined&&value.exactProjectVersion!==1)throw fail('project_part_version');
 if(value.nativeGeometry!==undefined)throw fail('mixed_geometry_backends');
 for(const key of ['supports','connectorHoles','connectorPlan'])if(value[key]!=null)throw fail('unsupported_exact_'+key);
 if(value.mark!=null&&value.exactMachining==null)throw fail('unsupported_exact_mark');
 if(!Object.hasOwn(value,'exactPoseReview')||!Object.hasOwn(value,'exactInteriorPermission'))throw fail('exact_metadata_missing');
 const binding=validateExactBinding(value),authority=binding.authority,storedPose=value.exactPoseReview;
 if(!authority.vertexCount||!authority.faceCount)throw fail('empty_project_part');
 const localPose=storedPose===null?null:validateExactPrintPoseReview(storedPose,authority);
 if(localPose?.configuration.posePolicy==='manual'&&!localPose.selected)throw fail('manual_pose_unavailable');
 const expected=localPose?.selected?new Matrix4().fromArray(localPose.selected.assemblyToPrint).invert().toArray():identity;
 if(!Array.isArray(value.assemblyMatrix)||value.assemblyMatrix.length!==16||value.assemblyMatrix.some((n,i)=>n!==expected[i]))throw fail('display_pose_does_not_match_review');
 const display=deriveExactDisplay(authority,{assemblyMatrix:value.assemblyMatrix,precision:binding.display.precision});
 const rights=permission(value.exactInteriorPermission,authority,display.assemblyMatrix,ctx);
 let machined={};
 if(value.exactMachining!=null){
  const token=Object.freeze({kind:'exact-project-context'});contexts.set(token,ctx);
  const checked=validateExactMachining(value.exactMachining,{context:token});
  const manual=localPose?.configuration.posePolicy==='manual';
  // Machining evidence is revalidated in its original immutable print frame.
  // An explicit later manual pose changes only its local mark description and
  // display binding; it must not rewrite the saved cutter or Boolean evidence.
  const posedMark=manual&&localPose.selected?transformMarkLocation(checked.mark,new Matrix4().fromArray(localPose.selected.assemblyToPrint).multiply(new Matrix4().fromArray(checked.base.assemblyMatrix))):checked.mark;
  if(checked.authority.authorityHash!==authority.authorityHash||JSON.stringify(posedMark)!==JSON.stringify(value.mark)||JSON.stringify(checked.permission)!==JSON.stringify(rights.exactInteriorPermission)||!manual&&(JSON.stringify(checked.poseReview.configuration)!==JSON.stringify(localPose?.configuration)||JSON.stringify(checked.poseReview.selected?.assemblyToPrint)!==JSON.stringify(localPose?.selected?.assemblyToPrint)))throw fail('machining_result_mismatch');
  if(value.plannedMark!=null)throw fail('planned_mark_after_machining');
  machined={mark:freeze(posedMark),exactMachining:checked.evidence,exactMachiningProof:checked.proof};
 }
 const annotations=metadata(value);if(machined.mark)delete annotations.plannedMarkIssue;
 return {...display,...annotations,...rights,...refreshedQuality(localPose),...machined,exactGeometry:binding,exactPoseReview:freeze(storedPose),exactProjectVersion:1,reviewRequired:true,printable:false};
}
export function restoreExactProjectPart(raw,options={}){return restore(raw,context(options));}

/** Heavy validation belongs in the project worker. The returned record contains
 * a compact child-rights reference, never its full original source capture. */
export function serializeExactProjectPart(part,options={}){
 const p=restore(part,context(options));
 return {exactProjectVersion:1,exactGeometry:p.exactGeometry,exactPoseReview:p.exactPoseReview,exactInteriorPermission:p.exactInteriorPermission,vertices:p.vertices,triangles:p.triangles,displayFaceToExactFace:p.displayFaceToExactFace,assemblyMatrix:p.assemblyMatrix,id:p.id,name:p.name,color:p.color,note:p.note,...(p.exactLeafId!==undefined?{exactLeafId:p.exactLeafId}:{}),...(p.plannedMark?{plannedMark:p.plannedMark}:{}),...(p.plannedMarkIssue!==undefined?{plannedMarkIssue:p.plannedMarkIssue}:{}),...(p.exactMachining?{mark:p.mark,exactMachining:p.exactMachining}:{})};
}

/** Stage an exact leaf without any rounded-mesh boolean or legacy adoption. */
export function createExactProjectPart({source,poseReview,permission:selection=null,metadata:annotations={},permissionSources,context:providedContext}={}){
 if(poseReview===undefined)throw fail('exact_metadata_missing');
 const ctx=context({permissionSources,context:providedContext}),input=detached({source,poseReview,selection,annotations});
 if(!input.annotations||typeof input.annotations!=='object'||Array.isArray(input.annotations)||Object.keys(input.annotations).some(k=>!['id','name','color','note','exactLeafId','plannedMark','plannedMarkIssue'].includes(k)))throw fail('creation_metadata');
 const local=input.poseReview===null?null:validateExactPrintPoseReview(input.poseReview,input.source),assemblyMatrix=local?.selected?new Matrix4().fromArray(local.selected.assemblyToPrint).invert().toArray():[...identity];
 const display=deriveExactDisplay(input.source,{assemblyMatrix}),exactGeometry=bindExactGeometry(display,input.source);
 return restore({...display,...metadata(input.annotations),exactGeometry,exactPoseReview:input.poseReview,exactInteriorPermission:input.selection},ctx);
}
