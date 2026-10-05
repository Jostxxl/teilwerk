/** Contextual reading help only; no model objects, workflow changes or computation. */
export const STUDIO_HELP_TOPICS = Object.freeze([
  {id:'model',selector:'#interiorPanel > summary',title:'Innenflächen auswählen',items:[
    '„Innenfläche wählen“ aktivieren und die gewünschte Innenseite anklicken. Die türkise Fläche zeigt, wo automatische Nummern liegen dürfen.',
    '„Auswahlweite“ begrenzt die Normalenabweichung vom Startpunkt: kleiner wählt weniger, größer mehr. Der Regler ändert nur den zuletzt angeklickten Bereich.',
    'Auch bei glatten Übergängen kann die Auswahl über einen Rand wachsen. Rundum prüfen; mit „Weitere Innenflächen hinzufügen“ bleiben frühere Bereiche erhalten.'
  ]},
  {id:'split',selector:'#studioCutSettings .sectiontitle',title:'Vorschau ist noch kein Schnitt',items:[
    '„Aufteilung vorschlagen“ zeigt zunächst eine offene Vorschau. Prüfe Teilzahl, Details und den Druckraum.',
    '„Schnitte berechnen & schließen“ erzeugt die geschlossenen Körper. Erst „Ergebnis übernehmen“ ersetzt das aktuelle Ergebnis.',
    '„Vorschau schließen“ verwirft die Vorschau. Nicht passende oder ungeklärte Teile bleiben erhalten und müssen geprüft werden.'
  ]},
  {id:'mark',selector:'#studioMarkSettings > summary',title:'Nummern wirklich eingravieren',items:[
    '„Nummern mittig platzieren“ merkt Stellen auf den gewählten Innenflächen vor. Prüfe die komplette Schrift und eine gemeinsame lesbare Größe.',
    '„Nummern gravieren“ zieht die Schrift als echte Geometrie vom Teil ab. Vorgemerkt ist noch nicht graviert. Standardtiefe: 0,4 mm.',
    'Fehlt Platz für die ganze Nummer, bleibt die Stelle offen. Position oder Schriftgröße anpassen und anschließend erneut prüfen.'
  ]},
  {id:'print',selector:'#studioPrintSettings .sectiontitle',title:'Drucklage & manuelle Finnen',items:[
    '„Teile ausrichten & Finnen setzen“ öffnen. Mit Drehringen ausrichten oder eine Fläche aufs Bett legen; danach die neue Lage ausdrücklich übernehmen.',
    'Schwerpunkt und Auflage zeigen Kippgefahr oder Reserve. Überhänge gesondert prüfen; Bettanhaftung und Druckverlauf sind damit nicht freigegeben.',
    'Finnen setzt du von Hand: Werkzeug aktivieren, Start und Ende am Teil anklicken und die geprüfte Vorschau abwarten. Werkzeugverfügbarkeit hängt vom Teil ab. Geänderte Lagen vor dem Wechsel übernehmen oder verwerfen.'
  ]},
  {id:'connect',selector:'#studioConnectorSettings > summary',title:'Passstifte passend planen',items:[
    'Standard: gekaufte DIN-6325-Metallstifte Ø 3 × 10 mm. Dazu Bohrungen Ø 3,3 mm und je 7 mm tief: 5 mm Stift plus 2 mm Luft pro Ende.',
    'Zuerst Nummern und Drucklagen festlegen, dann „Verbindungen berechnen“. Materialreserve und Einbauwege werden geprüft. Offene Verbindungen sind nicht gelöst.',
    'Andere Stiftmaße unter „Stiftmaße und weitere Einstellungen“ anpassen. Kaufstifte erscheinen in der Stückliste, nicht als gedruckte Stiftdateien. Reale Passung mit einem Testdruck prüfen.'
  ]},
  {id:'export',selector:'#workflowExport',title:'Projekt, Druckdateien & PDF',items:[
    'Das Projekt zum Weiterarbeiten speichern. Das Druckpaket enthält Druckdateien und Montageinformationen; Prüfhinweise vor dem Export lesen.',
    'Die Browserausgabe öffnet die Anleitung zum Drucken: Als Ziel „Als PDF speichern“ wählen.',
    'STL enthält keine Farben. Im Slicer Materialien, Platten, Unterstützung und Schichtvorschau prüfen. Eine exportierte Datei ist keine allgemeine Druckfreigabe.'
  ]}
].map(topic=>Object.freeze({...topic,items:Object.freeze(topic.items)})));

