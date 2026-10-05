/** Prinjekt application frame. Existing model controls keep their identity and handlers. */
export function mountApplicationShell({root=document,getState,onDemo,onProject}={}){
 const $=id=>root.getElementById(id),body=root.body,header=root.querySelector('body > header'),main=root.querySelector('body > main');
 body.classList.add('teilwerk-app');header.classList.add('app-header');main.classList.add('app-workspace');
 const make=(tag,className,text)=>{const node=root.createElement(tag);node.className=className;if(text)node.textContent=text;return node;};
 const draftDetails=make('details','app-draft-details');draftDetails.append(make('summary','','Details zum Vorschlag'),$('draftInfo'));$('draftBar').append(draftDetails);$('draftBar').querySelector('strong').textContent='Offener Schnittvorschlag';
 const left=root.querySelector('.left'),scroll=make('div','app-settings-scroll');scroll.id='appSettingsScroll';
 for(const child of [...left.children])if(child.id!=='workflowActions')scroll.append(child);
 left.prepend(scroll);
 const brand=root.querySelector('.brand');brand.href='https://prinjekt.de/';brand.target='_blank';brand.rel='noopener';brand.setAttribute('aria-label','Prinjekt-Website öffnen');
 const steps=make('div','app-steps');header.after(steps);steps.append($('workflowNav'));
 const project=make('details','app-project-menu'),projectLabel=make('summary','','Projekt'),projectItems=make('div','app-menu-items');project.append(projectLabel,projectItems);
 for(const id of ['studioImport','loadProject','saveProject','undo']){const control=$(id);projectItems.append(control);control.addEventListener('click',()=>{if(!control.disabled)project.open=false;});}
 root.querySelector('.header-end').prepend(project);root.querySelector('.projectbar').remove();
 const website=make('a','app-website-link','Zur Website');website.href='https://prinjekt.de/';website.target='_blank';website.rel='noopener';root.querySelector('.header-end').prepend(website);
 const viewMenu=make('details','app-view-menu'),viewLabel=make('summary','','Ansicht');viewMenu.append(viewLabel,root.querySelector('.view-tools'));
 const viewTitle=root.querySelector('.view-title');viewTitle.append(viewMenu);
 const partsToggle=make('button','app-parts-toggle','Teile');partsToggle.type='button';partsToggle.setAttribute('aria-controls','appParts');partsToggle.setAttribute('aria-expanded','true');partsToggle.title='Teileliste ein- oder ausblenden';root.querySelector('.right').id='appParts';viewTitle.append(partsToggle);
 partsToggle.addEventListener('click',()=>{const collapsed=body.classList.toggle('app-parts-collapsed');partsToggle.setAttribute('aria-expanded',String(!collapsed));});
 // One global status/progress area also works before the first model is loaded.
 const footer=root.querySelector('.bottomline');footer.classList.add('app-status');body.append(footer,$('busy'));
 const drop=$('drop'),emptyActions=make('div','app-empty-actions');drop.after(emptyActions);
 $('empty').querySelector('h2').textContent='Noch kein Modell';$('empty').querySelector('p').textContent='Öffne links eine STL, OBJ oder Projektdatei.';
 drop.querySelector('.upload').innerHTML='<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 22V5m-6 6 6-6 6 6M6 21v6h20v-6"/></svg>';
 const projectStart=make('button','wide','Projekt öffnen'),demoStart=make('button','wide','Beispiel ausprobieren');projectStart.type=demoStart.type='button';projectStart.addEventListener('click',()=>{if(!getState().busy)onProject();});demoStart.addEventListener('click',()=>{if(!getState().busy)onDemo();});emptyActions.append(projectStart,demoStart);
 const closeMenus=event=>{for(const menu of [project,viewMenu])if(!menu.contains(event.target))menu.open=false;};root.addEventListener('click',closeMenus);
 root.addEventListener('keydown',event=>{if(event.key!=='Escape')return;for(const menu of [project,viewMenu])if(menu.open){menu.open=false;menu.querySelector('summary').focus();}});
 function sync(){
  const state=getState(),isEmpty=!state.hasModel;
  root.querySelector('.right > .sectiontitle h2').textContent=state.preview?'Vorschauteile':'Deine Teile';
  root.querySelector('.right > p.hint').textContent=isEmpty?'Hier erscheinen deine Druckteile.':state.preview?'Abstände mit der Explosionsansicht prüfen. Die Teileliste folgt nach dem Übernehmen.':'Teil auswählen, Drucklage und Kennzeichnung prüfen.';
  $('parts').hidden=!!state.preview;$('partCount').hidden=!!state.preview&&!state.previewCount;
  if(state.previewCount)$('partCount').textContent=state.previewCount;
  body.classList.toggle('app-is-empty',isEmpty);emptyActions.hidden=!isEmpty;
  drop.querySelector('strong').textContent=isEmpty?'Modell importieren':'Modell ersetzen';
  drop.querySelector('.upload').setAttribute('aria-hidden','true');drop.setAttribute('aria-label',isEmpty?'STL oder OBJ öffnen oder hier ablegen':'Anderes STL- oder OBJ-Modell öffnen');
  projectStart.disabled=demoStart.disabled=state.busy;
 }
 sync();return Object.freeze({sync});
}
