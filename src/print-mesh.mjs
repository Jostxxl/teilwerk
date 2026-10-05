import {bounds,toSolid,fromSolid} from './engine.mjs';
import {authoritativeNativeInPrintFrame} from './native-print-body.mjs';
import {rebuildManualFins} from './manual-fins.mjs';

const fatal=error=>error?.name==='RuntimeError'||/Aborted|memory access out of bounds|unreachable|RuntimeError/i.test(error?.message||'');

/** Export only: the editable body stays separate from detachable supports.
 * Overlapping support shells are unioned with the body into real STL/3MF
 * material here. Assembly guides must continue to receive the original part. */
export function preparePrintMesh(api,part,bed){
 if(part?.exactGeometry!==undefined&&part?.supports?.enabled)throw Error('Exakte Teile benötigen einen eigenen exakten Finnenexport; keine Anzeige-Konversion.');
 if(!part?.supports?.enabled||!part.supports.triangles?.length)return part;
 if(!api||!Array.isArray(bed)||bed.length!==3||bed.some(x=>!Number.isFinite(x)||x<=0))throw Error('Gültigen Bauraum für den Finnenexport wählen.');
 const supportsData=part.supports.kind==='manual'&&Array.isArray(part.supports.fins)?rebuildManualFins(api,part,bed,part.supports):part.supports;
 const handles=[];let poisoned=false,source;
 const owned=solid=>{handles.push(solid);if(solid.status()!=='NoError')throw Error('Ungültiger Volumenkörper beim Verbinden der Finnen.');return solid;};
 try{
  source=authoritativeNativeInPrintFrame(api,part);const body=source.solid,supports=owned(toSolid(api,supportsData)),components=supports.decompose();
  handles.push(...components);for(const s of components)if(s.status()!=='NoError'||!(s.volume()>0))throw Error('Finnen enthalten ungültige oder innere Teilkörper.');
  const fins=owned(api.Manifold.union(components)),contact=owned(body.intersect(fins));
  if(!(contact.volume()>1e-8))throw Error('Die Finnen haben keinen echten Materialkontakt zum Teil.');
  const joined=owned(body.add(fins)),bodies=joined.decompose();handles.push(...bodies);
  if(bodies.some(s=>s.status()!=='NoError'||!Number.isFinite(s.volume()))||bodies.filter(s=>s.volume()>0).length!==1)throw Error('Finnen und Teil bilden keinen zusammenhängenden Druckkörper.');
  const bodyVolume=body.volume(),printVolume=joined.volume();
  if(!Number.isFinite(printVolume)||printVolume<=bodyVolume+1e-8)throw Error('Die Finnen ergänzen keine druckbare Stützgeometrie.');
  const data=fromSolid(joined),box=bounds(data),tolerance=.005;
  if(box.min[0]<-bed[0]/2-tolerance||box.max[0]>bed[0]/2+tolerance||box.min[1]<-bed[1]/2-tolerance||box.max[1]>bed[1]/2+tolerance||Math.abs(box.min[2])>tolerance||box.max[2]>bed[2]+tolerance)throw Error('Teil und Finnen passen nicht gemeinsam auf die Druckplatte.');
  return {...part,...data,nativeGeometry:undefined,supports:undefined,printPreparation:{method:'native-union',finCount:part.supports.count,bodyVolume,printVolume}};
 }catch(error){poisoned=fatal(error);if(poisoned)source?.abandon();throw error;}
 finally{if(!poisoned){let ordinary;for(const solid of handles.reverse())try{solid.delete();}catch(error){if(fatal(error)){source?.abandon();throw error;}ordinary??=error;}try{source?.dispose();}catch(error){if(fatal(error))throw error;ordinary??=error;}if(ordinary)throw ordinary;}}
}