let serial=0;
export function mountStudioHelp({root=globalThis.document,onOpenTutorial}={}){
  const doc=root?.ownerDocument||root;
  if(!root?.querySelector||!doc?.createElement||!doc.body?.append)throw new TypeError('Hilfe: Dokument fehlt.');
  if(onOpenTutorial!==undefined&&typeof onOpenTutorial!=='function')throw new TypeError('Hilfe: ungültiger Tutorial-Callback.');
  const id='studio-help-'+(++serial),anchors=new Map(),listeners=[];
  let disposed=false,opened=false,topicId='model',returnFocus=null,epoch=0;
  const el=(tag,className,text)=>{const n=doc.createElement(tag);if(className)n.className=className;if(text!==undefined)n.textContent=text;return n;};
  const listen=(node,type,fn)=>{node.addEventListener(type,fn);listeners.push(()=>node.removeEventListener(type,fn));};
  const dialog=el('dialog','studio-help-dialog');dialog.id=id;dialog.setAttribute('aria-labelledby',id+'-title');doc.body.append(dialog);
  const panel=el('div','studio-help-panel'),header=el('header','studio-help-header'),label=el('span','','TEILWERK · HILFE VON PRINJEKT'),closeButton=el('button','studio-help-close','Schließen ×');closeButton.type='button';closeButton.setAttribute('aria-label','Hilfe schließen');header.append(label,closeButton);
  const content=el('div','studio-help-content'),title=el('h2'),list=el('ol'),status=el('p','studio-help-status');title.id=id+'-title';title.tabIndex=-1;status.setAttribute('role','status');status.hidden=true;content.append(title,list,status);
  const footer=el('footer','studio-help-footer'),tutorial=el('button','studio-help-tutorial','Im Tutorial ansehen →'),done=el('button','studio-help-done','Verstanden');tutorial.type=done.type='button';tutorial.hidden=!onOpenTutorial;footer.append(tutorial,done);panel.append(header,content,footer);dialog.append(panel);
  function close(){if(disposed||!opened)return;opened=false;epoch++;if(typeof dialog.close==='function')dialog.close();else dialog.removeAttribute('open');const fallback=anchors.get(topicId)?.button;const target=returnFocus?.isConnected!==false?returnFocus:fallback;target?.focus?.();}
  function open(value){if(disposed)return false;const topic=STUDIO_HELP_TOPICS.find(t=>t.id===value);if(!topic)throw new TypeError('Unbekanntes Hilfethema.');topicId=value;title.textContent=topic.title;list.replaceChildren(...topic.items.map(text=>el('li','',text)));status.hidden=true;status.textContent='';if(!opened){returnFocus=doc.activeElement;opened=true;epoch++;if(typeof dialog.showModal==='function')dialog.showModal();else{dialog.setAttribute('open','');dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');}}sync();title.focus();return true;}
  function sync(){
    if(disposed)return;
    for(const topic of STUDIO_HELP_TOPICS){
      const anchor=root.querySelector(topic.selector),previous=anchors.get(topic.id);
      if(previous&&previous.button.parentElement!==anchor){previous.button.remove();previous.off();anchors.delete(topic.id);}
      if(anchor&&!anchors.has(topic.id)){
        const b=el('button','studio-help-trigger','?');b.type='button';b.dataset.studioHelp=topic.id;b.setAttribute('aria-label','Hilfe: '+topic.title);b.setAttribute('aria-haspopup','dialog');b.setAttribute('aria-controls',id);b.title=topic.title;
        const click=e=>{e.preventDefault();e.stopPropagation();open(topic.id);};b.addEventListener('click',click);
        // A summary's default toggle must not run when its help button is used.
        if(topic.id==='export'){b.classList.add('studio-help-export');anchor.prepend(b);}else anchor.append(b);
        anchors.set(topic.id,{button:b,off:()=>b.removeEventListener('click',click)});
      }
    }
    // The host disables all buttons while computing. Help remains read-only.
    for(const {button}of anchors.values())button.disabled=false;
    for(const button of [closeButton,tutorial,done])button.disabled=false;
  }
  listen(closeButton,'click',close);listen(done,'click',close);
  listen(tutorial,'click',()=>{if(disposed||!onOpenTutorial)return;const selected=topicId;close();const token=epoch;try{Promise.resolve(onOpenTutorial(selected)).catch(error=>showFailure(error,token,selected));}catch(error){showFailure(error,token,selected);}});
  function showFailure(error,token,selected){if(disposed||epoch!==token)return;open(selected);status.hidden=false;status.textContent=error?.message||'Das Tutorial konnte nicht geöffnet werden.';}
  listen(dialog,'cancel',e=>{e.preventDefault();close();});
  listen(dialog,'close',()=>{if(opened&&dialog.getAttribute('open')===null)close();});
  listen(dialog,'keydown',e=>{
    if(e.key==='Escape'){e.preventDefault();close();return;}if(e.key!=='Tab')return;
    const controls=[closeButton,...(onOpenTutorial?[tutorial]:[]),done];
    if(e.shiftKey&&(doc.activeElement===controls[0]||doc.activeElement===title)){e.preventDefault();done.focus();}
    else if(!e.shiftKey&&doc.activeElement===done){e.preventDefault();closeButton.focus();}
  });
  function dispose(){if(disposed)return;close();disposed=true;epoch++;for(const off of listeners)off();for(const {button,off}of anchors.values()){off();button.remove();}anchors.clear();dialog.remove();}
  sync();return Object.freeze({sync,dispose,open,close});
}
