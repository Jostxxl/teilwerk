/** View preference only. Never copy its resolved color into a project part,
 * neighbor-color plan, export mesh or assembly-guide input. */
export const DEFAULT_VIEW_PRESENTATION=Object.freeze({mode:'parts',color:'#d5d9d9'});
const color=v=>typeof v==='string'&&/^#[0-9a-f]{6}$/i.test(v);
const invalid=()=>Error('Ungültige Ansichtsfarbe. Teilfarben oder Einfarbig mit einer sechsstelligen Hex-Farbe wählen.');

export function normalizeViewPresentation(value=undefined){
 if(value===undefined)return Object.freeze({...DEFAULT_VIEW_PRESENTATION});
 if(!value||typeof value!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw invalid();
 const fields={};for(const key of Reflect.ownKeys(value)){const descriptor=Object.getOwnPropertyDescriptor(value,key);if(typeof key!=='string'||!['mode','color'].includes(key)||!descriptor||!Object.hasOwn(descriptor,'value'))throw invalid();fields[key]=descriptor.value;}
 const mode=Object.hasOwn(fields,'mode')?fields.mode:DEFAULT_VIEW_PRESENTATION.mode,c=Object.hasOwn(fields,'color')?fields.color:DEFAULT_VIEW_PRESENTATION.color;
 if(!['parts','single'].includes(mode)||!color(c))throw invalid();return Object.freeze({mode,color:c.toLowerCase()});
}
export const restoreViewPresentation=normalizeViewPresentation;

/** Return a color string only; geometry, IDs, annotations and stored part colors
 * are never read beyond `color`, cloned or changed. Missing display colors keep
 * the existing palette fallback; invalid palette entries use the default green. */
export function resolveDisplayColor(part,index,palette,state=undefined){
 const view=normalizeViewPresentation(state);if(view.mode==='single')return view.color;
 if(color(part?.color))return part.color;
 const i=Number.isInteger(index)&&index>=0?index:0,p=Array.isArray(palette)&&palette.length?palette[i%palette.length]:undefined;
 return color(p)?p:'#bde780';
}
