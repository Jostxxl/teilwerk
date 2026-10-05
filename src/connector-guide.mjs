import {partNumber} from './part-ids.mjs';

const fail=message=>{throw Error(`Passstift-Anleitung: ${message}`);};
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const positive=(value,name)=>finite(value)&&value>0?value:fail(`${name} muss positiv und endlich sein.`);
const nonnegative=(value,name)=>finite(value)&&value>=0?value:fail(`${name} muss endlich und mindestens null sein.`);
const text=(value,name)=>typeof value==='string'&&value.trim()?value:fail(`${name} fehlt.`);
const vector=(value,name)=>Array.isArray(value)&&value.length===3&&value.every(finite)?[...value]:fail(`${name} benötigt drei endliche Montagekoordinaten.`);
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
const scale=(a,k)=>a.map(v=>v*k===0?0:v*k),add=(a,b)=>a.map((v,i)=>v+b[i]),subtract=(a,b)=>a.map((v,i)=>v-b[i]);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const unit=(value,name)=>{const v=vector(value,name),length=Math.hypot(...v);if(Math.abs(length-1)>1e-5)fail(`${name} muss ein Einheitsvektor sein.`);return scale(v,1/length);};
const normalized=v=>scale(v,1/Math.hypot(...v));
const number=value=>{const id=partNumber(value);if(!id||String(value)!==id)fail('Teilnummern müssen eindeutige positive Zahlen ohne Umnummerierung sein.');return id;};
const compareIds=(a,b)=>Number(a)-Number(b);
function plainCopy(value,depth=0){
 if(depth>16)fail('Prüfmetadaten sind zu tief verschachtelt.');
 if(value===null||typeof value==='boolean'||typeof value==='string'||finite(value))return value;
 if(Array.isArray(value))return value.map(v=>plainCopy(v,depth+1));
 if(value&&Object.getPrototypeOf(value)===Object.prototype)return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,plainCopy(v,depth+1)]));
 fail('Prüfmetadaten müssen endliche, speicherbare Werte enthalten.');
}
const dimension=value=>Number(value.toFixed(4)).toLocaleString('de-DE');
function checkedProof(proof,direction,approachDistance){
 if(!proof||!Array.isArray(proof.obstacleIds)||proof.obstacleIds.some(id=>typeof id!=='string')||new Set(proof.obstacleIds).size!==proof.obstacleIds.length||proof.status!=='verified'||proof.verified!==true||proof.diagnostics?.continuous!==true||proof.diagnostics?.completed!==true)fail('Ein Einsteckweg wird ohne vollständigen geometrischen Nachweis als geprüft bezeichnet.');
 // Native insertion proofs sweep the object OUT from its final assembly pose.
 // The pictured insertion traverses exactly that path in the opposite direction.
 const motion=vector(proof.motion,'Geprüfter Einsteckweg'),length=Math.hypot(...motion);if(length<approachDistance-1e-5||dot(scale(motion,1/length),direction)>-1+1e-5)fail('Wegnachweis und gezeigter Einschubpfeil stimmen nicht überein.');
}

function contactViews(connection){
 const {positions,normal,pin,hole,insertion}=connection;
 const center=positions[0].map((v,i)=>v*.5+positions[1][i]*.5),baseline=subtract(positions[1],positions[0]);
 const right=normalized(subtract(baseline,scale(normal,dot(baseline,normal)))),up=normalized(cross(normal,right));
 const span=Math.hypot(...baseline)+hole.diameter*4,depth=Math.max(pin.length,insertion.approachDistance);
 const points=positions.map((position,i)=>({label:String(i+1),position:[...position],parentHole:{center:[...position],bottom:add(position,scale(normal,-hole.depthParent)),diameter:hole.diameter},childHole:{center:[...position],bottom:add(position,scale(normal,hole.depthChild)),diameter:hole.diameter},pinEnds:[add(position,scale(normal,-(hole.depthParent-pin.endClearance))),add(position,scale(normal,pin.length-(hole.depthParent-pin.endClearance)))]}));
 return {
  frame:'assembly',center,span,depth,points,
  parent:{partId:connection.parentId,partnerId:connection.childId,target:[...center],cameraDirection:[...normal],up:[...up],right:[...right]},
  child:{partId:connection.childId,partnerId:connection.parentId,target:[...center],cameraDirection:scale(normal,-1),up:[...up],right:scale(right,-1)},
  overview:{partIds:[connection.parentId,connection.childId],target:[...center],cameraDirection:normalized(add(scale(normal,.65),scale(up,.76))),up:[...up]},
  // Motion of the CHILD, not a camera direction. The final interface is the
  // arrow head; the tail is the child's position before approaching the parent.
  insertionArrow:{movingPartId:connection.childId,stationaryPartId:connection.parentId,from:add(center,scale(insertion.direction,-insertion.approachDistance)),to:[...center],direction:[...insertion.direction],length:insertion.approachDistance,dashed:!insertion.checked,label:`Teil ${connection.childId} in Richtung Teil ${connection.parentId} einsetzen`},
  pinArrows:positions.map(position=>({from:add(position,scale(normal,pin.length)),to:[...position],direction:scale(normal,-1),dashed:true,checked:false,label:`Vorgesehene Stiftrichtung in Teil ${connection.parentId}`})),
 };
}

