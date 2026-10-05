// Pure orientation review; no native process, cuts or forest.
import {sha256} from '@noble/hashes/sha2.js';
import {exactHash} from './exact-geometry.mjs';
import {createExactProjectContext,restoreExactProjectPart,createExactProjectPart} from './exact-project.mjs';
import {deriveExactSupportPlanes} from './exact-support-planes.mjs';
import {reviewExactPrintPoses,validateExactPrintPoseReview} from './exact-pose-review.mjs';
import {comparePrintPoses,stabilityRank} from './print-pose-ranking.mjs';

const reviews=new WeakMap(),fail=reason=>Object.assign(Error(`Gemeinsame Drucklagenprüfung: ${reason}.`),{code:'EXACT_PROJECT_POSES_REJECTED',reason});
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const freeze=v=>{if(v&&typeof v==='object'&&!ArrayBuffer.isView(v)&&!Object.isFrozen(v)){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
export const EXACT_PROJECT_POSE_POLICY=Object.freeze({version:1,maximumSupportPlanes:24,minimumContactArea:50,relativeArithmeticNoise:1e-8,maximumParts:4096,maximumInputBytes:512*1024*1024,maximumObjects:2_000_000,maximumArray:16_000_000,defaultDurationMs:900000,maximumDurationMs:3600000});
const typed=[Float32Array,Float64Array,Uint32Array,Uint16Array,Uint8Array,Int32Array,Int16Array,Int8Array];
function inputOptions(value,fields){
 if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw fail('options');
 const out={};for(const k of Reflect.ownKeys(value)){const d=Object.getOwnPropertyDescriptor(value,k);if(typeof k!=='string'||!fields.includes(k)||!d?.enumerable||!Object.hasOwn(d,'value'))throw fail('options');out[k]=d.value;}return out;
}

// Snapshot every part (including skipped metadata/geometry) and the complete
// source map before the first await. Hash literal numeric bits, including -0;
// avoid materializing one huge JSON string or trusting claimed source hashes.
function capture(input){
 const h=sha256.create(),encoder=new TextEncoder(),buffer=new Uint8Array(32768),view=new DataView(buffer.buffer),active=new Set(),memo=new Map();let bytes=0,objects=0,used=0;
 const flush=()=>{if(used){h.update(buffer.subarray(0,used));used=0;}};
 const tag=s=>{flush();const b=encoder.encode(s);h.update(encoder.encode(`${b.length}:`));h.update(b);};
 const add=n=>{bytes+=n;if(bytes>EXACT_PROJECT_POSE_POLICY.maximumInputBytes)throw fail('input_bytes');};
 const number=n=>{if(!Number.isFinite(n))throw fail('input_number');view.setFloat64(used,n,true);used+=8;if(used===buffer.length)flush();};
 function copy(v,depth){
  if(v===null||v===undefined||typeof v==='boolean'){add(8);tag(String(v));return v;}
  if(typeof v==='number'){add(8);tag('number');number(v);return v;}
  if(typeof v==='string'){add(v.length*2);tag('string');tag(v);return v;}
  if(!v||typeof v!=='object'||depth>100||active.has(v))throw fail('input_shape');
  if(memo.has(v)){tag(`reference:${memo.get(v).id}`);return memo.get(v).value;}
  if(++objects>EXACT_PROJECT_POSE_POLICY.maximumObjects)throw fail('input_objects');
  const identity=objects;
  if(ArrayBuffer.isView(v)){
   const C=typed.find(C=>Object.getPrototypeOf(v)===C.prototype);
   if(!C||['length','byteLength','buffer','constructor'].some(k=>Object.hasOwn(v,k))||v.length>EXACT_PROJECT_POSE_POLICY.maximumArray||Reflect.ownKeys(v).length!==v.length)throw fail('input_view');
   add(v.byteLength);tag(`view:${C.name}:${v.length}`);const out=C.prototype.slice.call(v);for(const n of out)number(n);memo.set(v,{id:identity,value:out});return out;
  }
  const list=Array.isArray(v),proto=Object.getPrototypeOf(v),keys=Reflect.ownKeys(v);
  if(list?proto!==Array.prototype:proto!==Object.prototype&&proto!==null)throw fail('input_prototype');
  if(keys.some(k=>typeof k!=='string'||['__proto__','constructor','prototype','toJSON'].includes(k)))throw fail('input_keys');
  if(list&&(v.length>EXACT_PROJECT_POSE_POLICY.maximumArray||keys.length!==v.length+1))throw fail('input_array');
  const get=k=>{const d=Object.getOwnPropertyDescriptor(v,k);if(!d?.enumerable||!Object.hasOwn(d,'value'))throw fail('input_accessor');return d.value;};
  if(list&&v.length){
   let numeric=true;for(let i=0;i<v.length;i++)if(typeof get(String(i))!=='number')numeric=false;
   if(numeric){add(v.length*8);tag(`numbers:${v.length}`);const out=new Array(v.length);for(let i=0;i<v.length;i++){out[i]=get(String(i));number(out[i]);}memo.set(v,{id:identity,value:out});return out;}
  }
  active.add(v);const out=list?[]:{};memo.set(v,{id:identity,value:out});add(16);tag(list?`array:${v.length}`:`object:${keys.length}`);
  if(list){for(let i=0;i<v.length;i++)out.push(copy(get(String(i)),depth+1));}
  else for(const k of keys){add(2*k.length);tag(k);out[k]=copy(get(k),depth+1);}
  active.delete(v);return out;
 }
 const value=copy(input,0);flush();return {value,hash:Array.from(h.digest(),n=>n.toString(16).padStart(2,'0')).join(''),bytes};
}
function setup(options){
 const {getCurrentRevision,signal,onProgress,limits}=options;
 if(typeof getCurrentRevision!=='function'||onProgress!==undefined&&typeof onProgress!=='function'||signal!==undefined&&(!signal||typeof signal.addEventListener!=='function'||typeof signal.removeEventListener!=='function'||typeof signal.aborted!=='boolean'))throw fail('callbacks');
 let duration=EXACT_PROJECT_POSE_POLICY.defaultDurationMs;
 if(limits!==undefined){if(!limits||typeof limits!=='object'||Array.isArray(limits)||![Object.prototype,null].includes(Object.getPrototypeOf(limits))||Reflect.ownKeys(limits).some(k=>k!=='maxDurationMs'))throw fail('limits');const d=Object.getOwnPropertyDescriptor(limits,'maxDurationMs');if(d){if(!d.enumerable||!Object.hasOwn(d,'value'))throw fail('limits');duration=d.value;}}
 if(!Number.isSafeInteger(duration)||duration<1||duration>EXACT_PROJECT_POSE_POLICY.maximumDurationMs)throw fail('limits');
 const started=Date.now();let terminal=null;
 const lifecycle=()=>{if(terminal)throw fail(terminal);if(signal?.aborted){terminal='aborted';throw fail(terminal);}};
 const check=()=>{lifecycle();if(Date.now()-started>=duration)throw fail('timeout');};
 async function bounded(fn){check();let timer,abort;try{return await Promise.race([Promise.resolve().then(fn),new Promise((_,reject)=>{timer=setTimeout(()=>reject(fail('callback_timeout')),Math.min(10000,Math.max(1,duration-(Date.now()-started))));abort=()=>reject(fail('aborted'));signal?.addEventListener('abort',abort,{once:true});})]);}finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}}
 async function current(sourceRevision,planHash,phase){check();const response=await bounded(()=>getCurrentRevision({sourceRevision,planHash,phase}));lifecycle();if(response?.sourceRevision!==sourceRevision||response?.planHash!==planHash){terminal='stale';throw fail('stale');}check();}
 async function progress(value){check();if(onProgress)await bounded(()=>onProgress(freeze(value)));check();}
 return {check,current,progress,duration};
}
function capacity(value){if(!Array.isArray(value)||value.length!==3||!value.every(x=>Number.isFinite(x)&&x>=1&&x<=10000))throw fail('bed');return [...value];}
function skip(part){
 if(!part||typeof part!=='object'||Array.isArray(part))throw fail('part');
 if(part.exactGeometry===undefined)return 'non_exact_part';
 if(part.nativeGeometry!==undefined)return 'mixed_geometry_backends';
 if(part.mark!=null||part.exactMachining!=null)return 'physical_mark';
 if(part.plannedMark!=null)return 'planned_mark';
 return null;
}
const fits=(p,bed)=>!!p&&p.size.every((x,i)=>Number.isFinite(x)&&x<=bed[i]+.005);
function metrics(p,bed){return p?{poseAvailable:true,classification:p.printStability.classification,minimumMargin:p.printStability.minimumMargin,criticalTiltDegrees:p.printStability.gravityMargin?.criticalTiltDegrees??null,stableUnderGravity:p.printStability.stableUnderGravity===true,supportArea:p.overhang.supportArea,severeArea:p.overhang.severeArea,bedContactArea:p.connectedBedContactArea,fits:fits(p,bed),size:[...p.size]}:{poseAvailable:false,classification:'unknown',minimumMargin:null,criticalTiltDegrees:null,stableUnderGravity:false,supportArea:null,severeArea:null,bedContactArea:null,fits:false,size:null};}
const noise=x=>EXACT_PROJECT_POSE_POLICY.relativeArithmeticNoise*Math.max(1,Math.abs(x));
function gate(candidate,baseline,bed){
 if(!fits(candidate,bed)||candidate.connectedBedContactArea<50)return 'fit_or_contact';
 if(!baseline)return 'baseline_pose_missing';
 if(stabilityRank(candidate.printStability)>stabilityRank(baseline.printStability))return 'stability_worse';
 if(candidate.overhang.supportArea>baseline.overhang.supportArea+noise(baseline.overhang.supportArea)||candidate.overhang.severeArea>baseline.overhang.severeArea+noise(baseline.overhang.severeArea))return 'overhang_tradeoff';
 if(equal(candidate.assemblyToPrint,baseline.assemblyToPrint))return 'same_pose';
 if(!fits(baseline,bed))return null;
 if(stabilityRank(candidate.printStability)<stabilityRank(baseline.printStability))return null;
 if(stabilityRank(baseline.printStability)===2){const a=candidate.printStability.gravityMargin?.criticalTiltDegrees??-90,b=baseline.printStability.gravityMargin?.criticalTiltDegrees??-90;if(a>b+1e-6)return null;if(a<b-1e-6)return 'stability_worse';}
 return candidate.score<baseline.score-noise(baseline.score)?null:'no_pose_improvement';
}
function annotations(part){return Object.fromEntries(['id','name','color','note','exactLeafId','plannedMarkIssue'].filter(k=>part[k]!==undefined).map(k=>[k,part[k]]));}
function unchangedMaterial(part,base){for(const k of ['exactInteriorPermission','id','name','color','note','exactLeafId','plannedMarkIssue'])if(!equal(part[k],base[k]))throw fail('material_or_annotation_changed');if(!equal(part.exactGeometry.authority,base.exactGeometry.authority))throw fail('authority_changed');}
function display(part,index){return {index,id:part.id,vertices:part.vertices.slice(),triangles:part.triangles.slice(),assemblyMatrix:[...part.assemblyMatrix],printStability:part.printStability,overhang:part.overhang,bedContactArea:part.bedContactArea};}

/** One private central permission context serves the entire project. Only
 * literal poses may change; skipped and unchanged slots are never replaced. */
export async function reviewExactProjectPoses(options={}){
 options=inputOptions(options,['parts','permissionSources','usableBed','getCurrentRevision','signal','onProgress','limits']);
 const cb=setup(options);cb.check();
 const captured=capture({parts:options.parts,permissionSources:options.permissionSources,usableBed:options.usableBed});
 const {parts,permissionSources,usableBed}=captured.value,bed=capacity(usableBed);
 if(!Array.isArray(parts)||!parts.length||parts.length>EXACT_PROJECT_POSE_POLICY.maximumParts)throw fail('parts');
 const sourceRevision=exactHash(`EXACT_PROJECT_POSE_SOURCE_1\n${captured.hash}`),planHash=exactHash(JSON.stringify({schema:'prinjekt-exact-project-pose-plan-v1',sourceRevision,usableBed:bed,policy:EXACT_PROJECT_POSE_POLICY,maxDurationMs:cb.duration}));
 await cb.current(sourceRevision,planHash,'pose-review-start');
 const context=createExactProjectContext({permissionSources}),rows=[],changes=[],displayParts=[];
 for(let index=0;index<parts.length;index++){
  await cb.current(sourceRevision,planHash,'pose-review-part');const raw=parts[index],why=skip(raw);
  if(why){rows.push({index,id:typeof raw.id==='string'?raw.id:String(index+1),changed:false,status:'skipped',reason:why,before:null,after:null,alternative:null,rejectionCounts:{}});}
  else{
   const base=restoreExactProjectPart(raw,{context}),source=base.exactGeometry.authority;
   const original=base.exactPoseReview===null?null:validateExactPrintPoseReview(base.exactPoseReview,source),baseline=original?.selected??null;
   const known=original?.configuration.cutPlanes??[],planes=new Map(known.map(p=>[p.planeHash,p]));
   for(const plane of deriveExactSupportPlanes(source,{maximumPlanes:24,minimumArea:50}))if(planes.size<128)planes.set(plane.planeHash,plane);
   const cutPlanes=[...planes.values()],bank=cutPlanes.length?reviewExactPrintPoses(source,{usableBed:bed,cutPlanes,posePolicy:'search',...(baseline?{retainedAssemblyToPrint:baseline.assemblyToPrint}:{})}):null;
   const rejected={},eligible=[];for(const candidate of bank?.candidates??[]){const why=gate(candidate,baseline,bed);if(why)rejected[why]=(rejected[why]??0)+1;else eligible.push(candidate);}
   eligible.sort(comparePrintPoses);const chosen=eligible[0]??null,alternative=bank?.selected&&!equal(bank.selected.assemblyToPrint,baseline?.assemblyToPrint)?bank.selected:null;
   let after=baseline;
   if(chosen){
    const retained=reviewExactPrintPoses(source,{usableBed:bed,cutPlanes,posePolicy:'retain',retainedAssemblyToPrint:[...chosen.assemblyToPrint]});
    if(!retained.selected||!equal(retained.selected.assemblyToPrint,chosen.assemblyToPrint)||gate(retained.selected,baseline,bed)!==null)throw fail('retained_pose_changed');
    const staged=createExactProjectPart({source,poseReview:retained,permission:base.exactInteriorPermission,metadata:annotations(base),context});unchangedMaterial(staged,base);
    changes.push({index,base,poseReview:retained});displayParts.push(display(staged,index));after=retained.selected;
   }
   const reason=chosen?'improved_pose':!baseline?'baseline_pose_missing':alternative?gate(alternative,baseline,bed):bank?.candidates.length?'no_pose_improvement':'no_fitting_pose';
   rows.push({index,id:base.id,changed:!!chosen,status:chosen?'changed':'unchanged',reason:reason??'no_pose_improvement',before:metrics(baseline,bed),after:metrics(after,bed),alternative:alternative?metrics(alternative,bed):null,rejectionCounts:rejected,candidateCount:bank?.candidates.length??0});
  }
  await cb.current(sourceRevision,planHash,'pose-review-part-complete');await cb.progress({phase:'project-pose-review',completed:index+1,total:parts.length,changed:changes.length});await new Promise(r=>setTimeout(r,0));
 }
 const summary={partCount:parts.length,changed:changes.length,unchanged:rows.filter(r=>r.status==='unchanged').length,skipped:rows.filter(r=>r.status==='skipped').length,overhangTradeoffsRejected:rows.filter(r=>r.reason==='overhang_tradeoff').length,nativeJobs:0,geometryChanged:false,numberingChanged:false,permissionChanged:false,contextCount:1,finiteSearch:true,globalOptimumProven:false};
 const metadata={schema:'prinjekt-exact-project-pose-review-v1',sourceRevision,planHash,rows,summary,policy:EXACT_PROJECT_POSE_POLICY,reviewRequired:true,printable:false},reviewHash=exactHash(JSON.stringify(metadata));
 const result=freeze({...metadata,reviewHash,displayParts});await cb.current(sourceRevision,planHash,'pose-review-ready');
 reviews.set(result,{context,changes,partCount:parts.length,sourceRevision,planHash,reviewHash,summary,busy:false});return result;
}

/** The host retains this owned review; main applies replacements atomically
 * only after its final project-wide token check. Public display is never used. */
export async function stageExactProjectPoseReview(input={}){
 const {previous,...options}=inputOptions(input,['previous','getCurrentRevision','signal','onProgress','limits']);
 const own=reviews.get(previous);if(!own)throw fail('unknown_review');if(own.busy)throw fail('busy');
 const cb=setup(options);cb.check();own.busy=true;
 try{
  const replacements=[];for(const change of own.changes){
   await cb.current(own.sourceRevision,own.planHash,'pose-adoption-part');
   const base=restoreExactProjectPart(change.base,{context:own.context}),part=createExactProjectPart({source:base.exactGeometry.authority,poseReview:change.poseReview,permission:base.exactInteriorPermission,metadata:annotations(base),context:own.context});
   unchangedMaterial(part,base);if(!equal(part.exactPoseReview.selected.assemblyToPrint,change.poseReview.selected.assemblyToPrint))throw fail('retained_pose_changed');
   replacements.push({index:change.index,part});await cb.progress({phase:'project-pose-adoption',completed:replacements.length,total:own.changes.length});await new Promise(r=>setTimeout(r,0));
  }
  await cb.current(own.sourceRevision,own.planHash,'pose-adoption-ready');const changed=new Set(replacements.map(p=>p.index));
  return {schema:'prinjekt-exact-project-pose-adoption-v1',sourceRevision:own.sourceRevision,planHash:own.planHash,reviewHash:own.reviewHash,replacements,unchangedIndices:Array.from({length:own.partCount},(_,i)=>i).filter(i=>!changed.has(i)),summary:own.summary,reviewRequired:true,printable:false};
 }finally{own.busy=false;}
}
