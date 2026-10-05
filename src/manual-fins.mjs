import {Matrix4,Triangle,Vector3} from 'three';
import {bounds,toSolid,fromSolid,transformData} from './engine.mjs';
import {overhangMetrics} from './overhang-metrics.mjs';
import {printStability} from './print-stability.mjs';
import {buildTopology,IDENTITY3} from './vendor/support-fins/overhangs.js';
import {findWallPatches} from './vendor/support-fins/planes.js';
import {buildSwayRib,SWAY} from './vendor/support-fins/sway.js';
import {MATERIAL} from './vendor/support-fins/materials.js';
import {packManualFins as pack,extractManualFin as extract} from './manual-fin-records.mjs';
import {addManualDrawnFin} from './manual-drawn-fins.mjs';
import {authoritativeNativeInPrintFrame} from './native-print-body.mjs';
import {boxExtrude} from './vendor/support-fins/solids.js';
import {manualFinFailureMessage} from './manual-fin-messages.mjs';

const fatal=e=>e?.name==='RuntimeError'||/Aborted|memory access out of bounds|unreachable|RuntimeError/i.test(e?.message||'');
const zero={x:0,y:0,z:0},MAX_FINS=64;
const vector=v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite);
const inBed=(box,bed)=>box.min[0]>=-bed[0]/2-.005&&box.max[0]<=bed[0]/2+.005&&box.min[1]>=-bed[1]/2-.005&&box.max[1]<=bed[1]/2+.005&&box.min[2]>=-.005&&box.max[2]<=bed[2]+.005;
const raw=points=>({vertices:Float32Array.from(points.flat()),triangles:Uint32Array.from({length:points.length},(_,i)=>i)});
function bedArea(data){let sum=0;for(let f=0;f<data.triangles.length;f+=3){const p=[0,1,2].map(k=>data.triangles[f+k]*3);if(p.some(i=>Math.abs(data.vertices[i+2])>1e-4))continue;const a=p[0],b=p[1],c=p[2];sum+=Math.abs((data.vertices[b]-data.vertices[a])*(data.vertices[c+1]-data.vertices[a+1])-(data.vertices[b+1]-data.vertices[a+1])*(data.vertices[c]-data.vertices[a]))/2;}return sum;}
function options(value={}){
 const {point,normal,width=4,footLength=10,thickness=1.2,angle=0,layerHeight=.2,material='pla'}=value;
 if(!vector(point)||!vector(normal)||Math.hypot(...normal)<1e-8)throw Error('Eine gültige Stelle auf der Seitenfläche wählen.');
 if(![width,footLength,thickness,angle,layerHeight].every(Number.isFinite)||width<2||width>40||footLength<4||footLength>80||thickness<.6||thickness>4||width<thickness+.4||Math.abs(angle)>180||layerHeight<.08||layerHeight>.4||!Object.hasOwn(MATERIAL,material))throw Error('Finnenmaße prüfen: Fußbreite 2–40 mm, Ausladung 4–80 mm, Dicke 0,6–4 mm, Schichthöhe 0,08–0,4 mm; Fuß breiter als die Rippe.');
 return {point:[...point],normal:new Vector3(...normal).normalize().toArray(),width,footLength,thickness,angle,layerHeight,material};
}

/** Adds ONE explicitly placed PrintFins side brace. The part and any previous
 * supports are borrowed and never changed. Coordinates are the current print
 * pose. Width is the flange width, footLength its outward reach, angle the
 * clockwise/CCW turn about the clicked Z axis. Unsupported turns are rejected,
 * never silently moved to another surface. Returns supports, not the part. */
