import {toSolid} from './engine.mjs';
import {restoreBoundNative} from './native-geometry-binding.mjs';
const fatal=e=>e?.name==='RuntimeError'||/Aborted|memory access out of bounds|unreachable|RuntimeError/i.test(e?.message||'');

// Revalidate both native input and its display, preserving display indices so
// the saved binding and the user's face selections remain attached to the mesh.
export function restoreNativeProjectGeometry(api,data){
 const bound=restoreBoundNative(api,data);let display,failure;
 try{display=toSolid(api,data);return {vertices:new Float32Array(data.vertices),triangles:new Uint32Array(data.triangles),nativeGeometry:data.nativeGeometry,assemblyMatrix:data.assemblyMatrix};}
 catch(error){failure=error;if(fatal(error))bound.abandon();throw error;}
 finally{
  if(!fatal(failure)){
   let cleanup;
   try{display?.delete();}catch(error){if(fatal(error)){bound.abandon();throw error;}cleanup=error;}
   try{bound.dispose();}catch(error){if(fatal(error)){bound.abandon();throw error;}cleanup??=error;}
   if(cleanup&&!failure)throw cleanup;
  }
 }
}
