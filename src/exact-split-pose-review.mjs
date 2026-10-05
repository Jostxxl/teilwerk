import {exactHash,validateExactAuthority} from './exact-geometry.mjs';
import {validateExactPrintPoseReview,reviewExactPrintPoses,exactRefinementCutter} from './exact-pose-review.mjs';
import {materializeExactSplitPartition} from './exact-split-partition.mjs';
import {deriveExactSupportPlanes} from './exact-support-planes.mjs';

const fail=reason=>Object.assign(Error(`Gemeinsame Drucklagenprüfung: ${reason}.`),{code:'EXACT_SPLIT_POSE_REJECTED',reason});
const freeze=v=>{if(v&&typeof v==='object'&&!Object.isFrozen(v)){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const tolerances=Object.freeze({supportArea:0.01,severeArea:0.01,minimumTiltGainDegrees:0.1,minimumContactArea:50,minimumMaterialVolume:1000});
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const positive=p=>p?.printStability?.valid===true&&p.printStability.stableUnderGravity===true&&finite(p.printStability.minimumMargin)&&p.printStability.minimumMargin>0;
const stable=p=>positive(p)&&p.printStability.classification==='stable';
const tilt=p=>p?.printStability?.gravityMargin?.criticalTiltDegrees;
function usable(p,bed){return positive(p)&&Array.isArray(p.size)&&p.size.length===3&&Array.from(p.size).every((n,i)=>finite(n)&&n>=0&&n<=bed[i]+.005)&&finite(p.connectedBedContactArea)&&p.connectedBedContactArea>=50&&finite(tilt(p))&&finite(p.overhang?.supportArea)&&p.overhang.supportArea>=0&&finite(p.overhang?.severeArea)&&p.overhang.severeArea>=0;}
const rank=(a,b)=>b.stableChildren-a.stableChildren||a.severeArea-b.severeArea||a.supportArea-b.supportArea||b.worstTiltDegrees-a.worstTiltDegrees||b.minimumContactArea-a.minimumContactArea||a.indexes[0]-b.indexes[0]||a.indexes[1]-b.indexes[1];

/** Rank freshly generated reviews only; this comparator is not a validator. */
export function compareExactSplitPoseReviews(a,b){
 const A=a?.acceptedForRefinement===true?a.selection?.selected:null,B=b?.acceptedForRefinement===true?b.selection?.selected:null;
 if(!!A!==!!B)return A?-1:1;
 return (A&&B?rank(A,B):0)||String(a?.candidateId??'').localeCompare(String(b?.candidateId??''));
}

/** Pure policy diagnostics, not validation of externally supplied pose records.
 * The public geometry wrapper below supplies only freshly measured banks. */
export function chooseExactSplitPosePair(banks,parent,usableBed){
 if(!Array.isArray(banks)||banks.length!==2||!Array.from(banks).every(b=>Array.isArray(b)&&b.length<=2048)||!Array.isArray(usableBed)||usableBed.length!==3||!Array.from(usableBed).every(n=>finite(n)&&n>=1&&n<=10000))throw fail('pair_configuration');
 if(!parent||!finite(parent.overhang?.supportArea)||!finite(parent.overhang?.severeArea))throw fail('parent_metrics');
 const noRefinementNeeded=stable(parent)&&usable(parent,usableBed);
 const rejections={},count=reason=>{rejections[reason]=(rejections[reason]??0)+1;};
 let selected=null,bestPositive=null,pairsReviewed=0;
 for(let i=0;i<banks[0].length;i++)for(let j=0;j<banks[1].length;j++){
  pairsReviewed++;const poses=[banks[0][i],banks[1][j]];
  if(!poses.every(p=>usable(p,usableBed))){count('child_pose_not_positive_and_fitting');continue;}
  // Fresh signed-volume measurements include cavities. This is a conservative
  // minimum-piece policy, not an exact rational material-conservation oracle.
  // A stable fitting parent still takes precedence: no new split is needed.
  if(!noRefinementNeeded&&!poses.every(p=>finite(p.printStability.volume)&&p.printStability.volume>=tolerances.minimumMaterialVolume)){count('child_below_minimum_volume');continue;}
  const pair={indexes:[i,j],stableChildren:poses.filter(stable).length,severeArea:poses.reduce((s,p)=>s+p.overhang.severeArea,0),supportArea:poses.reduce((s,p)=>s+p.overhang.supportArea,0),minimumMargin:Math.min(...poses.map(p=>p.printStability.minimumMargin)),worstTiltDegrees:Math.min(...poses.map(tilt)),minimumContactArea:Math.min(...poses.map(p=>p.connectedBedContactArea)),assemblyToPrint:poses.map(p=>[...p.assemblyToPrint])};
  if(!finite(pair.supportArea)||!finite(pair.severeArea)){count('nonfinite_combined_metrics');continue;}
  if(!bestPositive||rank(pair,bestPositive)<0)bestPositive=pair;
  let reason=null;
  if(noRefinementNeeded)reason='no_refinement_needed';
  else if(pair.supportArea>parent.overhang.supportArea+tolerances.supportArea)reason='support_increase';
  else if(pair.severeArea>parent.overhang.severeArea+tolerances.severeArea)reason='severe_overhang_increase';
  else if(stable(parent)&&pair.stableChildren!==2)reason='stable_parent_degraded';
  else if(positive(parent)&&!stable(parent)&&pair.stableChildren!==2&&(!finite(tilt(parent))||pair.worstTiltDegrees<tilt(parent)+tolerances.minimumTiltGainDegrees||pair.minimumMargin<parent.printStability.minimumMargin))reason='insufficient_marginal_improvement';
  // An actually unstable parent improves only when BOTH children pass the
  // positive-gravity gate above. Marginal children remain explicitly unresolved.
  if(reason){count(reason);continue;}
  if(!selected||rank(pair,selected)<0)selected=pair;
 }
 const reason=selected?'improved_split':noRefinementNeeded?'no_refinement_needed':Object.keys(rejections)[0]??'no_child_pose';
 return freeze({selected,bestPositive,pairsReviewed,rejections,reason,acceptedForRefinement:!!selected,needsRefinement:!selected||selected.stableChildren!==2,reviewRequired:true,printable:false});
}

/** Validate the complete frozen parent-pose → plane → cutter → shared split
 * chain, then jointly compare child poses. Exact assembly geometry is retained
 * unchanged; local floating measurements never become geometry operands. */
export function reviewExactSplitPoses(splitReview,options){
 if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>!['source','poseReview','refinement','candidateId'].includes(k)))throw fail('options');
 const {poseReview,refinement,candidateId}=options,source=validateExactAuthority(options.source);
 if(typeof candidateId!=='string'||!candidateId)throw fail('candidate_id');
 const parentReview=validateExactPrintPoseReview(poseReview,source),parent=parentReview.selected;
 if(!parent)throw fail('parent_pose_missing');
 const cutter=exactRefinementCutter(source,poseReview,refinement,candidateId);
 if(!same(parent.assemblyToPrint,refinement.assemblyToPrint))throw fail('parent_pose_changed');
 const splitOptions={source,cutter,poseReviewHash:poseReview.reviewHash,refinementHash:refinement.refinementHash};
 const parts=materializeExactSplitPartition(splitReview,splitOptions),bed=parentReview.configuration.usableBed;
 const children=parts.map(part=>{
  let review=null,issue=null;
  try{
   const planes=[...new Map([cutter.plane,...deriveExactSupportPlanes(part.geometry,{maximumPlanes:12,minimumArea:50})].map(p=>[p.planeHash,p])).values()];
   review=reviewExactPrintPoses(part.geometry,{usableBed:bed,cutPlanes:planes,posePolicy:'search',retainedAssemblyToPrint:parent.assemblyToPrint});
  }catch(error){
   if(!['EXACT_POSE_REJECTED','EXACT_SUPPORT_PLANES_REJECTED'].includes(error?.code))throw error;
   issue={code:error.code,reason:error.reason??error.message};
  }
  return {part,poseReview:review,issue};
 });
 const twoOwners=children.length===2&&new Set(children.map(c=>c.part.owner)).size===2;
 let selection;
 if(!twoOwners)selection={selected:null,bestPositive:null,pairsReviewed:0,rejections:{material_component_count:1},reason:'material_component_count',acceptedForRefinement:false,needsRefinement:true,reviewRequired:true,printable:false};
 else if(children.some(c=>c.part.nonManifoldEdges!==0))selection={selected:null,bestPositive:null,pairsReviewed:0,rejections:{non_manifold_child:1},reason:'non_manifold_child',acceptedForRefinement:false,needsRefinement:true,reviewRequired:true,printable:false};
 else selection=chooseExactSplitPosePair(children.map(c=>c.poseReview?.candidates??[]),parent,bed);
 const metadata={kind:'exactSplitPoseReview',version:1,frame:'assembly',sourceAuthorityHash:source.authorityHash,sourceMeshHash:source.meshHash,splitAuthorityHash:splitReview.authorityHash,splitStateHash:splitReview.stateHash,storedPoseReviewHash:poseReview.reviewHash,refinementHash:refinement.refinementHash,candidateId,cutterMeshHash:cutter.meshHash,plane:cutter.plane,usableBed:[...bed],parentReview,children,selection,acceptedForRefinement:selection.acceptedForRefinement,needsRefinement:selection.needsRefinement,childCount:children.length,allMaterialComponentsPreserved:true,orientationBeforeRefinement:true,policy:'strict-joint-positive-improvement-v1',tolerances,finiteSearch:true,globalOptimumProven:false,interiorPermissionTransferred:false,reviewRequired:true,printable:false};
 return freeze({...metadata,reviewHash:exactHash(`EXACT_SPLIT_POSE_REVIEW_1\n${JSON.stringify(metadata)}`)});
}

