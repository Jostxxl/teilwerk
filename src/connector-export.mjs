// Separate purchased hardware from generated print objects at both export paths.
export function connectorExportItems(plan){
 if(!plan)return {printablePins:[],purchasedPins:[],shoppingList:[]};
 if(!Array.isArray(plan.pins)||!Array.isArray(plan.connections))throw Error('Unvollständiger Passstiftplan für den Export.');
 const printablePins=[],purchasedPins=[],seen=new Set(),grouped=new Map();
 for(const pin of plan.pins){
  const connection=plan.connections.find(c=>c.id===pin.connectionId&&c.status==='computed'),source=pin.source??'printed';
  if(!connection||!['printed','purchased'].includes(source)||source!==(connection.pin?.source??'printed')||seen.has(pin.id)||!pin.auxiliary||![pin.diameter,pin.length].every(v=>Number.isFinite(v)&&v>0)||pin.diameter!==connection.pin.diameter||pin.length!==connection.pin.length)throw Error('Stift und berechnete Verbindung passen nicht zusammen.');
  seen.add(pin.id);
  if(source==='printed'){if(!pin.vertices?.length||!pin.triangles?.length)throw Error('Druckgeometrie eines Passstifts fehlt.');printablePins.push(pin);continue;}
  const item={id:pin.id,connectionId:pin.connectionId,source,diameter:pin.diameter,length:pin.length,standard:connection.pin.standard};purchasedPins.push(item);
  const key=JSON.stringify([item.diameter,item.length,item.standard]);let group=grouped.get(key);if(!group){group={diameter:item.diameter,length:item.length,standard:item.standard,quantity:0,connectionIds:[]};grouped.set(key,group);}group.quantity++;if(!group.connectionIds.includes(item.connectionId))group.connectionIds.push(item.connectionId);
 }
 for(const c of plan.connections.filter(c=>c.status==='computed'))if(plan.pins.filter(p=>p.connectionId===c.id).length!==2)throw Error('Jede berechnete Verbindung benötigt zwei Stifte.');
 return {printablePins,purchasedPins,shoppingList:[...grouped.values()]};
}

export function connectorShoppingText(items){
 const dim=v=>v.toLocaleString('de-DE',{maximumFractionDigits:4});
 return ['TEILWERK - Kaufteile','',...items.map(p=>`${p.quantity} Zylinderstifte${p.standard?' '+p.standard:''}, Ø ${dim(p.diameter)} × ${dim(p.length)} mm`),'','Kaufstifte nicht drucken. Bohrungen und Einstecktiefen stehen in der Montageanleitung.',''].join('\n');
}
