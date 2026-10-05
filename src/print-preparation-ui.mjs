/**
 * Manual print-pose preview. Display meshes only; the host owns all geometry,
 * assembly transforms, bindings, support rebuilding, validation and Undo.
 * Controls adapted from gittrahan/support-fins, web/ui/pose.js (MIT).
 * Copyright (c) 2026 gittrahan. Full license: ./support-fins-pose-LICENSE.txt.
 */
import * as THREE from 'three';
import {TransformControls} from 'three/addons/controls/TransformControls.js';

const SNAP=Math.PI/36, DOWN=new THREE.Vector3(0,0,-1);
const AXES={x:new THREE.Vector3(1,0,0),y:new THREE.Vector3(0,1,0),z:new THREE.Vector3(0,0,1)};
const identity=()=>new THREE.Matrix4().toArray();
const frozen=a=>Object.freeze(a);
const DRAFT_NOTICE='Drucklage zuerst übernehmen oder Vorschau verwerfen. Danach kannst du das Teil wechseln oder die Druckvorbereitung schließen.';
const typing=e=>!!e.target?.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"])');
function error(reason,message){return Object.assign(new Error(message),{reason});}
function validatePart(p){
 if(!p||!['string','number'].includes(typeof p.id)||!['string','number'].includes(typeof p.revision)||String(p.revision)==='')throw error('invalid_part','Teil und Modellversion fehlen.');
 if(!Number.isInteger(p.index)||!Number.isInteger(p.count)||p.index<0||p.index>=p.count)throw error('invalid_part','Ungültige Teileauswahl.');
 if(!p.vertices?.length||p.vertices.length%3||p.vertices.length>24_000_000||!p.triangles?.length||p.triangles.length%3||p.triangles.length>24_000_000)throw error('invalid_mesh','Ungültige Vorschaugeometrie.');
 const v=Float64Array.from(p.vertices),t=Uint32Array.from(p.triangles);
 for(let i=0;i<v.length;i++)if(!Number.isFinite(v[i])||!Number.isFinite(Math.fround(v[i])))throw error('invalid_mesh','Nicht darstellbare Koordinaten.');
 for(let i=0;i<t.length;i++)if(!Number.isSafeInteger(p.triangles[i])||p.triangles[i]<0||p.triangles[i]>=v.length/3)throw error('invalid_mesh','Ungültiger Dreiecksindex.');
 return {id:p.id,revision:p.revision,index:p.index,count:p.count,vertices:v,triangles:t,color:p.color,finDisabledReason:typeof p.finDisabledReason==='string'?p.finDisabledReason.slice(0,2000):'',
  originalVertices:p.vertices,originalTriangles:p.triangles};
}

/** Uses indexed, winding-derived triangle normals, never a stored STL normal. */
export function printPreparationFace(vertices,triangles,faceIndex){
 if(!Number.isSafeInteger(faceIndex)||faceIndex<0||faceIndex*3+2>=triangles.length)return null;
 const points=[];
 for(let j=0;j<3;j++){const k=triangles[faceIndex*3+j]*3;points.push(new THREE.Vector3(vertices[k],vertices[k+1],vertices[k+2]));}
 const normal=points[1].clone().sub(points[0]).cross(points[2].clone().sub(points[0]));
 if(!Number.isFinite(normal.lengthSq())||normal.lengthSq()===0)return null;
 return {points,normal:normal.normalize()};
}

/**
 * getCurrentPart: {id,revision,index,count,vertices,triangles,color}, local PRINT
 * frame. revision must change on any relevant project change, including Undo.
 * onCommit({id,revision,localTransform}) must recheck the revision atomically.
 * For local transform L, core preserves assembly with Anew=Aold*inverse(L).
 * The callback must settle only after the host has published the updated part.
 * onModeChange disables normal picking/rendering while open. onFinPick receives
 * committed PRINT-frame points and winding normals; it never changes geometry.
 */
