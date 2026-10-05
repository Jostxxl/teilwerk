/** Bind a worker result to the whole project state it was requested from. */
export function capturePrintPreparationState(state){
 const {parts,active,connectorBaseParts,connectorPlan,permissionSources,printer}=state;
 if(!Array.isArray(parts)||!Number.isInteger(active)||!parts[active])throw Error('Kein gültiges Druckteil gewählt.');
 return {parts,active,part:parts[active],connectorBaseParts,base:connectorBaseParts?.[active],connectorPlan,permissionSources,printer:JSON.stringify(printer)};
}
export function requirePrintPreparationState(snapshot,state){
 if(state.parts!==snapshot.parts||state.active!==snapshot.active||state.parts[state.active]!==snapshot.part||state.connectorBaseParts!==snapshot.connectorBaseParts||state.connectorBaseParts?.[state.active]!==snapshot.base||state.connectorPlan!==snapshot.connectorPlan||state.permissionSources!==snapshot.permissionSources||JSON.stringify(state.printer)!==snapshot.printer)
  throw Error('Das Projekt hat sich während der Berechnung geändert. Ergebnis verworfen; bitte erneut versuchen.');
}
