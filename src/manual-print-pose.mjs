import {Matrix3,Matrix4,Vector3} from 'three';
import {bounds} from './engine.mjs';
import {validateNativeBinding,rebindNativePose} from './native-geometry-binding.mjs';
import {transformMarkLocation} from './mark-locations.mjs';
import {printStability} from './print-stability.mjs';
import {overhangMetrics} from './overhang-metrics.mjs';
import {connectedCutContactArea} from './cut-orientation.mjs';
import {prepareExactManualPrintPose} from './exact-manual-print-pose.mjs';

const identity=()=>new Matrix4().toArray();
const fail=(reason,message)=>Object.assign(Error(`Manuelle Drucklage: ${message}`),{code:'MANUAL_PRINT_POSE_REJECTED',reason});
function rigid(value,label){
 if(!Array.isArray(value)||value.length!==16||!Array.from(value).every(Number.isFinite))throw fail('invalid_matrix',`${label} ist keine endliche Matrix.`);
 const m=new Matrix4().fromArray(value),e=m.elements;
 if(e[3]!==0||e[7]!==0||e[11]!==0||Math.abs(e[15]-1)>8*Number.EPSILON||Math.abs(m.determinant()-1)>1e-8)throw fail('nonrigid_matrix',`${label} muss eine starre Drehung/Verschiebung sein.`);
 for(let i=0;i<3;i++)for(let j=i;j<3;j++){let d=0;for(let k=0;k<3;k++)d+=e[i*4+k]*e[j*4+k];if(Math.abs(d-(i===j?1:0))>1e-8)throw fail('nonrigid_matrix',`${label} darf nicht skalieren oder scheren.`);}
 return m;
}
function mesh(value){
 const v=value?.vertices,t=value?.triangles;
 if(!v||!t||!v.length||!t.length||v.length%3||t.length%3||v.length>6000000||t.length>12000000||Array.from(v).some(x=>!Number.isFinite(x))||Array.from(t).some(x=>!Number.isInteger(x)||x<0||x>=v.length/3))throw fail('invalid_mesh','Ungültiges Teilnetz.');
}
function points(vertices,matrix,ArrayType=Float64Array){const out=new ArrayType(vertices.length),p=new Vector3();for(let i=0;i<out.length;i+=3)p.fromArray(vertices,i).applyMatrix4(matrix).toArray(out,i);return out;}
function direction(vector,matrix){if(!Array.isArray(vector)||vector.length!==3||!vector.every(Number.isFinite)||Math.hypot(...vector)<=0)throw fail('invalid_direction','Ungültige lokale Flächennormale.');return new Vector3(...vector).applyNormalMatrix(new Matrix3().getNormalMatrix(matrix)).toArray();}
function point(vector,matrix){if(!Array.isArray(vector)||vector.length!==3||!vector.every(Number.isFinite))throw fail('invalid_point','Ungültiger lokaler Punkt.');return new Vector3(...vector).applyMatrix4(matrix).toArray();}
function source(part){
 if(!part||part.exactGeometry!==undefined)throw fail('exact_adapter_required','Exakte Teile benötigen den gesonderten manuellen Exact-Pose-Adapter. Ihre Geometrie wird nicht nach Legacy konvertiert.');
 mesh(part);const assembly=rigid(part.assemblyMatrix??identity(),'Gespeicherte Montagelage');
 if(part.transform!==undefined)throw fail('uncommitted_transform','Zuerst die bestehende Vorschau übernehmen oder verwerfen.');
 const binding=part.nativeGeometry!==undefined?validateNativeBinding(part):null;
 return {part,assembly,binding,vertices:binding?binding.snapshot.vertices:points(part.vertices,assembly),triangles:binding?binding.snapshot.triangles:part.triangles};
}
function relocateRegion(region,local){if(region==null)return region;mesh(region);return {...region,vertices:points(region.vertices,local),triangles:new Uint32Array(region.triangles)};}
function materialize(src,assemblyToPrint){
 const before=src.part,assemblyMatrix=assemblyToPrint.clone().invert().toArray(),local=assemblyToPrint.clone().multiply(src.assembly),out={...before,vertices:points(src.vertices,assemblyToPrint,Float32Array),triangles:new Uint32Array(src.triangles),assemblyMatrix};
 for(const key of ['interiorRegion','interiorBaseRegion'])if(Object.hasOwn(before,key))out[key]=relocateRegion(before[key],local);
 // Indexed selection seeds only survive if native display topology is identical.
 if(src.binding&&(out.triangles.length!==before.triangles.length||out.triangles.some((v,i)=>v!==before.triangles[i])||out.vertices.length!==before.vertices.length)){
  if(before.interiorSeeds?.length)throw fail('selection_topology_changed','Die gespeicherten Auswahlindizes passen nicht zum nativen Drucknetz.');
 }
 for(const key of ['mark','plannedMark'])if(before[key]!=null)out[key]={...before[key],...transformMarkLocation(before[key],local)};
 if(before.cutPlanes)out.cutPlanes=before.cutPlanes.map(p=>{const n=direction(p.normal,local),q=point(p.normal.map(x=>x*p.offset),local);return {...p,normal:n,offset:q.reduce((s,x,i)=>s+x*n[i],0)};});
 if(before.connectorHoles)out.connectorHoles=before.connectorHoles.map(h=>({...h,positions:h.positions.map(p=>point(p,local)),inward:direction(h.inward,local)}));
 out.supports=undefined;out.supportOrientation=undefined;out.cutOrientation=undefined;out.largestFace=undefined;
 out.supportNotice=before.supports?'Die Drucklage wurde manuell geändert. Vorhandene Finnen wurden verworfen; Finnen nach der Ausrichtung neu setzen.':undefined;
 out.overhang=overhangMetrics(out);out.printStability=printStability(out);
 // The manual bed can be any existing surface, not only an old cut face. This
 // temporary plane is a measurement filter; it never enters cut provenance or
 // the user's permitted interior geometry.
 out.bedContactArea=connectedCutContactArea({...out,cutPlanes:[{normal:[0,0,-1],offset:0}]});
 out.bedFace=out.cutPlanes?.some(p=>Math.abs(Math.abs(p.normal[2])-1)<1e-8&&Math.abs(p.offset)<1e-4)&&out.bedContactArea>0?'cut':'surface';out.requiresCutFace=out.bedContactArea<1;
 if(!out.printStability.valid)throw fail('invalid_quality','Das neue Drucknetz besitzt keine gültige geschlossene positive Volumenbewertung.');
 if(src.binding){out.nativeGeometry=rebindNativePose(before,out);if(out.nativeGeometry.payload!==before.nativeGeometry.payload||out.nativeGeometry.snapshotHash!==before.nativeGeometry.snapshotHash)throw fail('native_material_changed','Der native Montagekörper wurde verändert.');validateNativeBinding(out);}
 return {part:out,localTransform:local.toArray(),size:bounds(out).size};
}