export function addManualFin(api,part,bed,settings={}){
 if(!api?.Manifold||!Array.isArray(bed)||bed.length!==3||bed.some(v=>!Number.isFinite(v)||v<=0))throw Error('Gültigen nutzbaren Bauraum für die manuelle Finne wählen.');
 const spec=options(settings),box=bounds(part);if(Math.abs(box.min[2])>.005||!inBed(box,bed))throw Error('Das Teil zuerst innerhalb des Bauraums auf der Druckplatte ausrichten.');
 if(part.supports&&part.supports.kind!=='manual')throw Error('Alte automatische Finnen zuerst entfernen.');
 const previous=part.supports?.fins||[];if(previous.length>=MAX_FINS)throw Error('Höchstens 64 manuelle Finnen pro Teil.');
 const ids=new Set(previous.map(f=>f.id));let id=settings.id;if(id!==undefined&&(!/^m[1-9]\d{0,5}$/.test(id)||ids.has(id)))throw Error('Ungültige oder doppelte Finnen-ID.');if(!id){let n=1;while(ids.has(`m${n}`))n++;id=`m${n}`;}
 const soup=new Float32Array(part.triangles.length*3),triangle=new Triangle(),closest=new Vector3(),point=new Vector3(...spec.point),normal=new Vector3(...spec.normal);let nearest=-1,distance=Infinity;
 for(let f=0;f<part.triangles.length;f+=3){for(let k=0;k<3;k++)for(let j=0;j<3;j++)soup[f*3+k*3+j]=part.vertices[part.triangles[f+k]*3+j];triangle.a.fromArray(soup,f*3);triangle.b.fromArray(soup,f*3+3);triangle.c.fromArray(soup,f*3+6);if(triangle.getNormal(new Vector3()).dot(normal)<.9)continue;triangle.closestPointToPoint(point,closest);const d=closest.distanceToSquared(point);if(d<distance){distance=d;nearest=f/3;}}
 if(nearest<0||distance>.05**2)throw Error('Die gewählte Stelle liegt nicht auf der angegebenen Außenseite des Teils.');
 const topology=buildTopology({getAttribute:()=>({array:soup})}),patch=findWallPatches(topology,IDENTITY3,zero).find(p=>p.faces.includes(nearest));
 if(!patch)throw Object.assign(Error('Diese Stelle ist zu klein, gekrümmt oder geneigt. Eine größere aufrechte Seitenfläche wählen.'),{code:'MANUAL_SWAY_UNAVAILABLE'});
 const profile=MATERIAL[spec.material],saved={...SWAY};let built;
 // Upstream exposes dimensions as a synchronous settings object. Scope changes
 // to this call so PLA/PETG and another manual placement cannot inherit them.
 try{Object.assign(SWAY,{thMin:spec.thickness,thMax:spec.thickness,thPerMm:0,footHalf:(spec.width-spec.thickness)/2,footPad:0,minDepth:spec.footLength,maxDepth:spec.footLength,topDepth:Math.min(4,spec.footLength),footH:Math.max(.4,spec.layerHeight*3)});built=buildSwayRib(patch,point.x*patch.u.x+point.y*patch.u.y,soup,topology,IDENTITY3,zero,{allowStilt:true,layerHeight:spec.layerHeight,gap:profile.propGap,bite:profile.tineBite});}finally{Object.assign(SWAY,saved);}
 if(!built.ok)throw Object.assign(Error(manualFinFailureMessage(built.reason)),{code:'MANUAL_SWAY_UNAVAILABLE'});
 // Pinned upstream emits two rectangular prisms (rib, flange), then one
 // rectangular prism per tooth. Keep all solids; no largest-component repair.
 if(built.tris.length!==72+built.tines*36)throw Error('Unerwartetes PrintFins-Geometrieformat.');
 const turn=new Matrix4().makeTranslation(...spec.point).multiply(new Matrix4().makeRotationZ(spec.angle*Math.PI/180)).multiply(new Matrix4().makeTranslation(...spec.point.map(v=>-v)));
 const moved=points=>transformData(raw(points),turn),handles=[];let poisoned=false,body;
 const keep=h=>{if(!handles.includes(h))handles.push(h);return h;},check=h=>{keep(h);if(h.status()!=='NoError')throw Error('Die manuelle Finne ist kein gültiger Volumenkörper.');return h;};
 try{
  body=authoritativeNativeInPrintFrame(api,part);const model=body.solid,modelComponents=model.decompose();handles.push(...modelComponents);if(modelComponents.filter(c=>c.volume()>0).length!==1)throw Error('Manuelle Finnen benötigen ein zusammenhängendes Teil.');
  const solids=[];for(let at=0;at<built.tris.length;at+=36)solids.push(keep(toSolid(api,moved(built.tris.slice(at,at+36)))));
  const ribAndFoot=keep(check(api.Manifold.union(solids.slice(0,2)))),bodyOverlap=keep(check(model.intersect(ribAndFoot)));if(bodyOverlap.volume()>1e-7)throw Error('Rippe oder Fuß schneiden in das Modell. Andere Stelle, schmaleren Fuß oder kleineren Winkel wählen.');
  const horizontal=new Vector3(patch.n.x,patch.n.y,0).normalize(),across=new Vector3(-horizontal.y,horizontal.x,0);let minimumBiteFraction=1;
  for(let i=2;i<solids.length;i++){
   const points=built.tris.slice(i*36,(i+1)*36),s=points.map(p=>horizontal.x*p[0]+horizontal.y*p[1]),u=points.map(p=>across.x*p[0]+across.y*p[1]),z=points.map(p=>p[2]),low=Math.min(...s),high=low+Math.min(.1,profile.tineBite/2),poly=[[low,Math.min(...u)],[high,Math.min(...u)],[high,Math.max(...u)],[low,Math.max(...u)]],cap=[];
   boxExtrude(poly,Math.min(...z),Math.max(...z),(x,y,height)=>[horizontal.x*x+across.x*y,horizontal.y*x+across.y*y,height],cap);
   const tip=keep(toSolid(api,moved(cap))),inside=keep(check(tip.intersect(model))),fraction=inside.volume()/tip.volume();minimumBiteFraction=Math.min(minimumBiteFraction,fraction);if(!Number.isFinite(fraction)||fraction<.999)throw Object.assign(Error('Kontaktzähne greifen hier nicht vollständig in das Modell. Schichtlage, Neigung oder Wandabstand prüfen; eine andere Stelle oder einen kleineren Winkel wählen.'),{code:'MANUAL_SWAY_CONTACT_UNRESOLVED',minimumBiteFraction:fraction});
   // A tip could be inside a second wall after crossing a very thin first
   // skin. Its whole contact must therefore be one positive solid, with no
   // disconnected second contact or signed enclosed air pocket.
   const toothContact=keep(check(solids[i].intersect(model))),contacts=toothContact.decompose();handles.push(...contacts);if(contacts.length!==1||!Number.isFinite(contacts[0].volume())||contacts[0].volume()<=0)throw Error('Ein Kontaktzahn würde mehrere Wandflächen oder einen Hohlraum überbrücken. Andere Stelle wählen.');
  }
  const fin=keep(check(api.Manifold.union(solids))),components=fin.decompose();handles.push(...components);if(components.length!==1||components[0].volume()<=1e-8)throw Error('Die Finne ist nicht vollständig verbunden.');
  const data=fromSolid(fin),contactArea=bedArea(data);if(contactArea<.01)throw Error('Die Finne hat keine flache Auflage auf der Druckplatte.');if(!inBed(bounds(data),bed))throw Error('Die Finne überschreitet den nutzbaren Bauraum. Fuß verkleinern oder andere Stelle wählen.');
  const contact=keep(check(model.intersect(fin))),contactVolume=contact.volume();if(!Number.isFinite(contactVolume)||contactVolume<=1e-8||bounds(fromSolid(contact)).max[2]<.6)throw Error('Die Finne erreicht das Teil oberhalb des Fußes nicht.');
  const joined=keep(check(model.add(fin))),joinedComponents=joined.decompose();handles.push(...joinedComponents);if(joinedComponents.filter(c=>c.volume()>0).length!==1)throw Error('Die Finne ist nicht mit dem Teil verbunden.');
  const records=previous.map(record=>({...record,data:extract(part.supports,record)})),oldSolids=[];for(const record of records){const old=keep(toSolid(api,record.data));oldSolids.push(old);if(fin.minGap(old,1.001)<1-.005)throw Error('Zwischen manuellen Finnen mindestens 1 mm Abstand lassen.');if(!inBed(bounds(record.data),bed))throw Error('Vorhandene Finne überschreitet den nutzbaren Bauraum.');}
  records.push({id,kind:'manual',spec,data,bedArea:contactArea,modelContactVolume:contactVolume,contactHeight:bounds(fromSolid(contact)).max[2],tines:built.tines,stilt:built.stilt,minimumBiteFraction,bounds:bounds(data),volume:fin.volume()});
  const overhang=overhangMetrics(part),warnings=[];if(overhang.needsFurtherSplit)warnings.push('Überhänge über 60° bleiben bestehen. Manuelle Finnen ersetzen keine Slicerprüfung.');if(records.some(record=>record.stilt>40))warnings.push('Eine Finne steht lange frei, bevor ihre Zähne das Teil erreichen. Druckverlauf im Slicer prüfen.');
  const allJoined=oldSolids.length?keep(check(api.Manifold.union([model,fin,...oldSolids]))):joined;
  if(oldSolids.length){const components=allJoined.decompose();handles.push(...components);if(components.filter(c=>c.volume()>0).length!==1)throw Error('Nicht alle manuellen Finnen sind mit dem Teil verbunden.');}
  const combinedStability=printStability(fromSolid(allJoined));
  warnings.push('Die Stützwirkung ist geometrisch geprüft. Druckbetthaftung, Düsenkräfte und der Druckverlauf sind nicht geprüft.');
  return pack(records,{enabled:true,sourceOverhang:overhang,material:spec.material,layerHeight:spec.layerHeight,warnings,minimumFinClearance:1,printStability:combinedStability});
 }catch(e){poisoned=fatal(e);if(poisoned)body?.abandon();throw e;}finally{if(!poisoned){let ordinary;for(const handle of handles.reverse())try{handle.delete();}catch(e){if(fatal(e)){body?.abandon();throw e;}ordinary??=e;}try{body?.dispose();}catch(e){if(fatal(e))throw e;ordinary??=e;}if(ordinary)throw ordinary;}}
}

