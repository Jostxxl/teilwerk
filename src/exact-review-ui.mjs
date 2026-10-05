import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {createExactModelClient} from './exact-model-client.mjs';
import {displayPartMatrices} from './display-pose.mjs';
import {stabilityOverlay} from './stability-overlay.mjs';
import {stabilityDescription} from './part-quality.mjs';
import './exact-review.css';

let uncertainService=false;
const retainedClients=new Set();
export const exactReviewServiceLocked=()=>uncertainService;
const number=n=>Number.isFinite(n)?n.toLocaleString('de-DE',{maximumFractionDigits:1}):'–';
const defaultPalette=['#bde780','#6fc7d4','#eab784','#b3a2ed','#e08d97','#e0d37a','#65a9e8','#ed8461','#dc9cda','#d5d9d9'];
function disposeGroup(group){for(const object of [...group.children]){group.remove(object);object.traverse(o=>{o.geometry?.dispose();if(Array.isArray(o.material))o.material.forEach(m=>m.dispose());else o.material?.dispose();});}}
function meshGeometry(data){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(new Float32Array(data.vertices),3));g.setIndex(new THREE.BufferAttribute(new Uint32Array(data.triangles),1));g.computeVertexNormals();return g;}

/** Isolated review of the actual active model. The normal project remains the
 * sole editing/export state. Exact operands/history stay in the owning worker;
 * this dialog receives display derivatives and physical measurements only. */
