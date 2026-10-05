// Scheduling only. No candidate, obstacle, proof, or native check is omitted.
export function createFreshContactPriority(count){
 if(!Number.isInteger(count)||count<1)throw Error('Invalid part count');
 const revisions=Array(count).fill(0),failed=new Map();
 function state(child,neighbors,built){return {revision:revisions[child],contacts:neighbors[child].filter(i=>built.includes(i)).map(i=>[i,revisions[i]])};}
 return {
  rank(frontier,neighbors,built){
   return frontier.map((child,preferredRank)=>{
    const now=state(child,neighbors,built),old=failed.get(child),prior=new Map(old?.contacts||[]);
    const newContact=old&&now.contacts.some(([id])=>!prior.has(id));
    const revised=old&&(now.revision!==old.revision||now.contacts.some(([id,revision])=>prior.get(id)!==revision));
    const tier=newContact?0:!old?1:revised?2:3;
    const newest=Math.max(-1,...now.contacts.map(([id])=>built.indexOf(id)));
    return {child,preferredRank,tier,newest};
   }).sort((a,b)=>a.tier-b.tier||(a.tier<=1?b.newest-a.newest:0)||a.preferredRank-b.preferredRank);
  },
  rejected(child,neighbors,built){failed.set(child,state(child,neighbors,built));},
  committed(parent,child){revisions[parent]++;revisions[child]++;failed.delete(child);},
 };
}
