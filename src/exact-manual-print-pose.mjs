import {Matrix4,Vector3} from 'three';
import {exactAuthorityDisplaySource} from './exact-geometry.mjs';
import {exactPlaneFromPrintPose} from './exact-planar-cutter.mjs';
import {reviewExactPrintPoses} from './exact-pose-review.mjs';
import {createExactProjectContext,restoreExactProjectPart,createExactProjectPart} from './exact-project.mjs';
import {transformMarkLocation} from './mark-locations.mjs';

const fail=(reason,message)=>Object.assign(Error(`Manuelle exakte Drucklage: ${message}`),{code:'MANUAL_PRINT_POSE_REJECTED',reason});
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
/** Assembly authority and machining history stay literal. The explicit manual
 * pose is freshly measured, including no-contact/unstable warnings. This is not
 * an automatic stability-approved search result or a different CSG operand. */
export function prepareExactManualPrintPose({part,connectorBasePart,localTransform,usableBed,context,permissionSources}={}){
 if(connectorBasePart!=null)throw fail('unsupported_exact_connector_base','Exakte Passstift-Basisteile werden noch nicht unterstützt.');
 exactPlaneFromPrintPose({normal:[0,0,1],offset:0,assemblyToPrint:localTransform});
 if(!Array.isArray(usableBed)||usableBed.length!==3||!Array.from(usableBed).every(x=>Number.isFinite(x)&&x>=1&&x<=10000))throw fail('invalid_bed','Ungültiger nutzbarer Bauraum.');
 const shared=context??createExactProjectContext({permissionSources}),base=restoreExactProjectPart(part,{context:shared}),authority=base.exactGeometry.authority,source=exactAuthorityDisplaySource(authority);
 const moved=new Matrix4().fromArray(localTransform).multiply(new Matrix4().fromArray(base.assemblyMatrix).invert()),min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity],point=new Vector3();
 for(let i=0;i<source.vertices.length;i+=3){point.fromArray(source.vertices,i).applyMatrix4(moved);for(let k=0;k<3;k++){const x=point.getComponent(k);min[k]=Math.min(min[k],x);max[k]=Math.max(max[k],x);}}
 const assemblyToPrint=new Matrix4().makeTranslation(-(min[0]+max[0])/2,-(min[1]+max[1])/2,-min[2]).multiply(moved);
 const poseReview=reviewExactPrintPoses(authority,{usableBed,cutPlanes:base.exactPoseReview?.configuration.cutPlanes??[],posePolicy:'manual',retainedAssemblyToPrint:assemblyToPrint.toArray()});
 if(!poseReview.selected)throw fail('manual_pose_unavailable','Die gewünschte Lage passt nicht in den Bauraum oder ist nicht verlässlich messbar.');
 const local=assemblyToPrint.clone().multiply(new Matrix4().fromArray(base.assemblyMatrix)),metadata={};
 for(const key of ['id','name','color','note','exactLeafId','plannedMarkIssue'])if(base[key]!==undefined)metadata[key]=base[key];
 if(base.plannedMark)metadata.plannedMark={...base.plannedMark,...transformMarkLocation(base.plannedMark,local)};
 let out=createExactProjectPart({source:authority,poseReview,permission:base.exactInteriorPermission,metadata,context:shared});
 if(base.exactMachining){
  // Use the immutable ORIGINAL machining frame even after repeated reposing.
  // Its stored guard, cutter and three native results are never transformed.
  const evidence=base.exactMachining,mark=transformMarkLocation(evidence.plan.mark,assemblyToPrint.clone().multiply(new Matrix4().fromArray(evidence.base.assemblyMatrix)));
  out=restoreExactProjectPart({...out,mark,exactMachining:evidence},{context:shared});
  if(!equal(out.exactMachining,evidence))throw fail('machining_changed','Die ursprüngliche Gravurbeweiskette wurde verändert.');
 }
 if(!equal(out.exactGeometry.authority,authority)||!equal(out.exactInteriorPermission,base.exactInteriorPermission))throw fail('material_or_permission_changed','Montagekörper oder Innenfreigabe wurden verändert.');
 const selected=poseReview.selected,warnings=[];if(selected.printStability.stableUnderGravity!==true)warnings.push('Die gewählte Drucklage ist ohne zusätzliche Abstützung nicht standfest.');if(selected.overhang.needsFurtherSplit)warnings.push('Die gewählte Drucklage enthält starke Überhänge.');
 return {schema:'prinjekt-manual-print-pose-v1',part:out,localTransform:local.toArray(),assemblyToPrint:assemblyToPrint.toArray(),usableBed:[...usableBed],warnings,quality:{size:selected.size,classification:selected.printStability.classification,bedContactArea:selected.connectedBedContactArea,printStability:selected.printStability,overhang:selected.overhang},geometryChanged:false,assemblyChanged:false,connectorPlanChanged:false,nativeCalls:0,printable:false};
}
