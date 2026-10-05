import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createPrintPreparationUI,printPreparationFace} from '../src/print-preparation-ui.mjs';
class Events{
 listeners=new Map();
 addEventListener(type,fn){const a=this.listeners.get(type)??[];a.push(fn);this.listeners.set(type,a);}
 removeEventListener(type,fn){this.listeners.set(type,(this.listeners.get(type)??[]).filter(x=>x!==fn));}
 fire(type,event={}){const e={type,preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;},stopPropagation(){this.stopped=true;},...event};for(const fn of this.listeners.get(type)??[])fn(e);return e;}
}
class Element extends Events{
 constructor(tag,doc){super();this.tagName=tag.toUpperCase();this.ownerDocument=doc;this.children=[];this.dataset={};this.style={};this.attrs={};this.textContent='';this.hidden=false;this.disabled=false;}
 append(...els){this.children.push(...els);for(const e of els)e.parent=this;}
 setAttribute(k,v){this.attrs[k]=v;}
 getAttribute(k){return this.attrs[k]??null;}
 remove(){if(this.parent)this.parent.children=this.parent.children.filter(e=>e!==this);}
 getBoundingClientRect(){return{left:0,top:0,width:600,height:600};}
 closest(){return ['INPUT','TEXTAREA','SELECT'].includes(this.tagName)||this.editable?this:null;}
}
class Controls extends Events{
 constructor(){super();this.helper=new THREE.Group();this.dragging=false;}
 getHelper(){return this.helper;}
 setMode(x){this.controlMode=x;}setSpace(x){this.space=x;}setSize(x){this.size=x;}setRotationSnap(x){this.snap=x;}
 attach(o){this.object=o;}detach(){this.object=undefined;}dispose(){this.disposed=true;}
 pointerUp(){this.dragging=false;this.fire('dragging-changed',{value:false});}
 begin(){this.dragging=true;this.fire('dragging-changed',{value:true});}
 turn(q){this.object.quaternion.premultiply(q);this.fire('objectChange');}
}
function box(id,index,count,z=0){const g=new THREE.BoxGeometry(10,20,30);g.translate(0,0,15+z);return {id,revision:'rev-1',index,count,vertices:Float64Array.from(g.attributes.position.array),triangles:Uint32Array.from(g.index.array),color:'#6fc7d4'};}
function harness(options={}){
 const doc={createElement(tag){return new Element(tag,doc);}},container=doc.createElement('div'),canvas=doc.createElement('canvas'),events=new Events(),controls=new Controls(),orbit={enabled:true};
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(40,1,.1,1000);camera.position.set(0,0,120);camera.lookAt(0,0,15);camera.updateMatrixWorld(true);
 const parts=options.parts??[box('7',0,2),box('8',1,2)],selected={index:0},errors=[],modes=[],previews=[],commits=[],fins=[],frames=new Map();let fid=0;
 const settings={container,scene,camera,renderer:{domElement:canvas},orbitControls:orbit,eventTarget:events,controlsFactory:()=>controls,getCurrentPart:()=>parts[selected.index],
  onSelect:({index})=>{selected.index=index;},onCommit:async payload=>{commits.push(payload);const p=parts[selected.index],m=new THREE.Matrix4().fromArray(payload.localTransform),v=p.vertices.slice(),point=new THREE.Vector3();for(let i=0;i<v.length;i+=3){point.fromArray(v,i).applyMatrix4(m).toArray(v,i);}parts[selected.index]={...p,vertices:v,revision:'rev-2'};},
  onPreview:p=>previews.push(p),onModeChange:p=>modes.push(p),onError:e=>errors.push(e),onFinPick:p=>fins.push(p),
  requestFrame:fn=>{frames.set(++fid,fn);return fid;},cancelFrame:id=>frames.delete(id),...options};
 const api=createPrintPreparationUI(settings);return{api,parts,selected,errors,modes,previews,commits,fins,controls,orbit,scene,container,canvas,camera,events,doc,frames,flush(){for(const [id,fn]of [...frames]){frames.delete(id);fn();}},buttons(){return Object.fromEntries(container.children[0].children[2].children.map(b=>[b.dataset.action,b]));}};
}
const arr=m=>new THREE.Matrix4().fromArray(m),almost=(a,b,e=1e-10)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`),defer=()=>{let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j;});return{promise,resolve,reject};};
function transformedBounds(h){const m=arr(h.api.getPreviewTransform()),b=new THREE.Box3(),v=new THREE.Vector3();for(let i=0;i<h.parts[h.selected.index].vertices.length;i+=3)b.expandByPoint(v.fromArray(h.parts[h.selected.index].vertices,i).applyMatrix4(m));return b;}

test('opening and navigation never rotate or silently ground stored poses; geometry stays untouched',async()=>{
 const h=harness({parts:[box('7',0,2,8),box('8',1,2,12)]}),before=structuredClone(h.parts);h.api.open();assert.deepEqual(h.api.getPreviewTransform(),new THREE.Matrix4().toArray());assert.equal(h.api.isDirty,false);almost(transformedBounds(h).min.z,8);
 await h.api.navigate(1);assert.deepEqual(h.api.getPreviewTransform(),new THREE.Matrix4().toArray());almost(transformedBounds(h).min.z,12);assert.deepEqual(h.parts,before);assert.equal(h.commits.length,0);h.api.dispose();
});
test('world 90° rotations are preview only, grounded after deliberate rotation, reset is exact',()=>{
 const h=harness();h.api.open();const before=structuredClone(h.parts);h.api.rotate90('x');const b=transformedBounds(h);almost(b.min.z,0);almost(b.max.z,20);assert.equal(h.api.isDirty,true);assert.deepEqual(h.parts,before);assert.throws(()=>h.api.armFins(),{reason:'uncommitted_pose'});h.api.reset();assert.deepEqual(h.api.getPreviewTransform(),new THREE.Matrix4().toArray());assert.equal(h.api.isDirty,false);h.api.dispose();
});
test('explicit apply is the only commit and passes frozen part/version/matrix; sibling unchanged',async()=>{
 const h=harness();h.api.open();const sibling=structuredClone(h.parts[1]);h.api.rotate90('y');await h.api.apply();assert.equal(h.commits.length,1);assert.equal(h.commits[0].id,'7');assert.equal(h.commits[0].revision,'rev-1');assert.ok(Object.isFrozen(h.commits[0].localTransform));assert.deepEqual(h.parts[1],sibling);assert.equal(h.api.isDirty,false);assert.equal(h.api.isBusy,false);h.api.dispose();
});
test('indexed face hover/click derives winding normal and requires explicit arm',()=>{
 const h=harness();h.api.open();assert.throws(()=>h.api.layFace(0),{reason:'face_not_armed'});const p=h.parts[0],face=printPreparationFace(p.vertices,p.triangles,0);assert.ok(face.normal.x>.99);h.api.armFace();h.api.layFace(0);const normal=face.normal.transformDirection(arr(h.api.getPreviewTransform()));almost(normal.z,-1);almost(transformedBounds(h).min.z,0);assert.equal(h.api.mode,'rotate');assert.equal(h.commits.length,0);h.api.dispose();
});
test('real ray pick/highlight uses indexed triangle corners; unarmed click leaves pose unchanged',()=>{
 const h=harness();h.api.open();const event={clientX:300,clientY:300,pointerId:1,button:0},hit=h.api.pick(event);assert.ok(hit);h.canvas.fire('pointerdown',event);h.canvas.fire('pointerup',event);assert.equal(h.api.isDirty,false);
 h.api.armFace();h.canvas.fire('pointermove',event);const highlight=h.api.getPreviewMesh().children[0],face=printPreparationFace(h.parts[0].vertices,h.parts[0].triangles,hit.faceIndex);assert.equal(highlight.visible,true);assert.deepEqual([...highlight.geometry.attributes.position.array],face.points.flatMap(p=>p.toArray()));h.api.dispose();
});
test('dragging disables Orbit temporarily, frames coalesce and Esc restores only current drag',()=>{
 const h=harness();h.api.open();h.api.rotate90('z');const before=h.api.getPreviewTransform();h.controls.begin();assert.equal(h.orbit.enabled,false);h.controls.turn(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),.2));h.controls.turn(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),.2));assert.equal(h.frames.size,1);h.events.fire('keydown',{key:'Escape'});assert.equal(h.orbit.enabled,true);assert.deepEqual(h.api.getPreviewTransform(),before);assert.equal(h.frames.size,0);assert.equal(h.commits.length,0);h.api.dispose();
});
test('drag end grounds once, preserves initially disabled orbit; Shift snap restores after blur',()=>{
 const h=harness();h.api.open();h.orbit.enabled=false;h.events.fire('keydown',{key:'Shift'});assert.equal(h.controls.snap,null);h.controls.begin();h.controls.turn(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),.6));h.controls.pointerUp();assert.equal(h.orbit.enabled,false);almost(transformedBounds(h).min.z,0);h.events.fire('blur');almost(h.controls.snap,Math.PI/36);h.api.dispose();
});
test('stale part/version rejects preview and commit; no ignored commit promise/unsafe navigation',async()=>{
 const h=harness();h.api.open();h.api.rotate90('x');h.parts[0]={...h.parts[0],revision:'changed'};await assert.rejects(h.api.apply(),{reason:'stale'});assert.equal(h.commits.length,0);assert.equal(h.controls.enabled,false);h.api.close();h.api.open();assert.equal(h.controls.enabled,true);h.api.dispose();
});
test('in-place geometry replacement without revision still fails closed via captured references',()=>{
 const h=harness();h.api.open();h.parts[0].vertices=h.parts[0].vertices.slice();assert.throws(()=>h.api.rotate90('x'),{reason:'stale'});h.api.dispose();
});
test('pending commit locks closing/navigation/disposal; failure retains draft and can be retried',async()=>{
 const d=defer(),h=harness({onCommit:()=>d.promise});h.api.open();h.api.rotate90('x');const pending=h.api.apply();assert.equal(h.api.isBusy,true);assert.equal(h.api.cancel(),false);assert.throws(()=>h.api.close(),{reason:'busy'});assert.throws(()=>h.api.dispose(),{reason:'busy'});await assert.rejects(h.api.navigate(1),{reason:'busy'});d.reject(new Error('test validation failed'));await assert.rejects(pending,/validation failed/);assert.equal(h.api.isDirty,true);assert.equal(h.api.isBusy,false);h.api.dispose();
});
test('fin mode hides gizmo and sends committed print-coordinate points only; drag and right-click cancel',async()=>{
 const h=harness();h.api.open();h.api.armFins();assert.equal(h.controls.enabled,false);const e={clientX:300,clientY:300,button:0,pointerId:5};h.canvas.fire('pointerdown',e);h.canvas.fire('pointerup',{...e,clientX:310});assert.equal(h.fins.length,0);
 h.canvas.fire('pointerdown',e);h.canvas.fire('pointerup',e);await Promise.resolve();assert.equal(h.fins.length,1);assert.deepEqual(h.fins[0].point,[0,0,30]);h.fins[0].normal.forEach((x,i)=>almost(x,[0,0,1][i]));assert.equal(h.fins[0].tool,'draw');assert.equal(h.fins[0].revision,'rev-1');h.canvas.fire('contextmenu');assert.equal(h.api.mode,'rotate');h.api.dispose();
});
test('dirty pose blocks both navigation directions and user close without losing the preview',async()=>{
 const h=harness({parts:[box('7',0,3),box('8',1,3),box('9',2,3)]});h.api.open();await h.api.navigate(1);
 const before=structuredClone(h.parts);h.api.rotate90('x');const preview=h.api.getPreviewTransform();
 for(const key of ['previous','next','close']){assert.equal(h.buttons()[key].disabled,true);assert.match(h.buttons()[key].title,/übernehmen oder Vorschau verwerfen/);}
 assert.match(h.container.children[0].children[3].textContent,/übernehmen oder Vorschau verwerfen/);
 await assert.rejects(h.api.navigate(-1),{reason:'uncommitted_pose'});await assert.rejects(h.api.navigate(1),{reason:'uncommitted_pose'});
 // A programmatic click must pass the same guard even if global button state
 // was reset before syncControls restored its disabled state.
 h.buttons().close.disabled=false;h.buttons().close.fire('click');assert.equal(h.errors.at(-1).reason,'uncommitted_pose');h.api.syncControls();assert.equal(h.buttons().close.disabled,true);
 assert.equal(h.selected.index,1);assert.equal(h.api.isOpen,true);assert.equal(h.api.isDirty,true);assert.deepEqual(h.api.getPreviewTransform(),preview);assert.deepEqual(h.parts,before);assert.equal(h.commits.length,0);h.api.dispose();
});
test('explicit discard or apply enables part navigation and user close again',async()=>{
 const h=harness();h.api.open();const before=structuredClone(h.parts);h.api.rotate90('x');h.buttons().discard.fire('click');
 assert.equal(h.api.isDirty,false);assert.equal(h.buttons().next.disabled,false);assert.equal(h.buttons().close.disabled,false);assert.deepEqual(h.parts,before);assert.equal(h.commits.length,0);
 await h.api.navigate(1);assert.equal(h.selected.index,1);h.api.rotate90('y');await h.api.apply();assert.equal(h.commits.length,1);assert.equal(h.api.isDirty,false);assert.equal(h.buttons().previous.disabled,false);assert.equal(h.buttons().close.disabled,false);
 await h.api.navigate(-1);assert.equal(h.selected.index,0);h.buttons().close.fire('click');assert.equal(h.api.isOpen,false);h.api.dispose();
});
test('host invalidation and disposal still clean up dirty previews without committing geometry',()=>{
 const h=harness();h.api.open();const before=structuredClone(h.parts);h.api.rotate90('x');h.api.close();assert.equal(h.api.isOpen,false);assert.deepEqual(h.parts,before);assert.equal(h.commits.length,0);
 h.api.open();h.api.rotate90('y');h.controls.begin();h.controls.turn(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),.2));assert.equal(h.orbit.enabled,false);
 h.api.dispose();assert.equal(h.orbit.enabled,true);assert.equal(h.controls.disposed,true);assert.equal(h.scene.children.length,0);assert.equal(h.container.children.length,0);assert.equal(h.frames.size,0);assert.deepEqual(h.parts,before);assert.equal(h.commits.length,0);
});
test('Ctrl-Z delegates host Undo only outside editable inputs; camera replacement updates rings',async()=>{
 let count=0;const h=harness({onUndo:()=>{count++;}});h.api.open();h.events.fire('keydown',{key:'z',ctrlKey:true,target:h.doc.createElement('input')});assert.equal(count,0);h.events.fire('keydown',{key:'z',ctrlKey:true});await Promise.resolve();assert.equal(count,1);const camera=new THREE.OrthographicCamera();h.api.setCamera(camera);assert.equal(h.controls.camera,camera);h.api.dispose();assert.ok(h.controls.disposed);assert.equal(h.scene.children.length,0);assert.equal(h.container.children.length,0);
});
test('malformed indexed mesh and zero-area triangle never become a face direction',()=>{
 const p=box('1',0,1);p.triangles[0]=1_000_000;const h=harness({parts:[p]});assert.throws(()=>h.api.open(),{reason:'invalid_mesh'});h.api.dispose();assert.equal(printPreparationFace([0,0,0,1,0,0,2,0,0],[0,1,2],0),null);
});
test('fin anchor ghost follows hovered print points and clears on cancellation; caller status survives',async()=>{
 let h;h=harness({onFinPick:p=>{h.api.setFinAnchor(p.point);h.api.setStatus('Zweiten Punkt wählen.');}});h.api.open();h.api.armFins();const e={clientX:300,clientY:300,button:0,pointerId:1};h.canvas.fire('pointerdown',e);h.canvas.fire('pointerup',e);await Promise.resolve();assert.match(h.container.children[0].children[4].textContent,/Zweiten Punkt/);const ghost=h.api.getPreviewMesh().getObjectByName('manual-fin-draft');assert.equal(ghost.visible,true);h.canvas.fire('pointermove',{...e,clientX:310});assert.equal(ghost.visible,true);const p=ghost.geometry.attributes.position.array;assert.notEqual(p[0],p[3]);h.api.cancel();assert.equal(ghost.visible,false);h.api.dispose();
});
test('explicit backend limitation is visible and rejects fin arming without affecting manual pose',()=>{
 const p=box('7',0,1);p.finDisabledReason='Für exakte Teile sind manuelle Finnen noch nicht verfügbar.';const h=harness({parts:[p]});h.api.open();assert.equal(h.buttons().fins.disabled,true);assert.throws(()=>h.api.armFins(),{reason:'fins_unavailable'});assert.match(h.container.children[0].children[5].textContent,/exakte Teile/);h.api.rotate90('x');assert.equal(h.api.isDirty,true);h.api.dispose();
});
test('syncControls restores guards after global busy reset without discarding fin anchor or mesh',()=>{
 const h=harness();h.api.open();h.api.armFins();h.api.setFinAnchor([0,0,30]);const mesh=h.api.getPreviewMesh(),ghost=mesh.getObjectByName('manual-fin-draft'),matrix=h.api.getPreviewTransform();
 for(const button of Object.values(h.buttons()))button.disabled=false;
 h.api.syncControls();assert.equal(h.buttons().apply.disabled,true);assert.equal(h.buttons().previous.disabled,true);assert.equal(h.api.mode,'fins');assert.equal(h.controls.enabled,false);assert.equal(h.api.getPreviewMesh(),mesh);assert.equal(ghost.visible,true);assert.deepEqual([...ghost.geometry.attributes.position.array],[0,0,30,0,0,30]);assert.deepEqual(h.api.getPreviewTransform(),matrix);
 h.api.cancel();h.api.rotate90('x');for(const button of Object.values(h.buttons()))button.disabled=false;h.api.syncControls();assert.equal(h.buttons().fins.disabled,true);assert.equal(h.buttons()['fin-tool'].disabled,true);assert.equal(h.api.isDirty,true);assert.equal(h.api.getPreviewMesh(),mesh);h.api.dispose();
});
test('external list receives settled notification after commit and fin callback, not only while busy',async()=>{
 const events=[],h=harness({onPreview:event=>events.push({kind:'preview',busy:event.busy}),onFinPick:async()=>{}});h.api.open();h.api.rotate90('x');await h.api.apply();assert.deepEqual(events.at(-1),{kind:'preview',busy:false});assert.ok(events.some(e=>e.busy));
 events.length=0;h.api.armFins();const e={clientX:300,clientY:300,button:0,pointerId:1};h.canvas.fire('pointerdown',e);h.canvas.fire('pointerup',e);await Promise.resolve();assert.deepEqual(events.at(-1),{kind:'preview',busy:false});assert.equal(h.api.isBusy,false);h.api.dispose();
});

test('face and fin clicks do not swallow pointerup needed by OrbitControls',async()=>{
 const h=harness();h.api.open();const e={clientX:300,clientY:300,button:0,pointerId:1};
 h.api.armFace();h.canvas.fire('pointerdown',e);assert.notEqual(h.canvas.fire('pointerup',e).stopped,true);h.api.reset();
 h.api.armFins();h.canvas.fire('pointerdown',e);assert.notEqual(h.canvas.fire('pointerup',e).stopped,true);await Promise.resolve();assert.equal(h.fins.length,1);h.api.dispose();
});
const previewResponse=(token,extra={})=>({...token,vertices:[0,0,0,4,0,0,4,0,20,0,0,20],triangles:[0,1,2,0,2,3],...extra});
test('live fin mesh uses bounded detached display arrays and never changes the model',()=>{
 const events=[],h=harness({onFinHover:p=>events.push(p)});h.api.open();h.api.armFins();const original=structuredClone(h.parts);h.api.setFinAnchor([0,0,30]);h.canvas.fire('pointermove',{clientX:310,clientY:300});const request=events.at(-1);assert.ok(Object.isFrozen(request));assert.ok(Object.isFrozen(request.anchor));assert.equal(request.tool,'draw');assert.deepEqual(request.anchor,[0,0,30]);
 const response=previewResponse(request);assert.equal(h.api.setFinPreview(response),true);const mesh=h.api.getPreviewMesh().getObjectByName('manual-fin-preview');assert.equal(mesh.visible,true);assert.equal(mesh.geometry.index.count,6);response.vertices[0]=99;assert.equal(mesh.geometry.attributes.position.array[0],0);assert.deepEqual(h.parts,original);assert.equal(h.commits.length,0);h.api.dispose();
});
test('live hover accepts increasing in-flight responses but rejects out-of-order, old anchor and outside hits',()=>{
 const requests=[],h=harness({onFinHover:p=>requests.push(p)});h.api.open();h.api.armFins();h.api.setFinAnchor([0,0,30]);h.canvas.fire('pointermove',{clientX:310,clientY:300});const first=requests.at(-1);h.canvas.fire('pointermove',{clientX:320,clientY:300});const second=requests.at(-1);
 assert.equal(h.api.setFinPreview(previewResponse(first)),true);assert.equal(h.api.setFinPreview(previewResponse(second)),true);assert.equal(h.api.setFinPreview(previewResponse(first)),false);assert.equal(h.api.setFinPreview(previewResponse({...second,sequence:second.sequence+20})),false);
 h.api.setFinAnchor([1,0,30]);assert.equal(requests.at(-1),null);assert.equal(h.api.setFinPreview(previewResponse(second)),false);h.canvas.fire('pointermove',{clientX:310,clientY:300});const fresh=requests.at(-1);assert.equal(h.api.setFinPreview(previewResponse(fresh)),true);
 h.canvas.fire('pointermove',{clientX:-100,clientY:-100});assert.equal(requests.at(-1),null);assert.equal(h.api.getPreviewMesh().getObjectByName('manual-fin-preview').visible,false);assert.equal(h.api.setFinPreview(previewResponse(fresh)),false);h.api.dispose();
});
test('live preview rejects malformed/oversized indices and nonfinite coordinates without replacing good geometry',()=>{
 let request;const h=harness({onFinHover:p=>{request=p;}});h.api.open();h.api.armFins();h.api.setFinAnchor([0,0,30]);h.canvas.fire('pointermove',{clientX:310,clientY:300});
 for(const extra of [{vertices:[0,0,NaN]},{vertices:new Float32Array(1800003)},{triangles:[0,1,99]},{triangles:[0,1,2.1]},{vertices:[1e300,0,0,0,0,0,0,1,0]}])assert.throws(()=>h.api.setFinPreview(previewResponse(request,extra)),{reason:'invalid_fin_preview'});
 assert.equal(h.api.getPreviewMesh().getObjectByName('manual-fin-preview').visible,false);assert.equal(h.api.setFinPreview(previewResponse(request)),true);h.api.cancel();assert.equal(h.api.getPreviewMesh().getObjectByName('manual-fin-preview').visible,false);assert.equal(h.api.setFinPreview(previewResponse(request)),false);h.api.dispose();
});
test('current worker rejection clears only its ghost, keeps hover generation and later valid responses; stale errors are ignored',()=>{
 const requests=[],h=harness({onFinHover:p=>requests.push(p)});h.api.open();h.api.armFins();h.api.setFinAnchor([0,0,30]);h.canvas.fire('pointermove',{clientX:310,clientY:300});const first=requests.at(-1);assert.equal(h.api.setFinPreview(previewResponse(first)),true);
 h.canvas.fire('pointermove',{clientX:320,clientY:300});const second=requests.at(-1);assert.equal(h.api.setFinPreview({...second,valid:false,message:'Linie zu kurz.'}),true);assert.equal(h.api.getPreviewMesh().getObjectByName('manual-fin-preview').visible,false);assert.match(h.container.children[0].children[4].textContent,/Linie zu kurz/);assert.equal(requests.at(-1),second);
 h.canvas.fire('pointermove',{clientX:310,clientY:300});const third=requests.at(-1);assert.equal(third.generation,second.generation);assert.equal(h.api.setFinPreview(previewResponse(third)),true);assert.equal(h.api.setFinPreview({...second,valid:false,message:'Alte Meldung'}),false);assert.equal(h.api.getPreviewMesh().getObjectByName('manual-fin-preview').visible,true);h.api.dispose();
});
test('sway hover needs no anchor and clears on leave, click, stale geometry and navigation',async()=>{
 const requests=[],h=harness({onFinHover:p=>requests.push(p)});h.api.open();h.buttons()['fin-tool'].value='sway';h.buttons()['fin-tool'].fire('change');h.api.armFins();h.canvas.fire('pointermove',{clientX:310,clientY:300});const first=requests.at(-1);assert.equal(first.anchor,null);assert.equal(first.tool,'sway');assert.equal(h.api.setFinPreview(previewResponse(first)),true);
 h.canvas.fire('pointerleave');assert.equal(requests.at(-1),null);assert.equal(h.api.setFinPreview(previewResponse(first)),false);h.canvas.fire('pointermove',{clientX:310,clientY:300});const second=requests.at(-1);h.parts[0]={...h.parts[0],revision:'different'};assert.equal(h.api.setFinPreview(previewResponse(second)),false);h.api.close();h.api.open();h.api.armFins();h.canvas.fire('pointermove',{clientX:310,clientY:300});const third=requests.at(-1);await h.api.navigate(1);assert.equal(h.api.setFinPreview(previewResponse(third)),false);h.api.dispose();
});

test('native stage upgrades identical hover, rejects late coarse, and new motion immediately removes contact approval',()=>{
 const requests=[],h=harness({onFinHover:p=>requests.push(p)});h.api.open();h.api.armFins();h.api.setFinAnchor([0,0,30]);h.canvas.fire('pointermove',{clientX:310,clientY:300});const first=requests.at(-1),mesh=h.api.getPreviewMesh().getObjectByName('manual-fin-preview');
 assert.equal(h.api.setFinPreview(previewResponse(first,{previewStage:0,valid:false,contactChecked:false})),true);assert.equal(mesh.material.color.getHex(),0xe9ad62);assert.equal(mesh.userData.contactChecked,false);
 assert.equal(h.api.setFinPreview(previewResponse(first,{previewStage:1,valid:true,contactChecked:true})),true);assert.equal(mesh.material.color.getHex(),0x65e3c5);assert.equal(mesh.userData.contactChecked,true);assert.equal(h.api.setFinPreview(previewResponse(first,{previewStage:0,valid:false})),false);
 h.canvas.fire('pointermove',{clientX:320,clientY:300});assert.equal(mesh.userData.contactChecked,false);assert.equal(mesh.material.color.getHex(),0xe9ad62);const second=requests.at(-1);assert.equal(h.api.setFinPreview(previewResponse(second,{previewStage:0,valid:false})),true);assert.equal(h.api.setFinPreview(previewResponse(first,{previewStage:1,valid:true,contactChecked:true})),false);assert.equal(h.api.setFinPreview({...second,previewStage:1,valid:false,message:'Kein sicherer Kontakt'}),true);assert.equal(mesh.visible,false);h.api.dispose();
});
