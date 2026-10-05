import {connectorSettings} from './connector-project.mjs';

export const DEFAULT_CONNECTOR_OPTIONS=Object.freeze({pinSource:'purchased',pinDiameter:3,pinLength:10,pinEndClearance:2,diametralClearance:.3,minWall:1});
const format=n=>n.toLocaleString('de-DE',{maximumFractionDigits:3});

/** Form state only. The shared normalizer and native planner remain authority. */
export function createConnectorControls(get){
 const fields=['dowelSource','dowelDiameter','dowelClearance','dowelDepth','dowelWall','dowelLength','dowelEndClearance'];
 if(typeof get!=='function'||fields.some(id=>!get(id)))throw Error('Passstift-Einstellungen fehlen.');
 const remembered={printed:connectorSettings({pinSource:'printed'}),purchased:connectorSettings(DEFAULT_CONNECTOR_OPTIONS)};
 let source='purchased',locked=false,printedExplicit=true;
 function read(){
  const common={pinDiameter:Number(get('dowelDiameter').value),diametralClearance:Number(get('dowelClearance').value),minWall:Number(get('dowelWall').value)};
  if(get('dowelSource').value==='purchased')return connectorSettings({...common,pinSource:'purchased',pinLength:Number(get('dowelLength').value),pinEndClearance:Number(get('dowelEndClearance').value)});
  if(get('dowelSource').value!=='printed')throw Error('Stiftart wählen: Kaufstift oder gedruckter Stift.');
  return connectorSettings({...common,...(printedExplicit?{pinSource:'printed'}:{}),socketDepth:Number(get('dowelDepth').value)});
 }
 function update(){
  const purchased=get('dowelSource').value==='purchased';get('dowelPurchased').hidden=!purchased;
  for(const id of fields)get(id).disabled=locked;
  get('dowelDepth').readOnly=purchased;
  if(purchased){const depth=Number(get('dowelLength').value)/2+Number(get('dowelEndClearance').value);get('dowelDepth').value=Number.isFinite(depth)?String(depth):'';}
  try{const value=read();remembered[source]=value;get('dowelFitInfo').textContent=`Bohrung Ø ${format(value.pinDiameter+value.diametralClearance)} mm · ${format(value.socketDepth)} mm tief je Teil.${purchased?` Stiftlänge ${format(value.pinLength)} mm + ${format(value.pinEndClearance)} mm Luft je Ende.`:''}`;}
  catch(error){get('dowelFitInfo').textContent=error.message;}
  get('dowelExportInfo').textContent=purchased?'DIN-6325-Metallstifte separat kaufen; im Druckpaket werden keine Druckdateien für Kaufstifte ausgegeben. Passung zunächst physisch testen. Für weitere Schnitte, Gravuren oder andere Drucklagen zuerst den Plan entfernen.':'Gedruckte Stifte werden als separate Druckteile exportiert. Passung zunächst physisch testen. Für weitere Schnitte, Gravuren oder andere Drucklagen zuerst den Plan entfernen.';
 }
 function restore(value){
  const normalized=connectorSettings(value);source=normalized.pinSource??'printed';if(source==='printed')printedExplicit=normalized.pinSource==='printed';get('dowelSource').value=source;
  get('dowelDiameter').value=String(normalized.pinDiameter);get('dowelClearance').value=String(normalized.diametralClearance);get('dowelWall').value=String(normalized.minWall);get('dowelDepth').value=String(normalized.socketDepth);
  if(source==='purchased'){get('dowelLength').value=String(normalized.pinLength);get('dowelEndClearance').value=String(normalized.pinEndClearance);}
  remembered[source]=normalized;update();return normalized;
 }
 for(const id of fields.filter(id=>id!=='dowelSource'))get(id).addEventListener('input',update);
 get('dowelSource').addEventListener('change',()=>{const next=get('dowelSource').value;if(!['purchased','printed'].includes(next)){update();return;}restore(remembered[next]);});
 restore(DEFAULT_CONNECTOR_OPTIONS);
 return Object.freeze({read,restore,refresh(value=false){locked=!!value;update();}});
}

export function connectorHardwareDescription(settings){
 const value=connectorSettings(settings);
 return value.pinSource==='purchased'?`Kaufstifte DIN 6325 · Ø ${format(value.pinDiameter)} × ${format(value.pinLength)} mm · Bohrung Ø ${format(value.pinDiameter+value.diametralClearance)} × ${format(value.socketDepth)} mm je Teil`:`Gedruckte Stifte · Ø ${format(value.pinDiameter)} mm · Bohrtiefe ${format(value.socketDepth)} mm je Teil`;
}
