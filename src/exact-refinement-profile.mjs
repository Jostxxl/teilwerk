// Explicit search profile. Absent means the unchanged historical plan bytes.
export function captureExactRefinementProfile(value){
 if(value===undefined)return Object.freeze({});
 if(!['stability-v2','stability-breadth-v3'].includes(value))throw Object.assign(Error('Unbekanntes Schnittsuchprofil.'),{code:'EXACT_REFINEMENT_PROFILE_REJECTED',reason:'profile'});
 return Object.freeze({refinementProfile:value});
}
// Called only with freshly validated physical values, never serialized claims.
export function exactRefinementProfileOptions(profile,localPose,{maxMassCandidates,maxStabilityCandidates}){
 captureExactRefinementProfile(profile);
 const s=localPose?.selected?.printStability,c=s?.contact;
 if(['stability-v2','stability-breadth-v3'].includes(profile)&&s?.classification==='unstable'&&s.stableUnderGravity===false&&Number.isFinite(s.minimumMargin)&&s.minimumMargin<0&&c?.area>0&&c.triangleCount>0&&c.hull?.length>=3&&s.centerOfMass?.[2]>0)
  return Object.freeze({candidatePolicy:'support-pivot-v2',maxPivotCandidates:12});
 return Object.freeze({maxMassCandidates,maxStabilityCandidates});
}
