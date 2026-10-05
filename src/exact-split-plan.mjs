import {exactHash} from './exact-geometry.mjs';
const fields=['sourceAuthorityHash','poseReviewHash','refinementHash','candidateId','sourceRevision'],hash=/^[a-f0-9]{64}$/;
const fail=()=>Object.assign(Error('Ungültige Bindung des exakten Schnittplans.'),{code:'EXACT_SPLIT_PLAN_REJECTED'});
/** Cheap identity binding only. This does not validate geometry, a pose, or a
 * cutter. The execution worker must reconstruct all three before native work. */
export function createExactSplitPlanBinding(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!fields.includes(k))||fields.filter(k=>k!=='candidateId').some(k=>typeof value[k]!=='string'||!hash.test(value[k]))||typeof value.candidateId!=='string'||!/^[1-9][0-9]{0,2}$/.test(value.candidateId))throw fail();
 const plan={schema:'prinjekt-exact-split-plan-v1',sourceAuthorityHash:value.sourceAuthorityHash,poseReviewHash:value.poseReviewHash,refinementHash:value.refinementHash,candidateId:value.candidateId,sourceRevision:value.sourceRevision};
 return Object.freeze({...plan,planHash:exactHash(JSON.stringify(plan))});
}
