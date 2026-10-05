/** Help and navigation only. The host owns imports, project state and all guards. */
export const STUDIO_TUTORIAL_VERSION = 1;
export const STUDIO_TUTORIAL_STEPS = Object.freeze([
  {id:'overview', title:'Dein Weg zum Druckpaket', kicker:'TEILWERK · KURZ ERKLÄRT', lead:'Ein Modell. Überschaubare Teile. Ein nachvollziehbarer Zusammenbau.',
    points:['Du arbeitest in sechs Schritten. Die Anleitung kannst du jederzeit wieder öffnen.','Eine Vorschau ist noch kein übernommenes Ergebnis. Prüfe Form und Hinweise, bevor du bestätigst.','Speichere zwischendurch dein Projekt. Die Projektdatei ist zum Weiterarbeiten da; das Druckpaket ist für Slicer und Montage.'],
    check:'Deine Modelle werden auf diesem Gerät verarbeitet und nicht hochgeladen.',controls:[]},
  {id:'model', title:'Modell & Drucker vorbereiten', kicker:'01 / MODELL', lead:'Zuerst müssen Modellgröße und verfügbarer Druckraum zusammenpassen.',
    points:['Importiere eine STL- oder OBJ-Datei. Ein gespeichertes Teilwerk-Projekt öffnest du über „Projekt öffnen“.','Stelle die Druckermaße und den Rand ein. Kontrolliere die Größe in Millimetern.','Wenn du automatische Nummern nutzen möchtest: Wähle vor dem Aufteilen die Innenflächen aus, auf denen sie liegen dürfen.'],
    check:'Drehen, zoomen und die Innenseite ansehen. Ist die Auswahl wirklich dort, wo später die Nummern stehen sollen?',controls:['file','projectFile','interiorPanel']},
  {id:'split', title:'Aufteilen – erst sehen, dann übernehmen', kicker:'02 / AUFTEILEN', lead:'Die Schnittvorschau zeigt dir, was aus dem Modell werden soll.',
    points:['Lass dir eine Aufteilung vorschlagen oder prüfe einen eigenen Schnitt. Achte auf Teilzahl, Details und Bauraum.','Eine offene Vorschau enthält noch keine fertigen Abschlussflächen. Berechne die Schnitte und prüfe das Ergebnis.','Erst „Ergebnis übernehmen“ macht den geprüften Vorschlag zum aktuellen Projekt. Nicht passende oder ungeklärte Teile bleiben ein Prüfpunkt.'],
    check:'Weniger Teile sind hilfreich, wenn sie sinnvoll ausgerichtet in den Druckraum passen. Ein Vorschlag ist keine Druckfreigabe.',controls:['applyResult','cancelPreview','calculateDraft']},
  {id:'mark', title:'Nummern zum Wiederfinden', kicker:'03 / NUMMERN', lead:'Die Kennzeichnung verbindet das gedruckte Teil mit seiner Montageansicht.',
    points:['Platziere die automatischen IDs auf den ausgewählten Innenflächen. Prüfe jede Stelle und eine gut lesbare Schriftgröße.','Eine vorgemerkte Nummer ist noch keine Gravur. Übernimm sie mit „Nummern gravieren“ in die Geometrie.','Kontrolliere Position und Tiefe. Für eine unauffällige Gravur sind 0,4 mm voreingestellt; die gesamte Schrift muss auf die erlaubte Fläche passen.'],
    check:'Fehlt eine sichere Stelle, bleibt die Nummer offen. Eine Warnung nicht mit einer fertigen Kennzeichnung verwechseln.',controls:['centerAutoMarks','applyAllMarks','markDepth']},
  {id:'print', title:'Drucklage vor weiteren Schritten', kicker:'04 / DRUCKLAGE', lead:'Montagelage und Drucklage haben unterschiedliche Aufgaben.',
    points:['Öffne „Teile ausrichten & Finnen setzen“. Drehe ein Teil oder lege eine geeignete Fläche auf das Druckbett.','Prüfe Bauraum, Auflage, Schwerpunkt und Überhänge. Eine stabile Lage kann trotzdem Unterstützung im Slicer benötigen.','Finnen setzt du bei Bedarf bewusst von Hand: Werkzeug aktivieren, Start und Ende am Teil anklicken, Vorschau prüfen. Verfügbare Werkzeuge hängen vom Teil ab. Übernimm jede neue Drucklage.'],
    check:'Vor dem Schrittwechsel eine geänderte Lage übernehmen oder verwerfen. Die Anzeige allein verändert noch nicht die gespeicherte Lage.',controls:['printPreparation','showStability','supportsEnabled']},
  {id:'connect', title:'Passstifte & Einbauwege prüfen', kicker:'05 / STIFTE', lead:'Zusammenpassen heißt auch: Die Teile müssen sich einbauen lassen.',
    points:['Lege zuerst Nummern und Drucklagen fest. Wähle anschließend Kaufstifte oder gedruckte Stifte und prüfe die Maße.','„Verbindungen berechnen“ prüft Bohrstellen, Materialreserve und Einbauwege. Die Planung kann offene Verbindungen melden.','Kläre diese Hinweise vor dem Export. Kaufstifte werden als benötigte Hardware geführt, nicht als Stift-Druckteile.'],
    check:'Bohrung, Spiel und Stift müssen zu deinem Material passen. Prüfe die reale Passung mit einem kleinen Testdruck.',controls:['dowelSource','dowelFitInfo','planDowels','connectorIssues']},
  {id:'export', title:'Projekt sichern. Druckpaket prüfen.', kicker:'06 / EXPORT', lead:'Jetzt gehen Teile und Anleitung gemeinsam in die nächste Etappe.',
    points:['Speichere das Projekt, damit Geometrie, Drucklagen und Einstellungen später wieder verfügbar sind.','Lies die Prüfhinweise und exportiere die Druckteile mit Montageanleitung und Prüfbericht. Öffnet sich die Anleitung im Browser-Druckdialog, wähle dort „Als PDF speichern“.','Öffne die Druckdateien in deinem Slicer. Prüfe Platten, Materialien, Unterstützung und Schichtvorschau vor dem Drucken.'],
    check:'Die Anleitung führt über die Teilnummern durch den Zusammenbau. STL enthält keine Farben; Materialzuweisungen im Slicer prüfen.',controls:['saveProject','export','guide']}
].map(step=>Object.freeze({...step,points:Object.freeze(step.points),controls:Object.freeze(step.controls)})));

