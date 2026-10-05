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
test('actual preview ray returns original high print point, including large translated XY center',async()=>{
 for(const [x,y,height] of [[0,0,80],[512,-300,130]]){
  const p=box('7',0,1),g=new THREE.BoxGeometry(20,30,height);g.translate(x,y,height/2);p.vertices=Float64Array.from(g.attributes.position.array);p.triangles=Uint32Array.from(g.index.array);g.dispose();
  const h=harness({parts:[p]});h.camera.position.set(x,y,height+100);h.camera.lookAt(x,y,height/2);h.camera.updateMatrixWorld(true);h.api.open();h.api.armFins();
  const e={clientX:300,clientY:300,button:0,pointerId:1};h.canvas.fire('pointerdown',e);h.canvas.fire('pointerup',e);await Promise.resolve();
  assert.equal(h.fins.length,1);h.fins[0].point.forEach((v,i)=>assert.ok(Math.abs(v-[x,y,height][i])<1e-9));h.fins[0].normal.forEach((v,i)=>assert.ok(Math.abs(v-[0,0,1][i])<1e-12));assert.equal(h.errors.length,0);h.api.dispose();
 }
});
test('after actual preview commit, ray point is in newly committed grounded frame, not old center frame',async()=>{
 const h=harness();h.api.open();h.api.rotate90('x');await h.api.apply();const p=h.parts[0],zs=Array.from(p.vertices).filter((_,i)=>i%3===2),top=Math.max(...zs);assert.ok(top>1.7);assert.equal(Math.min(...zs),0);
 const box=new THREE.Box3().setFromArray(p.vertices),center=box.getCenter(new THREE.Vector3());h.camera.position.set(center.x,center.y,top+100);h.camera.lookAt(center.x,center.y,center.z);h.camera.updateMatrixWorld(true);h.api.armFins();
 const e={clientX:300,clientY:300,button:0,pointerId:1};h.canvas.fire('pointerdown',e);h.canvas.fire('pointerup',e);await Promise.resolve();assert.equal(h.fins.length,1);assert.ok(Math.abs(h.fins[0].point[2]-top)<1e-9);assert.equal(h.errors.length,0);h.api.dispose();
});
