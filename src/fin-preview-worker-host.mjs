import {previewManualFinCandidate} from './manual-fin-preview.mjs';
import {addManualDrawnFin} from './manual-drawn-fins.mjs';
import {addManualFinWithFallback} from './manual-fin-fallback.mjs';
import {extractManualFin} from './manual-fin-records.mjs';
import {fatalSupportError} from './native-print-body.mjs';

/** Same core as commit; only a detached display mesh leaves this private worker. */
export function createFinPreviewWorkerHost({getNativeApi,emit,coarse=previewManualFinCandidate,draw=addManualDrawnFin,sway=addManualFinWithFallback}){
 let part=null,bed=null,poisoned=false;
 async function handle(m){
  if(poisoned)return;
  if(m.op==='model'){part=m.data;bed=m.bed;return;}
  if(!['preview','validate'].includes(m.op))return;
  const native=m.op==='validate';let result,fatal=false;
  try{
   if(!part)throw Error('Kein Modell für die Finnenvorschau.');
   if(native){
    if(!Array.isArray(bed)||bed.length!==3||!Array.from(bed).every(n=>Number.isFinite(n)&&n>0))throw Error('Gültigen nutzbaren Bauraum für die Kontaktprüfung wählen.');
    if(!['draw','sway'].includes(m.settings?.tool))throw Error('Unbekanntes manuelles Finnenwerkzeug.');
    const api=await getNativeApi();if(poisoned)return;
    const supports=(m.settings.tool==='draw'?draw:sway)(api,part,bed,m.settings),record=supports.fins?.at(-1);
    if(!record||supports.fins.length!==(part.supports?.fins?.length||0)+1)throw Error('Die geprüfte Finnenvorschau ist unvollständig.');
    const geometry=extractManualFin(supports,record);
    result={...geometry,valid:true,contactChecked:true,message:'Kontakt, Bettauflage und Bauraum dieser Vorschau geprüft. Zum Setzen erneut klicken; die Übernahme prüft nochmals.',kind:record.spec?.mode||m.settings.tool};
   }else{
    const geometry=coarse(part,m.settings);
    result={vertices:geometry.vertices,triangles:geometry.triangles,valid:false,contactChecked:false,kind:geometry.kind,message:'Vorläufige Form – Maus kurz stillhalten für die Prüfung der Kontaktzähne.'};
   }
   if(!result?.vertices?.length||!result?.triangles?.length||result.vertices.length>1800000||result.triangles.length>600000)throw Error('Für diese Stelle ist die Vorschau zu groß. Eine kürzere Linie wählen.');
  }catch(error){fatal=fatalSupportError(error);if(fatal)poisoned=true;result={valid:false,contactChecked:false,message:String(error.message||'Finnenvorschau fehlgeschlagen.').slice(0,500)};}
  emit({requestId:m.requestId,token:m.token,result:{...result,displayOnly:true,reviewOnly:true},...(fatal?{fatal:true}:{})});
 }
 return {handle,get poisoned(){return poisoned;}};
}
