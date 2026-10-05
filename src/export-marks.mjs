// A planned label is a viewer overlay. Never let a print export mistake it for
// material: all pending engravings must succeed before a caller commits/export.
export async function prepareMarksForExport(parts,engrave){
 if(!Array.isArray(parts)||!parts.length||typeof engrave!=='function')throw Error('Für den Druckexport werden Teile benötigt.');
 const unresolved=parts.filter(p=>!p.mark&&p.plannedMarkIssue&&!p.plannedMark);
 if(unresolved.length)throw Error(`Druckexport angehalten: Für Teil ${unresolved.map(p=>p.id).join(', ')} fehlt noch eine sichere Gravurstelle. Automatische IDs mittig platzieren oder eine Stelle wählen.`);
 const pending=parts.map((part,index)=>({part,index})).filter(({part})=>part.plannedMark&&!part.mark);
 if(!pending.length)return {parts,engraved:0};
 const result=await engrave(parts);
 if(!Array.isArray(result?.parts)||result.parts.length!==parts.length)throw Error('Gravurberechnung lieferte kein vollständiges Druckergebnis. Kein Export erstellt.');
 const failed=pending.filter(({part,index})=>{const fresh=result.parts[index];return !fresh?.mark||fresh.plannedMark||fresh.mark.text!==part.plannedMark.text||fresh.mark.depth!==part.plannedMark.depth;});
 if(result.failed?.length||failed.length){const ids=[...new Set([...(result.failed||[]).map(p=>p.id),...failed.map(({part})=>part.id)])];throw Error(`Druckexport angehalten: Gravur für Teil ${ids.join(', ')} konnte nicht erzeugt werden. ${(result.failed||[]).map(p=>p.reason).filter(Boolean).slice(0,2).join(' ')} Die vorgemerkten Stellen bleiben erhalten.`);}
 return {parts:result.parts,engraved:pending.length};
}
