import {Triangle,Vector3} from 'three';
import {bounds,toSolid,fromSolid} from './engine.mjs';
import {snapshotNativeGeometry} from './native-geometry-transport.mjs';
import {authoritativeNativeInPrintFrame,fatalSupportError,supportNativeScope} from './native-print-body.mjs';
import {packManualFins,extractManualFin} from './manual-fin-records.mjs';
import {drawnWall,drawnLine} from './vendor/support-fins/draw.js';
import {boxExtrude} from './vendor/support-fins/solids.js';
import {PROP} from './vendor/support-fins/prop.js';
import {buildTopology,IDENTITY3} from './vendor/support-fins/overhangs.js';
import {MATERIAL} from './vendor/support-fins/materials.js';
import {overhangMetrics} from './overhang-metrics.mjs';
import {printStability} from './print-stability.mjs';
import {manualToothGeometry,classifyManualTip} from './manual-fin-contact.mjs';
import {prepareManualFinPath} from './manual-fin-path.mjs';
import {manualFinFailureMessage} from './manual-fin-messages.mjs';

const zero={x:0,y:0,z:0};
const vector=v=>Array.isArray(v)&&v.length===3&&[0,1,2].every(i=>Object.hasOwn(v,i)&&Number.isFinite(v[i]));
const inBed=(b,bed)=>b.min[0]>=-bed[0]/2-.005&&b.max[0]<=bed[0]/2+.005&&b.min[1]>=-bed[1]/2-.005&&b.max[1]<=bed[1]/2+.005&&Math.abs(b.min[2])<=.005&&b.max[2]<=bed[2]+.005;
const mesh=points=>({vertices:Float32Array.from(points.flat()),triangles:Uint32Array.from({length:points.length},(_,i)=>i)});
function specFor(s){
 const {a,b,tines=true,tineDensity=1,layerHeight=.2,material='pla'}=s;
 if(!vector(a)||!vector(b)||tines!==true||!Number.isFinite(tineDensity)||tineDensity<0||tineDensity>1||!Number.isFinite(layerHeight)||layerHeight<.08||layerHeight>.4||!Object.hasOwn(MATERIAL,material))throw Error('Zwei gültige Modellpunkte und aktivierte Kontaktzähne wählen.');
 if(s.version!==undefined&&s.version!==1)throw Error('Unbekannte gespeicherte Finnenversion.');
 const length=Math.hypot(a[0]-b[0],a[1]-b[1]);if(length<PROP.minSpan||length>300)throw Error('Die gezeichnete Finne muss in XY zwischen 7 und 300 mm lang sein.');
 return {mode:'draw',version:1,a:[...a],b:[...b],tines:true,tineDensity,layerHeight,material};
}
function bedArea(data){let area=0;for(let i=0;i<data.triangles.length;i+=3){const p=[0,1,2].map(k=>data.triangles[i+k]*3);if(p.some(k=>Math.abs(data.vertices[k+2])>1e-4))continue;const[a,b,c]=p;area+=Math.abs((data.vertices[b]-data.vertices[a])*(data.vertices[c+1]-data.vertices[a+1])-(data.vertices[b+1]-data.vertices[a+1])*(data.vertices[c]-data.vertices[a]))/2;}return area;}

// Upstream's closed emitters reuse point OBJECTS within each solid, never
// between primitives. Preserve that topology; do not guess it by coordinate
// welding. Each separate closed shell is unioned natively, never just appended.
function primitives(points){
 if(!Array.isArray(points)||points.length%3||points.length>300000)throw Error('Ungültige Finnengeometrie.');
 const parent=Array.from({length:points.length/3},(_,i)=>i),first=new Map(),find=i=>parent[i]===i?i:(parent[i]=find(parent[i]));
 for(let i=0;i<points.length;i++){const p=points[i];if(!vector(p))throw Error('Ungültiger Finnenpunkt.');if(first.has(p))parent[find(i/3|0)]=find(first.get(p));else first.set(p,i/3|0);}
 const groups=new Map();for(let i=0;i<parent.length;i++){const key=find(i);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(...points.slice(i*3,i*3+3));}return [...groups.values()];
}
function endpointOnSource(p,soup){const tri=new Triangle(),point=new Vector3(...p),closest=new Vector3();let best=Infinity;for(let i=0;i<soup.length;i+=9){tri.a.fromArray(soup,i);tri.b.fromArray(soup,i+3);tri.c.fromArray(soup,i+6);tri.closestPointToPoint(point,closest);best=Math.min(best,point.distanceToSquared(closest));}return best<=.05**2;}

