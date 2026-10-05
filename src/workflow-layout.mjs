// Reuse the existing controls and handlers; only their presentation is grouped.
export function mountWorkflowLayout(root=document){
 const $=id=>root.getElementById(id),left=root.querySelector('.left'),nav=root.querySelector('.studio-tabs');
 nav.id='workflowNav';nav.replaceChildren();
 const summary=root.createElement('div');summary.id='workflowSummary';left.querySelector('.panel-heading').replaceWith(summary);
 const actions=root.createElement('div');actions.id='workflowActions';left.append(actions);
 const phases=(node,value)=>{if(node)node.dataset.workflowPhases=value;return node;};
 const group=(id,phase,nodes)=>{const el=root.createElement('section');el.id=id;phases(el,phase);for(const node of nodes)if(node)el.append(node);left.insertBefore(el,actions);return el;};
 const importOptions=$('drop').nextElementSibling;
 importOptions.append(root.querySelector('.scale'),$('largestFace'));
 group('workflowModel','model',[$('drop'),importOptions,$('studioPrinterSettings'),$('interiorPanel')]);
 group('workflowSplit','split',[$('studioCutSettings'),$('studioMergeSettings')]);
 const previewMarks=root.createElement('details');previewMarks.id='workflowPreviewMarks';previewMarks.hidden=true;previewMarks.innerHTML='<summary>Nummerpositionen in der Vorschau</summary><p class="hint">Eine Stelle am Vorschauteil anklicken und übernehmen. Schriftgröße und Gravur folgen im Schritt „Nummern“.</p><button id="workflowPickPreviewMark" class="wide">Stelle am Vorschauteil wählen</button><button id="workflowApplyPreviewMark" class="wide">Nummerposition übernehmen</button>';$('workflowSplit').append(previewMarks);
 $('workflowPickPreviewMark').onclick=()=>$('pickMark').click();$('workflowApplyPreviewMark').onclick=()=>$('applyMark').click();
 group('workflowMark','mark',[$('studioMarkSettings'),$('studioColorSettings')]);
 group('workflowPrint','print',[$('printPreparationPanel'),$('studioPrintSettings')]);
 group('workflowConnect','connect',[$('studioConnectorSettings')]);
 const output=root.querySelector('.output-actions'),result=root.querySelector('.resultSettings');
 const exportButton=$('export'),exportHelp=exportButton.nextElementSibling;
 group('workflowExport','export',[output,exportButton,exportHelp]);
 phases(result,'split mark connect export');
 const report=root.createElement('p');report.id='workflowExportCheck';report.className='workflow-check';$('workflowExport').prepend(report);
 for(const id of ['studioMarkSettings','studioConnectorSettings'])$(id).open=true;
 for(const id of ['studioMarkSettings','studioConnectorSettings'])$(id).classList.add('workflow-expanded');
 $('studioMarkSettings').querySelector('summary').textContent='Nummern auf den Teilen';
 $('studioConnectorSettings').querySelector('summary').textContent='Passstifte verbinden die Teile';
 const title=root.querySelector('.right > .sectiontitle h2');if(title)title.textContent='Deine Teile';
 const context=root.querySelector('.project-context');context.textContent='SCHRITT FÜR SCHRITT';
 const views=root.createElement('div');views.className='view-presentation';views.innerHTML='<label for="viewColorMode">Darstellung</label><select id="viewColorMode" aria-label="Farbdarstellung"><option value="parts">Teilfarben</option><option value="single">Einfarbig</option></select><input id="viewSingleColor" type="color" value="#d5d9d9" aria-label="Einheitliche Ansichtsfarbe" title="Nur die Ansicht; Druckfarben bleiben erhalten" hidden><span class="view-color-note" id="viewColorNote" hidden>Nur Ansicht</span>';
 root.querySelector('.view-tools').prepend(views);
 const fold=(id,summaryText,keep)=>{const el=$(id),details=root.createElement('details');details.className='workflow-more';const heading=root.createElement('summary');heading.textContent=summaryText;details.append(heading);for(const child of [...el.children])if(!keep(child))details.append(child);el.append(details);return details;};
 // Keep the normal path short. Detailed geometry/settings remain reachable.
 fold('studioMarkSettings','Position und Text manuell bearbeiten',el=>el.tagName==='SUMMARY'||['centerAutoMarks','automaticMarkSettings','applyAllMarks'].includes(el.id));
 const defaults=root.createElement('p');defaults.className='hint';defaults.textContent='1, 2, 3 … · mittig · gleiche Schriftgröße · 0,4 mm tief';$('studioMarkSettings').querySelector('summary').after(defaults);
 fold('studioConnectorSettings','Stiftmaße und weitere Einstellungen',el=>el.tagName==='SUMMARY'||['planDowels','removeDowels','connectorInfo','connectorIssues','dowelFitInfo'].includes(el.id));
 const explanation=root.createElement('p');explanation.className='hint';explanation.textContent='DIN 6325 · 3 × 10 mm. Bohrungen Ø 3,3 mm, je 7 mm tief. Zuerst Drucklage und Nummern festlegen.';$('studioConnectorSettings').querySelector('summary').after(explanation);
 const required=root.createElement('label');required.className='check';required.innerHTML='<input id="connectorsRequired" type="checkbox" checked> Teile mit Passstiften verbinden';explanation.after(required);
 const repair=root.createElement('button');repair.id='repairDowels';repair.className='primary wide';repair.textContent='Offene Verbindungen neu prüfen';repair.hidden=true;$('removeDowels').before(repair);
 const cutHint=$('autoCutHint'),hintDetails=root.createElement('details');hintDetails.className='workflow-more';hintDetails.innerHTML='<summary>Wie die Aufteilung berechnet wird</summary>';cutHint.before(hintDetails);hintDetails.append(cutHint);
 const printSettings=$('studioPrintSettings');for(const child of [...printSettings.children])if(child.matches('p.hint')&&!['orientationInfo','stabilityLegend'].includes(child.id))child.dataset.workflowAdvanced='';
 $('studioAdvancedCuts').dataset.workflowAdvanced='';
 // Old numbered section headers conflict with the guided step numbers.
 for(const span of left.querySelectorAll('.sectiontitle > span'))span.remove();
 return {navigation:nav,summary,actions};
}
