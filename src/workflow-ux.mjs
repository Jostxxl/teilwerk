/** Presentation of the existing six steps; no model writes or computation. */
export function mountWorkflowUX({root=document,getState,browserOnly,onModelPhase,onAutomaticMarkSettings}={}){
 const $=id=>root.getElementById(id),make=(tag,text,className)=>{const n=root.createElement(tag);if(text)n.textContent=text;if(className)n.className=className;return n;};
 const label=(id,text)=>{const control=$(id),parent=control.parentElement;for(const n of [...parent.childNodes])if(n.nodeType===3)n.textContent='';parent.prepend(root.createTextNode(text));};
 const fold=(host,title,nodes)=>{const d=make('details',null,'workflow-more');d.append(make('summary',title));for(const n of nodes)if(n)d.append(n);host.append(d);return d;};
 const model=$('workflowModel'),options=model.querySelector('.subdetails');
 model.append($('studioPrinterSettings'),$('interiorPanel'),options);options.querySelector('summary').textContent='Modellgröße & Ausrichtung';
 const usable=make('p','','hint');usable.id='usableBuildSpace';$('studioPrinterSettings').append(usable);
 const interior=$('interiorPanel');interior.querySelector('summary').childNodes[0].textContent='Innenflächen für Nummern';
 const intro=interior.querySelector('p.hint');intro.textContent='Fläche am Modell anklicken. Mit „Auswahlweite“ bestimmen, wie weit die Auswahl reicht.';
 const interiorButtons=$('pickInterior').parentElement;intro.after(interiorButtons);$('pickInterior').classList.add('primary');
 const hints=[...interior.querySelectorAll(':scope > p.hint')].filter(n=>n!==intro);fold(interior,'Auswahl und Nummern genauer einstellen',[$('showInteriorMask').parentElement,$('interiorAdd').parentElement,$('autoInteriorMarks').parentElement,...hints]);
 const splitActions=make('div',null,'workflow-result-actions'),cutModeLabel=$('autoCutMode').parentElement,cutExplanation=$('autoCutHint').closest('details'),cutNextHint=$('studioCutSettings').querySelector(':scope > p.hint');
 $('studioCutSettings').querySelector('.sectiontitle').after(splitActions);splitActions.append($('draftBar'),$('applyResult'),$('cancelPreview'));$('applyResult').classList.add('wide');$('cancelPreview').classList.add('wide');
 const mark=$('studioMarkSettings'),manual=mark.querySelector('.workflow-more');
 const defaults=mark.querySelector(':scope > .hint');if(defaults)defaults.remove();
 label('markSize','Texthöhe / mm');label('markDepth','Texttiefe / mm');
 const autoMarkRow=make('div',null,'double'),autoMarkFields={};
 const autoMarkRules={size:{id:'workflowAutoMarkSize',label:'Schrifthöhe / mm',min:1,max:100,step:.5},depth:{id:'workflowAutoMarkDepth',label:'Gravurtiefe / mm',min:.1,max:5,step:.1}};
 let lastAutoMarkSettings={size:8,depth:.4};
 const validAutomaticValue=(key,value)=>typeof value==='number'&&Number.isFinite(value)&&value>=autoMarkRules[key].min&&value<=autoMarkRules[key].max;
 function readAutomaticSettings(state){
  for(const [key,field]of [['size','autoMarkSize'],['depth','autoMarkDepth']])if(validAutomaticValue(key,state[field]))lastAutoMarkSettings={...lastAutoMarkSettings,[key]:state[field]};
  return {...lastAutoMarkSettings};
 }
 for(const [key,rule]of Object.entries(autoMarkRules)){
  const holder=make('label',rule.label),input=make('input');input.id=rule.id;input.type='number';input.min=String(rule.min);input.max=String(rule.max);input.step=String(rule.step);input.required=true;holder.append(input);autoMarkRow.append(holder);autoMarkFields[key]=input;
  const updateAutomaticInput=finalize=>{
   const state=getState(),previous=readAutomaticSettings(state);
   if(state.busy||state.hasConnectorPlan||state.preview||typeof onAutomaticMarkSettings!=='function'){input.value=String(previous[key]);sync();return;}
   const value=input.valueAsNumber;
   if(!input.validity.valid||!validAutomaticValue(key,value)){
    if(finalize){input.reportValidity();input.value=String(previous[key]);}
    return;
   }
   const next={...previous,[key]:value};if(value!==previous[key])onAutomaticMarkSettings(next);lastAutoMarkSettings=next;sync();
  };
  input.addEventListener('input',()=>updateAutomaticInput(false));
  input.addEventListener('change',()=>updateAutomaticInput(true));
  input.addEventListener('blur',()=>{
   if(!input.validity.valid||!validAutomaticValue(key,input.valueAsNumber))updateAutomaticInput(true);
   else sync();
  });
 }
 manual.before(autoMarkRow,$('autoFitMarkSize').parentElement);
 autoMarkRow.after($('centerAutoMarks'),$('automaticMarkSettings'),$('applyAllMarks'));
 $('centerAutoMarks').textContent='Nummern mittig platzieren';$('applyAllMarks').textContent='Nummern gravieren';$('applyAllMarks').classList.add('primary');
 const markState=make('p','','workflow-state');markState.id='workflowMarkState';mark.querySelector('summary').after(markState);
 const selectInterior=make('button','Innenflächen auswählen →','wide');selectInterior.id='workflowSelectInterior';selectInterior.type='button';selectInterior.addEventListener('click',()=>onModelPhase());markState.after(selectInterior);
 const printSettings=$('studioPrintSettings');$('printPreparation').textContent='Teile ausrichten & Finnen setzen';
 const printBar=root.querySelector('.print-preparation [data-action="apply"]').parentElement;
 for(const action of ['previous','next','rotate-x','rotate-y','rotate-z','reset','face','apply','discard','fins','fin-tool','close'])printBar.append(printBar.querySelector(`[data-action="${action}"]`));
 const show=$('showStability').parentElement,printDetails=fold(printSettings,'Auflage und Überhänge prüfen',[$('orientationInfo'),show,$('stabilityLegend')]);printSettings.querySelector('.sectiontitle').after($('printPreparation'),$('orient'),printDetails);
 const connector=$('studioConnectorSettings'),staticHint=connector.querySelector(':scope > .hint');if(staticHint)staticHint.remove();
 const connectorDetails=connector.querySelector('.workflow-more');connectorDetails.before($('dowelSource').parentElement,$('dowelFitInfo'),$('planDowels'),$('repairDowels'),$('connectorInfo'),$('connectorIssues'));
 $('planDowels').textContent='Verbindungen berechnen';$('removeDowels').textContent='Bohrungen entfernen';connectorDetails.append($('removeDowels'),make('p','Stellt die Basisteile vor der Stiftplanung wieder her.','hint'));
 const engravingNote=make('p','','hint');engravingNote.id='connectorEngravingNote';$('planDowels').before(engravingNote);
 const exportPanel=$('workflowExport'),exportHint=$('export').nextElementSibling,guideOptions=exportPanel.querySelector('.output-actions');
 exportPanel.append($('export'),exportHint);
 const save=make('button','Projektdatei speichern','wide');save.type='button';save.id='workflowSaveProject';save.addEventListener('click',()=>$('saveProject').click());exportPanel.append(save);
 const guideTitle=make('h3','Montageanleitung','workflow-output-title');exportPanel.append(guideTitle,$('guide'));
 $('guide').classList.remove('primary');$('guide').classList.add('wide');$('guideHtml').textContent='HTML-Anleitung herunterladen';
 const guideHint=guideOptions.querySelector(':scope > .hint');if(guideHint)guideHint.textContent=browserOnly?'Öffnet die Druckansicht. Dort „Als PDF speichern“ wählen.':'Bebilderte Anleitung mit Teilnummern und Montagereihenfolge.';
 if(guideHint)exportPanel.append(guideHint);
 fold(exportPanel,'Weitere Ausgabeoptionen',[$('guideHtml'),...guideOptions.querySelectorAll(':scope > details')]);guideOptions.remove();
 exportHint.textContent=browserOnly?'ZIP mit STL-Teilen, farbiger 3MF, HTML-Montageanleitung und Prüfbericht. PDF separat über die Druckansicht speichern.':'ZIP mit STL-Teilen, farbiger 3MF, Montageanleitung und Prüfbericht.';
 function sync(){
  const s=getState();
  const automatic=readAutomaticSettings(s);
  for(const [key,input]of Object.entries(autoMarkFields)){
   input.disabled=s.busy||s.hasConnectorPlan||s.preview||typeof onAutomaticMarkSettings!=='function';
   if(root.activeElement!==input)input.value=String(automatic[key]);
  }
  usable.textContent=s.usableBed?'Nutzbarer Bauraum: '+s.usableBed.map(n=>n.toLocaleString('de-DE')).join(' × ')+' mm':'';
  $('autoContourAll').hidden=s.preview;$('calculateDraft').classList.add('wide');
  cutModeLabel.hidden=cutExplanation.hidden=cutNextHint.hidden=s.preview;
  if(s.preview){$('calculateDraft').classList.add('primary');}
  $('centerAutoMarks').disabled=s.busy||s.hasConnectorPlan||!s.hasInterior||s.preview;
  $('applyAllMarks').disabled=s.busy||s.hasConnectorPlan||s.plannedMarks===0||s.preview;
  selectInterior.hidden=s.hasInterior||s.hasConnectorPlan;selectInterior.disabled=s.busy;
  markState.textContent=s.partCount?`${s.plannedMarks} vorgemerkt · ${s.engravedMarks} graviert · ${s.partCount-s.plannedMarks-s.engravedMarks} ohne Gravur`:'';
  $('automaticMarkSettings').textContent=s.markSettings;
  $('removeDowels').hidden=!s.hasConnectorPlan;
  $('planDowels').hidden=s.hasConnectorPlan;
  $('connectorInfo').hidden=!s.hasConnectorPlan;
  engravingNote.hidden=!s.plannedMarks||s.hasConnectorPlan;engravingNote.textContent=`${s.plannedMarks} vorgemerkte Nummern werden vor der Stiftplanung graviert.`;
  save.disabled=s.busy||!s.partCount||s.preview||$('saveProject').disabled;
 }
 sync();return Object.freeze({sync});
}
