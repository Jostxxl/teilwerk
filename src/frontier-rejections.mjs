// Reuses ONLY an unresolved outcome, never a successful path proof. The input
// geometry/settings of one planner invocation are immutable except commits.
export function createFrontierRejections(count) {
  const revisions=Array(count).fill(0), failures=new Map();
  const neighborsOf=(child,graph,built)=>{
    const set=new Set(built);
    return graph[child].filter(index=>set.has(index)).sort((a,b)=>a-b);
  };
  const interrupted=attempt=>/time_limit|time_budget|stopped|requested|Zeitbudget|Abbruch|angehalten/i
    .test([attempt?.reason,attempt?.message,attempt?.proof?.reason].filter(Boolean).join(' '));
  return {
    committed(parent,child){revisions[parent]++;revisions[child]++;failures.delete(child);},
    remember(child,graph,built,pins,candidate,{complete=false,attempts=[]}={}) {
      // Reject a partially examined frontier even if its LAST rejection was
      // geometric: an earlier placement may have exhausted its time budget.
      if(!complete||candidate.accepted!==false||interrupted(candidate)||attempts.some(interrupted)){
        failures.delete(child);return false;
      }
      failures.set(child,{
        childRevision:revisions[child],neighbors:neighborsOf(child,graph,built),
        built:built.map(index=>[index,revisions[index]]),
        pins:pins.map(pin=>({id:pin.id,solid:pin.solid})),
        candidate:{...candidate},
      });
      return true;
    },
    reuse(child,graph,built,pins){
      const old=failures.get(child);if(!old||revisions[child]!==old.childRevision)return null;
      const neighbors=neighborsOf(child,graph,built);
      if(neighbors.length!==old.neighbors.length||neighbors.some((index,i)=>index!==old.neighbors[i]))return null;
      // A stronger append-only check than a set superset; current planner never
      // reorders/removes built bodies or existing pins within a search run.
      if(built.length<old.built.length||old.built.some(([index,revision],i)=>built[i]!==index||revisions[index]!==revision))return null;
      if(pins.length<old.pins.length||old.pins.some((pin,i)=>pins[i].id!==pin.id||pins[i].solid!==pin.solid))return null;
      return {...old.candidate,accepted:false,
        reason:'Weiterhin ungeprüft: '+old.candidate.reason,
        rejectionReuse:{method:'unchanged-rejection-with-added-obstacles',
          previousBuilt:[...old.built.map(([index])=>index)],addedBuilt:built.slice(old.built.length),
          previousPinIds:old.pins.map(pin=>pin.id),addedPinIds:pins.slice(old.pins.length).map(pin=>pin.id),
          originalReason:old.candidate.reason}};
    },
  };
}
