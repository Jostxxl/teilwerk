import {overhangMetrics} from './overhang-metrics.mjs';
import {printStability} from './print-stability.mjs';
import {supportFins} from './supports.mjs';
import {supportBedContact} from './support-orientation.mjs';
import {bounds} from './engine.mjs';
import {rebuildManualFins} from './manual-fins.mjs';

// Engraving changes the body under a fin's contact teeth. Recompute supports in
// the chosen print pose, preserving the user's export toggle and material.
export function refreshMarkedSupports(part,bed,{nativeApi,generate=supportFins,regenerateManual=rebuildManualFins}={}){
 const out={...part,overhang:overhangMetrics(part)};
 out.printStability=printStability(out);
 out.bedContactArea=supportBedContact(out,{requireCut:false});
 const cutArea=supportBedContact(out,{requireCut:true});
 out.bedFace=cutArea>=1?'cut':'surface';
 out.requiresCutFace=out.bedContactArea<1;
 if(part.supportOrientation)out.supportOrientation={...part.supportOrientation,bedArea:out.bedContactArea,severeArea:out.overhang.severeArea,supportArea:out.overhang.supportArea,height:bounds(out).size[2]};
 if(!part.supports)return out;
 out.supports=undefined;
 // A manual fin is a user-selected contact. Rebuild the same anchors against
 // the engraved mesh; never replace them with automatically generated fins.
 // On failure reject this marking operation so geometry and selected supports
 // remain together in the caller's atomic commit/export transaction.
 if(part.supports.kind==='manual'){
  try{out.supports=regenerateManual(nativeApi,out,bed,part.supports);out.supportNotice=out.supports?.warnings?.join(' ')||undefined;return out;}
  catch(error){if(error?.name==='RuntimeError'||/Aborted|memory access out of bounds|unreachable|RuntimeError/i.test(error?.message||''))throw error;throw Error(`Gravur angehalten: Die manuell gesetzten Finnen passen danach nicht mehr. Finnen prüfen oder neu setzen. ${error.message}`);}
 }
 try{
  const supports=generate(out,bed,{material:part.supports.material,layerHeight:part.supports.layerHeight??.2,sway:part.supports.sway??true,nativeApi});
  out.supports={...supports,enabled:!!part.supports.enabled};
  out.supportNotice=supports.warnings?.join(' ')||undefined;
 }catch(error){
  if(error?.name==='RuntimeError'||/Aborted|memory access out of bounds|unreachable|RuntimeError/i.test(error?.message||''))throw error;
  out.supportNotice='Nach der Kennzeichnung konnten die Finnen nicht erneut geprüft werden. Support Fins neu berechnen. '+error.message;
 }
 return out;
}