export async function openExactModelReview({part,usableBed,mode,permissionSources,palette=defaultPalette,getDisplayColor=(p,i)=>palette[i%palette.length]??defaultPalette[i%10],projectToken,getCurrentProjectToken,onAdopt,clientFactory=createExactModelClient}={}){
 if(typeof getDisplayColor!=='function')throw Error('Ungültige Ansichtsfarbfunktion.');
 if(uncertainService)throw Error('Der vorherige Rechenauftrag ist noch nicht sicher beendet. Weitere Berechnungen bleiben gesperrt.');
 const dialog=document.createElement('dialog');dialog.className='exact-review';dialog.setAttribute('aria-labelledby','exactReviewTitle');
 dialog.innerHTML=`<div class="exact-review-header"><div><span class="eyebrow">TEILWERK · SCHNITTPLANUNG</span><h2 id="exactReviewTitle">Präzise Aufteilung prüfen</h2><p data-role="source"></p></div><button type="button" data-role="close" aria-label="Zurück zum Modell">✕</button></div>
 <div class="exact-review-layout"><section class="exact-review-controls"><ol class="exact-review-steps"><li data-step="prepared">1 · Offener Vorschlag</li><li data-step="review">2 · Drucklagen &amp; Schnitte</li><li data-step="improve">3 · Weiter verbessern</li></ol>
 <p class="hint">Zuerst den offenen Vorschlag prüfen. Nach dem Schließen wird für jedes Grobteil die Drucklage gewählt; erst danach folgen verfeinerte Schnitte.</p>
 <div data-role="summary" class="exact-review-summary" aria-live="polite">Offene Vorschau wird vorbereitet …</div>
 <button type="button" data-role="calculate" class="primary wide" disabled>Schnitte berechnen &amp; schließen</button>
 <button type="button" data-role="improve" class="wide" hidden>Weiter verbessern</button>
 <button type="button" data-role="adopt" class="primary wide" hidden>Teile ins Projekt übernehmen</button>
 <p class="hint" data-role="limit" hidden>Ein Durchlauf sucht bis zu fünf Minuten. Bereits geprüfte Schnitte bleiben beim Fortsetzen erhalten.</p>
 <button type="button" data-role="cancel" class="wide" hidden>Berechnung abbrechen</button>
 <p class="hint exact-review-preserved" data-role="adoptInfo">Zurück behält dein Original. Übernommene Teile lassen sich mit Drucklage und Innenauswahl speichern. Anschließend können Nummern graviert und die geprüften Drucknetze exportiert werden.</p>
 <label class="check"><input data-role="mask" type="checkbox"> Gespeicherte Innenauswahl zeigen</label>
 <p class="hint" data-role="maskInfo"></p>
 <div class="sectiontitle"><h3 data-role="partHeading">Vorschaubereiche</h3><b data-role="count">0</b></div><div data-role="parts" class="exact-review-parts"></div>
 <p class="hint">Vorläufige Prüffarben. Die endgültige Farbverteilung und Kennzeichnung folgen bei der Übernahme.</p></section>
 <section class="exact-review-workspace"><div class="exact-review-viewtools"><select data-role="mode" aria-label="Ansicht der Schnittprüfung"><option value="assembly">Montage</option><option value="print" disabled>Drucklage</option></select><select data-role="direction" aria-label="Blickrichtung der Schnittprüfung"><option value="iso">Isometrisch</option><option value="top">Oben</option><option value="bottom">Unten · Innenseite</option><option value="front">Vorne</option><option value="right">Rechts</option></select><button data-role="projection" type="button">Perspektivische Ansicht</button><button data-role="frame" type="button">Zentrieren</button></div>
 <div data-role="viewport" class="exact-review-viewport"><span data-role="badge" class="exact-review-badge">OFFENE VORSCHAU · ORTHOGRAFISCH</span><div data-role="waiting" class="exact-review-waiting"><span class="spinner"></span><span data-role="progress">Modell wird vorbereitet …</span></div></div>
 <div class="exact-review-inspector" data-role="inspector">Noch keine Drucklage berechnet.</div><label class="exact-review-explosion">Explosionsansicht <output data-role="explodeValue">25 %</output><input data-role="explode" type="range" min="0" max="100" value="25"></label>
 </section></div><footer class="exact-review-footer"><span data-role="status" role="status">Die Berechnung bleibt auf diesem Rechner.</span><button data-role="back" type="button">Zurück zum Modell</button></footer>`;
 const localPart=mode==='project-part';
 const el=role=>dialog.querySelector(`[data-role="${role}"]`),mask=part.interiorRegion,sourceAssembly=[...(part.assemblyMatrix??new THREE.Matrix4().elements)];
 el('source').textContent=`${part.name||'Aktives Modell'} · Nutzbarer Druckraum ${usableBed.map(number).join(' × ')} mm`;
 el('mask').disabled=!mask?.triangles?.length;el('maskInfo').textContent=mask?.triangles?.length?`${number(mask.triangles.length/3)} ausgewählte Dreiecke. Anzeige in der zusammengesetzten Montage.`:'Keine Innenfläche gespeichert.';
 if(localPart){dialog.querySelector('#exactReviewTitle').textContent='Teil weiter verbessern';dialog.querySelector('[data-step=prepared]').textContent='1 · Drucklage zuerst';el('calculate').textContent='Drucklage prüfen & Teil verbessern';dialog.querySelector('.exact-review-controls > .hint').textContent='Die vorhandene genaue Geometrie bleibt erhalten. Zuerst werden passende Drucklagen verglichen; nur wenn nötig werden zusätzliche Schnitte geprüft.';el('badge').textContent='GESPEICHERTES EXAKTES TEIL';}
 document.body.append(dialog);dialog.showModal();
 let renderer,controls,observer,client,result=null,parts=[],poses=[],meshes=[],selected=0,stage=null,busy=false,operation=null,closing=false,closed=false,adopted=false,resolveClosed;
 if(part.plannedMark)el('adoptInfo').textContent='Die vorhandene Markierungsstelle bleibt am Original. Ihre Übertragung wird noch angeschlossen; diese Aufteilung kann deshalb vorerst nur geprüft werden.';
 const done=new Promise(resolve=>{resolveClosed=resolve;});
 const scene=new THREE.Scene();scene.background=new THREE.Color(0x202d33);
 let camera=new THREE.OrthographicCamera(-300,300,300,-300,.01,100000);camera.up.set(0,0,1);camera.aspect=1;
 const models=new THREE.Group(),lines=new THREE.Group(),helpers=new THREE.Group(),maskGroup=new THREE.Group(),bed=new THREE.Group();scene.add(models,lines,helpers,maskGroup,bed);
 scene.add(new THREE.HemisphereLight(0xe0f0ff,0x5a6158,2.5));const light=new THREE.DirectionalLight(0xfff7e9,3);light.position.set(300,-400,600);scene.add(light);
 const fill=new THREE.DirectionalLight(0x8fbed6,2);fill.position.set(-400,100,250);scene.add(fill);
 const status=(message,error=false)=>{el('status').textContent=message;el('status').classList.toggle('error',error);};
 function refresh(){
  el('calculate').hidden=stage==='review';el('calculate').disabled=busy||stage!=='prepared'||client?.locked;
  el('improve').hidden=stage!=='review';el('improve').disabled=busy||client?.locked||result?.summary?.unresolvedCount===0;
  el('adopt').hidden=stage!=='review';el('adopt').disabled=busy||client?.locked||typeof onAdopt!=='function'||!!part.plannedMark;
  el('limit').hidden=stage!=='review';el('cancel').hidden=!busy;el('cancel').disabled=closing||client?.locked;
  el('waiting').hidden=!busy;el('mode').querySelector('[value="print"]').disabled=stage!=='review'&&!localPart;
  dialog.querySelectorAll('[data-step]').forEach(item=>item.classList.toggle('active',item.dataset.step===(operation==='improve'?'improve':stage??'prepared')));
  el('back').textContent=busy?'Abbrechen & zurück':'Zurück zum Modell';el('close').disabled=closing||operation==='adopt';el('back').disabled=closing||operation==='adopt';el('cancel').disabled=closing||client?.locked||operation==='adopt';
 }
 function printAvailable(p){return p?.printPoseAvailable===true;}
 function updateView(){
  if(el('mode').value==='print'&&!printAvailable(parts[selected]))el('mode').value='assembly';
  const printing=el('mode').value==='print',amount=printing?0:Number(el('explode').value)/100;
  el('explode').disabled=printing||result?.display?.limited===true;el('explodeValue').textContent=el('explode').value+' %';
  for(let i=0;i<meshes.length;i++){
   const mesh=meshes[i],pose=poses[i];mesh.visible=!printing||i===selected;
   const matrix=printing?new THREE.Matrix4():pose.assemblyMatrix.clone();
   if(!printing){const offset=pose.offset.clone().multiplyScalar(amount);matrix.premultiply(new THREE.Matrix4().makeTranslation(...offset.toArray()));}
   mesh.matrix.copy(matrix);mesh.matrixAutoUpdate=false;mesh.matrixWorldNeedsUpdate=true;
   mesh.material.opacity=printing||i===selected||stage==='prepared'?1:.75;mesh.material.transparent=mesh.material.opacity<1;
  }
  bed.visible=printing;lines.visible=!printing&&amount===0;maskGroup.visible=!printing&&amount===0&&el('mask').checked;
  disposeGroup(helpers);if(printing){const helper=stabilityOverlay(parts[selected]?.printStability);if(helper)helpers.add(helper);}
  const p=parts[selected];el('badge').textContent=`${stage==='review'||localPart?(printing?'DRUCKLAGE · TEIL '+(selected+1):localPart&&stage==='prepared'?'GESPEICHERTES EXAKTES TEIL':'SCHNITTPRÜFUNG'):'OFFENE VORSCHAU'} · ${camera.isOrthographicCamera?'ORTHOGRAFISCH':'PERSPEKTIVE'}`;
  el('inspector').textContent=stage!=='review'&&!localPart?'Offene Oberflächen: noch keine geschlossenen Druckteile oder geprüften Drucklagen.':p?[`Teil ${selected+1}`,printAvailable(p)?stabilityDescription(p.printStability):'Noch keine passende Drucklage gefunden.',p.overhang?`Über 60°: ${number(p.overhang.severeArea)} mm² · über 45°: ${number(p.overhang.supportArea)} mm²`:'',printAvailable(p)?'Kugel: Schwerpunkt · Kreuz: Projektion · Linie: Auflagehülle.':''].filter(Boolean).join(' · '):'';
  el('parts').querySelectorAll('button').forEach((button,i)=>{button.classList.toggle('active',i===selected);button.setAttribute('aria-pressed',String(i===selected));});
  models.updateMatrixWorld(true);
 }
 function frame(){
  const box=new THREE.Box3();for(const m of meshes)if(m.visible)box.union(new THREE.Box3().setFromObject(m));
  if(box.isEmpty())box.setFromCenterAndSize(new THREE.Vector3(),new THREE.Vector3(...usableBed));
  const size=Math.max(1,box.getSize(new THREE.Vector3()).length()),center=box.getCenter(new THREE.Vector3());controls.target.copy(center);
  camera.position.copy(center).add(new THREE.Vector3(1,0,0).multiplyScalar(size*1.8));setDirection();camera.near=Math.max(.01,size/10000);camera.far=Math.max(10000,size*40);
  if(camera.isOrthographicCamera){camera.zoom=1;camera.top=size*.6;camera.bottom=-camera.top;camera.left=-camera.top*camera.aspect;camera.right=-camera.left;}
  camera.updateProjectionMatrix();controls.update();
 }
 function setDirection(){
  const value=el('direction').value,direction={iso:[.8,-1,.8],top:[0,0,1],bottom:[0,0,-1],front:[0,-1,0],right:[1,0,0]}[value],distance=camera.position.distanceTo(controls.target);
  camera.up.set(0,['top','bottom'].includes(value)?1:0,['top','bottom'].includes(value)?0:1);camera.position.copy(controls.target).add(new THREE.Vector3(...direction).normalize().multiplyScalar(distance));camera.lookAt(controls.target);controls.update();
 }
 function summaryText(summary={}){
  if(stage==='prepared'&&localPart)return 'Vorhandenes exaktes Teil. Drucklagen wurden zuerst geprüft; noch keine neuen Schnitte berechnet. Originale Innenfreigabe bleibt erhalten.';
  if(stage==='prepared')return result.display?.limited?'Schnittlinien-Vorschau: Für dieses Modell werden die Oberflächen noch nicht einzeln auseinandergezogen. Das vollständige Modell bleibt sichtbar.':`${parts.length} offene Bereiche. Prüfe den Vorschlag, bevor Schnittflächen geschlossen werden.`;
  const count=key=>Number.isInteger(summary[key])?summary[key]:parts.filter(p=>key==='missingPose'?!printAvailable(p):p.printStability?.classification===key).length;
  return `${parts.length} Teile · ${count('stable')} mit Standreserve · ${count('marginal')} mit geringer Reserve · ${count('unstable')} mit Kippgefahr · ${count('missingPose')} ohne Drucklage. ${summary.exhaustedReason?'Suchbudget erreicht. Weiter verbessern setzt diesen Stand fort.':'Begrenzte Suche abgeschlossen.'}`;
 }
 function show(value){
  result=value;stage=value.stage;parts=value.display?.parts??[];selected=Math.min(selected,Math.max(0,parts.length-1));if(value.display?.limited)el('explode').value='0';
  disposeGroup(models);disposeGroup(lines);disposeGroup(helpers);meshes=[];
  poses=displayPartMatrices(parts,{mode:'assembly',explode:1});
  const displayColors=parts.map((p,i)=>getDisplayColor(p,i));
  for(let i=0;i<parts.length;i++){const mesh=new THREE.Mesh(meshGeometry(parts[i]),new THREE.MeshStandardMaterial({color:displayColors[i],roughness:.7,side:THREE.DoubleSide,flatShading:true}));mesh.userData.part=i;models.add(mesh);meshes.push(mesh);}
  const whole=new THREE.Box3();for(let i=0;i<meshes.length;i++){meshes[i].matrix.copy(poses[i].assemblyMatrix);meshes[i].matrixAutoUpdate=false;whole.union(new THREE.Box3().setFromObject(meshes[i]));}
  const center=whole.isEmpty()?new THREE.Vector3():whole.getCenter(new THREE.Vector3()),size=whole.isEmpty()?250:Math.max(...whole.getSize(new THREE.Vector3()).toArray())*1.1;
  for(const p of value.display?.cutPlanes??[]){if(!p.normal||!Number.isFinite(p.offset))continue;const normal=new THREE.Vector3(...p.normal).normalize(),g=new THREE.PlaneGeometry(size,size),m=new THREE.Mesh(g,new THREE.MeshBasicMaterial({color:0xf59f27,side:THREE.DoubleSide,transparent:true,opacity:.12,depthWrite:false}));m.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),normal);m.position.copy(center).addScaledVector(normal,p.offset-center.dot(normal));lines.add(m);}
  el('parts').replaceChildren();parts.forEach((p,i)=>{const button=document.createElement('button');button.type='button';button.className='exact-review-part';const swatch=document.createElement('span');swatch.style.background=displayColors[i];const label=document.createElement('span');label.textContent=stage==='prepared'&&!localPart?`Bereich ${i+1}`:`Teil ${i+1}`;const detail=document.createElement('small');detail.textContent=stage==='prepared'&&!localPart?'Offen':!printAvailable(p)?'Drucklage offen':p.printStability?.classification==='stable'?'Standreserve':p.printStability?.classification==='marginal'?'Geringe Reserve':'Kippgefahr';button.append(swatch,label,detail);button.onclick=()=>{selected=i;updateView();if(el('mode').value==='print')frame();};el('parts').append(button);});
  el('count').textContent=String(parts.length);el('partHeading').textContent=stage==='prepared'&&!localPart?'Vorschaubereiche':'Teile prüfen';el('summary').textContent=summaryText(value.summary);updateView();frame();refresh();
 }
 const phaseText=event=>({prepare:localPart?'Vorhandenes Teil und passende Drucklagen werden geprüft …':'Offener Vorschlag wird vorbereitet …',grid:'Alle Schnittflächen werden gemeinsam berechnet …',grouping:'Nachbarteile und Drucklagen werden verglichen …',refinement:'Die Drucklagen sind gewählt; passende Schnitte für kippgefährdete Teile werden gesucht …',improve:'Geprüften Schnittplan weiter verbessern …',display:'Ansicht wird vorbereitet …',cancelling:'Abbruch angefordert. Warte auf das Ende der laufenden Berechnung …'}[event.phase]??(typeof event.message==='string'?event.message:'Drucklagen und Schnittplan werden geprüft …'));
 async function perform(name,callback){
  if(busy||closed)return;busy=true;operation=name;status(name==='prepare'?(localPart?'Vorhandenes Teil wird geprüft.':'Offene Vorschau wird vorbereitet.'):'Berechnung läuft. Das ursprüngliche Modell bleibt erhalten.');el('progress').textContent=name==='prepare'?(localPart?'Vorhandenes Teil und passende Drucklagen werden geprüft …':'Offener Vorschlag wird vorbereitet …'):name==='calculate'?'Schnittkörper und Drucklagen werden berechnet …':'Geprüften Schnittplan weiter verbessern …';refresh();
  try{const value=await callback();if(!closing&&!closed){show(value);status(value.stage==='prepared'?(localPart?'Vorhandenes Teil und vorgeschlagene Drucklage prüfen. Noch kein neuer Schnitt.':'Offenen Vorschlag prüfen. Noch keine Schnittkörper berechnet.'):'Schnittvorschau berechnet. Drucklagen und offene Hinweise prüfen.');}}
  catch(error){if(client?.locked||error?.cancellationConfirmed===false){uncertainService=true;retainedClients.add(client);}status(error?.message??'Berechnung fehlgeschlagen.',true);}
  finally{busy=false;operation=null;if(!closed)refresh();}
 }
 async function close(){
  if(closing||closed)return;closing=true;refresh();
  try{await client?.dispose();}catch(error){if(client?.locked||error?.cancellationConfirmed===false){uncertainService=true;retainedClients.add(client);}}
  finally{closed=true;observer?.disconnect();renderer?.setAnimationLoop(null);controls?.dispose();for(const group of [models,lines,helpers,maskGroup,bed])disposeGroup(group);renderer?.dispose();dialog.close();dialog.remove();resolveClosed({serviceLocked:uncertainService,adopted});}
 }
 try{
  renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));el('viewport').prepend(renderer.domElement);controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;
  observer=new ResizeObserver(()=>{const {width,height}=el('viewport').getBoundingClientRect();if(width<=0||height<=0)return;renderer.setSize(width,height);camera.aspect=width/height;if(camera.isOrthographicCamera){camera.left=-camera.top*camera.aspect;camera.right=-camera.left;}camera.updateProjectionMatrix();});observer.observe(el('viewport'));
  renderer.setAnimationLoop(()=>{controls.update();renderer.render(scene,camera);});
  const grid=new THREE.GridHelper(Math.max(...usableBed.slice(0,2)),20,0xf59f27,0x526066);grid.rotation.x=Math.PI/2;grid.position.z=-.15;bed.add(grid);
  const edges=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(...usableBed)),new THREE.LineBasicMaterial({color:0x718086}));edges.position.z=usableBed[2]/2;bed.add(edges);bed.visible=false;
  if(mask?.triangles?.length){const mesh=new THREE.Mesh(meshGeometry(mask),new THREE.MeshBasicMaterial({color:0x28ddd3,side:THREE.DoubleSide,transparent:true,opacity:.65,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2}));mesh.matrix.fromArray(sourceAssembly);mesh.matrixAutoUpdate=false;maskGroup.add(mesh);}maskGroup.visible=false;
  client=clientFactory({workerFactory:()=>new Worker(new URL('./exact-model-worker.mjs',import.meta.url),{type:'module'}),getCurrentProjectToken,onProgress:event=>{if(closed)return;el('progress').textContent=phaseText(event.progress??event);}});
  el('close').onclick=el('back').onclick=close;dialog.addEventListener('cancel',event=>{event.preventDefault();if(operation!=='adopt')void close();});
  el('calculate').onclick=()=>perform('calculate',()=>client.calculate({refinementProfile:'stability-breadth-v3'}));el('improve').onclick=()=>perform('improve',()=>client.improve({refinementProfile:'stability-breadth-v3',budget:{maxDurationMs:300000,maxJobs:24}}));
  el('adopt').onclick=async()=>{
   if(busy||!onAdopt||part.plannedMark)return;busy=true;operation='adopt';el('progress').textContent='Genaue Körper, Drucklagen und Innenflächen für das Projekt prüfen …';status('Übernahme wird vorbereitet.');refresh();
   try{const value=await client.adopt({metadata:{name:part.name??'Teil',note:part.note??'',palette}});await onAdopt(value.adoption);adopted=true;await close();}
   catch(error){status(error.message,true);if(client.locked){uncertainService=true;retainedClients.add(client);}}
   finally{busy=false;operation=null;if(!closed)refresh();}
  };
  el('cancel').onclick=async()=>{el('cancel').disabled=true;el('progress').textContent='Abbruch angefordert. Laufende Berechnung wird beendet …';try{await client.cancel();}catch(error){status(error.message,true);if(client.locked){uncertainService=true;retainedClients.add(client);}}};
  el('mode').onchange=()=>{el('mask').checked=false;updateView();frame();};el('explode').oninput=()=>{if(Number(el('explode').value)>0)el('mask').checked=false;updateView();};el('mask').onchange=()=>{if(el('mask').checked){el('mode').value='assembly';el('explode').value='0';}updateView();};el('frame').onclick=frame;
  el('direction').onchange=setDirection;
  el('projection').onclick=()=>{const prior=camera,aspect=prior.aspect,vector=prior.position.clone().sub(controls.target);if(prior.isOrthographicCamera){camera=new THREE.PerspectiveCamera(38,aspect,prior.near,prior.far);camera.position.copy(controls.target).add(vector.normalize().multiplyScalar((prior.top-prior.bottom)/(2*prior.zoom*Math.tan(THREE.MathUtils.degToRad(19)))));}else{const half=vector.length()*Math.tan(THREE.MathUtils.degToRad(19));camera=new THREE.OrthographicCamera(-half*aspect,half*aspect,half,-half,prior.near,prior.far);camera.aspect=aspect;camera.position.copy(prior.position);}camera.up.copy(prior.up);camera.quaternion.copy(prior.quaternion);controls.object=camera;camera.updateProjectionMatrix();controls.update();el('projection').textContent=camera.isOrthographicCamera?'Perspektivische Ansicht':'Orthografische Ansicht';updateView();};
  let down=null;renderer.domElement.addEventListener('pointerdown',event=>{down=[event.clientX,event.clientY];});renderer.domElement.addEventListener('pointerup',event=>{if(!down||event.button!==0||Math.hypot(event.clientX-down[0],event.clientY-down[1])>4)return;const box=renderer.domElement.getBoundingClientRect(),ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2((event.clientX-box.left)/box.width*2-1,-(event.clientY-box.top)/box.height*2+1),camera);const hit=ray.intersectObjects(meshes.filter(m=>m.visible))[0];if(hit){selected=hit.object.userData.part;updateView();}});
  void perform('prepare',()=>client.prepare({part,usableBed,projectToken,...(localPart?{mode:'project-part',permissionSources}: {})}));
 }catch(error){status(error.message,true);el('waiting').hidden=true;el('back').onclick=el('close').onclick=close;dialog.addEventListener('cancel',event=>{event.preventDefault();void close();});}
 return done;
}
