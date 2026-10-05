import {drawnLine} from './vendor/support-fins/draw.js';
import {PROP} from './vendor/support-fins/prop.js';

const point=p=>Array.isArray(p)&&p.length===3&&[0,1,2].every(i=>Object.hasOwn(p,i)&&Number.isFinite(p[i]));
const reject=(reason,message)=>Object.assign(new Error(message),{code:'MANUAL_FIN_PATH_REJECTED',reason});

/** Display/generator preparation only, never a material/contact proof. Keep raw
 * a/b in the saved fin spec; rebuild derives this path again from current source.
 * The original chord is shortened only at low OUTER ends. Interior low stations
 * are not bridged or silently split into independently chosen support regions.
 * All unchanged upstream native wall/contact/bed gates must follow this helper.
 */
export function prepareManualFinPath(a,b,soup,{zBed=0,gap=PROP.gap}={}){
 if(!point(a)||!point(b)||!Number.isFinite(zBed)||!Number.isFinite(gap)||gap<0||gap>2)throw reject('invalid_path','Zwei gültige Modellpunkte für die Finnenlinie wählen.');
 if(!(Array.isArray(soup)||ArrayBuffer.isView(soup)&&!(soup instanceof DataView))||!soup.length||soup.length%9||soup.length>4_500_000)throw reject('invalid_surface','Die Modelloberfläche für die Finne ist ungültig oder zu groß.');
 for(const n of soup)if(!Number.isFinite(n))throw reject('invalid_surface','Die Modelloberfläche enthält ungültige Koordinaten.');
 const originalA=[...a],originalB=[...b],dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);
 if(length<PROP.minSpan||length>300)throw reject('invalid_span','Die gezeichnete Finne muss in XY zwischen 7 und 300 mm lang sein.');
 const at=t=>originalA.map((v,k)=>v+(originalB[k]-v)*t),faces=soup.length/9;
 let first=0,last=1,work=0;
 for(let pass=0;pass<4;pass++){
  const aa=first===0?[...originalA]:at(first),bb=last===1?[...originalB]:at(last);
  work+=(Math.max(PROP.minStations-1,Math.ceil(length*(last-first)/PROP.stationStep))+1)*faces;
  if(work>25_000_000)throw reject('work_limit','Diese Finnenlinie ist für die Modellgröße zu aufwendig; eine kürzere Linie wählen.');
  const line=drawnLine(aa,bb,soup);
  if(!line?.length||line.length<PROP.minStations||line.some(p=>!point(p)))throw reject('invalid_sampling','Die Modellhöhe entlang dieser Finnenlinie konnte nicht bestimmt werden.');
  // Same arithmetic as sweep(): do not lower its 1.5 mm minimum-height gate.
  const usable=line.map(p=>p[2]-gap-zBed>=PROP.minHeight),lo=usable.indexOf(true),hi=usable.lastIndexOf(true);
  if(lo<0){
   if(Math.max(aa[2],bb[2])-gap-zBed<PROP.minHeight)throw reject('near_bed','Die Linie liegt vollständig zu nah an der Druckplatte. Zwei höher liegende Modellpunkte wählen.');
   throw reject('blocked_surface','Unter der gewählten Linie liegt eine tiefere Modellfläche. Eine von der Druckplatte erreichbare Stelle wählen.');
  }
  if(usable.slice(lo,hi+1).some(v=>!v))throw reject('interior_low_section','Die Finnenlinie wird innen durch einen zu niedrigen Bereich unterbrochen. Für die getrennten Bereiche jeweils eine eigene Finne zeichnen.');
  if(lo===0&&hi===line.length-1){
   const trimmed=first!==0||last!==1;
   return {a:aa,b:bb,originalA,originalB,trimmed,startFraction:first,endFraction:last,
    minimumHeight:Math.min(...line.map(p=>p[2]-gap-zBed)),stationCount:line.length,
    notice:trimmed?'Die Finnenlinie wurde am niedrigen Ende gekürzt; der höher liegende Abschnitt wird geprüft.':'',
    checkedGeometry:false};
  }
  const span=last-first,nextFirst=first+span*lo/(line.length-1),nextLast=first+span*hi/(line.length-1);
  if(length*(nextLast-nextFirst)<PROP.minSpan)throw reject('short_remainder','Oberhalb der Druckplatte bleiben weniger als 7 mm Finnenlänge. Zwei weiter auseinanderliegende höhere Punkte wählen.');
  first=nextFirst;last=nextLast;
 }
 throw reject('unstable_sampling','Nach dem Kürzen bleibt die Finnenlinie zu niedrig. Die Endpunkte etwas höher auf dem Modell wählen.');
}
