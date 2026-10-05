// The dispatcher must call this BEFORE entering the legacy geometry kernel.
// A display mesh is never a replacement operand for its rational authority.
// The permitted exact save/restore branches still have to validate bindings;
// this capability guard is deliberately not a geometry validator.
const allowed=new Set(['smart','neighborColors','readProject','serializeProject','restoreExactProjectParts','exactAutoMarks','exactPrintMeshes','manualPrintPose']);
const partFields=['data','part','parts','baseParts','currentParts','connectorBaseParts','connectorPins','pins'];
const containerFields=['project','plan','connectorPlan'];
const labels={
 import:'Der bisherige Modellimport',cut:'Der bisherige Ebenenschnitt',auto:'Die bisherige Rasterteilung',autoContours:'Die bisherige automatische Teilung',contourPlan:'Die bisherige Konturteilung',
 autoPlanPreview:'Die bisherige automatische Vorschau',fit:'Die bisherige Bauraumteilung',mergeFit:'Das bisherige Zusammenfassen',
 orient:'Die bisherige Druckausrichtung',printOrient:'Die bisherige Druckausrichtung',flat:'Das Ausrichten einer gewählten Fläche',largestFace:'Das Ausrichten auf die größte Fläche',scale:'Das Skalieren',
 interiorSelect:'Das Ändern der Innenflächenfreigabe',autoMarkLocations:'Das automatische Setzen von Markierungen',uniformMarkSize:'Die automatische Schriftgrößenprüfung',mark:'Das Gravieren',engravePlanned:'Das Gravieren vorgemerkter Nummern',
 planDowels:'Das Berechnen von Passstiften',restoreDowels:'Das Wiederherstellen von Passstiften',restoreConnectorBase:'Das Wiederherstellen gebohrter Basisteile',
 printMeshes:'Der Druckexport',supportFins:'Das Erzeugen von Finnen',supportFinsAll:'Das Erzeugen von Finnen',addManualFin:'Das Setzen manueller Finnen',removeManualFin:'Das Ändern manueller Finnen',restoreManualFins:'Das Wiederherstellen manueller Finnen',
 seams:'Die bisherige Kantenerkennung',seamCut:'Der bisherige Kantenschnitt',seamsAuto:'Die bisherige Kantenteilung',suggest:'Die bisherige Vorschlagsberechnung',closeCandidates:'Der bisherige Konturverschluss',
 adoptDrawn:'Die bisherige Konturübernahme',drawPreview:'Die bisherige Zeichenkontur',drawCut:'Der bisherige gezeichnete Schnitt',patchPreview:'Die bisherige Konturvorschau',patchCut:'Der bisherige Konturschnitt',loopPreview:'Die bisherige Fugenvorschau'
};
const exact=value=>value&&typeof value==='object'&&(value.exactGeometry!==undefined||value.kind==='exactGeometry'||value.kind==='exactGeometryBinding');

/** Checks all known operand containers, including mixed native/exact projects.
 * Unknown operations fail closed when an exact operand is present. No vertex,
 * triangle, mask or authority array is traversed or changed. */
export function requireExactOperationSupport(message){
 if(!message||typeof message!=='object')throw Object.assign(Error('Ungültiger Bearbeitungsauftrag.'),{code:'EXACT_OPERATION_INPUT'});
 if(allowed.has(message.op))return;
 const found=[],seen=new Set();
 function inspect(value){
  if(!value||typeof value!=='object'||ArrayBuffer.isView(value)||seen.has(value))return;
  seen.add(value);
  if(Array.isArray(value)){for(const item of value)inspect(item);return;}
  if(exact(value)){found.push(value);return;}
  for(const key of partFields)if(Object.hasOwn(value,key))inspect(value[key]);
  for(const key of containerFields)if(Object.hasOwn(value,key))inspect(value[key]);
 }
 inspect(message);if(!found.length)return;
 const action=labels[message.op]||'Diese Bearbeitung';
 throw Object.assign(Error(`${action} unterstützt exakte Projektteile noch nicht. Die genaue Geometrie bleibt erhalten. Speichern, Farben, Notizen und Montageansicht bleiben möglich.`),{
  code:'EXACT_OPERATION_UNSUPPORTED',operation:typeof message.op==='string'?message.op:null,partIds:found.slice(0,64).map(p=>String(p.id??'').slice(0,200))
 });
}
