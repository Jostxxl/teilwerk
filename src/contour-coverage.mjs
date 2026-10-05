import {clipTriangleByPrism} from './open-clip.mjs';

const dot=(p,n)=>p[0]*n[0]+p[1]*n[1]+p[2]*n[2];
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const fatal=e=>e?.name==='RuntimeError'||/Aborted|memory access out of bounds|unreachable|RuntimeError/i.test(e?.message||'');
const vector=value=>Array.isArray(value)&&value.length===3&&value.every(Number.isFinite);
const signedArea=polygon=>polygon.reduce((sum,p,i)=>{const q=polygon[(i+1)%polygon.length];return sum+p[0]*q[1]-p[1]*q[0];},0)/2;
const area3=triangle=>{const [a,b,c]=triangle;return Math.hypot(...cross(b.map((v,i)=>v-a[i]),c.map((v,i)=>v-a[i])))/2;};
function invalid(message){const error=Error(message);error.code='CONTOUR_COVERAGE';return error;}

/** Expand a fitted contour by the smallest measured miter offset, retaining
 * straight sides. Source faces, basis and depth are immutable. Coverage is
 * checked in native 2D and once more against the actual 3D triangles. */
export function coverContourFaces(api,data,faces,definition,{maxPadding=4.6,tolerance=1e-5}={}){
 if(!api?.CrossSection?.ofPolygons||!Number.isFinite(maxPadding)||maxPadding<0||!Number.isFinite(tolerance)||tolerance<0)throw invalid('Ungültige Einstellungen für die Konturabdeckung.');
 if(!data?.vertices?.length||data.vertices.length%3||!data.triangles?.length||data.triangles.length%3||!(Array.isArray(faces)||ArrayBuffer.isView(faces))||!faces.length)throw invalid('Keine gültige Oberflächenauswahl für die Konturabdeckung.');
 if(!definition||![definition.u,definition.v,definition.n].every(vector)||!Number.isFinite(definition.min)||!Number.isFinite(definition.max)||definition.min>=definition.max)throw invalid('Ungültige Basis oder Höhenbegrenzung der Kontur.');
 const {u,v,n}=definition;
 if([u,v,n].some(axis=>Math.abs(Math.hypot(...axis)-1)>1e-5)||Math.abs(dot(u,v))>1e-5||Math.abs(dot(u,n))>1e-5||Math.abs(dot(v,n))>1e-5||dot(cross(u,v),n)<1-1e-5)throw invalid('Die Konturbasis muss orthonormal und rechtshändig sein.');
 if(!Array.isArray(definition.contours)||!definition.contours.length||definition.contours.some(loop=>!Array.isArray(loop)||loop.length<3||loop.some(p=>!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite))))throw invalid('Ungültiger Konturumriss für die Flächenabdeckung.');
 const triangles=[],polygons=[];
 for(const face of new Set(faces)){
  if(!Number.isInteger(face)||face<0||face>=data.triangles.length/3)throw invalid('Die Oberflächenauswahl enthält einen ungültigen Dreiecksindex.');
  const triangle=[];
  for(let k=0;k<3;k++){const id=data.triangles[face*3+k];if(!Number.isInteger(id)||id<0||id>=data.vertices.length/3)throw invalid('Die Oberflächenauswahl enthält einen ungültigen Punktindex.');const point=[0,1,2].map(j=>data.vertices[id*3+j]);if(!point.every(Number.isFinite))throw invalid('Die Oberflächenauswahl enthält ungültige Koordinaten.');const height=dot(point,n);if(height<definition.min-1e-8||height>definition.max+1e-8)throw invalid('Die Höhenbegrenzung enthält die gewählte Oberfläche nicht vollständig.');triangle.push(point);}
  triangles.push(triangle);const polygon=triangle.map(p=>[dot(p,u),dot(p,v)]);if(signedArea(polygon)<0)polygon.reverse();polygons.push(polygon);
 }
 let selected,base,poisoned=false,failure;const owned=new Set();
 const call=fn=>{try{return fn();}catch(error){if(fatal(error))poisoned=true;throw error;}};
 const keep=handle=>{owned.add(handle);return handle;};
 const dispose=(handles,error)=>{if(poisoned)return;let first;for(const handle of handles){if(!handle||!owned.delete(handle))continue;try{call(()=>handle.delete());}catch(problem){if(poisoned)throw problem;first??=problem;}}if(first&&!error)throw first;};
 const evaluate=padding=>{let expanded,difference,error;try{expanded=keep(call(()=>base.offset(padding,'Miter')));difference=keep(call(()=>selected.subtract(expanded)));const area=call(()=>difference.area()),contours=call(()=>expanded.toPolygons());if(!Number.isFinite(area)||area<0||!Array.isArray(contours)||!contours.length||contours.some(loop=>loop.length<3||loop.some(p=>p.length!==2||!p.every(Number.isFinite))))throw invalid('Der Geometriekern lieferte keine gültige Konturabdeckung.');return{area,contours};}catch(e){error=e;throw e;}finally{dispose([difference,expanded],error);}};
 const missing3D=contours=>{const candidate={...definition,contours};let area=0;for(const triangle of triangles)for(const piece of clipTriangleByPrism(triangle,candidate).outside)area+=area3(piece);return area;};
 try{
  selected=keep(call(()=>api.CrossSection.ofPolygons(polygons,'Positive')));base=keep(call(()=>api.CrossSection.ofPolygons(definition.contours,'NonZero')));
  const projectedArea=call(()=>selected.area()),baseArea=call(()=>base.area());if(!Number.isFinite(projectedArea)||projectedArea<=0||!Number.isFinite(baseArea)||baseArea<=0)throw invalid('Die Auswahl oder Kontur besitzt keine projizierte Fläche.');
  const allowed=Math.max(tolerance,projectedArea*1e-10),initial=evaluate(0),originalHoles=initial.contours.filter(loop=>signedArea(loop)<0),holesBefore=originalHoles.length;let best=initial,padding=0,requiredPadding=0,sourceMissingArea=initial.area<=allowed?missing3D(initial.contours):Infinity;
  if(initial.area>allowed||sourceMissingArea>1e-10){
   let lo=0,hi=maxPadding;best=evaluate(hi);if(best.area>allowed||missing3D(best.contours)>1e-10)throw invalid('Die geglättete Kontur deckt die gewählte Fläche innerhalb des erlaubten Versatzes nicht vollständig ab.');
   for(let i=0;i<16;i++){const mid=(lo+hi)/2,result=evaluate(mid);if(result.area<=allowed){hi=mid;best=result;}else lo=mid;}
   requiredPadding=hi;padding=Math.min(maxPadding,hi+.002);best=evaluate(padding);sourceMissingArea=missing3D(best.contours);
   // Degenerate projected faces have no 2D area. If they require additional
   // reach, certify that reach against their actual triangles as well.
   if(sourceMissingArea>1e-10){lo=hi;hi=maxPadding;for(let i=0;i<16;i++){const mid=(lo+hi)/2,result=evaluate(mid);if(result.area<=allowed&&missing3D(result.contours)<=1e-10)hi=mid;else lo=mid;}requiredPadding=hi;padding=Math.min(maxPadding,hi+.002);best=evaluate(padding);sourceMissingArea=missing3D(best.contours);}
  }
  if(best.area>allowed||sourceMissingArea>1e-10)throw invalid('Die vollständige gewählte Oberfläche konnte nicht durch die Kontur abgedeckt werden.');
  const holesAfter=best.contours.filter(loop=>signedArea(loop)<0).length;if(holesAfter!==holesBefore)throw invalid('Der erforderliche Konturversatz würde Öffnungen schließen oder die Lochstruktur verändern.');
  // Check each original hole too; equal counts alone could hide the loss of
  // one hole while an unrelated new hole forms between merged outer loops.
  for(const loop of originalHoles){let hole,expanded,remaining,error;try{hole=keep(call(()=>api.CrossSection.ofPolygons([[...loop].reverse()],'Positive')));expanded=keep(call(()=>api.CrossSection.ofPolygons(best.contours,'NonZero')));remaining=keep(call(()=>hole.subtract(expanded)));if(call(()=>remaining.area())<=Math.max(tolerance,1e-10))throw invalid('Der erforderliche Konturversatz würde eine vorhandene Öffnung schließen.');}catch(e){error=e;throw e;}finally{dispose([remaining,expanded,hole],error);}}
  return {...definition,contours:best.contours,contourCoverage:{version:1,projectedArea,initialMissingArea:initial.area,missingArea:best.area,sourceMissingArea,padding,requiredPadding,safetyPadding:padding-requiredPadding,tolerance:allowed,holesBefore,holesAfter}};
 }catch(error){failure=error;throw error;}finally{dispose([...owned].reverse(),failure);}
}
