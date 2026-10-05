import {Triangle,Vector3,Matrix4} from 'three';
import {buildTopology,IDENTITY3} from './vendor/support-fins/overhangs.js';
import {findWallPatches} from './vendor/support-fins/planes.js';
import {buildSwayRib,SWAY} from './vendor/support-fins/sway.js';
import {drawnWall} from './vendor/support-fins/draw.js';
import {PROP} from './vendor/support-fins/prop.js';
import {MATERIAL} from './vendor/support-fins/materials.js';
import {prepareManualFinPath} from './manual-fin-path.mjs';
import {manualFinFailureMessage} from './manual-fin-messages.mjs';

const zero={x:0,y:0,z:0},point=p=>Array.isArray(p)&&p.length===3&&[0,1,2].every(i=>Object.hasOwn(p,i)&&Number.isFinite(p[i]));
const reject=m=>Error(m);
export function manualFinSoup(part){
 const v=part?.vertices,t=part?.triangles;if(!v||!t||v.length%3||t.length%3||!t.length||t.length>1500000||v.length>4500000)throw reject('Das Modell ist für diese Finnenvorschau ungültig oder zu groß.');
 const soup=new Float64Array(t.length*3);for(let i=0;i<t.length;i++){const n=t[i];if(!Number.isInteger(n)||n<0||n>=v.length/3)throw reject('Ungültige Modellfläche.');for(let k=0;k<3;k++){const x=v[n*3+k];if(!Number.isFinite(x))throw reject('Ungültiger Modellpunkt.');soup[i*3+k]=x;}}return soup;
}
function closest(soup,p,normal,maxDistance){
 const tri=new Triangle(),v=new Vector3(...p),q=new Vector3(),n=new Vector3(),want=new Vector3(...normal).normalize();let best=maxDistance**2,result;
 for(let i=0;i<soup.length;i+=9){tri.a.fromArray(soup,i);tri.b.fromArray(soup,i+3);tri.c.fromArray(soup,i+6);if(tri.getNormal(n).dot(want)<.85)continue;tri.closestPointToPoint(v,q);const d=q.distanceToSquared(v);if(d<=best){best=d;result={point:q.toArray(),normal:n.toArray(),faceIndex:i/9};}}
 return result;
}
/** At most four short candidates on the clicked local surface; no CSG and no
 * contact/fit certificate. Native callers subsequently check every candidate. */
