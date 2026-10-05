import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import {createPrintPreparationUI} from '../src/print-preparation-ui.mjs';
import {guidedWorkflowGuard} from '../src/guided-workflow.mjs';
import {printStability} from '../src/print-stability.mjs';

const src=new URL('../src/',import.meta.url),threeURL=import.meta.resolve('three');
// Reuse the existing fake DOM and gizmo only; the UI, app adapter and state
// gates below are real production functions. No worker, server or CSG is used.
let helpers=await fs.readFile(new URL('./print-preparation-ui.test.mjs',import.meta.url),'utf8');
helpers=helpers.slice(0,helpers.indexOf("test('opening"));
helpers=helpers.replace("from 'three'",'from '+JSON.stringify(threeURL)).replace("from '../src/print-preparation-ui.mjs'",'from '+JSON.stringify(new URL('print-preparation-ui.mjs',src).href));
const {Events,Element,Controls,box}=await import('data:text/javascript;base64,'+Buffer.from(helpers+'\nexport {Events,Element,Controls,box};').toString('base64'));
Element.prototype.replaceChildren=function(...children){this.children=[];this.append(...children);};
Element.prototype.querySelectorAll=function(selector){return this.children.flatMap(x=>[...(selector==='button'&&x.tagName==='BUTTON'?[x]:[]),...x.querySelectorAll(selector)]);};
let source=await fs.readFile(new URL('print-preparation-app.mjs',src),'utf8');
source=source.replace("from 'three'",'from '+JSON.stringify(threeURL)).replace("import {createPrintPreparationUI} from './print-preparation-ui.mjs';",'const createPrintPreparationUI=options=>globalThis.appReviewCreateUI(options);');
source=source.replace(/from '(\.\/[^']+)'/g,(_m,file)=>'from '+JSON.stringify(new URL(file,src).href));
const {createPrintPreparationApp}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
function harness(){
 const doc={createElement(tag){return new Element(tag,doc);},getElementById(){return null;},body:{classList:{toggle(){}}}};
 globalThis.document=doc;globalThis.window=new Events();
 const events=new Events(),controls=new Controls(),container=doc.createElement('div'),canvas=doc.createElement('canvas');
 let ui,options;
 globalThis.appReviewCreateUI=o=>{options=o;ui=createPrintPreparationUI({...o,eventTarget:events,controlsFactory:()=>controls,requestFrame:()=>1,cancelFrame(){}});return ui;};
 const state={parts:[box('7',0,2),box('11',1,2)],active:0,printer:{bed:[250,250,250],margin:0},preview:false,busy:false},requests=[],commits=[];
 const scene=new THREE.Scene();
 const app=createPrintPreparationApp({container,scene,camera:new THREE.PerspectiveCamera(),renderer:{domElement:canvas},controls:{enabled:true},models:new THREE.Group(),overlays:new THREE.Group(),
  getState:()=>state,selectPart:index=>{state.active=index;},commitPart:(index,part)=>{commits.push({index,part});state.parts[index]=part;},request:async(op,value)=>{requests.push({op,value});return{supports:undefined};},run:fn=>fn(),undo(){},frame(){},status(){},finOptions:()=>({layerHeight:.2,material:'PLA'})});
 return {app,ui,options,state,requests,commits,scene,dispose(){ui.dispose();}};
}
test('presentation refresh preserves literal draft, preview mesh and revision',()=>{
 const h=harness();h.app.open();h.ui.rotate90('y');const matrix=h.ui.getPreviewTransform(),mesh=h.app.getPreviewMesh(),revision=h.options.getCurrentPart().revision;
 h.app.refresh();h.app.refresh();assert.equal(h.app.isDirty,true);assert.deepEqual(h.ui.getPreviewTransform(),matrix);assert.equal(h.app.getPreviewMesh(),mesh);assert.equal(h.options.getCurrentPart().revision,revision);h.dispose();
});
test('first fin click survives presentation refresh and pairs with the second click',async()=>{
 const h=harness();h.app.open();h.ui.armFins();const token=h.options.getCurrentPart();
 await h.options.onFinPick({...token,tool:'draw',point:[0,0,30],normal:[0,0,1]});
 const ghost=h.app.getPreviewMesh().getObjectByName('manual-fin-draft');assert.equal(ghost.visible,true);h.app.refresh();assert.equal(ghost.visible,true);assert.equal(h.ui.mode,'fins');
 await h.options.onFinPick({...token,tool:'draw',point:[3,0,30],normal:[0,0,1]});
 assert.equal(h.requests.length,1);assert.equal(h.requests[0].op,'addManualDrawnFin');assert.deepEqual(h.requests[0].value.options.a,[0,0,30]);assert.deepEqual(h.requests[0].value.options.b,[3,0,30]);h.dispose();
});
test('actual part replacement invalidates the old revision and reloads the current saved pose',async()=>{
 const h=harness();h.app.open();h.ui.rotate90('y');const old=h.options.getCurrentPart();h.state.parts[0]={...h.state.parts[0],note:'changed'};h.app.refresh();
 assert.equal(h.app.isDirty,false);assert.notEqual(h.options.getCurrentPart().revision,old.revision);await assert.rejects(h.options.onCommit({...old,localTransform:new THREE.Matrix4().toArray()}),/Projekt wurde geändert/);assert.equal(h.requests.length,0);h.dispose();
});
test('in-place geometry-reference replacement and printer edits still invalidate',()=>{
 const h=harness();h.app.open();h.ui.rotate90('x');let revision=h.options.getCurrentPart().revision;h.state.parts[0].vertices=h.state.parts[0].vertices.slice();h.app.refresh();assert.equal(h.app.isDirty,false);assert.notEqual(h.options.getCurrentPart().revision,revision);
 h.ui.rotate90('y');revision=h.options.getCurrentPart().revision;h.state.printer.bed[0]=240;h.app.refresh();assert.equal(h.app.isDirty,false);assert.notEqual(h.options.getCurrentPart().revision,revision);h.dispose();
});
test('closing a draft cannot leave the wizard locked by an invisible dirty pose',()=>{
 const h=harness();h.app.open();const original=structuredClone(h.state.parts);h.ui.rotate90('y');h.app.close();assert.equal(h.app.isOpen,false);assert.equal(h.app.isDirty,false);
 assert.equal(guidedWorkflowGuard('connect',{hasModel:true,hasClosedParts:true,dirtyPrintPose:h.app.isDirty,printPreparationOpen:h.app.isOpen},'print').allowed,true);assert.deepEqual(h.state.parts,original);assert.equal(h.commits.length,0);h.app.open();assert.equal(h.app.isDirty,false);h.dispose();
});

