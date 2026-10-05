import * as THREE from 'three';
import {createPrintPreparationUI} from './print-preparation-ui.mjs';
import {capturePrintPreparationState,requirePrintPreparationState} from './print-preparation-state.mjs';
import {createFinPreviewClient} from './fin-preview-client.mjs';
import {stabilityOverlay} from './stability-overlay.mjs';
import {usableBed} from './engine.mjs';

/** App integration: the controller owns display previews, the worker owns parts. */
export function createPrintPreparationApp({container,scene,camera,renderer,controls,models,overlays,
 getState,selectPart,commitPart,request,run,undo,frame,status,finOptions,onOpenChange,getDisplayColor=p=>p.color,onStateChange}){
 let revision=0,anchor=null,lastMode=null,selectedFin=null,framedPart=null,observedState=null,ui,finPreview;
 const supportGroup=new THREE.Group();supportGroup.name='manual-preparation-fins';scene.add(supportGroup);
 const stabilityGroup=new THREE.Group();stabilityGroup.name='manual-preparation-stability';stabilityGroup.visible=false;scene.add(stabilityGroup);
 let displayedStability=null;
 function clearStability(){for(const helper of [...stabilityGroup.children]){stabilityGroup.remove(helper);helper.traverse(o=>{o.geometry?.dispose();if(Array.isArray(o.material))o.material.forEach(m=>m.dispose());else o.material?.dispose();});}displayedStability=null;}
 function updateStability(){
  const s=getState(),stability=s.parts[s.active]?.printStability;
  // Stored gravity evidence belongs to the committed print frame. Never move
  // its old support polygon along with a not-yet-evaluated rotation preview.
  stabilityGroup.visible=!!(ui?.isOpen&&!ui.isDirty&&s.showStability);
  if(!ui?.isOpen){clearStability();return;}
  if(stability!==displayedStability){clearStability();displayedStability=stability;const helper=stabilityOverlay(stability);if(helper)stabilityGroup.add(helper);}
 }
 const list=document.createElement('div');list.className='preparation-fins';container.append(list);
 function clearSupports(){for(const mesh of [...supportGroup.children]){supportGroup.remove(mesh);mesh.geometry.dispose();mesh.material.dispose();}}
 function current(){const s=getState(),p=s.parts[s.active];return p?{...p,color:getDisplayColor(p,s.active),index:s.active,count:s.parts.length,revision,
  finDisabledReason:p.exactGeometry!==undefined?'Manuelle Finnen sind für exakte Schnittkörper noch nicht verfügbar. Die genaue Modellgeometrie bleibt erhalten.':undefined}:null;}
 function observeState(s){
  const part=s.parts[s.active],state={parts:s.parts,active:s.active,part,vertices:part?.vertices,triangles:part?.triangles,assemblyMatrix:part?.assemblyMatrix,supports:part?.supports,nativeGeometry:part?.nativeGeometry,exactGeometry:part?.exactGeometry,connectorBaseParts:s.connectorBaseParts,base:s.connectorBaseParts?.[s.active],connectorPlan:s.connectorPlan,permissionSources:s.permissionSources,printer:JSON.stringify(s.printer),preview:!!s.preview};
  const changed=!observedState||Object.keys(state).some(key=>!Object.is(state[key],observedState[key]));observedState=state;return changed;
 }
 function assertToken(token){const p=current();if(!p||p.id!==token.id||p.revision!==token.revision)throw Error('Teil oder Projekt wurde geändert. Bitte erneut auswählen.');return getState().parts[getState().active];}
 function clearAnchor(){anchor=null;ui?.setFinAnchor(null);finPreview?.clear();}
 function setMessage(message){status(message);ui?.setStatus(message);}
 function frameChangedGeometry(){const p=getState().parts[getState().active];if(ui?.isOpen&&!ui.isDirty&&p&&(!framedPart||framedPart.id!==p.id||framedPart.vertices!==p.vertices||framedPart.triangles!==p.triangles)){framedPart={id:p.id,vertices:p.vertices,triangles:p.triangles};frame();}}
 function drawSupports(){
  clearSupports();list.replaceChildren();list.hidden=!ui?.isOpen;
  const p=getState().parts[getState().active],support=p?.supports;
  if(!ui?.isOpen||!support?.fins?.length)return;
  const heading=document.createElement('p');heading.textContent=`${support.count} manuelle Finnen`;list.append(heading);
  for(const fin of support.fins){
   const row=document.createElement('div');row.className='double';
   const choose=document.createElement('button');choose.textContent=`Finne ${fin.id}`;choose.setAttribute('aria-pressed',String(selectedFin===fin.id));
   choose.onclick=()=>{selectedFin=fin.id;drawSupports();};
   const remove=document.createElement('button');remove.textContent='Entfernen';remove.setAttribute('aria-label',`Finne ${fin.id} entfernen`);
   remove.onclick=()=>removeFin(fin.id);row.append(choose,remove);list.append(row);
  }
  if(!support.enabled||ui.isDirty)return;
  // Each selectable fin uses only its validated triangle range; these are display copies.
  const positions=new THREE.Float32BufferAttribute(support.vertices,3);
  for(const fin of support.fins){
   const g=new THREE.BufferGeometry();g.setAttribute('position',positions);g.setIndex(new THREE.BufferAttribute(new Uint32Array(support.triangles.slice(fin.triangleStart*3,(fin.triangleStart+fin.triangleCount)*3)),1));g.computeVertexNormals();
   const m=new THREE.Mesh(g,new THREE.MeshStandardMaterial({color:selectedFin===fin.id?0xffcf43:0xf2ab67,roughness:.8}));m.userData.finId=fin.id;supportGroup.add(m);
  }
 }
 async function removeFin(id){
  if(getState().busy||ui.isBusy||ui.isDirty)return;
  try{await run(async()=>{
   const token=current(),part=assertToken(token),snapshot=capturePrintPreparationState(getState()),index=snapshot.active;
   const supports=await request('removeManualFin',{data:part,supports:part.supports,finId:id,...getState().printer});
   assertToken(token);requirePrintPreparationState(snapshot,getState());commitPart(index,{...part,supports,supportNotice:supports?.warnings?.join(' ')||undefined});selectedFin=null;
   setMessage('Manuelle Finne entfernt.');
  },'Finne entfernen …');}catch(e){status(e.message,true);}
 }
 let pointerStart=null;
 renderer.domElement.addEventListener('pointerdown',e=>{if(e.button===0)pointerStart=[e.clientX,e.clientY];},true);
 renderer.domElement.addEventListener('pointerup',e=>{
  if(e.button!==0||!ui?.isOpen||ui.mode!=='rotate'||ui.isDirty||ui.isBusy||getState().busy||!pointerStart||Math.hypot(e.clientX-pointerStart[0],e.clientY-pointerStart[1])>4)return;
  pointerStart=null;const rect=renderer.domElement.getBoundingClientRect(),ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1),camera);
  const targets=[...supportGroup.children,ui.getPreviewMesh()].filter(Boolean),hit=ray.intersectObjects(targets,false)[0];
  if(hit?.object.userData.finId){selectedFin=hit.object.userData.finId;drawSupports();setMessage(`Finne ${selectedFin} gewählt · Entf entfernt sie.`);}
 },true);
 ui=createPrintPreparationUI({container,scene,camera,renderer,orbitControls:controls,getCurrentPart:current,
  onSelect:async({index})=>{clearAnchor();selectedFin=null;selectPart(index);},
  onCommit:async token=>run(async()=>{
   const part=assertToken(token),s=getState(),snapshot=capturePrintPreparationState(s),index=s.active,base=s.connectorBaseParts?.[index];
   const result=await request('manualPrintPose',{data:part,connectorBasePart:base,localTransform:token.localTransform,...s.printer,permissionSources:s.permissionSources});
   assertToken(token);requirePrintPreparationState(snapshot,getState());commitPart(index,result.part,result.connectorBasePart);clearAnchor();selectedFin=null;
   setMessage(`Drucklage von Teil ${part.id} übernommen.${result.warnings?.length?' '+result.warnings.join(' '):''}`);
  },'Drucklage, Auflage und Bauraum prüfen …'),
  onFinPick:async token=>{
   const part=assertToken(token);if(part.exactGeometry!==undefined)throw Error(current().finDisabledReason);
   if(token.tool==='draw'&&!anchor){anchor={...token,point:[...token.point]};ui.setFinAnchor(anchor.point);setMessage('Startpunkt gesetzt. Zweiten Punkt auf dem Modell wählen.');return;}
   const first=anchor;clearAnchor();
   if(token.tool==='draw'&&(!first||first.id!==token.id||first.revision!==token.revision))throw Error('Startpunkt veraltet. Finne erneut zeichnen.');
   return run(async()=>{
    const snapshot=capturePrintPreparationState(getState()),index=snapshot.active,options=finOptions(),draw=token.tool==='draw';
    const result=await request(draw?'addManualDrawnFin':'addManualFin',{data:part,...getState().printer,options:draw?{a:first.point,b:[...token.point],tines:true,tineDensity:1,layerHeight:options.layerHeight,material:options.material}:{...options,point:[...token.point],normal:[...token.normal]}});
    assertToken(token);requirePrintPreparationState(snapshot,getState());commitPart(index,{...part,supports:result.supports,supportNotice:result.supportNotice});selectedFin=null;
    const message=`Finne an Teil ${part.id} ergänzt. Bettkontakt und Bauraum geprüft.${result.supportNotice?' '+result.supportNotice:''}`;setMessage(message);
   },'Manuelle Finne und Modellkontakt prüfen …');
  },
  onFinHover:token=>{
   if(!token){finPreview?.clear();return;}
   const part=assertToken(token),options=finOptions();
   if(token.tool==='draw'&&!token.anchor){finPreview?.clear();return;}
   const printer=getState().printer;
   finPreview?.request(part,token,token.tool==='draw'?{tool:'draw',a:[...token.anchor],b:[...token.point],tines:true,tineDensity:1,layerHeight:options.layerHeight,material:options.material}:{tool:'sway',...options,point:[...token.point],normal:[...token.normal]},usableBed(printer.bed,printer.margin));
  },
  onUndo:()=>{clearAnchor();selectedFin=null;undo();},
  onPreview:()=>{supportGroup.visible=ui?.isOpen&&!ui.isDirty;updateAppearance();updateControls();frameChangedGeometry();},
  onModeChange:event=>{
   if(event.mode!=='fins'||lastMode?.tool!==event.tool||lastMode?.id!==event.id||!event.open)clearAnchor();lastMode=event;
   models.visible=!event.open;overlays.visible=!event.open;supportGroup.visible=event.open&&!ui?.isDirty;
   document.body.classList.toggle('manual-preparing',event.open);onOpenChange?.(event.open);updateAppearance();drawSupports();updateControls();
   if(event.open)frameChangedGeometry();
  },
  onError:error=>status(error.message,true)
 });
 finPreview=createFinPreviewClient({onResult:result=>ui.setFinPreview(result),onClear:()=>ui.setFinPreview(null)});
 function updateControls(){
  const s=getState(),opened=ui?.isOpen;
  document.body.classList.toggle('print-pose-draft',!!(opened&&ui.isDirty));
  const launch=document.getElementById('printPreparation');if(launch)launch.disabled=s.busy||!s.parts.length||s.preview;
  for(const id of ['export','saveProject','guide','guideHtml']){const b=document.getElementById(id);if(b)b.disabled=s.busy||!s.parts.length||s.preview||!!(opened&&ui.isDirty);}
  for(const b of list.querySelectorAll('button'))b.disabled=s.busy||ui.isBusy||ui.isDirty;
  ui?.syncControls();onStateChange?.();
 }
 function updateAppearance(){const p=current(),mesh=ui?.getPreviewMesh();if(p&&mesh){mesh.material.color.set(p.color);mesh.material.wireframe=!!getState().wire;}updateStability();}
 function refresh(){
  const s=getState();
  // Redrawing wireframes, overlays or colors must not discard a local pose or
  // the first fin click. Real project/part replacements still invalidate it.
  if(observeState(s)){revision++;clearAnchor();if(ui.isOpen&&!ui.isBusy){if(!s.parts.length||s.preview)ui.close();else ui.refresh();}}
  updateAppearance();drawSupports();updateControls();
 }
 function open(){const s=getState();if(s.busy||s.preview||!s.parts.length)throw Error('Zuerst ein geschlossenes Druckteil wählen.');if(observeState(s))revision++;clearAnchor();ui.open();updateAppearance();frame();drawSupports();updateControls();}
 function close(){clearAnchor();ui.close();updateControls();}
 window.addEventListener('keydown',event=>{if(!ui.isOpen||event.target?.closest?.('input,select,textarea,[contenteditable]'))return;if(['Delete','Backspace'].includes(event.key)&&selectedFin){event.preventDefault();removeFin(selectedFin);}});
 return {open,close,refresh,updateControls,updateAppearance,invalidateFinPreview:()=>finPreview.clear(),setCamera:next=>{camera=next;ui.setCamera(next);},getPreviewMesh:()=>ui.getPreviewMesh(),get isOpen(){return ui.isOpen;},get isDirty(){return ui.isOpen&&ui.isDirty;}};
}