const key='prinjekt.studio.tutorial.v1.dismissed';
let instance=0;
function stateOf(getState){
  const value=getState();
  if(!value||typeof value.hasProject!=='boolean')throw new TypeError('Tutorial: hasProject muss ein Wahrheitswert sein.');
  for(const field of ['busy','dirtyPrintPose'])if(value[field]!==undefined&&typeof value[field]!=='boolean')throw new TypeError('Tutorial: ungültiger Zustand '+field);
  return {hasProject:value.hasProject,busy:value.busy??false,dirtyPrintPose:value.dirtyPrintPose??false};
}
const diagrams={
 overview:'<path d="M47 77 93 52l46 25v54l-46 26-46-26Z M47 77l46 27 46-27 M93 104v53"/><path class="accent" d="m165 106 36 0m-10-10 10 10-10 10"/><path d="m227 76 27-16 27 16v32l-27 16-27-16Z m0 0 27 16 27-16 M254 92v32 m39 10 27-16 27 16v32l-27 16-27-16Z m0 0 27 16 27-16 M320 150v32"/>',
 model:'<path d="M80 161h226M97 147V49h189v98 M126 89l63-35 64 35v53l-64 35-63-35Z M126 89l63 36 64-36 M189 125v52"/><path class="accent" d="M75 183h233m-233-6v12m233-12v12"/>',
 split:'<path d="m81 73 53-30 39 22v68l-53 30-39-22Z m0 0 39 23 53-31 M120 96v67 m90-7 53-31 40 23v68l-53 30-40-23Z m0 0 40 23 53-31 M250 179v67" transform="translate(0,-28)"/><path class="accent" stroke-dasharray="5 6" d="m169 42 43 137"/>',
 mark:'<path d="m84 91 104-50 104 50-104 58Z M84 91v44l104 51 104-51V91 M188 149v37"/><path class="accent" d="m173 91 14-9v35m-13 0h28"/>',
 print:'<path d="M69 170h242 M112 158l38-100h100l-36 100Z M150 58l31 34 69-34 M181 92l-30 66"/><path class="accent" d="M184 109v55m-7-8 7 8 7-8"/><circle class="accent" cx="184" cy="105" r="7"/>',
 connect:'<path d="m66 81 73-33 48 24v77l-73 33-48-24Z M66 81l48 24 73-33 M114 105v77 m182-99-48-24-42 20v78l48 24 42-20Z M206 79l48 25 42-21 M254 104v77"/><path class="accent" d="m164 101 50 24m-50 10 50 24"/>',
 export:'<path d="M108 40h124l40 40v112H108Z M232 40v40h40 M134 158h112m-112 15h83"/><path class="accent" d="M188 87v50m-17-17 17 17 17-17"/>'
};

