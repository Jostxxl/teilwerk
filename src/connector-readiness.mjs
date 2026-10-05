import {buildConnectorGuide} from './connector-guide.mjs';

/** Validate the actual assembly tree and its retained path checks, not just a
 * saved 'completed' flag. This does not create new geometric proofs. */
export function connectorReadiness(parts,plan,{required=false}={}){
 if(!plan){const missing=required&&parts.length>1;return {ready:!missing,planned:false,issueCount:missing?1:0,partIds:[],message:missing?'Passstifte fehlen noch. Im Schritt „Stifte“ berechnen oder dort ausdrücklich ohne Stifte fortfahren.':parts.length===1?'Ein einzelnes Teil benötigt keine Verbindung.':'Ohne Passstifte: Es werden keine Bohrungen ergänzt.'};}
 try{
  const guide=buildConnectorGuide(parts,plan.connections,{order:plan.order,pins:plan.pins,unresolved:plan.unresolved||[]});
  const ids=new Set();
  for(const step of guide.steps)if(step.connection&&!step.completeInsertionVerified)ids.add(step.partId);
  // Each additional component has no verified connection to the first one.
  for(const component of guide.components.slice(1))ids.add(component.rootId);
  for(const issue of plan.unresolved||[])if(issue.childId)ids.add(String(issue.childId));
  const issueCount=Math.max(ids.size,(plan.unresolved||[]).length,plan.completed===true?0:1);
  return {ready:issueCount===0,planned:true,issueCount,partIds:[...ids],message:issueCount?`Passstiftplan unvollständig${ids.size?' · Teile '+[...ids].join(', '):''}. Offene Verbindungen zuerst im Schritt „Stifte“ lösen.`:`Alle ${parts.length} Teile sind über ${guide.contacts.length} geprüfte Stiftverbindungen verbunden.`};
 }catch(error){return {ready:false,planned:true,issueCount:1,partIds:[],message:'Passstiftplan prüfen: '+error.message};}
}

export function requireCompleteConnectorPlan(parts,plan,options){
 const check=connectorReadiness(parts,plan,options);if(!check.ready)throw Error('Export angehalten: '+check.message);return check;
}