function validatePinInsertion(value,connection){
 if(value===undefined)return null;
 if(!value||typeof value.checked!=='boolean'||value.scope!=='assembled-parts')fail(`Ungültiger Stift-Einstecknachweis bei ${connection.id}.`);
 const direction=unit(value.direction,'Stift-Einsteckrichtung'),approachDistance=positive(value.approachDistance,'Stift-Einsteckweg');
 if(dot(direction,connection.normal)>-1+1e-7)fail('Stiftrichtung muss in das Elternteil zeigen.');
 if(!Array.isArray(value.checks)||value.checks.length!==2)fail('Beide losen Stifte benötigen getrennte Wegprüfungen.');
 const ids=new Set(),checks=value.checks.map(check=>{const id=text(check.id,'Stift-ID');if(ids.has(id))fail('Doppelte Stift-ID im Wegnachweis.');ids.add(id);const proof=plainCopy(check.proof);if(!proof||!Array.isArray(proof.obstacleIds))fail('Geprüfte Stifthindernisse fehlen.');if(value.checked)checkedProof(proof,direction,approachDistance);return {id,proof};});
 return {checked:value.checked,scope:value.scope,direction,approachDistance,checks};
}

function validateConnection(input,parts,seen){
 if(!input||typeof input!=='object'||Array.isArray(input))fail('Ungültige Verbindung.');
 const id=text(input.id,'Verbindungs-ID');if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id)||seen.has(id))fail('Verbindungs-IDs müssen eindeutig und als Verweise verwendbar sein.');seen.add(id);
 const parentId=number(input.parentId),childId=number(input.childId);if(parentId===childId||!parts.has(parentId)||!parts.has(childId))fail(`Verbindung ${id} benötigt zwei vorhandene, verschiedene Teile.`);
 const status=input.status;if(!['planned','computed','unresolved'].includes(status))fail(`Verbindung ${id} hat keinen gültigen Geometriestatus.`);
 const base={id,parentId,childId,status,parentIndex:parts.get(parentId).index,childIndex:parts.get(childId).index,anchor:`connector-${id}`,reason:input.reason===undefined?null:text(input.reason,'Offener Verbindungsgrund'),validation:input.validation===undefined?null:plainCopy(input.validation)};
 if(status==='unresolved'){
  if(!base.reason)fail(`Für die offene Verbindung ${id} fehlt der Grund.`);
  return {...base,positions:[],normal:null,pin:null,hole:null,insertion:null,views:null};
 }
 if(!Array.isArray(input.positions)||input.positions.length!==2)fail(`Verbindung ${id} benötigt genau zwei Stiftstellen.`);
 const positions=input.positions.map(p=>vector(p,'Stiftstelle')),normal=unit(input.normal,'Kontaktnormale'),delta=subtract(positions[1],positions[0]),separation=Math.hypot(...delta);
 if(separation<1e-6||!finite(separation)||Math.abs(dot(delta,normal))>.05)fail(`Die Stiftstellen von ${id} müssen getrennt in derselben Kontaktfläche liegen.`);
 const pin={diameter:positive(input.pin?.diameter,'Stiftdurchmesser'),length:positive(input.pin?.length,'Stiftlänge'),quantity:input.pin?.quantity??2,endClearance:nonnegative(input.pin?.endClearance??0,'Stirnspiel'),source:input.pin?.source??'printed'};
 if(!['printed','purchased'].includes(pin.source))fail('Unbekannte Stiftart.');
 if(input.pin.standard!==undefined)pin.standard=text(input.pin.standard,'Stiftnorm');
 const hole={diameter:positive(input.hole?.diameter,'Bohrungsdurchmesser'),depthParent:positive(input.hole?.depthParent,'Bohrtiefe am Elternteil'),depthChild:positive(input.hole?.depthChild,'Bohrtiefe am neuen Teil'),wallMargin:nonnegative(input.hole?.wallMargin??0,'Wandabstand')};
 if(pin.quantity!==2||hole.diameter<pin.diameter||hole.diameter>=separation||!finite(hole.depthParent+hole.depthChild)||pin.length+2*pin.endClearance>hole.depthParent+hole.depthChild+1e-7||hole.depthParent<=pin.endClearance||hole.depthChild<=pin.endClearance||pin.length<=hole.depthParent-pin.endClearance)fail(`Unvereinbare Stift- oder Bohrungsmaße bei ${id}.`);
 const raw=input.insertion;if(!raw||typeof raw.checked!=='boolean'||!['pair','assembled-parts'].includes(raw.scope))fail(`Für ${id} fehlt ein eindeutiger Status der Einsteckprüfung.`);
 const direction=unit(raw.direction,'Einsteckrichtung');if(dot(direction,normal)>-1+1e-7)fail(`Die Einsteckrichtung von ${id} muss vom neuen Teil zum Elternteil zeigen.`);
 const approachDistance=positive(raw.approachDistance,'Einsteckweg'),method=raw.method===undefined?null:text(raw.method,'Prüfmethode');if(approachDistance<pin.length-hole.depthParent+pin.endClearance)fail(`Der Einsteckweg von ${id} beginnt bereits innerhalb der Stiftaufnahme.`);
 if(!Array.isArray(raw.obstacleIds))fail(`Die geprüften Hindernisse von ${id} fehlen.`);
 const obstacleIds=raw.obstacleIds.map(number);if(new Set(obstacleIds).size!==obstacleIds.length||obstacleIds.some(p=>!parts.has(p)||p===childId))fail(`Ungültige geprüfte Hindernisse bei ${id}.`);
 const collisions=raw.collisions===undefined?[]:plainCopy(raw.collisions);if(!Array.isArray(collisions))fail('Kollisionen müssen als Liste gespeichert werden.');
 if(raw.checked&&(!method||!obstacleIds.includes(parentId)||collisions.length))fail(`Die Einsteckprüfung von ${id} ist widersprüchlich oder unvollständig.`);
 if(status==='computed'&&base.validation?.positiveComponents!==undefined&&(!Array.isArray(base.validation.positiveComponents)||base.validation.positiveComponents.length!==2||base.validation.positiveComponents.some(n=>n!==1)))fail(`Die berechnete Verbindung ${id} besitzt keine zwei zusammenhängenden Dachteile.`);
 const insertion={direction,approachDistance,checked:raw.checked,scope:raw.scope,method,obstacleIds,collisions,...(raw.proof?{proof:plainCopy(raw.proof)}:{})};if(insertion.checked&&insertion.proof)checkedProof(insertion.proof,direction,approachDistance);
 const result={...base,positions,normal,pin,hole,insertion};result.pinInsertion=validatePinInsertion(input.pinInsertion,result);return {...result,views:contactViews(result)};
}