/** Add one explicitly drawn, bed-attached, toothed wall. Endpoints are current
 * PRINT coordinates. Only new support geometry is generated; source authority,
 * annotations, source surface and earlier support specifications are borrowed. */
export function addManualDrawnFin(api,part,bed,settings={}){
 if(!api?.Manifold||!vector(bed)||bed.some(v=>v<=0))throw Error('Gültigen nutzbaren Bauraum wählen.');
 if(part?.exactGeometry!==undefined)throw Error('Exakte Teile benötigen einen eigenen exakten Finnenpfad.');
 const spec=specFor(settings),previous=part.supports?.fins||[];
 if(part.supports&&part.supports.kind!=='manual'||!Array.isArray(previous)||previous.length>=64)throw Error('Alte automatische Finnen entfernen; höchstens 64 manuelle Finnen pro Teil.');
 const ids=new Set(previous.map(r=>r.id));let id=settings.id;if(id!==undefined&&(!/^m[1-9]\d{0,5}$/.test(id)||ids.has(id)))throw Error('Ungültige oder doppelte Finnen-ID.');if(id===undefined){let n=1;while(ids.has('m'+n))n++;id='m'+n;}
 const life=supportNativeScope(),{call,keep}=life;let body,failure;
 const check=s=>{keep(s);if(call(()=>s.status())!=='NoError')throw Error('Ungültiger nativer Finnenkörper.');return s;};
 const one=s=>{const pieces=call(()=>s.decompose());pieces.forEach(keep);if(pieces.length!==1||call(()=>pieces[0].status())!=='NoError'||!(call(()=>pieces[0].volume())>0))throw Error('Die Finne oder das Teil ist nicht ein geschlossener positiver Körper.');};
 try{
  body=authoritativeNativeInPrintFrame(api,part);const model=body.solid;one(model);
  const bb=call(()=>model.boundingBox());if(!inBed(bb,bed))throw Error('Das Teil zuerst auf der Druckplatte innerhalb des Bauraums ausrichten.');
  const source=call(()=>snapshotNativeGeometry(api,model,{frame:'source',maxTriangles:500000}));
  const work=(Math.ceil(Math.hypot(spec.b[0]-spec.a[0],spec.b[1]-spec.a[1]))+1)*source.triangles.length/3;if(work>25000000)throw Error('Diese Finnenlinie ist für die Modellgröße zu aufwendig; kürzere Linie wählen.');
  const soup=Float64Array.from(source.triangles.flatMap(i=>source.vertices.slice(i*3,i*3+3)));
  if(!endpointOnSource(spec.a,soup)||!endpointOnSource(spec.b,soup))throw Error('Beide Endpunkte müssen auf dem aktuellen Modell liegen.');
  const topo=buildTopology({getAttribute:()=>({array:soup})}),saved={...PROP},hadCapture=Object.hasOwn(globalThis,'__TINECAP'),oldCapture=globalThis.__TINECAP,capture=[];let bare,built,path;
  try{
   Object.assign(PROP,{gap:MATERIAL[spec.material].propGap,footGap:MATERIAL[spec.material].propGap,tineBite:MATERIAL[spec.material].tineBite});
   globalThis.__TINECAP=capture;
   path=prepareManualFinPath(spec.a,spec.b,soup,{gap:MATERIAL[spec.material].propGap});
   bare=drawnWall(path.a,path.b,soup,0,{tines:false});
   built=drawnWall(path.a,path.b,soup,0,{tines:true,tineDensity:spec.tineDensity,layerHeight:spec.layerHeight,topo,rot:IDENTITY3,offset:zero});
  }finally{Object.assign(PROP,saved);if(hadCapture)globalThis.__TINECAP=oldCapture;else delete globalThis.__TINECAP;}
  if(!bare.ok||!built.ok)throw Error(manualFinFailureMessage(built.reason||bare.reason));
  if(built.partAttached||bare.partAttached)throw Error('Diese Finne würde auf dem Modell statt auf der Druckplatte beginnen. Eine zur Platte freie Stelle wählen.');
  if(built.tines!==capture.length||capture.length>256)throw Error('Ungültige Kontaktzähne an dieser Linie.');
  if(bare.tris.length>built.tris.length||bare.tris.some((p,i)=>p.some((v,k)=>v!==built.tris[i][k])))throw Error('Unerwartete gezeichnete Finnengeometrie.');
  const shell=primitives(bare.tris).map(p=>check(call(()=>toSolid(api,mesh(p))))),wall=check(call(()=>api.Manifold.union(shell))),wallOverlap=check(call(()=>wall.intersect(model)));
  if(!call(()=>wallOverlap.isEmpty()))throw Error('Wand oder Fuß schneiden in das Modell. Andere Linie wählen.');
  const all=[...shell],contactChecks=[];let liftedTines=0,surfaceAdjustedTines=0,trimmedSupportVolume=0,verticalTines=0;
  // A manually placed tooth needs a real connected grip, not a completely
  // buried rectangular end cap. On oblique/curved surfaces the latter rejects
  // a useful contact merely because one corner remains in the air. Preserve
  // the model and trim only GENERATED tooth fragments beyond its far surface.
  // Keep the outside component that actually reaches this fin's wall/step.
  function surfaceContact(g,lift){
   const tip=check(call(()=>toSolid(api,mesh(g.tip)))),tipOutside=check(call(()=>tip.subtract(model))),tipEmpty=call(()=>tipOutside.isEmpty());
   const verdict=classifyManualTip({empty:tipEmpty,outsideVolume:tipEmpty?0:call(()=>tipOutside.volume()),tipVolume:call(()=>tip.volume())});life.drop(tipOutside);life.drop(tip);
   const tooth=check(call(()=>toSolid(api,mesh(g.tooth)))),contact=check(call(()=>tooth.intersect(model)));
   const contactVolume=call(()=>contact.volume());
   if(!(contactVolume>0)||!Number.isFinite(contactVolume)){life.drop(contact);life.drop(tooth);return null;}
   const contacts=call(()=>contact.decompose());contacts.forEach(keep);
   if(contacts.length!==1||!(call(()=>contacts[0].volume())>0)){contacts.forEach(life.drop);life.drop(contact);life.drop(tooth);return null;}
   contacts.forEach(life.drop);
   let step;
   if(g.step.length){step=check(call(()=>toSolid(api,mesh(g.step))));const hit=check(call(()=>step.intersect(model))),clear=call(()=>hit.isEmpty());life.drop(hit);if(!clear){life.drop(step);life.drop(contact);life.drop(tooth);return null;}}
   const rear=step?check(call(()=>wall.add(step))):wall,exterior=check(call(()=>tooth.subtract(model))),pieces=call(()=>exterior.decompose());pieces.forEach(keep);const retained=[];
   for(const piece of pieces){const attachment=check(call(()=>piece.intersect(rear))),volume=call(()=>attachment.volume());life.drop(attachment);if(Number.isFinite(volume)&&volume>0)retained.push(piece);}
   if(rear!==wall)life.drop(rear);
   if(!retained.length){pieces.forEach(life.drop);life.drop(exterior);life.drop(step);life.drop(contact);life.drop(tooth);return null;}
   // A tooth can wrap around a SIDE edge, leaving its far-side tip connected
   // to the wall outside the thin model. Component membership alone cannot
   // detect that. Bound the generated support to the contact's backward shadow
   // toward its own root, then intersect with the original tooth. This cannot
   // add anything beyond the original generated tooth or alter the model.
   const back=check(call(()=>contact.translate(g.direction.map(v=>-2*v)))),shadow=check(call(()=>api.Manifold.hull([contact,back]))),adjusted=check(call(()=>tooth.intersect(shadow)));life.drop(shadow);life.drop(back);
   const removed=Math.max(0,call(()=>tooth.volume())-call(()=>adjusted.volume()));
   one(adjusted);pieces.forEach(life.drop);life.drop(exterior);life.drop(contact);if(adjusted!==tooth)life.drop(tooth);
   return {tooth:adjusted,step,lift,surfaceAdjusted:true,trimmedSupportVolume:removed,verdict:{...verdict,accepted:true,exact:false,reason:'native_connected_surface_contact',fullTipContained:verdict.accepted,modelContactVolume:contactVolume,minimumBiteFraction:Number.isFinite(verdict.minimumBiteFraction)?Math.max(0,Math.min(1,verdict.minimumBiteFraction)):0}};
  }
  // A shallow underside or a line along its contour cannot always be gripped
  // by an XY-facing tooth. The user still chose a usable wall. Small vertical
  // breakaway contacts connect that same wall to the selected underside.
  // They are generated only along this explicitly drawn line, never elsewhere.
  function verticalContact(c){
   const z=c.z+spec.layerHeight/2,half=PROP.tineW/2,points=[],tip=[],frame=(u,v,h)=>[c.x+u,c.y+v,h],polygon=[[-half,-half],[half,-half],[half,half],[-half,half]],top=z+MATERIAL[spec.material].tineBite;
   boxExtrude(polygon,z-MATERIAL[spec.material].propGap-spec.layerHeight,top,frame,points);
   boxExtrude(polygon,top-.05,top,frame,tip);
   const value=surfaceContact({tooth:points,tip,step:[],direction:[0,0,1]},0);return value?{...value,vertical:true}:null;
  }
  const verticalOnly=capture.length===0;
  if(verticalOnly){const line=drawnLine(path.a,path.b,soup),span=Math.hypot(path.b[0]-path.a[0],path.b[1]-path.a[1]),count=Math.max(3,Math.ceil(span/3));for(let i=0;i<count;i++){const q=(i+.5)/count*(line.length-1),j=Math.floor(q),f=q-j,p=line[j].map((v,k)=>v+(line[Math.min(j+1,line.length-1)][k]-v)*f);capture.push({x:p[0],y:p[1],z:p[2]-spec.layerHeight/2});}}
  for(const c of capture){
   let selected;
   for(const lift of verticalOnly?[]:[0,1]){
    const g=manualToothGeometry(c,{bite:MATERIAL[spec.material].tineBite,width:PROP.tineW,overlap:PROP.tineOverlap,gap:MATERIAL[spec.material].propGap,layerHeight:spec.layerHeight,lift});
    const tipBody=check(call(()=>toSolid(api,mesh(g.tip)))),outside=check(call(()=>tipBody.subtract(model))),empty=call(()=>outside.isEmpty());
    const verdict=classifyManualTip({empty,outsideVolume:empty?0:call(()=>outside.volume()),tipVolume:call(()=>tipBody.volume())});
    life.drop(outside);life.drop(tipBody);
    if(!verdict.accepted){if(verdict.reason==='unresolved_contact_residual')break;continue;}
    const tooth=check(call(()=>toSolid(api,mesh(g.tooth)))),contact=check(call(()=>tooth.intersect(model)));
    // No detached contact, opposite wall or enclosed signed component may be
    // thrown away. The raised tooth keeps the same bite/width/one-layer height.
    one(contact);life.drop(contact);
    let step;
    if(g.step.length){step=check(call(()=>toSolid(api,mesh(g.step))));const hit=check(call(()=>step.intersect(model))),clear=call(()=>hit.isEmpty());life.drop(hit);if(!clear){life.drop(step);life.drop(tooth);continue;}}
    selected={tooth,step,verdict,lift};break;
   }
   if(!selected&&!verticalOnly)for(const lift of [1,0]){
    const g=manualToothGeometry(c,{bite:MATERIAL[spec.material].tineBite,width:PROP.tineW,overlap:PROP.tineOverlap,gap:MATERIAL[spec.material].propGap,layerHeight:spec.layerHeight,lift});
    g.direction=[c.biteX,c.biteY,lift*spec.layerHeight/(MATERIAL[spec.material].tineBite+PROP.tineOverlap)];selected=surfaceContact(g,lift);if(selected)break;
   }
   if(!selected)selected=verticalContact(c);
   if(!selected)continue;
   all.push(selected.tooth);if(selected.step)all.push(selected.step);contactChecks.push(selected.verdict);liftedTines+=selected.lift;if(selected.vertical)verticalTines++;if(selected.surfaceAdjusted){surfaceAdjustedTines++;trimmedSupportVolume+=selected.trimmedSupportVolume;}
  }
  if(!contactChecks.length)throw Error('Die gezeichnete Finne erreicht das Modell nicht.');
  const fin=check(call(()=>api.Manifold.union(all)));one(fin);const data=call(()=>fromSolid(fin)),area=bedArea(data);
  if(area<.01||!inBed(call(()=>fin.boundingBox()),bed))throw Error('Die Finne braucht eine flache Bettauflage und muss in den Bauraum passen.');
  const contact=check(call(()=>fin.intersect(model))),contactVolume=call(()=>contact.volume());if(!(contactVolume>0)||!Number.isFinite(contactVolume))throw Error('Die Finne hat keinen positiven Materialkontakt.');
  const records=previous.map(r=>({...r,data:extractManualFin(part.supports,r)})),old=[];
  for(const record of records){const s=check(call(()=>toSolid(api,record.data)));one(s);old.push(s);if(call(()=>fin.minGap(s,1.001))<1-.005)throw Error('Zwischen manuellen Finnen mindestens 1 mm Abstand lassen.');if(!inBed(call(()=>s.boundingBox()),bed))throw Error('Vorhandene Finne überschreitet den Bauraum.');}
  const joined=check(call(()=>api.Manifold.union([model,fin,...old])));one(joined);
  records.push({id,kind:'manual',spec,path,data,bedArea:area,modelContactVolume:contactVolume,tines:contactChecks.length,length:built.length,height:built.height,partAttached:false,bounds:bounds(data),volume:call(()=>fin.volume()),nativeSource:body.nativeBound?'bound-native':'legacy-native',minimumBiteFraction:Math.min(...contactChecks.map(c=>c.minimumBiteFraction)),contactChecks,liftedTines,surfaceAdjustedTines,trimmedSupportVolume,verticalTines});
  const combinedStability=printStability(call(()=>fromSolid(joined))),overhang=overhangMetrics(part),warnings=['Geometrie, Bettauflage und Zahnkontakt geprüft. Druckbetthaftung und Druckverlauf im Slicer prüfen.'];if(overhang.needsFurtherSplit)warnings.push('Überhänge bleiben bestehen; manuelle Finnen ersetzen keine Slicerprüfung.');
  if(combinedStability.stableUnderGravity!==true)warnings.push('Auch mit der Finne ist keine geometrisch kippsichere Auflage nachgewiesen.');
  if(path.notice)warnings.push(path.notice);
  if(liftedTines)warnings.push(`${liftedTines} Kontaktzähne wurden an die Schichtlage angepasst; Biss und Modellkontakt sind erneut geprüft.`);
  return packManualFins(records,{enabled:true,sourceOverhang:overhang,material:spec.material,layerHeight:spec.layerHeight,warnings,minimumFinClearance:1,printStability:combinedStability});
 }catch(e){failure=e;if(fatalSupportError(e)){life.abandon();body?.abandon();}throw e;}
 finally{
  let cleanup;try{life.dispose();}catch(e){if(fatalSupportError(e)){body?.abandon();throw e;}cleanup=e;}
  if(!life.poisoned&&!fatalSupportError(failure))try{body?.dispose();}catch(e){if(fatalSupportError(e))throw e;cleanup??=e;}
  if(cleanup&&!failure)throw cleanup;
 }
}
