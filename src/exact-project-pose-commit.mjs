// Synchronous staging after the owning worker has validated poses and rights.
// Caller must check its full project token immediately before the single commit.
export function stageExactProjectPoseCommit(parts,value){
 const fail=()=>{throw Error('Die Drucklagenprüfung passt nicht vollständig zum unveränderten Projekt.');};
 if(!Array.isArray(parts)||value?.schema!=='prinjekt-exact-project-pose-adoption-v1'||!Array.isArray(value.replacements)||!Array.isArray(value.unchangedIndices)||value.permissionSources!==undefined)fail();
 const seen=new Set(),next=[...parts],same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 const index=i=>{if(!Number.isInteger(i)||i<0||i>=parts.length||seen.has(i))fail();seen.add(i);};
 for(const entry of value.replacements){
  index(entry.index);const old=parts[entry.index],part=entry.part;
  if(!old?.exactGeometry||old.mark||old.plannedMark||old.exactMachining||!part?.exactGeometry||part.mark||part.plannedMark||part.exactMachining)fail();
  if(!same(old.exactGeometry.authority,part.exactGeometry.authority)||!same(old.exactInteriorPermission,part.exactInteriorPermission))fail();
  for(const key of ['id','name','note','color','exactLeafId','plannedMarkIssue'])if(!Object.is(old[key],part[key]))fail();
  next[entry.index]=part;
 }
 for(const i of value.unchangedIndices)index(i);
 if(seen.size!==parts.length)fail();return next;
}
