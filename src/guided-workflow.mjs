/** Presentation/navigation only. No click forwarding, CSG, export or model edits. */
export const GUIDED_WORKFLOW_PHASES=Object.freeze([
 {id:'model',title:'Modell',heading:'Modell & Drucker',description:'Druckraum einstellen und Innenflächen für Nummern auswählen.'},
 {id:'split',title:'Aufteilen',heading:'Aufteilung prüfen',description:'Vorschlag ansehen, Schnitte berechnen und Ergebnis übernehmen.'},
 {id:'mark',title:'Nummern',heading:'Teile kennzeichnen',description:'Nummern platzieren, prüfen und gravieren.'},
 {id:'print',title:'Drucklage',heading:'Drucklage festlegen',description:'Teile ausrichten und bei Bedarf Finnen setzen.'},
 {id:'connect',title:'Stifte',heading:'Verbindungen planen',description:'Passende Bohrungen und den Einbauweg prüfen.'},
 {id:'export',title:'Export',heading:'Druckpaket ausgeben',description:'Projekt sichern, Druckdateien und Anleitung ausgeben.'}
].map(Object.freeze));
const IDS=GUIDED_WORKFLOW_PHASES.map(p=>p.id),own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
function invalid(reason,message){return Object.assign(new Error(message),{code:'GUIDED_WORKFLOW_ERROR',reason});}
function stateOf(input){
 if(!input||typeof input!=='object')throw invalid('invalid_state','Der aktuelle Projektzustand fehlt.');
 const state={};for(const key of ['hasModel','printerValid','hasOpenPreview','hasClosedParts','hasInteriorSelection','hasExistingMarks','requireInteriorSelection','busy','dirtyPrintPose','printPreparationOpen','connectorPlanPresent','connectorPlanPending']){
  if(own(input,key)&&typeof input[key]!=='boolean')throw invalid('invalid_state','Ungültiger Projektzustand: '+key);state[key]=input[key]??false;
 }
 state.printerValid=input.printerValid??true;
 const count=input.connectorIssueCount??0;if(!Number.isSafeInteger(count)||count<0)throw invalid('invalid_state','Die Anzahl offener Verbindungen ist ungültig.');state.connectorIssueCount=count;
 // The host may omit connectorPlanPresent when it supplies zero without a plan.
 state.connectorPlanPresent=input.connectorPlanPresent??count>0;
 return Object.freeze(state);
}
const allowed=()=>Object.freeze({allowed:true,reason:null,message:'',targetPhase:null});
const blocked=(reason,message,targetPhase)=>Object.freeze({allowed:false,reason,message,targetPhase});
/** This is a navigation guard, never an export/material/print approval. */
export function guidedWorkflowGuard(phase,input,currentPhase='model'){
 if(!IDS.includes(phase)||!IDS.includes(currentPhase))throw invalid('invalid_phase','Unbekannter Arbeitsschritt.');const state=stateOf(input);
 if(phase===currentPhase)return allowed();
 if(state.busy)return blocked('busy','Die laufende Berechnung zuerst abschließen oder abbrechen.',null);
 if(state.dirtyPrintPose)return blocked('uncommitted_print_pose','Die Drucklage zuerst übernehmen oder die Vorschau verwerfen.','print');
 if(phase==='model')return allowed();
 if(!state.hasModel)return blocked('model_missing','Zuerst ein Modell oder ein Projekt öffnen.','model');
 if(!state.printerValid)return blocked('printer_invalid','Zuerst gültige Druckermaße und einen passenden Rand einstellen.','model');
 if(phase==='split'){
  if(state.requireInteriorSelection&&!state.hasInteriorSelection)return blocked('interior_missing','Zuerst die Innenflächen für die automatischen Nummern auswählen.','model');
  return allowed();
 }
 if(state.hasOpenPreview)return blocked('preview_pending','Die Schnittvorschau zuerst prüfen und übernehmen oder verwerfen.','split');
 if(!state.hasClosedParts)return blocked('closed_parts_missing','Zuerst geschlossene Teile bereitstellen oder das Schnittergebnis übernehmen.','split');
 if(phase==='export'&&state.connectorPlanPresent&&state.connectorIssueCount>0)return blocked('connectors_unresolved',state.connectorPlanPending?'Zuerst Verbindungen berechnen oder bewusst ohne Stifte fortfahren.':`${state.connectorIssueCount} Stiftverbindung${state.connectorIssueCount===1?' ist':'en sind'} noch offen. Vor dem Export im Schritt „Stifte“ klären.`,'connect');
 return allowed();
}

