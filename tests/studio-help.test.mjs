import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {mountStudioHelp,STUDIO_HELP_TOPICS} from '../src/studio-help.mjs';

class Element {
  constructor(tag,doc){this.tagName=tag.toUpperCase();this.ownerDocument=doc;this.children=[];this.parentElement=null;this.attrs=new Map();this.listeners=new Map();this.dataset={};this.hidden=false;this.disabled=false;this.className='';this.textContent='';this.classList={add:className=>{this.className+=' '+className;}};}
  append(...nodes){for(const node of nodes){node.parentElement=this;this.children.push(node);}}
  prepend(node){node.parentElement=this;this.children.unshift(node);}
  replaceChildren(...nodes){for(const child of this.children)child.parentElement=null;this.children=[];this.append(...nodes);}
  remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(c=>c!==this);this.parentElement=null;}
  setAttribute(k,v){this.attrs.set(k,String(v));}getAttribute(k){return this.attrs.get(k)??null;}removeAttribute(k){this.attrs.delete(k);}
  addEventListener(k,f){if(!this.listeners.has(k))this.listeners.set(k,[]);this.listeners.get(k).push(f);}removeEventListener(k,f){this.listeners.set(k,(this.listeners.get(k)||[]).filter(v=>v!==f));}
  fire(k,input={}){const e={preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;},...input};for(const f of this.listeners.get(k)||[])f(e);return e;}
  focus(){this.ownerDocument.activeElement=this;}showModal(){this.setAttribute('open','');}close(){this.removeAttribute('open');this.fire('close');}
  get isConnected(){return this===this.ownerDocument.body||!!this.parentElement?.isConnected;}
}
function fixture(options={}){
  const anchors=new Map(),doc={createElement(tag){return new Element(tag,this);},querySelector(selector){return anchors.get(selector)||null;}};doc.body=doc.createElement('body');doc.activeElement=doc.body;
  const add=topic=>{const node=doc.createElement(topic.id==='model'||topic.id==='mark'||topic.id==='connect'?'summary':'div');anchors.set(topic.selector,node);doc.body.append(node);return node;};if(options.anchors!==false)for(const t of STUDIO_HELP_TOPICS)add(t);
  const api=mountStudioHelp({root:doc,onOpenTutorial:options.onOpenTutorial});
  const all=()=>{const result=[];const walk=n=>{result.push(n);n.children.forEach(walk);};walk(doc.body);return result;};
  return{api,doc,anchors,add,all,find:pred=>all().find(pred),get dialog(){return all().find(n=>n.tagName==='DIALOG');},get title(){return all().find(n=>n.tagName==='H2');},button:id=>all().find(n=>n.dataset.studioHelp===id),control:cls=>all().find(n=>n.className===cls)};
}
const flush=()=>new Promise(r=>setImmediate(r));
test('six immutable topics bind actual production panel IDs and accurate operation text',async()=>{
  assert.deepEqual(STUDIO_HELP_TOPICS.map(t=>t.id),['model','split','mark','print','connect','export']);
  const source=await fs.readFile(new URL('../index.html',import.meta.url),'utf8')+await fs.readFile(new URL('../src/workflow-layout.mjs',import.meta.url),'utf8');
  for(const topic of STUDIO_HELP_TOPICS){assert(Object.isFrozen(topic));assert(Object.isFrozen(topic.items));assert(source.includes(topic.selector.match(/^#([\w]+)/)[1]));}
  const text=JSON.stringify(STUDIO_HELP_TOPICS);for(const expected of ['zuletzt angeklickten','0,4 mm','3,3 mm','7 mm','5 mm','2 mm','von Hand','Als PDF speichern'])assert(text.includes(expected),expected);assert(!/Hexen|Dach/i.test(text));assert(!/automatisch/i.test(STUDIO_HELP_TOPICS.find(t=>t.id==='print').items.join(' ')));
});
test('mount adds six small buttons and no modal; sync is idempotent',()=>{
  const h=fixture();assert.equal(h.all().filter(n=>n.dataset.studioHelp).length,6);assert.equal(h.dialog.getAttribute('open'),null);for(let i=0;i<3;i++)h.api.sync();assert.equal(h.all().filter(n=>n.dataset.studioHelp).length,6);for(const t of STUDIO_HELP_TOPICS)assert.equal(h.button(t.id).getAttribute('aria-label'),'Hilfe: '+t.title);h.api.dispose();
});
test('help labels Teilwerk as product and Prinjekt as brand without renaming internal IDs',()=>{
  const h=fixture();assert(h.all().some(n=>n.textContent==='TEILWERK · HILFE VON PRINJEKT'));assert(!h.all().some(n=>/Studio/.test(n.textContent)));assert.equal(h.button('model').dataset.studioHelp,'model');h.api.dispose();
});
test('late layout and replaced title are discovered without duplicate buttons/listeners',()=>{
  const h=fixture({anchors:false});assert.equal(h.all().filter(n=>n.dataset.studioHelp).length,0);h.add(STUDIO_HELP_TOPICS[0]);h.api.sync();const old=h.button('model');old.remove();h.api.sync();assert.notEqual(h.button('model'),old);assert.equal(old.listeners.get('click').length,0);assert.equal(h.all().filter(n=>n.dataset.studioHelp).length,1);h.api.dispose();
});
test('summary help suppresses default toggle and opens only help content',()=>{
  const h=fixture();const b=h.button('model');b.focus();const event=b.fire('click');assert(event.prevented&&event.stopped);assert.equal(h.dialog.getAttribute('open'),'');assert.equal(h.title.textContent,'Innenflächen auswählen');assert.equal(h.doc.activeElement,h.title);h.api.close();assert.equal(h.doc.activeElement,b);h.api.dispose();
});
test('sync overrides global busy disable only on owned help controls',()=>{
  const h=fixture({onOpenTutorial:()=>{}});const outside=h.doc.createElement('button');h.doc.body.append(outside);for(const n of h.all())if(n.tagName==='BUTTON')n.disabled=true;h.api.sync();for(const n of h.all())if(n.tagName==='BUTTON'&&n!==outside)assert.equal(n.disabled,false);assert.equal(outside.disabled,true);h.api.dispose();
});
test('Escape, focus wrap and delayed native close keep dialog sessions distinct',()=>{
  const h=fixture({onOpenTutorial:()=>{}}),b=h.button('print');b.focus();h.api.open('print');const last=h.control('studio-help-done');assert(h.dialog.fire('keydown',{key:'Tab',shiftKey:true}).prevented);assert.equal(h.doc.activeElement,last);last.focus();h.dialog.fire('keydown',{key:'Tab'});assert.equal(h.doc.activeElement,h.control('studio-help-close'));h.dialog.fire('keydown',{key:'Escape'});assert.equal(h.doc.activeElement,b);h.api.open('export');h.dialog.fire('close');assert.equal(h.dialog.getAttribute('open'),'');h.api.dispose();
});
test('tutorial receives only topic, with contextual modal already closed',async()=>{
  let h;const calls=[];h=fixture({onOpenTutorial:id=>{assert.equal(h.dialog.getAttribute('open'),null);calls.push(id);}});h.api.open('connect');h.control('studio-help-tutorial').fire('click');await flush();assert.deepEqual(calls,['connect']);h.api.dispose();const no=fixture();assert.equal(no.control('studio-help-tutorial').hidden,true);no.api.dispose();
});
test('late tutorial rejection does not reopen a newer session or disposed help',async()=>{
  let reject;const p=new Promise((_,r)=>reject=r);const h=fixture({onOpenTutorial:()=>p});h.api.open('mark');h.control('studio-help-tutorial').fire('click');h.api.open('print');reject(Error('old'));await flush();assert.equal(h.title.textContent,'Drucklage & manuelle Finnen');assert.equal(h.control('studio-help-status').hidden,true);h.api.dispose();assert.equal(h.all().filter(n=>n.tagName==='DIALOG').length,0);
});
test('callback failure is readable and disposal removes only owned nodes',async()=>{
  const h=fixture({onOpenTutorial:()=>{throw Error('Bitte später öffnen.');}});h.api.open('model');h.control('studio-help-tutorial').fire('click');assert.equal(h.control('studio-help-status').textContent,'Bitte später öffnen.');assert.equal(h.dialog.getAttribute('open'),'');const anchors=[...h.anchors.values()];h.api.dispose();h.api.sync();h.api.dispose();assert(anchors.every(n=>n.isConnected));assert.equal(h.all().filter(n=>n.dataset.studioHelp).length,0);assert.equal(h.api.open('model'),false);
});
test('invalid API input/topic rejects without model callbacks',()=>{assert.throws(()=>mountStudioHelp({root:null}),/Dokument/);assert.throws(()=>fixture({onOpenTutorial:1}),/Callback/);const h=fixture();assert.throws(()=>h.api.open('unknown'),/Unbekannt/);h.api.dispose();});
