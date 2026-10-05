import test from 'node:test';import assert from 'node:assert/strict';
import {GUIDED_WORKFLOW_PHASES,createGuidedWorkflow,guidedWorkflowGuard} from '../src/guided-workflow.mjs';
class Element{
 constructor(tag,doc){this.tagName=tag;this.ownerDocument=doc;this.children=[];this.attrs=new Map();this.dataset={};this.handlers=new Map();this.hidden=false;this.disabled=false;this.open=false;this.textContent='';const set=new Set();this.classList={add:x=>set.add(x),remove:x=>set.delete(x),contains:x=>set.has(x),toggle:(x,value)=>value?set.add(x):set.delete(x)};}
 append(...items){this.children.push(...items);for(const x of items)x.parent=this;}
 remove(){if(this.parent)this.parent.children=this.parent.children.filter(x=>x!==this);}
 setAttribute(k,v){this.attrs.set(k,String(v));}getAttribute(k){return this.attrs.get(k)??null;}hasAttribute(k){return this.attrs.has(k);}removeAttribute(k){this.attrs.delete(k);}
 addEventListener(type,fn){const handlers=this.handlers.get(type)??[];handlers.push(fn);this.handlers.set(type,handlers);}removeEventListener(type,fn){this.handlers.set(type,(this.handlers.get(type)??[]).filter(x=>x!==fn));}
 fire(type,event={}){const e={preventDefault(){this.defaultPrevented=true;},...event};for(const fn of this.handlers.get(type)??[])fn(e);return e;}
}
function harness(options={}){
 const doc={nodes:[],createElement(tag){const e=new Element(tag,doc);doc.nodes.push(e);return e;},querySelectorAll(){return doc.nodes.filter(x=>x.hasAttribute('data-workflow-phases')||x.hasAttribute('data-workflow-advanced'));}},navigation=doc.createElement('nav'),summary=doc.createElement('div'),actions=doc.createElement('div'),state={hasModel:true,printerValid:true,hasClosedParts:true,hasInteriorSelection:true,...options.state},events=[],statuses=[];
 const sections={};for(const phase of GUIDED_WORKFLOW_PHASES){const e=doc.createElement('section');e.id='original-'+phase.id;e.setAttribute('data-workflow-phases',phase.id);sections[phase.id]=e;}
 const extra=doc.createElement('details');extra.id='original-extra';extra.setAttribute('data-workflow-phases','split');extra.setAttribute('data-workflow-advanced','');
 const api=createGuidedWorkflow({navigation,summary,actions,root:doc,getState:()=>state,onPhaseChange:event=>events.push(event),onStatus:(...args)=>statuses.push(args),...options,state:undefined});
 return {api,doc,state,navigation,summary,actions,sections,extra,events,statuses,get notice(){return summary.children[0].children[3];},get redirect(){return summary.children[0].children[4];},get advanced(){return actions.children[0].children[2];}};
}
const defer=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
test('six explicit phases; empty model and invalid printer block later steps with useful target',()=>{
 assert.deepEqual(GUIDED_WORKFLOW_PHASES.map(x=>x.id),['model','split','mark','print','connect','export']);
 for(const phase of ['split','mark','print','connect','export'])assert.deepEqual(guidedWorkflowGuard(phase,{hasModel:false}).targetPhase,'model');
 assert.equal(guidedWorkflowGuard('split',{hasModel:true,printerValid:false}).reason,'printer_invalid');
});
test('closed imported projects can enter every later phase without replaying cuts or selecting new rights',async()=>{
 const h=harness({state:{hasInteriorSelection:false,hasExistingMarks:true}});assert.equal(await h.api.selectPhase('export'),true);assert.equal(h.api.phase,'export');assert.equal(await h.api.selectPhase('mark'),true);assert.equal(h.notice.hidden,true);h.api.dispose();
});
test('interior choice is explicit before new cuts, optional by default and never grants permission',()=>{
 const input={hasModel:true,hasClosedParts:true,hasInteriorSelection:false};assert.equal(guidedWorkflowGuard('split',input).allowed,true);assert.equal(guidedWorkflowGuard('split',{...input,requireInteriorSelection:true}).reason,'interior_missing');assert.equal(guidedWorkflowGuard('mark',{...input,requireInteriorSelection:true}).allowed,true);assert.equal(input.hasInteriorSelection,false);
});
test('open preview can go back to model but cannot masquerade as committed parts',async()=>{
 const h=harness({initialPhase:'split',state:{hasOpenPreview:true}});for(const phase of ['mark','print','connect','export'])assert.equal(await h.api.selectPhase(phase),false);assert.equal(h.events.length,0);assert.equal(h.api.phase,'split');assert.equal(await h.api.previous(),true);assert.equal(h.api.phase,'model');assert.equal(h.state.hasOpenPreview,true);h.api.dispose();
});
test('busy and dirty pose never close preparation or call a phase callback',async()=>{
 let closeCount=0;const h=harness({initialPhase:'print',state:{printPreparationOpen:true,dirtyPrintPose:true},onClosePrintPreparation:()=>closeCount++});assert.equal(await h.api.next(),false);assert.equal(closeCount,0);assert.equal(h.events.length,0);assert.match(h.notice.textContent,/übernehmen|verwerfen/);h.state.dirtyPrintPose=false;h.state.busy=true;h.api.sync();assert.equal(await h.api.previous(),false);assert.equal(closeCount,0);assert.ok(h.navigation.children[0].children.every(x=>x.disabled));h.api.dispose();
});
test('clean preparation closes explicitly before view-only transition; no automatic next-step operation',async()=>{
 const calls=[];let h;h=harness({initialPhase:'print',state:{printPreparationOpen:true},onClosePrintPreparation:()=>{calls.push('close');h.state.printPreparationOpen=false;},onPhaseChange:e=>calls.push('view:'+e.phase)});assert.equal(await h.api.next(),true);assert.deepEqual(calls,['close','view:connect']);assert.equal(h.api.phase,'connect');h.api.dispose();
});
test('pending close locks second navigation and rechecks current busy/dirty state before changing step',async()=>{
 const d=defer();let h;h=harness({initialPhase:'print',state:{printPreparationOpen:true},onClosePrintPreparation:()=>d.promise});const pending=h.api.next();assert.equal(h.api.isChanging,true);assert.equal(await h.api.selectPhase('model'),false);h.state.printPreparationOpen=false;h.state.dirtyPrintPose=true;d.resolve();assert.equal(await pending,false);assert.equal(h.api.phase,'print');assert.equal(h.events.length,0);h.api.dispose();
});
test('missing or failed close callback leaves print step and propagates an actionable error',async()=>{
 const h=harness({initialPhase:'print',state:{printPreparationOpen:true}});await assert.rejects(h.api.next(),{reason:'print_preparation_open'});assert.equal(h.api.phase,'print');assert.equal(h.api.isChanging,false);h.api.dispose();
});
test('async view callback cannot publish a later phase after a new dirty-pose or busy state appears',async()=>{
 const d=defer(),h=harness({initialPhase:'print',onPhaseChange:()=>d.promise});const pending=h.api.next();await Promise.resolve();h.state.dirtyPrintPose=true;d.resolve();assert.equal(await pending,false);assert.equal(h.api.phase,'print');assert.equal(h.statuses.at(-1)[1].reason,'uncommitted_print_pose');h.api.dispose();
});
test('original IDs, hidden flags, disabled flags and event listeners survive phase filtering',async()=>{
 const h=harness(),node=h.sections.model;node.hidden=true;node.disabled=true;let clickCount=0;node.addEventListener('click',()=>clickCount++);await h.api.selectPhase('split');assert.equal(node.id,'original-model');assert.equal(node.hidden,true);assert.equal(node.disabled,true);assert.equal(node.hasAttribute('data-workflow-hidden'),true);assert.equal(h.sections.split.hasAttribute('data-workflow-hidden'),false);node.fire('click');assert.equal(clickCount,1);assert.equal(h.extra.hasAttribute('data-workflow-hidden'),true);h.api.dispose();assert.equal(node.hasAttribute('data-workflow-hidden'),false);assert.equal(node.hidden,true);assert.equal(node.disabled,true);
});
test('advanced tools are local to the selected phase and delayed toggle cannot leak between phases',async()=>{
 const h=harness();await h.api.selectPhase('split');const event=h.advanced.children[0].fire('click');assert.equal(event.defaultPrevented,true);assert.equal(h.api.advanced,true);assert.equal(h.extra.hasAttribute('data-workflow-hidden'),false);await h.api.selectPhase('mark');assert.equal(h.api.advanced,false);h.advanced.fire('toggle');assert.equal(h.api.advanced,false);assert.equal(h.extra.hasAttribute('data-workflow-hidden'),true);await h.api.selectPhase('split');assert.equal(h.api.advanced,true);assert.equal(h.extra.hasAttribute('data-workflow-hidden'),false);h.api.setAdvanced(false);assert.equal(h.extra.hasAttribute('data-workflow-hidden'),true);h.api.dispose();
});
test('open connector plan blocks export with visible reason and a direct Stifte link',async()=>{
 const h=harness({state:{connectorPlanPresent:true,connectorIssueCount:3}});assert.equal(await h.api.selectPhase('export'),false);assert.match(h.notice.textContent,/3 Stiftverbindungen/);assert.equal(h.redirect.hidden,false);assert.equal(h.redirect.textContent,'Zu den Stiften');assert.equal(h.statuses.at(-1)[1].targetPhase,'connect');await h.api.selectPhase('connect');assert.match(h.notice.textContent,/3 Stiftverbindungen/);h.state.connectorIssueCount=0;h.api.sync();assert.equal(await h.api.next(),true);assert.equal(h.api.phase,'export');assert.equal(await h.api.next(),false);assert.equal(h.events.length,2);h.api.dispose();
});
test('existing export view shows a new connection failure instead of silently treating it complete',async()=>{
 const h=harness({initialPhase:'export'});h.state.connectorPlanPresent=true;h.state.connectorIssueCount=1;h.api.sync();assert.match(h.notice.textContent,/1 Stiftverbindung ist/);assert.equal(h.redirect.textContent,'Zu den Stiften');assert.equal(h.redirect.hidden,false);h.api.dispose();
});
test('not-yet-calculated pin plan gives a preparation message and keeps export gated',async()=>{
 const h=harness({initialPhase:'connect',state:{connectorPlanPresent:true,connectorPlanPending:true,connectorIssueCount:1}});
 assert.match(h.notice.textContent,/Noch kein Stiftplan/);assert.doesNotMatch(h.notice.textContent,/noch offen/);
 assert.equal(await h.api.selectPhase('export'),false);assert.match(h.notice.textContent,/Verbindungen berechnen/);
 h.state.connectorPlanPending=false;h.state.connectorIssueCount=0;h.api.sync();assert.equal(await h.api.selectPhase('export'),true);h.api.dispose();
});
test('load or Undo replacing the complete state still reveals unresolved connectors while export remains current',()=>{
 let project=Object.freeze({hasModel:true,hasClosedParts:true,printerValid:true,connectorPlanPresent:true,connectorIssueCount:0});const h=harness({initialPhase:'export',getState:()=>project});assert.equal(h.notice.hidden,true);
 project=Object.freeze({...project,connectorIssueCount:4});assert.equal(guidedWorkflowGuard('export',project,'export').allowed,true);h.api.sync();assert.equal(h.api.phase,'export');assert.match(h.notice.textContent,/4 Stiftverbindungen/);assert.equal(h.redirect.textContent,'Zu den Stiften');assert.equal(h.redirect.hidden,false);assert.equal(h.events.length,0);
 project=Object.freeze({...project,connectorIssueCount:0});h.api.sync();assert.equal(h.notice.hidden,true);assert.equal(h.redirect.hidden,true);assert.equal(h.api.phase,'export');h.api.dispose();
});
test('sync never changes phase after load or triggers calculations/print preparation',()=>{
 const h=harness();h.state.hasClosedParts=true;h.api.sync();h.api.sync();assert.equal(h.events.length,0);assert.equal(h.api.phase,'model');assert.equal(h.state.printPreparationOpen,undefined);h.api.dispose();
});
test('malformed phases/state are explicit failures, disposal leaves no pending navigation publication',async()=>{
 assert.throws(()=>guidedWorkflowGuard('guess',{hasModel:true}),{reason:'invalid_phase'});assert.throws(()=>guidedWorkflowGuard('split',{hasModel:'yes'}),{reason:'invalid_state'});assert.throws(()=>guidedWorkflowGuard('export',{hasModel:true,connectorIssueCount:NaN}),{reason:'invalid_state'});
 const d=defer(),h=harness({onPhaseChange:()=>d.promise});const pending=h.api.next();await Promise.resolve();h.api.dispose();d.resolve();assert.equal(await pending,false);assert.equal(h.api.phase,'model');assert.equal(h.navigation.children.length,0);await assert.rejects(h.api.next(),{reason:'disposed'});
});
