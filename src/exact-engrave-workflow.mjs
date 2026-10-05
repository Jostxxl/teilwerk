import {exactHash,validateExactAuthority} from './exact-geometry.mjs';
import {createExactProjectContext,restoreExactProjectPart,serializeExactProjectPart} from './exact-project.mjs';
import {createExactMarkPlan} from './exact-mark-plan.mjs';
import {createExactMachinedPart} from './exact-machining.mjs';

const messages={unstable_print_pose:'Zuerst eine standfeste Drucklage durch passende Schnitte festlegen',already_engraved:'Die vorhandene Nummer zunächst per Rückgängig entfernen',insufficient_wall:'Unter der vollständigen Nummer bleibt nicht genügend Wandstärke',no_material_removed:'Die Nummer berührt das Teil nicht',aborted:'Berechnung abgebrochen; das Original bleibt erhalten',stale:'Das Projekt hat sich geändert; das Ergebnis wird nicht übernommen'};
const fail=reason=>Object.assign(Error(`Exakte Gravur angehalten: ${messages[reason]||reason}.`),{code:'EXACT_ENGRAVING_REJECTED',reason});
const yieldTurn=()=>new Promise(resolve=>setTimeout(resolve,0));

/** The original exact operand stays in assembly coordinates. All three native
 * jobs are awaited by the owning worker; no UI mutation happens in this module.
 * A complete failed/aborted attempt leaves both source and project unchanged. */
export async function engraveExactProjectPart({part,permissionSources,settings,runBooleanReview,getCurrentRevision,signal,onProgress}={}){
 if(typeof runBooleanReview!=='function'||typeof getCurrentRevision!=='function'||onProgress!==undefined&&typeof onProgress!=='function')throw fail('configuration');
 const check=()=>{if(signal?.aborted)throw fail('aborted');};check();
 const context=createExactProjectContext({permissionSources}),base=restoreExactProjectPart(part,{context});
 if(base.mark||base.exactMachining)throw fail('already_engraved');
 if(base.printStability?.stableUnderGravity!==true||!(base.printStability.minimumMargin>0))throw fail('unstable_print_pose');
 const source=validateExactAuthority(base.exactGeometry.authority),plan=createExactMarkPlan(base,settings,{context,signal});
 const sourceRevision=exactHash(`EXACT_ENGRAVE_SOURCE_1\n${JSON.stringify(serializeExactProjectPart(base,{context}))}`),planHash=plan.planHash;
 async function current(){check();const value=await getCurrentRevision({sourceRevision,planHash});check();if(value?.sourceRevision!==sourceRevision||value?.planHash!==planHash)throw fail('stale');return {sourceRevision,planHash};}
 async function progress(phase,message){check();await onProgress?.({phase,message});await current();await yieldTurn();}
 const sourceInput={id:'source',role:'source',meshText:source.meshText,meshHash:source.meshHash};
 const tool=(id,value)=>({id,role:'cutter',meshText:value.meshText,meshHash:value.meshHash});
 async function run(operation,inputs,phase,message){
  await progress(phase,message);
  check();
  const response=await runBooleanReview({operation,inputs,sourceRevision,planHash,signal,getCurrentRevision:current,onProgress:()=>progress(phase,message)});
  await current();
  if(response?.schema!=='prinjekt-exact-review-v1'||response.sourceRevision!==sourceRevision||response.planHash!==planHash||response.operation!==operation||response.reviewRequired!==true||response.printable!==false)throw fail('result_binding');
  const geometry=validateExactAuthority(response.geometry),operands=inputs.map(input=>({id:input.id,role:input.role,meshHash:input.meshHash}));
  if(geometry.origin.kind!=='boolean'||geometry.origin.operation!==operation||geometry.origin.operands.length!==inputs.length||geometry.origin.operands.some((actual,i)=>Object.entries(operands[i]).some(([k,v])=>actual[k]!==v)))throw fail('operand_binding');
  return geometry;
 }
 await current();
 const guardResult=await run('difference',[tool('guard',plan.guard),sourceInput],'wall','Wandstärke unter der vollständigen Nummer prüfen …');
 if(guardResult.faceCount||guardResult.vertexCount)throw fail('insufficient_wall');
 const removedResult=await run('intersection',[sourceInput,tool('cutter',plan.cutter)],'removed','Tatsächlich zu entfernende Schriftgeometrie berechnen …');
 if(!removedResult.faceCount||!removedResult.vertexCount)throw fail('no_material_removed');
 const result=await run('difference',[sourceInput,tool('cutter',plan.cutter)],'engrave','Nummer als echte Aussparung in das Teil rechnen …');
 await progress('validate','Materialbilanz, Innenflächen und beibehaltene Drucklage prüfen …');
 const output=createExactMachinedPart({base,plan,guardResult,removedResult,result},{context});
 await current();
 return {part:output,summary:{engraved:1,nativeJobs:3,orientationRetained:true,actualMaterialRemoved:true,sourceRevision,planHash,reviewRequired:true,printable:false}};
}