/**
 * Import this module and studio-tutorial.css separately. Supply host callbacks,
 * never direct model objects. sync() follows load/reset/busy/pose changes.
 * onNavigate must return true only after the host's ordinary navigation guards.
 * Start callbacks run synchronously in the click gesture (file pickers work).
 * storage is optional: only one dismiss preference is read/written, no model data.
 */
export function mountStudioTutorial({buttonHost,welcomeHost,getState,onStartDemo,onImportModel,onOpenProject,onNavigate,storage=null}={}){
  const doc=buttonHost?.ownerDocument;
  if(!doc?.createElement||!doc.body?.append||typeof getState!=='function')throw new TypeError('Tutorial: buttonHost und getState fehlen.');
  if(welcomeHost&&welcomeHost.ownerDocument!==doc)throw new TypeError('Tutorial: unterschiedliche Dokumente.');
  for(const callback of [onStartDemo,onImportModel,onOpenProject,onNavigate])if(callback!==undefined&&typeof callback!=='function')throw new TypeError('Tutorial: ungültiger Callback.');
  stateOf(getState);
  const id='studio-tutorial-'+(++instance),listeners=[],navButtons=[],startButtons=[],welcomeHelpButtons=[];
  let disposed=false,opened=false,pending=false,epoch=0,current=0,returnFocus=null,dismissed=false;
  try{dismissed=storage?.getItem(key)==='1';}catch{}
  const el=(tag,className,text)=>{const node=doc.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;};
  const listen=(node,type,fn)=>{node.addEventListener(type,fn);listeners.push(()=>node.removeEventListener(type,fn));};
  const button=(text,className,fn)=>{const node=el('button',className,text);node.type='button';listen(node,'click',fn);return node;};
  const launch=button('Tutorial','studio-tutorial-launch',()=>open());launch.dataset.studioTutorial='open';launch.setAttribute('aria-label','Tutorial');launch.setAttribute('aria-haspopup','dialog');buttonHost.append(launch);
  const dialog=el('dialog','studio-tutorial-dialog');dialog.id=id;dialog.setAttribute('aria-labelledby',id+'-title');dialog.setAttribute('aria-describedby',id+'-lead');doc.body.append(dialog);
  const panel=el('div','studio-tutorial-panel'),header=el('header','studio-tutorial-header'),brand=el('span','studio-tutorial-brand','TEILWERK');
  const closeButton=button('Schließen ×','studio-tutorial-close',()=>close());closeButton.setAttribute('aria-label','Tutorial schließen');header.append(brand,closeButton);
  const body=el('div','studio-tutorial-body'),nav=el('nav','studio-tutorial-nav');nav.setAttribute('aria-label','Tutorial-Kapitel');
  for(const [i,step]of STUDIO_TUTORIAL_STEPS.entries()){
    const b=button('', 'studio-tutorial-chapter',()=>select(i));b.dataset.tutorialStep=step.id;
    b.append(el('span','studio-tutorial-chapter-number',i?String(i).padStart(2,'0'):'→'),el('span','',i?['Modell','Aufteilen','Nummern','Drucklage','Stifte','Export'][i-1]:'Überblick'));nav.append(b);navButtons.push(b);
  }
  const content=el('section','studio-tutorial-content'),art=el('div','studio-tutorial-art'),kicker=el('p','studio-tutorial-kicker'),title=el('h2'),lead=el('p','studio-tutorial-lead'),list=el('ol','studio-tutorial-points'),check=el('p','studio-tutorial-check'),quick=el('div','studio-tutorial-quick');
  title.id=id+'-title';title.tabIndex=-1;lead.id=id+'-lead';art.setAttribute('aria-hidden','true');
  const status=el('p','studio-tutorial-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.hidden=true;
  const jump=button('','studio-tutorial-jump',()=>navigate());jump.dataset.studioTutorial='navigate';
  content.append(art,kicker,title,lead,list,check,quick,jump,status);body.append(nav,content);
  const footer=el('footer','studio-tutorial-footer'),progress=el('span','studio-tutorial-progress'),back=button('← Zurück','',()=>select(current-1)),next=button('Weiter →','studio-tutorial-primary',()=>current===STUDIO_TUTORIAL_STEPS.length-1?close():select(current+1));
  footer.append(progress,back,next);panel.append(header,body,footer);dialog.append(panel);
  const welcome=welcomeHost?el('section','studio-tutorial-welcome'):null;
  const actions=[['demo','Mit Beispiel starten',onStartDemo],['import','Modell importieren',onImportModel],['project','Projekt öffnen',onOpenProject]];
  function addStarts(host){for(const [name,label,callback]of actions)if(callback){const b=button(label,name==='import'?'studio-tutorial-primary':'',()=>start(callback));b.dataset.tutorialStart=name;host.append(b);startButtons.push(b);}}
  addStarts(quick);
  if(welcome){
    welcome.setAttribute('aria-label','Einstieg in Teilwerk');
    const top=el('div','studio-tutorial-welcome-top'),copy=el('div');copy.append(el('h2','','Neu hier?'));
    const later=button('Später','studio-tutorial-later',()=>{dismissed=true;try{storage?.setItem(key,'1');}catch{}sync();});later.setAttribute('aria-label','Einstieg ausblenden');top.append(copy,later);
    const intro=el('p','','Das Tutorial führt dich durch dein erstes Projekt.'),row=el('div','studio-tutorial-welcome-actions');const help=button('Tutorial öffnen →','studio-tutorial-text-button',()=>open());row.append(help);welcomeHelpButtons.push(later,help);welcome.append(top,intro,row);welcomeHost.append(welcome);
  }
  function message(text){if(disposed)return;status.textContent=text;status.hidden=!text;}
  function render(){
    const step=STUDIO_TUTORIAL_STEPS[current];kicker.textContent=step.kicker;title.textContent=step.title;lead.textContent=step.lead;check.textContent=step.check;
    list.replaceChildren(...step.points.map(p=>el('li','',p)));
    art.innerHTML='<svg viewBox="0 0 380 220" focusable="false" xmlns="http://www.w3.org/2000/svg">'+diagrams[step.id]+'</svg>';
    for(const [i,b]of navButtons.entries())b.setAttribute('aria-current',i===current?'step':'false');
    progress.textContent=current?`Schritt ${current} von 6`:'Überblick · etwa 3 Minuten';back.disabled=current===0;next.textContent=current===6?'Zurück zu Teilwerk':'Weiter →';
    jump.textContent=current?`In Teilwerk: ${['Modell','Aufteilen','Nummern','Drucklage','Stifte','Export'][current-1]} →`:'';
    message('');sync();
  }
  function select(index){if(disposed||!Number.isInteger(index)||index<0||index>=STUDIO_TUTORIAL_STEPS.length)return;current=index;render();if(opened)title.focus();}
  function sync(){
    if(disposed)return;const state=stateOf(getState),locked=pending||state.busy||state.dirtyPrintPose;
    // Main may disable every button during computation. Reading/closing help
    // stays available; actual model actions and workflow jumps stay guarded.
    for(const b of [launch,closeButton,...welcomeHelpButtons])b.disabled=false;
    if(welcome)welcome.hidden=state.hasProject||dismissed;
    quick.hidden=current!==0||state.hasProject;
    for(const b of startButtons)b.disabled=locked||state.hasProject;
    jump.hidden=!onNavigate||current===0;jump.disabled=locked;
    for(const b of navButtons)b.disabled=false;back.disabled=current===0;next.disabled=false;
    jump.title=state.busy?'Die Berechnung zuerst abschließen.':state.dirtyPrintPose?'Die Drucklage zuerst übernehmen oder verwerfen.':'';
  }
  function open(stepId='overview'){
    if(disposed)return false;const index=STUDIO_TUTORIAL_STEPS.findIndex(s=>s.id===stepId);if(index<0)throw new TypeError('Unbekanntes Tutorial-Kapitel.');
    if(!opened){returnFocus=doc.activeElement;opened=true;epoch++;if(typeof dialog.showModal==='function')dialog.showModal();else{dialog.setAttribute('open','');dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');}}
    current=index;render();title.focus();return true;
  }
  function close(){
    if(disposed||!opened)return;opened=false;epoch++;if(typeof dialog.close==='function')dialog.close();else dialog.removeAttribute('open');
    const target=returnFocus?.isConnected!==false&&typeof returnFocus?.focus==='function'?returnFocus:launch;target.focus();
  }
  function start(callback){
    if(disposed||pending)return;const state=stateOf(getState);if(state.hasProject||state.busy||state.dirtyPrintPose){message('Bitte zuerst zu Teilwerk zurückkehren und den aktuellen Vorgang abschließen.');sync();return;}
    pending=true;sync();let result;
    try{result=callback();close();}catch(error){pending=false;open();message(error?.message||'Der Einstieg konnte nicht geöffnet werden.');return;}
    const token=epoch;
    Promise.resolve(result).catch(error=>{if(!disposed&&token===epoch&&!stateOf(getState).hasProject){open();message(error?.message||'Der Einstieg konnte nicht geöffnet werden.');}}).finally(()=>{pending=false;if(!disposed)sync();});
  }
  async function navigate(){
    if(disposed||pending||!onNavigate||current===0)return;
    const state=stateOf(getState);if(state.busy||state.dirtyPrintPose){message('Zuerst die Berechnung abschließen oder die Drucklage übernehmen beziehungsweise verwerfen.');sync();return;}
    const token=epoch;pending=true;sync();
    try{const accepted=await onNavigate(STUDIO_TUTORIAL_STEPS[current].id);if(disposed||!opened||token!==epoch)return;if(accepted===true)close();else message('Dieser Schritt ist noch nicht verfügbar. Schließe zuerst den vorherigen Schritt in Teilwerk ab.');}
    catch(error){if(!disposed&&opened&&token===epoch)message(error?.message||'Der Schritt konnte nicht geöffnet werden.');}
    finally{pending=false;if(!disposed)sync();}
  }
  listen(dialog,'cancel',event=>{event.preventDefault();close();});
  // Native close events are queued: a previous session must not close a dialog
  // that has already been opened again in the same event turn.
  listen(dialog,'close',()=>{if(opened&&dialog.getAttribute('open')===null)close();});
  listen(dialog,'keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();close();return;}
    if(event.key!=='Tab')return;const nodes=[...dialog.querySelectorAll('button')].filter(b=>!b.disabled&&!b.hidden&&!b.closest('[hidden]'));
    if(!nodes.length)return;const first=nodes[0],last=nodes.at(-1);
    if(event.shiftKey&&(doc.activeElement===first||doc.activeElement===title)){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&doc.activeElement===last){event.preventDefault();first.focus();}
  });
  function dispose(){if(disposed)return;close();disposed=true;epoch++;for(const off of listeners)off();launch.remove();welcome?.remove();dialog.remove();}
  render();return Object.freeze({open,close,sync,dispose,get isOpen(){return opened;},get currentStep(){return STUDIO_TUTORIAL_STEPS[current].id;}});
}