/**
 * Annotated nodes keep their IDs, listeners, `hidden` and disabled properties.
 * data-workflow-phases="model split …" selects phases (missing means all).
 * data-workflow-advanced marks optional tools in their own phase only.
 * The host calls sync after render/setBusy/load and keeps its own operation gates.
 * onPhaseChange changes views only. onClosePrintPreparation must never commit a
 * draft; a dirty pose is rejected before this callback runs.
 */
export function createGuidedWorkflow({navigation,summary,actions,root=navigation?.ownerDocument,getState,
 onPhaseChange=()=>{},onClosePrintPreparation,onStatus=()=>{},initialPhase='model'}={}){
 if(!navigation?.ownerDocument||!summary?.append||!actions?.append||!root?.querySelectorAll||typeof getState!=='function')throw invalid('invalid_options','Die Schrittsteuerung ist nicht vollständig angeschlossen.');
 if(!IDS.includes(initialPhase))throw invalid('invalid_phase','Unbekannter Anfangsschritt.');
 const doc=navigation.ownerDocument,listeners=[],originalVisibility=new Map(),advancedByPhase=new Set(),navButtons=new Map();let phase=initialPhase,pending=false,disposed=false;
 const nav=doc.createElement('div'),summaryBox=doc.createElement('section'),actionBox=doc.createElement('div');nav.className='workflow-steps';summaryBox.className='workflow-summary';actionBox.className='workflow-actions';navigation.append(nav);summary.append(summaryBox);actions.append(actionBox);navigation.classList.add('guided-workflow-nav');
 nav.setAttribute('role','navigation');nav.setAttribute('aria-label','Arbeitsschritte');
 function listen(element,type,fn){element.addEventListener(type,fn);listeners.push(()=>element.removeEventListener(type,fn));}
 function fire(fn){Promise.resolve().then(fn).catch(error=>{showMessage(error.message,null);onStatus(error.message,{reason:error.reason??'workflow_failed',targetPhase:null});});}
 for(const [index,item] of GUIDED_WORKFLOW_PHASES.entries()){
  const button=doc.createElement('button'),number=doc.createElement('span'),label=doc.createElement('span');button.type='button';button.dataset.workflowPhase=item.id;number.className='workflow-step-number';number.textContent=String(index+1);label.className='workflow-step-label';label.textContent=item.title;button.append(number,label);nav.append(button);navButtons.set(item.id,button);listen(button,'click',()=>fire(()=>selectPhase(item.id)));
 }
 const eyebrow=doc.createElement('p'),heading=doc.createElement('h2'),description=doc.createElement('p'),notice=doc.createElement('p'),redirect=doc.createElement('button');eyebrow.className='workflow-eyebrow';description.className='workflow-description';notice.className='workflow-notice';notice.setAttribute('role','status');notice.setAttribute('aria-live','polite');redirect.type='button';redirect.className='workflow-redirect';redirect.hidden=true;summaryBox.append(eyebrow,heading,description,notice,redirect);let redirectPhase=null;listen(redirect,'click',()=>fire(()=>selectPhase(redirectPhase)));
 const back=doc.createElement('button'),next=doc.createElement('button'),advanced=doc.createElement('details'),advancedLabel=doc.createElement('summary'),advancedHint=doc.createElement('p');back.type=next.type='button';back.dataset.workflowAction='previous';next.dataset.workflowAction='next';next.className='workflow-next';advanced.className='workflow-advanced';advancedLabel.textContent='Erweitert';advancedHint.textContent='Zusätzliche Werkzeuge für diesen Schritt anzeigen.';advanced.append(advancedLabel,advancedHint);actionBox.append(back,next,advanced);listen(back,'click',()=>fire(previous));listen(next,'click',()=>fire(nextPhase));
 // Only the explicit summary click changes preference. Programmatic .open
 // updates queue delayed toggle events which must not affect another phase.
 listen(advancedLabel,'click',event=>{event.preventDefault();if(!disposed)setAdvanced(!advancedByPhase.has(phase));});
 function showMessage(message,target){notice.textContent=message;notice.hidden=!message;redirectPhase=target&&target!==phase?target:null;redirect.hidden=!redirectPhase;if(redirectPhase)redirect.textContent=redirectPhase==='connect'?'Zu den Stiften':`Zu „${GUIDED_WORKFLOW_PHASES.find(p=>p.id===redirectPhase).title}“`;}
 function updateVisibility(){
  for(const node of root.querySelectorAll('[data-workflow-phases],[data-workflow-advanced]')){
   if(!originalVisibility.has(node))originalVisibility.set(node,node.getAttribute('data-workflow-hidden'));
   const phases=(node.getAttribute('data-workflow-phases')??'').trim().split(/\s+/).filter(Boolean),isAdvanced=node.hasAttribute('data-workflow-advanced'),visible=(!phases.length||phases.includes(phase))&&(!isAdvanced||advancedByPhase.has(phase));
   if(visible)node.removeAttribute('data-workflow-hidden');else node.setAttribute('data-workflow-hidden','');
  }
 }
 function sync(){
  if(disposed)return;const state=stateOf(getState()),index=IDS.indexOf(phase),item=GUIDED_WORKFLOW_PHASES[index];eyebrow.textContent=`Schritt ${index+1} von ${IDS.length}`;heading.textContent=item.heading;description.textContent=item.description;
  for(const [id,button]of navButtons){const guard=guidedWorkflowGuard(id,state,phase);button.disabled=pending||state.busy||(id!==phase&&!guard.allowed);button.setAttribute('aria-current',id===phase?'step':'false');button.classList.toggle('active',id===phase);button.title=guard.message;}
  back.textContent='← Zurück';back.disabled=pending||index===0||!guidedWorkflowGuard(IDS[Math.max(0,index-1)],state,phase).allowed;
  const nextId=IDS[index+1],guard=nextId?guidedWorkflowGuard(nextId,state,phase):allowed();next.hidden=!nextId;next.textContent=nextId?`Weiter: ${GUIDED_WORKFLOW_PHASES[index+1].title} →`:'';next.disabled=pending||!nextId||!guard.allowed;next.title=guard.message;
  advanced.open=advancedByPhase.has(phase);updateVisibility();
  if(pending)showMessage('Schritt wird gewechselt …',null);
  else if(state.busy)showMessage('Berechnung läuft. Die Schrittwahl ist danach wieder verfügbar.',null);
  else if(state.dirtyPrintPose)showMessage('Drucklage übernehmen oder Vorschau verwerfen, bevor du den Schritt wechselst.',phase==='print'?null:'print');
  else if(phase!=='model'&&!state.hasModel)showMessage('Zuerst ein Modell oder ein Projekt öffnen.','model');
  else if(phase==='export'&&!guidedWorkflowGuard('export',state,'model').allowed){const currentGuard=guidedWorkflowGuard('export',state,'model');showMessage(currentGuard.message,currentGuard.targetPhase);}
  else if(phase==='connect'&&state.connectorPlanPending)showMessage('Noch kein Stiftplan. Verbindungen berechnen oder ohne Stifte fortfahren.',null);
  else if(phase==='connect'&&state.connectorPlanPresent&&state.connectorIssueCount>0)showMessage(`${state.connectorIssueCount} Stiftverbindung${state.connectorIssueCount===1?' ist':'en sind'} noch offen. Planung und Einbauwege prüfen.`,null);
  else if(nextId&&!guard.allowed)showMessage(guard.message,guard.targetPhase);
  else if(phase==='model'&&state.hasModel&&!state.hasInteriorSelection)showMessage('Innenflächen vor dem Schneiden auswählen, wenn die Teile automatisch nummeriert werden sollen.',null);
  else if(phase==='split'&&state.hasOpenPreview)showMessage('Schnittvorschau aktiv. Prüfen und übernehmen oder verwerfen.',null);
  else if(phase==='mark'&&!state.hasInteriorSelection&&!state.hasExistingMarks)showMessage('Für automatische Nummern fehlen ausgewählte Innenflächen. Vorhandene Kennzeichnungen bleiben erhalten.',null);
  else showMessage('',null);
 }
 async function selectPhase(target){
  if(disposed)throw invalid('disposed','Die Schrittsteuerung wurde geschlossen.');if(!IDS.includes(target))throw invalid('invalid_phase','Unbekannter Arbeitsschritt.');if(pending)return false;
  const state=stateOf(getState()),guard=guidedWorkflowGuard(target,state,phase);if(!guard.allowed){sync();showMessage(guard.message,guard.targetPhase);onStatus(guard.message,{reason:guard.reason,targetPhase:guard.targetPhase});return false;}if(target===phase){sync();return true;}
  pending=true;sync();const previous=phase;
  try{
   if(state.printPreparationOpen&&target!=='print'){
    if(typeof onClosePrintPreparation!=='function')throw invalid('print_preparation_open','Druckvorbereitung zuerst schließen.');await onClosePrintPreparation();
    if(stateOf(getState()).printPreparationOpen)throw invalid('print_preparation_open','Druckvorbereitung zuerst schließen.');
   }
   if(disposed)return false;const fresh=stateOf(getState()),again=guidedWorkflowGuard(target,fresh,phase);if(!again.allowed){onStatus(again.message,{reason:again.reason,targetPhase:again.targetPhase});return false;}
   await onPhaseChange(Object.freeze({phase:target,previous,state:fresh}));if(disposed)return false;
   const finalGuard=guidedWorkflowGuard(target,stateOf(getState()),phase);if(!finalGuard.allowed){onStatus(finalGuard.message,{reason:finalGuard.reason,targetPhase:finalGuard.targetPhase});return false;}phase=target;return true;
  }finally{pending=false;sync();}
 }
 const nextPhase=()=>{const index=IDS.indexOf(phase);return index+1<IDS.length?selectPhase(IDS[index+1]):Promise.resolve(false);};
 const previous=()=>{const index=IDS.indexOf(phase);return index>0?selectPhase(IDS[index-1]):Promise.resolve(false);};
 function setAdvanced(value){if(disposed)return;if(typeof value!=='boolean')throw invalid('invalid_advanced','Ungültige Werkzeugauswahl.');if(value)advancedByPhase.add(phase);else advancedByPhase.delete(phase);sync();}
 function dispose(){if(disposed)return;disposed=true;for(const off of listeners)off();for(const[node,value]of originalVisibility){if(value===null)node.removeAttribute('data-workflow-hidden');else node.setAttribute('data-workflow-hidden',value);}nav.remove();summaryBox.remove();actionBox.remove();navigation.classList.remove('guided-workflow-nav');}
 sync();return Object.freeze({selectPhase,next:nextPhase,previous,sync,setAdvanced,dispose,get phase(){return phase;},get advanced(){return advancedByPhase.has(phase);},get isChanging(){return pending;}});
}