test('wireframe uses existing preview material on open and preserves rotation and fin anchor',async()=>{
 const h=harness();h.state.wire=true;h.app.open();const mesh=h.app.getPreviewMesh();assert.equal(mesh.material.wireframe,true);
 h.ui.rotate90('x');const matrix=h.ui.getPreviewTransform(),revision=h.options.getCurrentPart().revision;h.state.wire=false;h.app.refresh();assert.equal(mesh.material.wireframe,false);assert.deepEqual(h.ui.getPreviewTransform(),matrix);assert.equal(h.options.getCurrentPart().revision,revision);assert.equal(h.app.getPreviewMesh(),mesh);
 h.ui.reset();h.ui.armFins();const token=h.options.getCurrentPart();await h.options.onFinPick({...token,tool:'draw',point:[0,0,30],normal:[0,0,1]});const anchor=mesh.getObjectByName('manual-fin-draft');assert.equal(anchor.visible,true);h.state.wire=true;h.app.refresh();assert.equal(mesh.material.wireframe,true);assert.equal(anchor.visible,true);assert.equal(h.ui.mode,'fins');await h.options.onFinPick({...token,tool:'draw',point:[3,0,30],normal:[0,0,1]});assert.deepEqual(h.requests[0].value.options.a,[0,0,30]);h.dispose();
});

test('stability overlay stays in committed print frame and disappears for dirty preview or closed UI',()=>{
 const h=harness();h.state.parts[0].printStability=printStability(h.state.parts[0]);h.state.showStability=true;h.app.open();const group=h.scene.getObjectByName('manual-preparation-stability'),helper=group.getObjectByName('print-stability-overlay');assert.equal(group.visible,true);assert.ok(helper);assert.deepEqual(group.matrix.toArray(),new THREE.Matrix4().toArray());assert.deepEqual(helper.getObjectByName('center-of-mass').position.toArray(),h.state.parts[0].printStability.centerOfMass);
 let disposed=0;helper.traverse(o=>o.geometry?.addEventListener('dispose',()=>disposed++));const mesh=h.app.getPreviewMesh(),revision=h.options.getCurrentPart().revision;h.ui.rotate90('x');assert.equal(group.visible,false);h.state.showStability=false;h.app.refresh();assert.equal(group.visible,false);h.state.showStability=true;h.app.refresh();assert.equal(group.visible,false);assert.equal(h.app.isDirty,true);assert.equal(h.app.getPreviewMesh(),mesh);assert.equal(h.options.getCurrentPart().revision,revision);assert.equal(group.children[0],helper);assert.equal(disposed,0);
 h.ui.reset();assert.equal(group.visible,true);h.state.showStability=false;h.app.updateAppearance();assert.equal(group.visible,false);h.state.showStability=true;h.app.updateAppearance();assert.equal(group.visible,true);h.app.close();assert.equal(group.visible,false);assert.equal(group.children.length,0);assert.equal(disposed,4);assert.equal(h.commits.length,0);h.dispose();
});