export function removeManualFin(supports,id){
 if(!supports)return undefined;if(supports.kind!=='manual')throw Error('Nur manuelle Finnen lassen sich einzeln entfernen.');const remaining=supports.fins.filter(fin=>fin.id!==id);if(remaining.length===supports.fins.length)return supports;if(!remaining.length)return undefined;
 return pack(remaining.map(record=>({...record,data:extract(supports,record)})),{...supports,printStability:undefined});
}

/** Saved mesh arrays are deliberately ignored: validate specifications and
 * regenerate all contacts against the current, possibly engraved, body. */
export function rebuildManualFins(api,part,bed,supportsOrSpecs){
 if(!supportsOrSpecs)return undefined;const records=Array.isArray(supportsOrSpecs)?supportsOrSpecs:supportsOrSpecs.kind==='manual'?supportsOrSpecs.fins:null;if(!Array.isArray(records)||records.length>MAX_FINS)throw Error('Ungültige gespeicherte manuelle Finnen.');
 for(const record of records)if((record.spec||record).mode!==undefined&&!['draw','sway'].includes((record.spec||record).mode))throw Error('Unbekannte manuelle Finnenart.');
 let supports;for(const record of records)supports=((record.spec||record).mode==='draw'?addManualDrawnFin:addManualFin)(api,{...part,supports},bed,{...(record.spec||record),...(record.id!==undefined?{id:record.id}:{})});if(supports)supports.enabled=Array.isArray(supportsOrSpecs)?true:supportsOrSpecs.enabled!==false;return supports;
}
export const restoreManualFins=rebuildManualFins;

export {addManualDrawnFin};
