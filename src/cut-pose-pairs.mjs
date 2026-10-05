import {stabilityRank} from './print-pose-ranking.mjs';

// Surface areas are mm² of actual downward-facing mesh, not support-material
// volume. Stability classes use the measured gravity/contact criteria. The
// ranking does not reinterpret a numerical tolerance as a physical tradeoff.
export function compareCutPosePairs(a,b){
 return a.worstStabilityRank-b.worstStabilityRank||a.marginalChildren-b.marginalChildren||a.severe-b.severe||a.support-b.support||(b.balance||0)-(a.balance||0);
}

export const STABLE_TRADEOFF_SEVERE_WEIGHT=4;
/** The explicit stability-first repair policy must not lock in a fragile
 * strict pair while two robust children are available at the same part count.
 * Among robust tradeoffs, weighted SURFACE area avoids paying an arbitrarily
 * large support-area increase for a tiny reduction across the 60° boundary.
 * The weight is a design preference, not estimated support volume or physics. */
export function compareRefinementChoices(a,b,{policy='strict',stabilityRepair=false}={}){
 const prioritizeRobust=policy==='stability-first'&&stabilityRepair;
 if(prioritizeRobust&&a.worstStabilityRank!==b.worstStabilityRank)return a.worstStabilityRank-b.worstStabilityRank;
 if(a.tradeoff!==b.tradeoff)return Number(a.tradeoff)-Number(b.tradeoff);
 if(prioritizeRobust&&a.tradeoff&&b.tradeoff&&a.worstStabilityRank===0&&b.worstStabilityRank===0){
  const delta=(a.support+STABLE_TRADEOFF_SEVERE_WEIGHT*a.severe)-(b.support+STABLE_TRADEOFF_SEVERE_WEIGHT*b.severe);if(delta)return delta;
 }
 return compareCutPosePairs(a,b);
}

/** Evaluate the Cartesian product, so an individually preferred child pose
 * cannot hide a feasible pair. Positive COM is a hard gate under BOTH policies.
 * The strict policy preserves every former acceptance bound. Stability-first
 * may bypass overhang non-increase only to repair an actually tipping parent;
 * Robust strict pairs remain preferred. A robust tradeoff can replace a
 * marginal strict pair only in the explicit stability-first repair policy. */
export function chooseCutPosePair(banks,{policy='strict',stabilityRepair=false,parent,reference=null,minSevereGain=50,minRelativeGain=.15,overhangTolerance=.01}={}){
 if(!['strict','stability-first'].includes(policy)||banks.length!==2||!parent)throw Error('Ungültige gemeinsame Drucklagenbewertung.');
 let strict=null,tradeoff=null,reviewed=0;const rejectionCounts={};
 for(let i=0;i<banks[0].length;i++)for(let j=0;j<banks[1].length;j++){
  const pair=[banks[0][i],banks[1][j]];if(pair.some(p=>!p.printStability?.valid||p.printStability.stableUnderGravity!==true))continue;reviewed++;
  const severe=pair.reduce((s,p)=>s+p.overhang.severeArea,0),support=pair.reduce((s,p)=>s+p.overhang.supportArea,0),gain=parent.severeArea-severe,ranks=pair.map(p=>stabilityRank(p.printStability));
  if(!Number.isFinite(severe)||!Number.isFinite(support))continue;
  const candidate={pair,indexes:[i,j],severe,support,gain,worstStabilityRank:Math.max(...ranks),marginalChildren:ranks.filter(r=>r===1).length,balance:Math.min(...pair.map(p=>p.volume??Infinity))};
  let reason=null;
  if(support>parent.supportArea+overhangTolerance)reason='support_increase';
  else if(stabilityRepair&&severe>parent.severeArea+overhangTolerance)reason='severe_overhang_increase';
  else if(!stabilityRepair&&gain+1e-8<Math.max(minSevereGain,parent.severeArea*minRelativeGain))reason='insufficient_gain';
  else if(reference&&(severe>reference.severeArea+overhangTolerance||support>reference.supportArea+overhangTolerance))reason='reference_overhang_increase';
  if(!reason){candidate.tradeoff=false;if(!strict||compareCutPosePairs(candidate,strict)<0)strict=candidate;}
  else{
   rejectionCounts[reason]=(rejectionCounts[reason]||0)+1;
   if(stabilityRepair&&policy==='stability-first'){candidate.tradeoff=true;candidate.strictRejection=reason;if(!tradeoff||compareRefinementChoices(candidate,tradeoff,{policy,stabilityRepair})<0)tradeoff=candidate;}
  }
 }
 const selection=strict&&tradeoff?(compareRefinementChoices(strict,tradeoff,{policy,stabilityRepair})<=0?strict:tradeoff):strict||tradeoff;
 if(selection){selection.overhangObjective=selection.tradeoff&&selection.worstStabilityRank===0?{name:'support-plus-severe-surface-area',supportWeight:1,severeWeight:STABLE_TRADEOFF_SEVERE_WEIGHT,weightedArea:selection.support+STABLE_TRADEOFF_SEVERE_WEIGHT*selection.severe,heuristic:true}:{name:'severe-then-support-surface-area',heuristic:true};}
 return {selection,reviewed,rejectionCounts,reason:Object.keys(rejectionCounts)[0]||'unstable_child'};
}

export function cutPoseSelection(pose,policy){return {version:1,method:'joint-cut-poses',policy,stabilityRank:stabilityRank(pose.printStability),classification:pose.printStability.classification,minimumMargin:pose.printStability.minimumMargin,overhang:{...pose.overhang},connectedBedContactArea:pose.bedContactArea};}
