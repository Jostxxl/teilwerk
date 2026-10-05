import {Matrix4} from 'three';
import {toSolid} from './engine.mjs';
import {restoreBoundNative} from './native-geometry-binding.mjs';

export const fatalSupportError=e=>e?.name==='RuntimeError'||/Aborted|memory access out of bounds|unreachable|RuntimeError/i.test(e?.message||'');

/** Own temporary print-frame body. Never treat a bound body's Float32 display
 * as CSG authority. Rational parts require their separate exact kernel path. */
export function authoritativeNativeInPrintFrame(api,part){
 if(part?.exactGeometry!==undefined)throw Error('Exakte Teile benötigen einen eigenen exakten Finnenpfad; die Anzeige wird nicht als Volumenkörper übernommen.');
 let bound,solid,poisoned=false;
 const abandon=()=>{poisoned=true;solid=null;bound?.abandon();bound=null;};
 const dispose=()=>{
  if(poisoned)return;let failure;
  const s=solid;solid=null;
  if(s)try{s.delete();}catch(e){if(fatalSupportError(e)){abandon();throw e;}failure=e;}
  const b=bound;bound=null;
  if(b)try{b.dispose();}catch(e){if(fatalSupportError(e)){abandon();throw e;}failure??=e;}
  if(failure)throw failure;
 };
 try{
  if(part?.nativeGeometry!==undefined){
   bound=restoreBoundNative(api,part);
   const inverse=new Matrix4().fromArray(part.assemblyMatrix||new Matrix4().toArray()).invert();
   solid=bound.solid.transform(inverse.toArray());
  }else solid=toSolid(api,part);
  if(solid.status()!=='NoError'||solid.isEmpty()||!(solid.volume()>0))throw Error('Ungültiger Körper für die manuelle Finne.');
  return {solid,nativeBound:!!bound,dispose,abandon};
 }catch(error){if(fatalSupportError(error))abandon();else try{dispose();}catch(cleanup){if(fatalSupportError(cleanup))throw cleanup;}throw error;}
}

/** Every owner is consumed before deletion. Ordinary deletion faults do not
 * leak the other owners; a fatal fault stops all native calls immediately. */
export function supportNativeScope(){
 const owned=new Set();let poisoned=false;
 const call=fn=>{if(poisoned)throw new WebAssembly.RuntimeError('Native support kernel is poisoned');try{return fn();}catch(e){if(fatalSupportError(e))poisoned=true;throw e;}};
 const keep=s=>{owned.add(s);return s;};
 const drop=s=>{if(owned.delete(s)&&!poisoned)call(()=>s.delete());};
 const dispose=()=>{if(poisoned)return;let ordinary;for(const s of [...owned].reverse())try{drop(s);}catch(e){if(poisoned)throw e;ordinary??=e;}if(ordinary)throw ordinary;};
 return {call,keep,drop,dispose,abandon:()=>{poisoned=true;owned.clear();},get poisoned(){return poisoned;}};
}
