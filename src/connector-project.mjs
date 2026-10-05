// Connector plans bind geometry and assembly order. Cosmetic edits and manual
// supports may change independently; removing/replaying a plan keeps those edits.
// Hardware length is independent of blind-hole depth: a centered purchased pin
// engages half its length in each part and leaves the requested axial clearance.
// Missing pinSource is the historical printable-pin mode, with unchanged bytes.
export function purchasedPinSettings(value={}){
 if(value.pinSource===undefined||value.pinSource==='printed')return null;
 if(value.pinSource!=='purchased')throw Error('Unbekannte Passstiftquelle.');
 const {pinLength=10,pinEndClearance=2}=value;
 const socketDepth=pinLength/2+pinEndClearance;
 if(![pinLength,pinEndClearance,socketDepth].every(Number.isFinite)||pinLength<2||pinLength>38||pinEndClearance<0||pinEndClearance>10||socketDepth<1||socketDepth>20||(value.socketDepth!==undefined&&value.socketDepth!==socketDepth))throw Error('Kaufstift: Länge 2–38 mm, Endluft 0–10 mm und Bohrtiefe = halbe Stiftlänge + Endluft (1–20 mm).');
 return {pinSource:'purchased',pinLength,pinEndClearance,socketDepth};
}

export function connectorSettings(value={}){
 const hardware=purchasedPinSettings(value);
 const {pinDiameter=3,diametralClearance=hardware ? .3 : .2,socketDepth=3,minWall=1}={...value,...hardware};
 if(![pinDiameter,diametralClearance,socketDepth,minWall].every(Number.isFinite)||pinDiameter<1||pinDiameter>20||diametralClearance<0||diametralClearance>2||socketDepth<1||socketDepth>20||minWall<1||minWall>10)throw Error('Passstiftmaße prüfen: Durchmesser 1–20 mm, diametrales Spiel 0–2 mm, Tiefe 1–20 mm und mindestens 1 mm Materialreserve.');
 return {pinDiameter,diametralClearance,socketDepth,minWall,...(hardware||{}),...(value.pinSource==='printed'?{pinSource:'printed'}:{})};
}

export function connectorPartDecorations(baseParts,currentParts){
 if(!Array.isArray(baseParts)||!Array.isArray(currentParts)||baseParts.length!==currentParts.length)throw Error('Passstiftplan und Basisteile passen nicht zusammen.');
 const ids=new Set();return baseParts.map((base,i)=>{const part=currentParts[i];if(!base?.id||String(base.id)!==String(part?.id)||ids.has(String(base.id)))throw Error('Teilnummern oder Reihenfolge des Passstiftplans wurden verändert.');ids.add(String(base.id));return {...base,color:/^#[0-9a-f]{6}$/i.test(part.color||'')?part.color:base.color,name:String(part.name||base.name||base.id).slice(0,100),note:String(part.note||'').slice(0,2000),supports:part.supports?.kind==='manual'?part.supports:undefined,supportNotice:undefined};});
}

export function savedConnectorPlan(result,settings){
 if(!result||result.stopped||!Array.isArray(result.parts)||!Array.isArray(result.connections)||!Array.isArray(result.pins)||!Array.isArray(result.order))throw Error('Kein vollständiger geprüfter Passstift-Teilplan vorhanden.');
 const actual=connectorSettings(result.settings||settings),saved=connectorSettings(settings);
 if((actual.pinSource==='purchased'||saved.pinSource==='purchased')&&JSON.stringify(actual)!==JSON.stringify(saved))throw Error('Gespeicherte Kaufstiftmaße passen nicht zum berechneten Plan.');
 const order=result.order;if(order.length!==result.parts.length||new Set(order).size!==order.length||order.some(i=>!Number.isInteger(i)||i<0||i>=order.length))throw Error('Ungültige Montagereihenfolge des Passstiftplans.');
 return {version:1,settings:connectorSettings(settings),connections:result.connections,pins:result.pins,order:[...order],unresolved:result.unresolved||[],completed:!!result.completed};
}

export function connectorPinFilename(pin){
 const id=String(pin?.id||'');if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id)||!pin.auxiliary)throw Error('Ungültige Kennung eines separaten Passstifts.');return `Passstifte/${id}.stl`;
}

export const connectorGeometryOperations=new Set(['smart','interiorSelect','autoMarkLocations','uniformMarkSize','engravePlanned','mark','autoPlanPreview','autoContours','contourPlan','suggest','seamCut','closeCandidates','adoptDrawn','drawPreview','drawCut','patchPreview','patchCut','loopPreview','seamsAuto','fit','mergeFit','cut','orient','printOrient','flat','largestFace','scale','auto']);
export const connectorLockedControls=['orient','flat','largestFace','scale','scaleFactor','mergeFit','fit','auto','autoOrient','autoContourAll','suggestCuts','previewContourPlan','preview','cut','calculateDraft','applyResult','applyEdges','autoEdges','cutEdge','findEdges','startDrawing','adoptContour','previewDrawing','pickInterior','clearInterior','pickMark','applyMark','applyAllMarks','centerAutoMarks','orderUp','orderDown','orderHeight'];
