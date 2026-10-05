import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {mountStudioTutorial,STUDIO_TUTORIAL_STEPS} from '../src/studio-tutorial.mjs';

class Node {
  constructor(tag,doc){this.tagName=tag.toUpperCase();this.ownerDocument=doc;this.children=[];this.attrs=new Map();this.dataset={};this.listeners=new Map();this.hidden=false;this.disabled=false;this.textContent='';this.className='';}
  append(...nodes){for(const n of nodes){n.parent=this;this.children.push(n);}}
  replaceChildren(...nodes){for(const n of this.children)n.parent=null;this.children=[];this.append(...nodes);}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(n=>n!==this);this.parent=null;}
  setAttribute(k,v){this.attrs.set(k,String(v));}getAttribute(k){return this.attrs.get(k)??null;}removeAttribute(k){this.attrs.delete(k);}
  addEventListener(t,f){if(!this.listeners.has(t))this.listeners.set(t,[]);this.listeners.get(t).push(f);}removeEventListener(t,f){this.listeners.set(t,(this.listeners.get(t)||[]).filter(fn=>fn!==f));}
  fire(type,event={}){const e={preventDefault(){this.defaultPrevented=true;},...event};for(const fn of this.listeners.get(type)||[])fn(e);return e;}
  focus(){this.ownerDocument.activeElement=this;}
  showModal(){this.setAttribute('open','');}close(){this.removeAttribute('open');this.fire('close');}
  get isConnected(){return this===this.ownerDocument.body||Boolean(this.parent?.isConnected);}
  closest(selector){if(selector==='[hidden]'&&this.hidden)return this;return this.parent?.closest(selector)??null;}
  querySelectorAll(selector){return this.children.flatMap(n=>[...(selector==='button'&&n.tagName==='BUTTON'?[n]:[]),...n.querySelectorAll(selector)]);}
}
function fixture(options={}){
  const doc={createElement(tag){return new Node(tag,this);}};doc.body=doc.createElement('body');doc.activeElement=doc.body;
  const buttonHost=doc.createElement('div'),welcomeHost=doc.createElement('section');doc.body.append(buttonHost,welcomeHost);
  const state={hasProject:false,busy:false,dirtyPrintPose:false,...options.state},calls=[];
  const api=mountStudioTutorial({buttonHost,welcomeHost,getState:()=>state,...options});
  const nodes=()=>{const all=[];const walk=n=>{all.push(n);n.children.forEach(walk);};walk(doc.body);return all;};
  const find=fn=>nodes().find(fn),button=text=>find(n=>n.tagName==='BUTTON'&&n.textContent===text),step=id=>find(n=>n.dataset.tutorialStep===id);
  return{doc,api,state,calls,buttonHost,welcomeHost,find,button,step,get dialog(){return find(n=>n.tagName==='DIALOG');},get title(){return find(n=>n.id?.endsWith('-title'));},get status(){return find(n=>n.className==='studio-tutorial-status');},get jump(){return find(n=>n.dataset.studioTutorial==='navigate');}};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};