/** Only printing coordinates change. The caller retains the connector plan and
 * commits current/base replacement together after its project-wide token guard.
 * Native snapshots are rebound in JS, without restore, Boolean or re-engraving. */
export function prepareManualPrintPose({part,connectorBasePart,localTransform,usableBed,context,permissionSources}={}){
 if(part?.exactGeometry!==undefined)return prepareExactManualPrintPose({part,connectorBasePart,localTransform,usableBed,context,permissionSources});
 if(!Array.isArray(usableBed)||usableBed.length!==3||!Array.from(usableBed).every(x=>Number.isFinite(x)&&x>=1&&x<=10000))throw fail('invalid_bed','Ungültiger nutzbarer Bauraum.');
 const requested=rigid(localTransform,'Gewünschte Druckänderung');
 // Detach before producing any staged result; public preview edits never touch
 // source or sibling metadata. This function itself has no asynchronous gap.
 const current=source(structuredClone(part)),base=connectorBasePart==null?null:source(structuredClone(connectorBasePart));
 if(base&&String(base.part.id)!==String(current.part.id))throw fail('base_id_mismatch','Basisteil und aktuelles Teil haben verschiedene Nummern.');
 if(current.part.connectorHoles?.length&&!base)throw fail('connector_base_missing','Für ein gebohrtes Teil muss das ungebohrte Basisteil mitgeführt werden.');
 if(base?.part.connectorHoles?.length)throw fail('base_already_drilled','Das gespeicherte Basisteil enthält bereits Bohrungen.');
 const moved=requested.clone().multiply(current.assembly.clone().invert()),extent={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};
 for(const src of [current,...(base?[base]:[])]){const p=points(src.vertices,moved);for(let i=0;i<p.length;i++){const k=i%3;extent.min[k]=Math.min(extent.min[k],p[i]);extent.max[k]=Math.max(extent.max[k],p[i]);}}
 const ground=new Matrix4().makeTranslation(-(extent.min[0]+extent.max[0])/2,-(extent.min[1]+extent.max[1])/2,-extent.min[2]),assemblyToPrint=ground.multiply(moved);
 const staged=materialize(current,assemblyToPrint),stagedBase=base?materialize(base,assemblyToPrint):null;
 for(const value of [staged,...(stagedBase?[stagedBase]:[])])if(value.size.some((x,i)=>x>usableBed[i]+.005))throw fail('bed_overflow','Die gewählte Lage passt nicht in den nutzbaren Bauraum; beide Teile bleiben unverändert.');
 const warnings=[];if(staged.part.printStability.stableUnderGravity!==true)warnings.push('Die gewählte Drucklage ist ohne zusätzliche Abstützung nicht standfest.');if(staged.part.overhang.needsFurtherSplit)warnings.push('Die gewählte Drucklage enthält starke Überhänge.');if(current.part.supports||base?.part.supports)warnings.push('Vorhandene Finnen werden mit der Übernahme verworfen und müssen für diese Lage neu gesetzt werden.');
 return {schema:'prinjekt-manual-print-pose-v1',part:staged.part,...(stagedBase?{connectorBasePart:stagedBase.part}:{}),localTransform:staged.localTransform,...(stagedBase?{baseLocalTransform:stagedBase.localTransform}:{}),assemblyToPrint:assemblyToPrint.toArray(),usableBed:[...usableBed],warnings,quality:{size:staged.size,classification:staged.part.printStability.classification,bedContactArea:staged.part.bedContactArea,printStability:staged.part.printStability,overhang:staged.part.overhang},geometryChanged:false,assemblyChanged:false,connectorPlanChanged:false,nativeCalls:0,printable:false};
}