/** Stored metrics are a cache only. Rebuild geometry and all local decisions;
 * allow diagnostic last-bit differences only when the literal banks, chosen
 * pair and policy outcome still agree. Never transplant cached measurements. */
export function validateExactSplitPoseReview(value,splitReview,options){
 if(!value||value.kind!=='exactSplitPoseReview')throw fail('review');
 const {reviewHash,...metadata}=value;
 if(reviewHash!==exactHash(`EXACT_SPLIT_POSE_REVIEW_1\n${JSON.stringify(metadata)}`))throw fail('review_hash');
 const fresh=reviewExactSplitPoses(splitReview,options);
 const poseIdentity=r=>r?{configuration:r.configuration,authorityHash:r.authorityHash,meshHash:r.meshHash,bank:r.candidates.map(p=>({origin:p.origin,assemblyToPrint:p.assemblyToPrint})),selectedIndex:r.selectedIndex}:null;
 const identity=r=>{
  const {reviewHash,parentReview,children,selection,...rest}=r;
  return {...rest,parentReview:poseIdentity(parentReview),children:children.map(c=>({...c,poseReview:poseIdentity(c.poseReview)})),selection:{reason:selection.reason,acceptedForRefinement:selection.acceptedForRefinement,needsRefinement:selection.needsRefinement,pairsReviewed:selection.pairsReviewed,rejections:selection.rejections,selected:selection.selected?{indexes:selection.selected.indexes,assemblyToPrint:selection.selected.assemblyToPrint,stableChildren:selection.selected.stableChildren}:null,bestPositive:selection.bestPositive?{indexes:selection.bestPositive.indexes,assemblyToPrint:selection.bestPositive.assemblyToPrint,stableChildren:selection.bestPositive.stableChildren}:null}};
 };
 if(!same(identity(value),identity(fresh)))throw fail('review_binding_or_local_decision_changed');
 return fresh;
}