/** Pure guide data in immutable assembly coordinates. This validates metadata
 * consistency; it does not perform or invent a geometric/collision proof.
 * Computed sockets, planned sockets and unresolved contacts remain distinct.
 * Each new roof part has at most one parent; pins never become roof part IDs. */
export function buildConnectorGuide(parts,connections,{order,pins,unresolved=[]}={}){
 if(!Array.isArray(parts)||!parts.length||!Array.isArray(connections))fail('Teile und Verbindungen werden als Listen benötigt.');
 const partMap=new Map();parts.forEach((part,index)=>{const id=number(part?.id);if(partMap.has(id))fail('Doppelte Teilnummer.');partMap.set(id,{id,index,color:/^#[0-9a-f]{6}$/i.test(part.color||'')?part.color:null,anchor:`part-${id}`});});
 const seen=new Set(),contacts=connections.map(c=>validateConnection(c,partMap,seen)),parents=new Map(),children=new Map([...partMap.keys()].map(id=>[id,[]]));
 for(const contact of contacts){if(parents.has(contact.childId))fail(`Teil ${contact.childId} besitzt mehrere Elternverbindungen; verschiedene Einsteckachsen dürfen nicht kombiniert werden.`);parents.set(contact.childId,contact);children.get(contact.parentId).push(contact);}
 for(const links of children.values())links.sort((a,b)=>compareIds(a.childId,b.childId));
 const roots=[...partMap.keys()].filter(id=>!parents.has(id)).sort(compareIds),steps=[],components=[],visited=new Set(),fallback=[],rootFor=new Map();
 for(const root of roots){const queue=[root];for(let i=0;i<queue.length;i++){const id=queue[i];if(visited.has(id))fail('Die Verbindungen bilden keinen Montagebaum.');visited.add(id);fallback.push(partMap.get(id).index);rootFor.set(id,root);queue.push(...children.get(id).map(c=>c.childId));}}
 if(visited.size!==parts.length)fail('Die Verbindungen enthalten einen Kreis und erlauben keine Baum-Montagefolge.');
 const sequence=order===undefined?fallback:order;
 if(!Array.isArray(sequence)||sequence.length!==parts.length||new Set(sequence).size!==parts.length||sequence.some(i=>!Number.isInteger(i)||i<0||i>=parts.length))fail('Die geprüfte Montagereihenfolge muss jeden Teilindex genau einmal enthalten.');
 const built=[],builtPins=[],componentByRoot=new Map();
 for(const index of sequence){
   const id=number(parts[index].id),root=rootFor.get(id),connection=parents.get(id)||null,part=partMap.get(id),notes=[];
   if(connection&&!built.includes(connection.parentId))fail(`Teil ${id} steht vor seinem Elternteil ${connection.parentId} in der Montagereihenfolge.`);
   let component=componentByRoot.get(root);if(!component){component={index:components.length,rootId:root,partIds:[]};componentByRoot.set(root,component);components.push(component);}component.partIds.push(id);
   let insertionVerification='not-applicable',missingObstacleIds=[];
   if(connection){
    if(connection.status==='unresolved'){notes.push(connection.reason);insertionVerification='unresolved';}
    else{
     if(connection.status==='planned')notes.push('Stiftstellen sind geplant; die Bohrungen sind noch nicht in der Geometrie enthalten.');
     if(!connection.insertion.checked){notes.push('Der Einsteckweg ist noch nicht geometrisch geprüft. Der Pfeil zeigt nur die vorgesehene Richtung.');insertionVerification='unchecked';}
     else if(connection.insertion.scope==='pair'){notes.push(`Der Einsteckweg wurde nur für die Kontaktprüfung mit Teil ${connection.parentId} geprüft. Weitere bereits eingesetzte Teile sind damit nicht freigegeben.`);insertionVerification='pair';}
     else{missingObstacleIds=built.filter(p=>!connection.insertion.obstacleIds.includes(p));insertionVerification=missingObstacleIds.length?'incomplete-for-order':'assembled-parts';if(missingObstacleIds.length)notes.push(`Für diese Reihenfolge fehlen im Einstecknachweis die bereits eingesetzten Teile ${missingObstacleIds.join(', ')}.`);}
    }
   }
   let pinInsertionVerification='not-applicable',missingPinObstacleIds=[];
   if(connection&&connection.status!=='unresolved'){
    const pinProof=connection.pinInsertion;
    if(!pinProof?.checked){pinInsertionVerification='unchecked';notes.push('Die beiden losen Stifte besitzen noch keinen vollständigen Einstecknachweis. Stiftpfeile zeigen nur die vorgesehene Richtung.');}
    else{for(const c of pinProof.checks)checkedProof(c.proof,pinProof.direction,pinProof.approachDistance);missingPinObstacleIds=[...built,...builtPins].filter(id=>pinProof.checks.some(c=>!c.proof.obstacleIds.includes(id)));for(const c of pinProof.checks)for(const other of pinProof.checks)if(c.id!==other.id&&!c.proof.obstacleIds.includes(other.id)&&!missingPinObstacleIds.includes(other.id))missingPinObstacleIds.push(other.id);pinInsertionVerification=missingPinObstacleIds.length?'incomplete-for-order':'assembled-parts';if(missingPinObstacleIds.length)notes.push(`Im Stift-Einstecknachweis fehlen die zuvor eingesetzten Teile oder Stifte ${missingPinObstacleIds.join(', ')}.`);}
   }
   const currentPins=connection?.pinInsertion?.checks.map(c=>c.id)||[],childProof=connection?.insertion?.proof,missingChildProofObstacleIds=connection?.status==='computed'?[...built,...builtPins,...currentPins].filter(id=>!childProof?.obstacleIds.includes(id)):[];
   if(connection?.status==='computed'&&!childProof)notes.push('Der gespeicherte Nachweis des neuen Teils enthält keine vollständige Hindernisliste einschließlich Passstiften.');else if(missingChildProofObstacleIds.length)notes.push(`Im vollständigen Einstecknachweis des neuen Teils fehlen ${missingChildProofObstacleIds.join(', ')}.`);
   const step={step:steps.length+1,index:part.index,partId:id,partAnchor:part.anchor,anchor:`connector-step-${steps.length+1}`,component:component.index,rootId:root,isStart:!connection,parentId:connection?.parentId??null,parentAnchor:connection?`part-${connection.parentId}`:null,parentIndex:connection?.parentIndex??null,parentStep:connection?steps.find(s=>s.partId===connection.parentId).step:null,contactIds:connection?[connection.id]:[],contacts:connection?[connection.parentIndex]:[],connection,geometryStatus:connection?.status??'base',insertionVerification,missingObstacleIds,pinInsertionVerification,missingPinObstacleIds,missingChildProofObstacleIds,notes,assemblyPathVerified:!!connection&&connection.status==='computed'&&insertionVerification==='assembled-parts',completeInsertionVerified:!!connection&&connection.status==='computed'&&insertionVerification==='assembled-parts'&&pinInsertionVerification==='assembled-parts'&&!!childProof&&!missingChildProofObstacleIds.length,views:connection?.views??null};
   if(step.views)step.views.insertionArrow.dashed=connection.status!=='computed'||!['pair','assembled-parts'].includes(insertionVerification);
   if(step.views)for(const arrow of step.views.pinArrows){arrow.checked=connection.status==='computed'&&pinInsertionVerification==='assembled-parts';arrow.dashed=!arrow.checked;}
   step.instruction=!connection?`Teil ${id} in Montagelage bereitlegen und sichern.`:connection.status==='unresolved'?`Verbindung von Teil ${id} zu Teil ${connection.parentId} ist noch offen.`:`Zwei Passstifte zuerst in Teil ${connection.parentId} einsetzen. Teil ${id} entlang des ${step.views.insertionArrow.dashed?'gestrichelten, noch ungeprüften':'gezeigten'} Pfeils an Teil ${connection.parentId} heranführen.`;
   if(connection?.pin?.source==='purchased'&&connection.status==='computed')step.instruction=`Zwei gekaufte Zylinderstifte Ø ${dimension(connection.pin.diameter)} × ${dimension(connection.pin.length)} mm zuerst ${dimension(connection.hole.depthParent-connection.pin.endClearance)} mm in Teil ${connection.parentId} einschieben. ${dimension(connection.pin.endClearance)} mm Luft bis zum Bohrgrund lassen. Teil ${id} entlang des ${step.views.insertionArrow.dashed?'gestrichelten, noch ungeprüften':'gezeigten'} Pfeils aufsetzen.`;
   if(connection?.status==='planned')step.instruction=`Geplant: zwei Passstifte zwischen Teil ${connection.parentId} und Teil ${id}. Bohrungen vor der Montage erst berechnen.`;
   steps.push(step);built.push(id);if(connection?.status==='computed')builtPins.push(...currentPins);
 }
 const bom=new Map();for(const c of contacts){if(!c.pin)continue;const key=JSON.stringify([c.pin.diameter,c.pin.length,c.pin.endClearance,c.pin.source,c.pin.standard]);let item=bom.get(key);if(!item){item={kind:'loose-pin',source:c.pin.source,standard:c.pin.standard,key,label:`${c.pin.source==='purchased'?'Kaufstift':'Passstift'} Ø ${dimension(c.pin.diameter)} × ${dimension(c.pin.length)} mm${c.pin.standard?' · '+c.pin.standard:''}`,diameter:c.pin.diameter,length:c.pin.length,endClearance:c.pin.endClearance,computedQuantity:0,plannedQuantity:0,connectionIds:[],roofPartIds:[]};bom.set(key,item);}item[c.status==='computed'?'computedQuantity':'plannedQuantity']+=2;item.connectionIds.push(c.id);item.roofPartIds.push(c.parentId,c.childId);}
 const billOfMaterials=[...bom.values()].sort((a,b)=>a.diameter-b.diameter||a.length-b.length||a.endClearance-b.endClearance).map((item,i)=>({...item,id:`pin-type-${i+1}`,quantity:item.computedQuantity+item.plannedQuantity,roofPartIds:[...new Set(item.roofPartIds)].sort(compareIds)}));
 let pinFiles=[],purchasedPins=[];if(pins!==undefined){
  if(!Array.isArray(pins))fail('Die losen Stifte müssen als Liste vorliegen.');const pinIds=new Set(),records=[];
  for(const p of pins){const id=text(p?.id,'Stift-ID'),connection=contacts.find(c=>c.id===p.connectionId&&c.status==='computed'),source=p.source??'printed';
   if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id)||pinIds.has(id)||!connection||p.auxiliary!==true||source!==connection.pin.source||Math.abs(p.diameter-connection.pin.diameter)>1e-6||Math.abs(p.length-connection.pin.length)>1e-6||!finite(p.diameter)||!finite(p.length))fail('Lose Stifte stimmen nicht mit den berechneten Verbindungen überein.');
   pinIds.add(id);const record={id,connectionId:p.connectionId,diameter:p.diameter,length:p.length,source};records.push(record);
   if(source==='purchased')purchasedPins.push({...record,standard:connection.pin.standard});else pinFiles.push({...record,file:`Passstifte/${id}.stl`});
  }
  for(const c of contacts.filter(c=>c.status==='computed')){const items=records.filter(p=>p.connectionId===c.id);if(items.length!==2)fail(`Verbindung ${c.id} benötigt genau zwei separate Stiftdateien oder Kaufstift-Einträge.`);if(c.pinInsertion?.checked&&c.pinInsertion.checks.some(check=>!items.some(p=>p.id===check.id)))fail('Stifteinträge und Wegnachweise verwenden verschiedene IDs.');}
 }

 if(!Array.isArray(unresolved))fail('Offene Verbindungen müssen als Liste vorliegen.');const unresolvedItems=unresolved.map(item=>plainCopy(item));
 const summary={roofParts:parts.length,contacts:contacts.length,components:components.length,computedConnections:contacts.filter(c=>c.status==='computed').length,plannedConnections:contacts.filter(c=>c.status==='planned').length,unresolvedConnections:contacts.filter(c=>c.status==='unresolved').length,computedPins:billOfMaterials.reduce((s,p)=>s+p.computedQuantity,0),plannedPins:billOfMaterials.reduce((s,p)=>s+p.plannedQuantity,0),assemblyVerifiedConnections:steps.filter(s=>s.assemblyPathVerified).length,completeInsertionVerifiedConnections:steps.filter(s=>s.completeInsertionVerified).length};
 return {version:1,frame:'assembly',parts:[...partMap.values()],contacts,roots,components,order:steps.map(s=>s.index),steps,billOfMaterials,pinFiles,purchasedPins,unresolved:unresolvedItems,summary,notices:[...(contacts.some(c=>c.pin?.source==='purchased')?['Kaufstifte stehen in der Stückliste; sie werden nicht als Druckdateien exportiert.']:[]),...(contacts.some(c=>c.pin?.source==='printed')?['Gedruckte Passstifte sind separate Druckteile; die Nummern der Dachteile bleiben unverändert.']:[]),'Die dargestellte Einsteckrichtung ist kein Nachweis der Tragfähigkeit. Umfang und Status der geometrischen Wegprüfung stehen am jeweiligen Montageschritt.',...(components.length>1?[`${components.length} getrennte Passstift-Baugruppen beginnen jeweils mit einem eigenen Ausgangsteil.`]:[])]};
}