export function createPrintPreparationUI({container,scene,camera,renderer,orbitControls,getCurrentPart,onSelect,onCommit,
 onPreview=()=>{},onModeChange=()=>{},onError=()=>{},onFinPick,onFinHover=()=>{},onUndo,
 controlsFactory=(c,el)=>new TransformControls(c,el),eventTarget=globalThis,
 requestFrame=fn=>requestAnimationFrame(fn),cancelFrame=id=>cancelAnimationFrame(id)}={}){
 if(!container?.ownerDocument||!scene?.add||!renderer?.domElement||!orbitControls||typeof getCurrentPart!=='function'||typeof onCommit!=='function')throw error('invalid_options','Druckvorbereitung ist nicht vollständig angeschlossen.');
 const doc=container.ownerDocument,canvas=renderer.domElement,listeners=[],root=doc.createElement('section');
 root.className='print-preparation';root.hidden=true;root.setAttribute('aria-label','Druckvorbereitung');
 const title=doc.createElement('h3'),partLabel=doc.createElement('p'),hint=doc.createElement('p'),status=doc.createElement('p'),bar=doc.createElement('div'),finHint=doc.createElement('p');
 title.textContent='Druckvorbereitung';hint.textContent='Mit den Ringen drehen · 5°-Schritte · Shift für freies Drehen. Änderungen zunächst als Vorschau.';
 status.setAttribute('role','status');status.setAttribute('aria-live','polite');root.append(title,partLabel,bar,hint,status);container.append(root);
 const buttons={};
 function button(key,label,fn){const b=doc.createElement('button');b.type='button';b.dataset.action=key;b.textContent=label;bar.append(b);buttons[key]=b;listen(b,'click',()=>run(fn));return b;}
 button('previous','← Vorheriges Teil',()=>navigate(-1));button('next','Nächstes Teil →',()=>navigate(1));
 for(const axis of ['x','y','z'])button('rotate-'+axis,axis.toUpperCase()+' +90°',()=>rotate90(axis));
 button('reset','Drehung zurücksetzen',reset);button('face','Fläche aufs Bett',()=>armFace(mode!=='face'));
 button('fins','Finnen manuell zeichnen',()=>armFins(mode!=='fins'));
 const finTool=doc.createElement('select');finTool.setAttribute('aria-label','Finnenwerkzeug');finTool.dataset.action='fin-tool';
 for(const [value,label] of [['draw','Finne mit zwei Punkten'],['sway','Seitliche Stützfinne']]){const option=doc.createElement('option');option.value=value;option.textContent=label;finTool.append(option);}finTool.value='draw';bar.append(finTool);
 listen(finTool,'change',()=>run(()=>{mutable();disarm();message('Finnenwerkzeug gewählt. Zum Platzieren den Finnenmodus aktivieren.');modeEvent();update();}));
 button('apply','Drucklage übernehmen',apply);button('discard','Vorschau verwerfen',cancel);button('close','Druckvorbereitung schließen',requestClose);
 finHint.className='print-preparation-fin-hint';finHint.hidden=true;root.append(finHint);
 const preview=new THREE.Group();preview.name='print-preparation-preview';preview.visible=false;scene.add(preview);
 const pivot=new THREE.Group();preview.add(pivot);
 const gizmo=controlsFactory(camera,canvas),helper=gizmo.getHelper?.()??gizmo;
 gizmo.setMode('rotate');gizmo.setSpace?.('world');gizmo.setSize(.85);gizmo.setRotationSnap(SNAP);gizmo.enabled=false;helper.visible=false;scene.add(helper);
 const hoverGeometry=new THREE.BufferGeometry();hoverGeometry.setAttribute('position',new THREE.Float32BufferAttribute(new Float32Array(9),3));
 const hover=new THREE.Mesh(hoverGeometry,new THREE.MeshBasicMaterial({color:0x4da3ff,transparent:true,opacity:.6,side:THREE.DoubleSide,depthTest:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-4,polygonOffsetUnits:-4}));hover.visible=false;hover.renderOrder=2;
 const ghostGeometry=new THREE.BufferGeometry();ghostGeometry.setAttribute('position',new THREE.Float32BufferAttribute(new Float32Array(6),3));
 const ghost=new THREE.Line(ghostGeometry,new THREE.LineBasicMaterial({color:0x65e3c5,depthTest:false}));ghost.name='manual-fin-draft';ghost.visible=false;ghost.renderOrder=3;
 const finPreview=new THREE.Mesh(new THREE.BufferGeometry(),new THREE.MeshBasicMaterial({color:0x65e3c5,transparent:true,opacity:.55,side:THREE.DoubleSide,depthWrite:false}));finPreview.name='manual-fin-preview';finPreview.visible=false;finPreview.renderOrder=2;
 const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2(),center=new THREE.Vector3();
 let current=null,mesh=null,opened=false,disposed=false,busy=false,stale=false,mode='rotate',dragging=false,dragCancelled=false,orbitBeforeDrag=true,dragPose=null,queued=null,pointerStart=null,oldCursor='',finAnchor=null;
 let hoverSequence=0,hoverGeneration=0,displayedSequence=0,displayedStage=-1,hoverActive=false;
 function listen(target,type,fn,opts){target.addEventListener(type,fn,opts);listeners.push(()=>target.removeEventListener(type,fn,opts));}
 function run(fn){try{const result=fn();if(result?.then)result.catch(report);return result;}catch(e){report(e);}}
 function report(e){status.textContent=e.message||'Druckvorbereitung fehlgeschlagen.';onError(e);}
 function message(text){status.textContent=text;}
 function setStatus(text){message(String(text).slice(0,2000));}
 function samePart(){const p=getCurrentPart();return p&&current&&p.id===current.id&&p.revision===current.revision&&p.index===current.index&&p.count===current.count&&p.vertices===current.originalVertices&&p.triangles===current.originalTriangles;}
 function check(){
  if(disposed||!opened||!current)throw error('closed','Druckvorbereitung ist geschlossen.');
  if(stale||!samePart()){stale=true;stopDrag(true);disarm();gizmo.enabled=false;helper.visible=false;update();throw error('stale','Teil oder Projekt geändert. Druckvorbereitung neu öffnen.');}
 }
 function mutable(){check();if(busy)throw error('busy','Bitte die laufende Übernahme abwarten.');}
 function localMatrix(){return new THREE.Matrix4().compose(pivot.position,pivot.quaternion,new THREE.Vector3(1,1,1)).multiply(new THREE.Matrix4().makeTranslation(-center.x,-center.y,-center.z));}
 function dirty(){return !!current&&(!pivot.quaternion.equals(new THREE.Quaternion())||!pivot.position.equals(center));}
 function requireCommittedPose(){if(dirty())throw error('uncommitted_pose',DRAFT_NOTICE);}
 function update(){
  const disabled=!opened||busy||stale,draft=dirty();
  for(const b of Object.values(buttons))b.disabled=disabled||dragging;
  buttons.close.disabled=busy||dragging||draft;buttons.discard.disabled=disabled||(!dirty()&&mode==='rotate'&&!dragging);
  buttons.previous.disabled=disabled||dragging||draft||current?.index===0||!onSelect;buttons.next.disabled=disabled||dragging||draft||current?.index===current?.count-1||!onSelect;
  for(const key of ['previous','next','close'])buttons[key].title=draft?DRAFT_NOTICE:'';
  hint.textContent=draft?DRAFT_NOTICE:'Mit den Ringen drehen · 5°-Schritte · Shift für freies Drehen. Änderungen zunächst als Vorschau.';
  buttons.apply.disabled=disabled||dragging||!dirty();buttons.reset.disabled=disabled||dragging||!dirty();
  buttons.fins.disabled=disabled||dragging||dirty()||typeof onFinPick!=='function'||!!current?.finDisabledReason;
  finHint.textContent=current?.finDisabledReason??'';finHint.hidden=!current?.finDisabledReason;buttons.fins.title=current?.finDisabledReason??'';
  finTool.disabled=disabled||dragging||dirty();
  buttons.face.setAttribute('aria-pressed',String(mode==='face'));buttons.fins.setAttribute('aria-pressed',String(mode==='fins'));
  buttons.face.textContent=mode==='face'?'Fläche anklicken · Esc bricht ab':'Fläche aufs Bett';
  gizmo.enabled=opened&&!busy&&!stale&&mode==='rotate';helper.visible=gizmo.enabled;
  if(current)partLabel.textContent=`Teil ${current.id} · ${current.index+1} von ${current.count}${dirty()?' · unübernommene Vorschau':''}`;
 }
 function notify(){
  if(!opened||!current||stale)return;
  onPreview(frozen({id:current.id,revision:current.revision,localTransform:frozen(localMatrix().toArray()),dirty:dirty(),dragging,busy,mode,displayOnly:true}));update();
 }
 function settled(){busy=false;update();notify();}
 function cancelQueued(){if(queued!==null){cancelFrame(queued);queued=null;}}
 function schedule(){if(queued!==null)return;queued=requestFrame(()=>{queued=null;run(()=>{check();notify();});});}
 function modeEvent(){onModeChange(frozen({open:opened,mode:opened?mode:null,tool:finTool.value,id:current?.id??null,revision:current?.revision??null}));}
 function clearFinPreview(){
  hoverGeneration++;displayedSequence=0;displayedStage=-1;const hadHover=hoverActive;hoverActive=false;finPreview.visible=false;finPreview.userData.contactChecked=false;
  finPreview.geometry.dispose();finPreview.geometry=new THREE.BufferGeometry();
  if(hadHover)onFinHover(null);
 }
 function disarm(){mode='rotate';hover.visible=false;ghost.visible=false;finAnchor=null;clearFinPreview();canvas.style.cursor=oldCursor;pointerStart=null;}
 function replaceMesh(){
  const data=validatePart(getCurrentPart());
  if(mesh){mesh.remove(hover,ghost,finPreview);pivot.remove(mesh);mesh.geometry.dispose();mesh.material.dispose();}
  current=data;
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(data.vertices,3));geometry.setIndex(new THREE.BufferAttribute(data.triangles.slice(),1));geometry.computeVertexNormals();
  const exactBounds=new THREE.Box3();for(let i=0;i<data.vertices.length;i+=3)exactBounds.expandByPoint(new THREE.Vector3(data.vertices[i],data.vertices[i+1],data.vertices[i+2]));exactBounds.getCenter(center);
  mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color:data.color??'#bde780',roughness:.63,metalness:.07,flatShading:true,side:THREE.DoubleSide}));mesh.name='print-preparation-part';mesh.position.copy(center).negate();mesh.add(hover,ghost,finPreview);pivot.add(mesh);
  pivot.position.copy(center);pivot.quaternion.identity();pivot.scale.set(1,1,1);pivot.updateMatrixWorld(true);stale=false;disarm();gizmo.attach(pivot);update();
 }
 function seat(){
  let min=Infinity;const p=new THREE.Vector3();for(let i=0;i<current.vertices.length;i+=3){p.fromArray(current.vertices,i).sub(center).applyQuaternion(pivot.quaternion).add(pivot.position);min=Math.min(min,p.z);}pivot.position.z-=min;
  pivot.updateMatrixWorld(true);
 }
 function stopDrag(restore){
  if(!dragging)return false;
  dragCancelled=true;
  if(restore&&dragPose){pivot.position.copy(dragPose.position);pivot.quaternion.copy(dragPose.quaternion);}
  gizmo.pointerUp?.({button:0});dragging=false;orbitControls.enabled=orbitBeforeDrag;dragPose=null;cancelQueued();return true;
 }
 function open(){
  if(disposed)throw error('disposed','Druckvorbereitung wurde geschlossen.');
  if(opened){refresh();return;}
  oldCursor=canvas.style.cursor??'';replaceMesh();opened=true;root.hidden=false;preview.visible=true;disarm();message('Teil gewählt. Die gespeicherte Drucklage ist unverändert.');update();modeEvent();notify();
 }
 function requestClose(){requireCommittedPose();close();}
 // Host invalidation/disposal may close a no-longer-current preview. User
 // actions must pass requestClose() and explicitly resolve a current draft.
 function close(){
  if(busy)throw error('busy','Bitte die laufende Übernahme abwarten.');
  if(!opened)return;stopDrag(true);cancelQueued();disarm();opened=false;preview.visible=false;root.hidden=true;gizmo.detach();update();modeEvent();
 }
 function refresh(){
  if(!opened)return;
  if(busy)throw error('busy','Bitte die laufende Übernahme abwarten.');
  stopDrag(true);cancelQueued();replaceMesh();message('Gespeicherte Drucklage geladen.');modeEvent();notify();
 }
 function reset(){mutable();stopDrag(true);disarm();pivot.quaternion.identity();pivot.position.copy(center);message('Vorschau auf die gespeicherte Drucklage zurückgesetzt.');modeEvent();notify();}
 function cancel(){
  if(!opened||busy)return false;
  if(stopDrag(true)){message('Drehung abgebrochen.');notify();return true;}
  if(mode!=='rotate'){disarm();message('Flächenauswahl abgebrochen.');modeEvent();update();return true;}
  if(stale){message('Projekt geändert. Bitte neu öffnen.');return false;}
  reset();return true;
 }
 function rotate90(axis){mutable();if(!AXES[axis])throw error('invalid_axis','Ungültige Drehachse.');if(dragging)throw error('dragging','Drehung zuerst beenden.');disarm();pivot.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(AXES[axis],Math.PI/2));seat();message(`${axis.toUpperCase()} +90° · nur Vorschau.`);modeEvent();notify();}
 function armFace(value=true){mutable();if(dragging)throw error('dragging','Drehung zuerst beenden.');disarm();mode=value?'face':'rotate';canvas.style.cursor=value?'crosshair':oldCursor;message(value?'Gewünschte Auflagefläche anklicken. Esc oder Rechtsklick bricht ab.':'Flächenauswahl beendet.');modeEvent();update();}
 function armFins(value=true){mutable();if(dragging||dirty())throw error('uncommitted_pose','Drucklage zuerst übernehmen oder Vorschau verwerfen.');if(value&&current.finDisabledReason)throw error('fins_unavailable',current.finDisabledReason);if(value&&typeof onFinPick!=='function')throw error('fins_unavailable','Manuelle Finnen sind noch nicht angeschlossen.');disarm();mode=value?'fins':'rotate';canvas.style.cursor=value?'crosshair':oldCursor;message(value?'Finne manuell am Teil zeichnen. Esc oder Rechtsklick bricht ab.':'Finnenmodus beendet.');modeEvent();update();}
 function setFinAnchor(point){
  if(point===null){finAnchor=null;ghost.visible=false;clearFinPreview();return;}
  check();if(mode!=='fins'||dirty())throw error('fins_not_armed','Finnenmodus zuerst aktivieren.');
  if(!Array.isArray(point)||point.length!==3||!Array.from(point).every(Number.isFinite))throw error('invalid_point','Ungültiger Finnenpunkt.');
  clearFinPreview();finAnchor=new THREE.Vector3(...point);updateGhost(finAnchor);
 }
 // Only a display response from the current gesture is accepted. During mouse
 // movement a newer completed response may replace the previous one while the
 // worker calculates the newest point. This is never a geometry commit.
 function setFinPreview(result){
  if(result===null){clearFinPreview();return false;}
  const stage=result.previewStage??0;
  if(![0,1].includes(stage)||!opened||disposed||busy||stale||mode!=='fins'||dirty()||!samePart()||!hoverActive||result.id!==current.id||result.revision!==current.revision||result.generation!==hoverGeneration||!Number.isSafeInteger(result.sequence)||result.sequence<displayedSequence||(result.sequence===displayedSequence&&stage<=displayedStage)||result.sequence>hoverSequence)return false;
  const {vertices:v,triangles:t}=result;
  if(result.valid===false&&v===undefined&&t===undefined){
   finPreview.visible=false;finPreview.userData.contactChecked=false;finPreview.geometry.dispose();finPreview.geometry=new THREE.BufferGeometry();displayedSequence=result.sequence;displayedStage=stage;
   message(typeof result.message==='string'?result.message.slice(0,500):'An dieser Stelle konnte keine Finnenvorschau aufgebaut werden.');return true;
  }
  if(!v?.length||v.length%3||v.length>1_800_000||!t?.length||t.length%3||t.length>600_000)throw error('invalid_fin_preview','Ungültige Finnenvorschau.');
  const vertices=new Float32Array(v.length),triangles=new Uint32Array(t.length);
  for(let i=0;i<v.length;i++){if(!Number.isFinite(v[i])||!Number.isFinite(Math.fround(v[i])))throw error('invalid_fin_preview','Ungültige Vorschaukoordinate.');vertices[i]=v[i];}
  for(let i=0;i<t.length;i++){if(!Number.isSafeInteger(t[i])||t[i]<0||t[i]>=v.length/3)throw error('invalid_fin_preview','Ungültiges Vorschaudreieck.');triangles[i]=t[i];}
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(vertices,3));geometry.setIndex(new THREE.BufferAttribute(triangles,1));
  finPreview.geometry.dispose();finPreview.geometry=geometry;finPreview.userData.contactChecked=stage===1&&result.valid===true&&result.contactChecked===true;finPreview.material.color.set(finPreview.userData.contactChecked?0x65e3c5:0xe9ad62);finPreview.visible=true;displayedSequence=result.sequence;displayedStage=stage;
  if(typeof result.message==='string')message(result.message.slice(0,500));
  return true;
 }
 function finHover(hit){
  if(mode!=='fins'||!hit||(finTool.value==='draw'&&!finAnchor)){if(hoverActive)clearFinPreview();return;}
  const face=printPreparationFace(current.vertices,current.triangles,hit.faceIndex);if(!face){clearFinPreview();return;}
  hoverActive=true;
  if(finPreview.visible&&finPreview.userData.contactChecked){finPreview.userData.contactChecked=false;finPreview.material.color.set(0xe9ad62);setStatus('Vorläufige Form – Maus kurz stillhalten für die Prüfung der Kontaktzähne.');}
  onFinHover(frozen({id:current.id,revision:current.revision,tool:finTool.value,anchor:finAnchor?frozen(finAnchor.toArray()):null,point:frozen(mesh.worldToLocal(hit.point.clone()).toArray()),normal:frozen(face.normal.toArray()),faceIndex:hit.faceIndex,sequence:++hoverSequence,generation:hoverGeneration}));
 }
 function updateGhost(end){
  ghost.visible=!!finAnchor&&mode==='fins'&&finTool.value==='draw';if(!ghost.visible)return;
  const p=ghostGeometry.attributes.position;p.setXYZ(0,finAnchor.x,finAnchor.y,finAnchor.z);p.setXYZ(1,end.x,end.y,end.z);p.needsUpdate=true;ghostGeometry.computeBoundingSphere();
 }
 function pick(event){
  if(!opened||!mesh||stale||busy)return null;check();const r=canvas.getBoundingClientRect();if(!(r.width>0&&r.height>0))return null;
  pointer.set((event.clientX-r.left)/r.width*2-1,-(event.clientY-r.top)/r.height*2+1);preview.updateMatrixWorld(true);camera.updateMatrixWorld(true);raycaster.setFromCamera(pointer,camera);
  return raycaster.intersectObject(mesh,false).find(h=>printPreparationFace(current.vertices,current.triangles,h.faceIndex))??null;
 }
 function highlight(hit){
  const face=hit&&printPreparationFace(current.vertices,current.triangles,hit.faceIndex);hover.visible=!!face;
  if(!face)return;const positions=hoverGeometry.attributes.position;for(let j=0;j<3;j++)positions.setXYZ(j,face.points[j].x,face.points[j].y,face.points[j].z);positions.needsUpdate=true;hoverGeometry.computeBoundingSphere();
 }
 function layFace(faceIndex){
  mutable();if(mode!=='face')throw error('face_not_armed','„Fläche aufs Bett“ zuerst aktivieren.');const face=printPreparationFace(current.vertices,current.triangles,faceIndex);if(!face)throw error('invalid_face','Diese Fläche hat keine gültige Normale.');
  const normal=face.normal.applyQuaternion(pivot.quaternion);pivot.quaternion.premultiply(new THREE.Quaternion().setFromUnitVectors(normal,DOWN));seat();disarm();
  const faceHeight=face.points[0].clone().applyMatrix4(localMatrix()).z;
  message(faceHeight>1e-6?'Fläche zeigt nach unten, liegt aber über anderen Teilbereichen. Auflage prüfen.':'Gewählte Fläche nach unten gedreht · Drucklage noch übernehmen.');modeEvent();notify();
 }
 async function finPick(hit){
  mutable();if(mode!=='fins'||dirty())throw error('fins_not_armed','Finnenmodus zuerst bei übernommener Drucklage aktivieren.');
  const face=printPreparationFace(current.vertices,current.triangles,hit.faceIndex);if(!face)return;
  const token={id:current.id,revision:current.revision},priorStatus=status.textContent;clearFinPreview();busy=true;update();
  try{await onFinPick(frozen({...token,tool:finTool.value,point:frozen(mesh.worldToLocal(hit.point.clone()).toArray()),normal:frozen(face.normal.toArray()),faceIndex:hit.faceIndex}));if(getCurrentPart()?.id!==token.id)throw error('stale','Teil während der Finnenplatzierung geändert.');if(!samePart()){replaceMesh();mode='fins';canvas.style.cursor='crosshair';modeEvent();}if(status.textContent===priorStatus)message('Finnenpunkt gewählt.');}
  finally{settled();}
 }
 async function apply(){
  mutable();if(dragging)throw error('dragging','Drehung zuerst beenden.');if(!dirty())return false;
  disarm();cancelQueued();check();const payload=frozen({id:current.id,revision:current.revision,localTransform:frozen(localMatrix().toArray())});busy=true;modeEvent();update();
  try{await onCommit(payload);if(getCurrentPart()?.id!==payload.id)throw error('stale','Teil während der Übernahme geändert.');replaceMesh();message('Drucklage übernommen.');modeEvent();notify();return true;}finally{settled();}
 }
 async function navigate(delta){
  mutable();requireCommittedPose();if(dragging||!onSelect)return false;const next=current.index+delta;if(next<0||next>=current.count)return false;
  cancelQueued();disarm();busy=true;update();
  try{await onSelect(frozen({index:next,id:current.id,revision:current.revision}));replaceMesh();message('Teil in gespeicherter Drucklage gewählt.');modeEvent();notify();return true;}finally{settled();}
 }
 function setCamera(next){if(!next?.isCamera)throw error('invalid_camera','Ungültige Kamera.');camera=next;gizmo.camera=next;}
 async function undo(){mutable();if(!onUndo)return;reset();busy=true;update();try{await onUndo(frozen({id:current.id,revision:current.revision}));replaceMesh();notify();}finally{settled();}}
 function dispose(){if(disposed)return;if(busy)throw error('busy','Bitte die laufende Übernahme abwarten.');close();disposed=true;for(const off of listeners)off();gizmo.dispose();scene.remove(helper,preview);if(mesh){mesh.remove(hover,ghost,finPreview);mesh.geometry.dispose();mesh.material.dispose();}hoverGeometry.dispose();hover.material.dispose();ghostGeometry.dispose();ghost.material.dispose();finPreview.geometry.dispose();finPreview.material.dispose();root.remove();}
 listen(gizmo,'dragging-changed',event=>{
  if(event.value){try{mutable();if(mode!=='rotate')throw error('wrong_mode','Drehringe sind in diesem Modus deaktiviert.');dragging=true;dragCancelled=false;dragPose={position:pivot.position.clone(),quaternion:pivot.quaternion.clone()};orbitBeforeDrag=orbitControls.enabled;orbitControls.enabled=false;update();}catch(e){gizmo.pointerUp?.({button:0});report(e);}}
  else if(dragging){dragging=false;orbitControls.enabled=orbitBeforeDrag;if(!dragCancelled){run(()=>{check();if(!pivot.quaternion.equals(dragPose.quaternion)){seat();message('Drehung als Vorschau · Drucklage noch übernehmen.');}notify();});}dragPose=null;update();}
 });
 listen(gizmo,'objectChange',()=>{if(opened&&!busy&&!stale){if(gizmo.axis&&Number.isFinite(gizmo.rotationAngle))message(`${gizmo.axis} ${(gizmo.rotationAngle*180/Math.PI).toFixed(1)}° · Vorschau`);schedule();}});
 listen(canvas,'pointerdown',event=>{if(!opened||event.button!==0)return;pointerStart={x:event.clientX,y:event.clientY,id:event.pointerId,mode};},true);
 listen(canvas,'pointermove',event=>{if(!opened||busy||mode==='rotate'||stale)return;run(()=>{const hit=pick(event);highlight(hit);if(hit&&finAnchor)updateGhost(mesh.worldToLocal(hit.point.clone()));else ghost.visible=false;finHover(hit);});},true);
 listen(canvas,'pointerup',event=>{
  if(!opened||event.button!==0||mode==='rotate'||busy)return;
  const start=pointerStart;pointerStart=null;if(!start||start.id!==event.pointerId||start.mode!==mode||Math.hypot(event.clientX-start.x,event.clientY-start.y)>4)return;
  // OrbitControls must also receive pointerup and release its captured pointer.
  // The host blocks ordinary model picking while this UI is open.
  run(()=>{const hit=pick(event);if(!hit)return;if(mode==='face')layFace(hit.faceIndex);else return finPick(hit);});
 },true);
 listen(canvas,'pointerleave',()=>{hover.visible=false;ghost.visible=false;if(hoverActive)clearFinPreview();});
 listen(canvas,'contextmenu',event=>{if(!opened)return;event.preventDefault();event.stopImmediatePropagation?.();run(cancel);},true);
 listen(eventTarget,'keydown',event=>{
  if(!opened||typing(event))return;
  if(event.key==='Shift')gizmo.setRotationSnap(null);
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation?.();run(cancel);}
  if((event.ctrlKey||event.metaKey)&&!event.shiftKey&&event.key?.toLowerCase()==='z'&&onUndo){event.preventDefault();event.stopImmediatePropagation?.();run(undo);}
 });
 listen(eventTarget,'keyup',event=>{if(event.key==='Shift')gizmo.setRotationSnap(SNAP);});
 listen(eventTarget,'blur',()=>{gizmo.setRotationSnap(SNAP);if(opened&&!busy)run(()=>{stopDrag(true);disarm();modeEvent();notify();});});
 update();
 return frozen({open,close,refresh,cancel,dispose,setCamera,setStatus,setFinAnchor,setFinPreview,syncControls:update,rotate90,reset,armFace,armFins,layFace,apply,navigate,pick,
  getPreviewMesh:()=>mesh,getPreviewTransform:()=>frozen(current?localMatrix().toArray():identity()),
  get isOpen(){return opened;},get isDirty(){return dirty();},get isBusy(){return busy;},get mode(){return mode;}});
}
