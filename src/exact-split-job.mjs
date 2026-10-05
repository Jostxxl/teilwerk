import {validateExactAuthority} from './exact-geometry.mjs';
import {validateExactPrintPoseReview,exactRefinementCutter} from './exact-pose-review.mjs';
import {createExactSplitPlanBinding} from './exact-split-plan.mjs';

const fields=['source','poseReview','refinement','candidateId','sourceRevision'],encoder=new TextEncoder();
const freeze=value=>{if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const fail=()=>Object.assign(Error('Der Schnittauftrag passt nicht zur zuvor gewählten Drucklage.'),{code:'EXACT_SPLIT_JOB_REJECTED'});
export const EXACT_SPLIT_JOB_BYTES=128*1024*1024;
function shape(value,allowed){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!allowed.includes(k)))throw fail();}
function detached(value){try{const text=JSON.stringify(value);if(!text||text.length>EXACT_SPLIT_JOB_BYTES||encoder.encode(text).length>EXACT_SPLIT_JOB_BYTES)throw fail();return JSON.parse(text);}catch{throw fail();}}
function prepare(value){
 shape(value,fields);
 // Capture every literal input before exposing a job to async transport.
 const snapshot=detached(value),source=validateExactAuthority(snapshot.source),poseReview=snapshot.poseReview,refinement=snapshot.refinement;
 const localPoseReview=validateExactPrintPoseReview(poseReview,source);
 if(!localPoseReview.selected||localPoseReview.orientationBeforeRefinement!==true)throw fail();
 const cutter=exactRefinementCutter(source,poseReview,refinement,snapshot.candidateId);
 const bindings=createExactSplitPlanBinding({sourceAuthorityHash:source.authorityHash,poseReviewHash:poseReview.reviewHash,refinementHash:refinement.refinementHash,candidateId:snapshot.candidateId,sourceRevision:snapshot.sourceRevision});
 const job={schema:'prinjekt-exact-split-job-v1',operation:'split',source,poseReview,refinement,candidateId:snapshot.candidateId,sourceRevision:snapshot.sourceRevision,planHash:bindings.planHash};
 if(encoder.encode(JSON.stringify(job)).length>EXACT_SPLIT_JOB_BYTES)throw fail();
 return freeze({job,cutter,localPoseReview,bindings});
}
/** Heavy, synchronous validation: use in a computation worker for large meshes.
 * This captures the original review; fresh local diagnostics remain separate. */
export function createExactSplitJob(options){return prepare(options).job;}
export function validateExactSplitJob(value){
 shape(value,['schema','operation',...fields,'planHash']);
 if(value.schema!=='prinjekt-exact-split-job-v1'||value.operation!=='split')throw fail();
 const prepared=prepare(Object.fromEntries(fields.map(k=>[k,value[k]])));
 if(value.planHash!==prepared.bindings.planHash)throw fail();
 return prepared;
}
