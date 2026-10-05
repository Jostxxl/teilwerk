import {Matrix3,Matrix4,Vector3} from 'three';
import {validateExactAuthority,exactAuthorityDisplaySource,exactHash,parseExactRational,exactRationalToNumber} from './exact-geometry.mjs';
import {validateExactPlane,exactPlaneFromPrintPose,createExactHalfspaceCutter} from './exact-planar-cutter.mjs';
import {cutFacePrintPoses,connectedCutContactArea} from './cut-orientation.mjs';
import {comparePrintPoses} from './print-pose-ranking.mjs';
import {bounds} from './engine.mjs';
import {overhangMetrics} from './overhang-metrics.mjs';
import {printStability} from './print-stability.mjs';
import {massCutCandidates,stabilityCutCandidates} from './mass-cut-candidates.mjs';
import {generateSupportPivotCandidates} from './support-pivot-candidates.mjs';

// Geometry stays in the immutable rational assembly frame. Float64 surfaces
// below serve only to compare physical poses and propose planes, never as CSG
// operands. The chosen pose is bound before any refinement plane is generated.
const fail=message=>Object.assign(Error(`Drucklagenprüfung: ${message}.`),{code:'EXACT_POSE_REJECTED'});
const freeze=value=>{if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const numeric=q=>exactRationalToNumber(parseExactRational(q)).number;
function rigid(value){
 if(!Array.isArray(value)||value.length!==16||!Array.from(value).every(Number.isFinite))throw fail('ungültige Drucklage');
 // The exact plane adapter validates handedness and rigidity, without changing
 // a single coefficient of the stored candidate matrix.
 exactPlaneFromPrintPose({normal:[0,0,1],offset:0,assemblyToPrint:value});return [...value];
}
function config(options){
 if(!options||Object.keys(options).some(k=>!['usableBed','cutPlanes','retainedAssemblyToPrint','posePolicy'].includes(k)))throw fail('ungültige Einstellungen');
 const bed=options.usableBed;if(!Array.isArray(bed)||bed.length!==3||!Array.from(bed).every(x=>Number.isFinite(x)&&x>=1&&x<=10000))throw fail('ungültiger Bauraum');
 const manual=options.posePolicy==='manual';
 if(!Array.isArray(options.cutPlanes)||(!options.cutPlanes.length&&!manual)||options.cutPlanes.length>128)throw fail('geprüfte Schnittflächen fehlen');
 const planes=options.cutPlanes.map(validateExactPlane).sort((a,b)=>a.planeHash.localeCompare(b.planeHash));
 if(new Set(planes.map(p=>p.planeHash)).size!==planes.length)throw fail('doppelte Schnittfläche');
 const posePolicy=options.posePolicy??'search';if(!['search','retain','manual'].includes(posePolicy)||(posePolicy==='retain'||manual)&&!options.retainedAssemblyToPrint)throw fail('beizubehaltende Drucklage fehlt');
 return {usableBed:[...bed],cutPlanes:planes,posePolicy,...(options.retainedAssemblyToPrint?{retainedAssemblyToPrint:rigid(options.retainedAssemblyToPrint)}:{})};
}
function floatPlanes(planes){return planes.map(p=>{const normal=p.normal.map(numeric),length=Math.hypot(...normal);if(!Number.isFinite(length)||length<=0)throw fail('Schnittfläche ist numerisch nicht auswertbar');return {normal:normal.map(x=>x/length),offset:numeric(p.offset)/length};});}
function source(authority,configuration){
 const a=validateExactAuthority(authority),derived=exactAuthorityDisplaySource(a);
 if(derived.rounding.distinctExactPointsCollapsed||derived.rounding.nonzeroCoordinatesRoundedToZero)throw fail('Darstellungsrundung verhindert eine verlässliche Drucklagenbewertung');
 return {authority:a,data:{vertices:derived.vertices,triangles:derived.triangles,cutPlanes:floatPlanes(configuration.cutPlanes)},rounding:derived.rounding};
}
function posed(data,coefficients){
 const matrix=new Matrix4().fromArray(coefficients),normalMatrix=new Matrix3().getNormalMatrix(matrix),point=new Vector3(),vertices=new Float64Array(data.vertices.length);
 for(let i=0;i<vertices.length;i+=3){point.fromArray(data.vertices,i).applyMatrix4(matrix).toArray(vertices,i);}
 const cutPlanes=data.cutPlanes.map(p=>{const n=new Vector3(...p.normal),on=n.clone().multiplyScalar(p.offset).applyMatrix4(matrix);n.applyMatrix3(normalMatrix).normalize();return {normal:n.toArray(),offset:on.dot(n)};});
 return {vertices,triangles:data.triangles,cutPlanes};
}
function measure(data,matrix,bed,manual=false){
 const geometry=posed(data,matrix),size=bounds(geometry).size,contact=connectedCutContactArea(manual?{...geometry,cutPlanes:[{normal:[0,0,-1],offset:0}]}:geometry),stability=printStability(geometry),overhang=overhangMetrics(geometry);
 if(!size.every((x,i)=>Number.isFinite(x)&&x<=bed[i]+.005)||!stability.valid||!Number.isFinite(contact)||!manual&&contact<50||!Number.isFinite(overhang.supportArea)||!Number.isFinite(overhang.severeArea))return null;
 const score=overhang.severeArea*1e6+overhang.supportArea*100-contact+size[2]*.001;
 return {assemblyToPrint:[...matrix],size,connectedBedContactArea:contact,printStability:stability,overhang,score};
}
function review(authority,options){
 const configuration=config(options),input=source(authority,configuration),manual=configuration.posePolicy==='manual',bank=configuration.posePolicy==='retain'||manual?[]:cutFacePrintPoses(input.data,configuration.usableBed),seen=new Set(),candidates=[];
 const matrices=[...(configuration.retainedAssemblyToPrint?[{matrix:configuration.retainedAssemblyToPrint,origin:'retained'}]:[]),...bank.map(p=>({matrix:p.transform,origin:'cut-face-search'}))];
 for(const {matrix,origin}of matrices){const values=rigid(matrix),key=JSON.stringify(values);if(seen.has(key))continue;seen.add(key);const measured=measure(input.data,values,configuration.usableBed,manual);if(measured)candidates.push({...measured,origin});}
 candidates.sort((a,b)=>comparePrintPoses(a,b));
 const metadata={kind:'exactPrintPoseReview',version:1,frame:'assembly',authorityHash:input.authority.authorityHash,meshHash:input.authority.meshHash,configuration,candidates,selectedIndex:candidates.length?0:null,selected:candidates[0]??null,orientationBeforeRefinement:true,objective:'stability-overhang-fit',finiteSearch:true,globalOptimumProven:false,rounding:input.rounding,reviewRequired:true,printable:false};
 return {value:freeze({...metadata,reviewHash:exactHash(`EXACT_PRINT_POSE_REVIEW_1\n${JSON.stringify(metadata)}`)}),input};
}
export function reviewExactPrintPoses(authority,options){return review(authority,options).value;}
function validated(value,authority){
 if(!value||value.kind!=='exactPrintPoseReview')throw fail('zuerst eine Drucklage wählen');
 const {reviewHash:storedReviewHash,...storedMetadata}=value;
 if(storedReviewHash!==exactHash(`EXACT_PRINT_POSE_REVIEW_1\n${JSON.stringify(storedMetadata)}`))throw fail('gespeicherte Drucklagenprüfung wurde verändert');
 const result=review(authority,value.configuration);
 // V8 versions may differ by a last bit in transcendental diagnostics. Never
 // transplant cached COM, overhangs or scores into the local computation, and
 // never round a literal matrix to make it match. Rebuild the ENTIRE ordered
 // bank and winner locally; only cached diagnostic values are replaced.
 const signature=p=>p?{origin:p.origin,assemblyToPrint:rigid(p.assemblyToPrint)}:null;
 const identity=r=>{
  const {reviewHash,candidates,selected,...metadata}=r;
  if(!Array.isArray(candidates)||candidates.length!==result.value.candidates.length||JSON.stringify(selected)!==JSON.stringify(r.selectedIndex===null?null:candidates[r.selectedIndex]))throw fail('gewählte Drucklage passt nicht zur Kandidatenliste');
  return {metadata,bank:candidates.map(signature),selected:signature(selected)};
 };
 if(JSON.stringify(identity(value))!==JSON.stringify(identity(result.value)))throw fail('Modell, Kandidatenliste oder gewählte Drucklage wurden verändert');
 return {...result,storedReviewHash};
}
/** Returns a freshly measured LOCAL review with its own consistent hash. Keep
 * the original stored review when validating an existing bound refinement. */
export function validateExactPrintPoseReview(value,authority){return validated(value,authority).value;}
// Legacy records omit candidatePolicy. Their options, order and hash domain are
// retained literally; new policy records cannot masquerade as version one.
export function proposeExactPoseRefinement(authority,poseReview,options={}){
 if(!options||typeof options!=='object'||Array.isArray(options))throw fail('ungültige Vorschlagseinstellungen');
 const candidatePolicy=options.candidatePolicy??'legacy-v1';
 if(options.candidatePolicy!==undefined&&!['legacy-v1','support-pivot-v2'].includes(options.candidatePolicy))throw fail('unbekannte Schnittvorschlagspolitik');
 if(candidatePolicy==='support-pivot-v2')return proposeSupportPivotRefinement(authority,poseReview,options);
 if(Object.keys(options).some(k=>!['maxMassCandidates','maxStabilityCandidates','candidatePolicy'].includes(k)))throw fail('ungültige Vorschlagseinstellungen');
 const {maxMassCandidates=8,maxStabilityCandidates=8}=options;
 if(!Number.isInteger(maxMassCandidates)||maxMassCandidates<0||maxMassCandidates>32||!Number.isInteger(maxStabilityCandidates)||maxStabilityCandidates<0||maxStabilityCandidates>24||maxMassCandidates+maxStabilityCandidates>32)throw fail('zu viele Schnittvorschläge');
 const {value,input,storedReviewHash}=validated(poseReview,authority),selected=value.selected;
 if(!selected)throw fail('keine passende Drucklage für eine Schnittverfeinerung vorhanden');
 const geometry=posed(input.data,selected.assemblyToPrint),com=selected.printStability.centerOfMass,candidates=massCutCandidates(geometry,{centerOfMass:com,maxCandidates:maxMassCandidates});
 if(selected.printStability.stableUnderGravity!==true&&maxStabilityCandidates)candidates.push(...stabilityCutCandidates(geometry,{centerOfMass:com,contactHull:selected.printStability.contact.hull,maxCandidates:maxStabilityCandidates}));
 const planes=[],seen=new Set();for(const candidate of candidates){const plane=exactPlaneFromPrintPose({normal:candidate.normal,offset:candidate.offset,assemblyToPrint:selected.assemblyToPrint});if(seen.has(plane.planeHash))continue;seen.add(plane.planeHash);planes.push({id:String(planes.length+1),printProposal:candidate,assemblyPlane:plane});}
 const metadata={kind:'exactPoseRefinement',version:1,authorityHash:input.authority.authorityHash,meshHash:input.authority.meshHash,poseReviewHash:storedReviewHash,assemblyToPrint:[...selected.assemblyToPrint],options:{maxMassCandidates,maxStabilityCandidates},planes,orientationBeforeRefinement:true,reviewRequired:true,printable:false};
 return freeze({...metadata,refinementHash:exactHash(`EXACT_POSE_REFINEMENT_1\n${JSON.stringify(metadata)}`)});
}

const pivotPolicy=Object.freeze({tiltDegrees:Object.freeze([15,20,25,30,35,40,45]),azimuthDegrees:Object.freeze([-30,-15,0,15,30]),liftMm:Object.freeze([10,25,40]),minimumInteriorClearance:.1});
function proposeSupportPivotRefinement(authority,poseReview,options){
 if(Object.keys(options).some(k=>!['candidatePolicy','maxPivotCandidates'].includes(k)))throw fail('ungültige Pivot-Einstellungen');
 const maxPivotCandidates=options.maxPivotCandidates??32;
 if(!Number.isInteger(maxPivotCandidates)||maxPivotCandidates<0||maxPivotCandidates>32)throw fail('zu viele Pivot-Vorschläge');
 const {value,input,storedReviewHash}=validated(poseReview,authority),selected=value.selected;
 if(!selected)throw fail('keine passende Drucklage für eine Schnittverfeinerung vorhanden');
 // This literal evaluation order is part of support-pivot-v2. It matches the
 // independently checked original experiments, including a non-unit affine w.
 const T=selected.assemblyToPrint,vertices=new Float64Array(input.data.vertices.length);
 for(let i=0;i<vertices.length;i+=3){const x=input.data.vertices[i],y=input.data.vertices[i+1],z=input.data.vertices[i+2],w=T[3]*x+T[7]*y+T[11]*z+T[15];for(let k=0;k<3;k++)vertices[i+k]=(T[k]*x+T[k+4]*y+T[k+8]*z+T[k+12])/w;}
 const bank=generateSupportPivotCandidates({vertices},{...pivotPolicy,maximumCandidates:maxPivotCandidates,centerOfMass:selected.printStability.centerOfMass,contactHull:selected.printStability.contact.hull});
 const planes=[],seen=new Set();
 for(const candidate of bank.candidates){const plane=exactPlaneFromPrintPose({normal:candidate.normal,offset:candidate.offset,assemblyToPrint:T});if(seen.has(plane.planeHash))continue;seen.add(plane.planeHash);planes.push({id:String(planes.length+1),printProposal:candidate,assemblyPlane:plane});}
 const metadata={kind:'exactPoseRefinement',version:2,authorityHash:input.authority.authorityHash,meshHash:input.authority.meshHash,poseReviewHash:storedReviewHash,assemblyToPrint:[...T],options:{candidatePolicy:'support-pivot-v2',maxPivotCandidates},pivotPolicy,planes,orientationBeforeRefinement:true,reviewRequired:true,printable:false};
 return freeze({...metadata,refinementHash:exactHash(`EXACT_POSE_REFINEMENT_2\n${JSON.stringify(metadata)}`)});
}

export function exactRefinementCutter(authority,poseReview,refinement,candidateId){
 if(!refinement||refinement.kind!=='exactPoseRefinement')throw fail('Schnittvorschlag fehlt');
 const expected=proposeExactPoseRefinement(authority,poseReview,refinement.options);
 if(JSON.stringify(expected)!==JSON.stringify(refinement))throw fail('Schnittvorschlag passt nicht zur zuvor gewählten Drucklage');
 const candidate=expected.planes.find(p=>p.id===candidateId);if(!candidate)throw fail('Schnittvorschlag nicht gefunden');
 return createExactHalfspaceCutter(authority.meshText,{plane:candidate.assemblyPlane});
}
