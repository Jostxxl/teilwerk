import {Matrix4,Vector3} from 'three';
import {addManualFin,addManualDrawnFin} from './manual-fins.mjs';
import {validateNativeBinding} from './native-geometry-binding.mjs';
import {fatalSupportError} from './native-print-body.mjs';
import {manualFinFallbackCandidates} from './manual-fin-preview.mjs';

/** Keep all successful side braces unchanged. A failure before native work may
 * try at most four short under-face lines. Every try uses the full authoritative
 * drawn-wall gates; fatal native failures stop immediately. */
export function addManualFinWithFallback(api,part,bed,settings={}){
 if(part?.exactGeometry!==undefined)throw Error('Manuelle Finnen sind für exakte Teile noch nicht verfügbar. Die genaue Modellgeometrie bleibt erhalten.');
 let original;try{return addManualFin(api,part,bed,settings);}catch(e){if(fatalSupportError(e)||e.code!=='MANUAL_SWAY_UNAVAILABLE')throw e;original=e;}
 let surface=part;
 if(part.nativeGeometry!==undefined){const {snapshot}=validateNativeBinding(part),T=new Matrix4().fromArray(part.assemblyMatrix??new Matrix4().toArray()).invert(),v=Float64Array.from(snapshot.vertices),p=new Vector3();for(let i=0;i<v.length;i+=3)p.fromArray(v,i).applyMatrix4(T).toArray(v,i);surface={vertices:v,triangles:snapshot.triangles};}
 const candidates=manualFinFallbackCandidates(surface,settings);let last=original;
 for(const spec of candidates){try{const result=addManualDrawnFin(api,part,bed,{...spec,...(settings.id!==undefined?{id:settings.id}:{})});result.warnings.push('Anstelle der Seitenstütze wurde eine kurze Finne unter dem angeklickten Bereich gesetzt.');return result;}catch(e){if(fatalSupportError(e))throw e;last=e;}}
 throw Object.assign(Error(last.message),{code:'MANUAL_FIN_FALLBACK_REJECTED',cause:last,attempts:candidates.length});
}