export function manualFinFallbackCandidates(part,settings={},soup=manualFinSoup(part)){
 if(!point(settings.point)||!point(settings.normal)||Math.hypot(...settings.normal)<1e-8)throw reject('Eine gültige Modellfläche wählen.');
 const hit=closest(soup,settings.point,settings.normal,.05);if(!hit)throw reject('Der Klick liegt nicht auf der angegebenen Modellfläche.');
 const [nx,ny,nz]=hit.normal;if(nz>=-.05)throw reject('Für die Ersatzfinne eine nach unten geneigte, von der Platte erreichbare Fläche wählen.');
 const h=Math.hypot(nx,ny),directions=h>.05?[[-ny/h,nx/h],[nx/h,ny/h]]:[[1,0],[0,1]],out=[];
 const angle=(settings.angle??0)*Math.PI/180;if(!Number.isFinite(angle)||Math.abs(angle)>Math.PI)throw reject('Ungültige Finnendrehung.');
 for(const length of [10,8])for(const dir of directions){
  const dx=dir[0]*Math.cos(angle)-dir[1]*Math.sin(angle),dy=dir[0]*Math.sin(angle)+dir[1]*Math.cos(angle),dz=-(nx*dx+ny*dy)/nz;
  if(Math.abs(dz*length)>30)continue;
  const ends=[-1,1].map(sign=>closest(soup,hit.point.map((x,k)=>x+sign*length/2*[dx,dy,dz][k]),hit.normal,1));
  if(ends.some(e=>!e)||Math.hypot(ends[1].point[0]-ends[0].point[0],ends[1].point[1]-ends[0].point[1])<7)continue;
  const spec={mode:'draw',version:1,a:ends[0].point,b:ends[1].point,tines:true,tineDensity:1,layerHeight:settings.layerHeight??.2,material:settings.material??'pla'};
  if(!out.some(v=>JSON.stringify([v.a,v.b])===JSON.stringify([spec.a,spec.b])))out.push(spec);
 }
 if(!out.length)throw reject('Um diesen Klick bleibt keine ausreichend lange, frei erreichbare Finnenlinie. Zwei Punkte manuell wählen.');return out;
}
function drawGeometry(soup,s){
 if(!point(s.a)||!point(s.b))throw reject('Zwei gültige Modellpunkte wählen.');
 const material=MATERIAL[s.material??'pla'],layerHeight=s.layerHeight??.2;
 if(!material||!Number.isFinite(layerHeight)||layerHeight<.08||layerHeight>.4)throw reject('Material oder Schichthöhe prüfen.');
 const saved={...PROP};let path,built;
 try{Object.assign(PROP,{gap:material.propGap,footGap:material.propGap,tineBite:material.tineBite});path=prepareManualFinPath(s.a,s.b,soup,{gap:material.propGap});built=drawnWall(path.a,path.b,soup,0,{tines:false});}finally{Object.assign(PROP,saved);}
 if(!built.ok)throw reject(manualFinFailureMessage(built.reason));if(built.partAttached)throw reject('Der Weg zur Druckplatte ist durch das Modell versperrt. Eine frei erreichbare Unterseite wählen.');
 return {points:built.tris,spec:{...s,tool:'draw'},message:path.notice||'Geometrische Vorschau; Modellkontakt und Zähne werden beim Setzen geprüft.',kind:'draw',path};
}
function swayGeometry(soup,s){
 const normal=s.normal,where=s.point;if(!point(normal)||!point(where))throw reject('Eine gültige Seitenfläche wählen.');
 const width=s.width??4,footLength=s.footLength??10,thickness=s.thickness??1.2,angle=s.angle??0,layerHeight=s.layerHeight??.2,material=MATERIAL[s.material??'pla'];
 if(![width,footLength,thickness,angle,layerHeight].every(Number.isFinite)||width<2||width>40||footLength<4||footLength>80||thickness<.6||thickness>4||width<thickness+.4||Math.abs(angle)>180||layerHeight<.08||layerHeight>.4||!material)throw reject('Finnenmaße, Material oder Schichthöhe prüfen.');
 const hit=closest(soup,where,normal,.05);if(!hit)throw reject('Der Klick liegt nicht auf der gewählten Modellfläche.');
 const topology=buildTopology({getAttribute:()=>({array:soup})}),patch=findWallPatches(topology,IDENTITY3,zero).find(p=>p.faces.includes(hit.faceIndex));
 if(!patch)throw Object.assign(reject('Diese Fläche braucht eine Unterseitenfinne.'),{code:'MANUAL_SWAY_UNAVAILABLE'});
 const saved={...SWAY};let built;try{Object.assign(SWAY,{thMin:thickness,thMax:thickness,thPerMm:0,footHalf:(width-thickness)/2,footPad:0,minDepth:footLength,maxDepth:footLength,topDepth:Math.min(4,footLength),footH:Math.max(.4,layerHeight*3)});built=buildSwayRib(patch,where[0]*patch.u.x+where[1]*patch.u.y,soup,topology,IDENTITY3,zero,{allowStilt:true,layerHeight,gap:material.propGap,bite:material.tineBite});}finally{Object.assign(SWAY,saved);}
 if(!built.ok)throw Object.assign(reject(manualFinFailureMessage(built.reason)),{code:'MANUAL_SWAY_UNAVAILABLE'});
 const T=new Matrix4().makeTranslation(...where).multiply(new Matrix4().makeRotationZ(angle*Math.PI/180)).multiply(new Matrix4().makeTranslation(...where.map(x=>-x)));
 return {points:built.tris.map(p=>new Vector3(...p).applyMatrix4(T).toArray()),kind:'sway',spec:{...s,tool:'sway'},message:'Geometrische Vorschau; Modellkontakt und Bauraum werden beim Setzen geprüft.'};
}
/** DISPLAY-ONLY: no native imports/calls, authority, collision or print proof. */
export function previewManualFinCandidate(part,settings={}){
 if(part?.exactGeometry!==undefined)throw reject('Manuelle Finnen sind für exakte Teile noch nicht verfügbar.');
 const soup=manualFinSoup(part);let result;
 if(settings.tool==='draw')result=drawGeometry(soup,settings);
 else if(settings.tool==='sway'){
  try{result=swayGeometry(soup,settings);}catch(error){if(error.code!=='MANUAL_SWAY_UNAVAILABLE')throw error;let last=error;for(const spec of manualFinFallbackCandidates(part,settings,soup))try{result=drawGeometry(soup,spec);result.message='Unterseitenfinne als Vorschau; der vollständige Modellkontakt wird erst beim Setzen geprüft.';break;}catch(e){last=e;}if(!result)throw last;}
 }else throw reject('Unbekanntes manuelles Finnenwerkzeug.');
 if(!result.points.length||result.points.length%3||result.points.length>100000)throw reject('Diese Finnenvorschau ist zu groß. Eine kürzere Linie wählen.');
 return {vertices:Float32Array.from(result.points.flat()),triangles:Uint32Array.from(result.points,(_,i)=>i),message:result.message,valid:false,contactChecked:false,reviewOnly:true,kind:result.kind,spec:result.spec,path:result.path};
}