test('content follows the six real phases and references existing controls only',async()=>{
  assert.deepEqual(STUDIO_TUTORIAL_STEPS.map(s=>s.id),['overview','model','split','mark','print','connect','export']);
  const html=await fs.readFile(new URL('../index.html',import.meta.url),'utf8');
  for(const step of STUDIO_TUTORIAL_STEPS){assert(Object.isFrozen(step));assert(Object.isFrozen(step.points));for(const id of step.controls)assert(html.includes(`id="${id}"`),id);}
  const copy=JSON.stringify(STUDIO_TUTORIAL_STEPS);assert(!/Hexen|Dach|Cloud|offline|bleiben bei dir/i.test(copy));assert.match(copy,/von Hand/);assert.match(copy,/Vorschau ist noch kein/);
});
test('first-run card is inline; mount and sync never open a dialog or load a model',()=>{
  let count=0;const h=fixture({onStartDemo:()=>count++,onImportModel:()=>count++,onOpenProject:()=>count++});
  h.api.sync();assert.equal(count,0);assert.equal(h.api.isOpen,false);assert.equal(h.welcomeHost.children[0].hidden,false);assert.equal(h.dialog.getAttribute('open'),null);h.api.dispose();
});
test('user-facing product is Teilwerk while internal IDs and saved preference stay compatible',async()=>{
  const h=fixture({onNavigate:()=>false});assert.equal(h.welcomeHost.children[0].getAttribute('aria-label'),'Einstieg in Teilwerk');assert.equal(h.find(n=>n.className==='studio-tutorial-brand').textContent,'TEILWERK');h.api.open('export');assert.equal(h.jump.textContent,'In Teilwerk: Export →');assert(h.button('Zurück zu Teilwerk'));assert.match(JSON.stringify(STUDIO_TUTORIAL_STEPS),/Teilwerk-Projekt/);assert(!/Studio|Prinjekt-Projekt/.test(JSON.stringify(STUDIO_TUTORIAL_STEPS)));const css=await fs.readFile(new URL('../src/studio-tutorial.css',import.meta.url),'utf8');assert(css.includes("content:' / PRINJEKT'"));assert.equal(h.jump.dataset.studioTutorial,'navigate');h.api.dispose();
});
test('existing project suppresses welcome and all load actions, even when invoked after a stale render',()=>{
  let count=0;const h=fixture({onStartDemo:()=>count++});h.api.open();const demo=h.find(n=>n.dataset.tutorialStart==='demo');h.state.hasProject=true;demo.fire('click');assert.equal(count,0);h.api.sync();assert.equal(h.welcomeHost.children[0].hidden,true);assert.equal(demo.disabled,true);assert(demo.closest('[hidden]'));assert.equal(h.api.isOpen,true);h.api.dispose();
});
test('explicit file action runs synchronously in the user gesture, exactly once',async()=>{
  const d=deferred();let count=0;const h=fixture({onImportModel:()=>{count++;return d.promise;}});h.api.open();const b=h.find(n=>n.dataset.tutorialStart==='import');b.fire('click');assert.equal(count,1);assert.equal(h.api.isOpen,false);b.fire('click');assert.equal(count,1);h.state.hasProject=true;d.resolve();await flush();assert.equal(h.welcomeHost.children[0].hidden,true);h.api.dispose();
});
test('busy and dirty state deny start/navigation without mutating host state',async()=>{
  let count=0;const h=fixture({onStartDemo:()=>count++,onNavigate:()=>count++});h.api.open('print');
  for(const field of ['busy','dirtyPrintPose']){h.state[field]=true;const before=structuredClone(h.state);h.api.sync();assert.equal(h.jump.disabled,true);h.jump.fire('click');h.find(n=>n.dataset.tutorialStart==='demo').fire('click');await flush();assert.equal(count,0);assert.deepEqual(h.state,before);h.state[field]=false;}
  h.api.dispose();
});
test('global main busy-button disable cannot trap the help dialog or disable reading it',()=>{
  const h=fixture({onStartDemo:()=>{},onNavigate:()=>true});h.api.open('print');h.state.busy=true;
  for(const b of h.doc.body.querySelectorAll('button'))b.disabled=true;h.api.sync();
  assert.equal(h.buttonHost.children[0].disabled,false);assert.equal(h.button('Schließen ×').disabled,false);assert.equal(h.button('Tutorial öffnen →').disabled,false);
  for(const phase of ['overview','model','split','mark','print','connect','export'])assert.equal(h.step(phase).disabled,false);
  assert.equal(h.button('← Zurück').disabled,false);assert.equal(h.button('Weiter →').disabled,false);assert.equal(h.jump.disabled,true);assert.equal(h.find(n=>n.dataset.tutorialStart==='demo').disabled,true);
  h.button('Schließen ×').fire('click');assert.equal(h.api.isOpen,false);h.api.dispose();
});
test('chapter selection only changes help; accepted host navigation closes the dialog',async()=>{
  const phases=[];const h=fixture({state:{hasProject:true},onNavigate:phase=>{phases.push(phase);return true;}});h.api.open();h.step('connect').fire('click');assert.deepEqual(phases,[]);assert.equal(h.api.currentStep,'connect');h.jump.fire('click');await flush();assert.deepEqual(phases,['connect']);assert.equal(h.api.isOpen,false);h.api.dispose();
});
test('pending host action does not lock reading another tutorial chapter',async()=>{
  const d=deferred();const h=fixture({onStartDemo:()=>d.promise});h.api.open();h.find(n=>n.dataset.tutorialStart==='demo').fire('click');h.state.busy=true;h.api.open('model');h.api.sync();h.step('print').fire('click');assert.equal(h.api.currentStep,'print');assert.equal(h.step('print').disabled,false);assert.equal(h.button('Weiter →').disabled,false);assert.equal(h.find(n=>n.dataset.tutorialStart==='demo').disabled,true);d.resolve();await flush();h.api.dispose();
});
test('denied or failed navigation remains in help with a useful message',async()=>{
  const h=fixture({onNavigate:()=>false});h.api.open('export');h.jump.fire('click');await flush();assert.equal(h.api.isOpen,true);assert.match(h.status.textContent,/noch nicht verfügbar/);h.api.dispose();
  const f=fixture({onNavigate:()=>{throw Error('Vorschau zuerst verwerfen.');}});f.api.open('split');f.jump.fire('click');await flush();assert.equal(f.api.isOpen,true);assert.equal(f.status.textContent,'Vorschau zuerst verwerfen.');f.api.dispose();
});
test('late navigation cannot close a newly opened tutorial session; repeated clicks do not dispatch twice',async()=>{
  const d=deferred();let count=0;const h=fixture({onNavigate:()=>{count++;return d.promise;}});h.api.open('model');h.jump.fire('click');h.jump.fire('click');h.api.close();h.api.open('print');d.resolve(true);await flush();assert.equal(count,1);assert.equal(h.api.isOpen,true);assert.equal(h.api.currentStep,'print');h.api.dispose();
});
test('Escape and Tab keep focus predictable, and return to the original launcher',()=>{
  const h=fixture();const launch=h.buttonHost.children[0];launch.focus();launch.fire('click');assert.equal(h.doc.activeElement,h.title);
  const first=h.dialog.querySelectorAll('button')[0],last=h.button('Weiter →');last.focus();assert.equal(h.dialog.fire('keydown',{key:'Tab'}).defaultPrevented,true);assert.equal(h.doc.activeElement,first);
  h.title.focus();assert.equal(h.dialog.fire('keydown',{key:'Tab',shiftKey:true}).defaultPrevented,true);assert.equal(h.doc.activeElement,last);
  h.dialog.fire('keydown',{key:'Escape'});assert.equal(h.api.isOpen,false);assert.equal(h.doc.activeElement,launch);h.api.dispose();
});
test('queued native close from the previous session cannot close a freshly reopened dialog',()=>{
  const h=fixture();h.api.open();h.api.close();h.api.open('export');h.dialog.fire('close');assert.equal(h.api.isOpen,true);assert.equal(h.api.currentStep,'export');h.dialog.removeAttribute('open');h.dialog.fire('close');assert.equal(h.api.isOpen,false);h.api.dispose();
});
test('dismiss stores one preference only; unavailable storage does not break the entry',()=>{
  const calls=[];const h=fixture({storage:{getItem:k=>null,setItem:(...args)=>calls.push(args)}});h.button('Später').fire('click');assert.equal(h.welcomeHost.children[0].hidden,true);assert.deepEqual(calls,[['prinjekt.studio.tutorial.v1.dismissed','1']]);h.api.open();assert.equal(h.api.isOpen,true);h.api.dispose();
  const f=fixture({storage:{getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}}});f.button('Später').fire('click');assert.equal(f.welcomeHost.children[0].hidden,true);f.api.dispose();
});
test('late load rejection cannot cover an already loaded project or reopen after disposal',async()=>{
  const d=deferred(),h=fixture({onStartDemo:()=>d.promise});h.api.open();h.find(n=>n.dataset.tutorialStart==='demo').fire('click');h.state.hasProject=true;d.reject(Error('late error'));await flush();assert.equal(h.api.isOpen,false);h.api.dispose();
  const e=deferred(),f=fixture({onStartDemo:()=>e.promise});f.find(n=>n.dataset.tutorialStart==='demo').fire('click');f.api.dispose();e.reject(Error('late error'));await flush();assert.equal(f.doc.body.children.length,2);assert.equal(f.buttonHost.children.length,0);assert.equal(f.welcomeHost.children.length,0);
});
test('dispose removes only owned nodes/listeners; bad configuration fails before mounting',()=>{
  const h=fixture();const original=h.doc.createElement('span');h.buttonHost.append(original);h.api.open();h.api.dispose();h.api.dispose();assert.deepEqual(h.buttonHost.children,[original]);assert.equal(h.api.open(),false);
  assert.throws(()=>mountStudioTutorial(),/buttonHost/);assert.throws(()=>fixture({getState:()=>({hasProject:'yes'})}),/hasProject/);assert.throws(()=>fixture({onNavigate:42}),/Callback/);
});
