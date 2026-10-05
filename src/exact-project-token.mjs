// A bounded literal snapshot for a modal project transaction. No JSON/string
// serialization on progress and no trust in a caller's mutable object identity.
const fail=reason=>Object.assign(Error(`Projektprüfung: ${reason}.`),{code:'EXACT_PROJECT_TOKEN_REJECTED',reason});
const classes=[Float32Array,Float64Array,Uint32Array,Uint16Array,Uint8Array,Int32Array,Int16Array,Int8Array];
export const EXACT_PROJECT_TOKEN_LIMITS=Object.freeze({bytes:512*1024*1024,objects:2000000,depth:100,array:16000000});
export function createExactProjectToken({getState,token}={}){
 if(typeof getState!=='function'||typeof token!=='string'||!token.length||token.length>200)throw fail('configuration');
 let bytes=0,objects=0,stale=false;const memo=new Map(),active=new Set();
 const add=n=>{bytes+=n;if(bytes>EXACT_PROJECT_TOKEN_LIMITS.bytes)throw fail('bytes');};
 function capture(v,depth){
  if(v===undefined||v===null||typeof v==='boolean'){add(8);return {kind:'primitive',value:v,immutable:true};}
  if(typeof v==='number'){if(!Number.isFinite(v))throw fail('number');add(8);return {kind:'primitive',value:v,immutable:true};}
  if(typeof v==='string'){add(2*v.length);return {kind:'primitive',value:v,immutable:true};}
  if(!v||typeof v!=='object'||depth>EXACT_PROJECT_TOKEN_LIMITS.depth)throw fail('value');
  if(active.has(v))throw fail('cycle');if(memo.has(v))return memo.get(v);
  if(++objects>EXACT_PROJECT_TOKEN_LIMITS.objects)throw fail('objects');
  if(ArrayBuffer.isView(v)){
   const C=classes.find(C=>Object.getPrototypeOf(v)===C.prototype);
   if(!C||Object.hasOwn(v,'length')||Object.hasOwn(v,'buffer')||Object.hasOwn(v,'byteLength')||Object.hasOwn(v,'constructor')||Reflect.ownKeys(v).length!==v.length)throw fail('view');
   if(v.length>EXACT_PROJECT_TOKEN_LIMITS.array)throw fail('array');add(v.byteLength);
   const copy=C.prototype.slice.call(v);for(const n of copy)if(!Number.isFinite(n))throw fail('number');
   const node={kind:'view',C,copy,immutable:false};memo.set(v,node);return node;
  }
  const list=Array.isArray(v),proto=Object.getPrototypeOf(v);if(list?proto!==Array.prototype:proto!==Object.prototype&&proto!==null)throw fail('prototype');
  const keys=Reflect.ownKeys(v);if(keys.some(k=>typeof k!=='string'||['__proto__','constructor','prototype','toJSON'].includes(k)))throw fail('keys');
  if(list&&(v.length>EXACT_PROJECT_TOKEN_LIMITS.array||keys.length!==v.length+1))throw fail('array');
  if(list&&v.length){
   let numeric=true;for(let i=0;i<v.length;i++){const d=Object.getOwnPropertyDescriptor(v,String(i));if(!d||!Object.hasOwn(d,'value')||!d.enumerable)throw fail('accessor');if(typeof d.value!=='number')numeric=false;else if(!Number.isFinite(d.value))throw fail('number');}
   if(numeric){add(v.length*8);const copy=new Float64Array(v.length);for(let i=0;i<v.length;i++){const d=Object.getOwnPropertyDescriptor(v,String(i));if(!d||!Object.hasOwn(d,'value')||!d.enumerable||typeof d.value!=='number'||!Number.isFinite(d.value))throw fail('accessor');copy[i]=d.value;}const node={kind:'numbers',original:v,copy,immutable:Object.isFrozen(v)};memo.set(v,node);return node;}
  }
  active.add(v);const entries=[];let immutable=Object.isFrozen(v);add(16);
  for(const k of keys){if(list&&k==='length')continue;const d=Object.getOwnPropertyDescriptor(v,k);if(!d||!Object.hasOwn(d,'value')||!d.enumerable||list&&!/^(0|[1-9]\d*)$/.test(k))throw fail('accessor');if(!list)add(k.length*2);const child=capture(d.value,depth+1);immutable&&=child.immutable;entries.push([k,child]);}
  active.delete(v);const node={kind:'object',original:v,proto,list,keys,entries,immutable};memo.set(v,node);return node;
 }
 const snapshot=capture(getState(),0);memo.clear();
 function equal(v,n,seen){
  if(n.kind==='primitive')return Object.is(v,n.value);
  if(!v||typeof v!=='object')return false;
  if(n.kind==='view'){
   if(Object.getPrototypeOf(v)!==n.C.prototype||Object.hasOwn(v,'length')||Object.hasOwn(v,'buffer')||Object.hasOwn(v,'byteLength')||Object.hasOwn(v,'constructor')||Reflect.ownKeys(v).length!==v.length)return false;
   if(v.length!==n.copy.length)return false;for(let i=0;i<v.length;i++)if(!Object.is(v[i],n.copy[i]))return false;return true;
  }
  if(n.kind==='numbers'){
   if(n.immutable&&v===n.original)return true;
   if(!Array.isArray(v)||Object.getPrototypeOf(v)!==Array.prototype||v.length!==n.copy.length||Reflect.ownKeys(v).length!==n.copy.length+1)return false;
   for(let i=0;i<v.length;i++){const d=Object.getOwnPropertyDescriptor(v,String(i));if(!d||!Object.hasOwn(d,'value')||!d.enumerable||!Object.is(d.value,n.copy[i]))return false;}return true;
  }
  if(n.immutable&&v===n.original)return true;
  if(Object.getPrototypeOf(v)!==n.proto)return false;
  // Memoize only within this comparison, never across mutable revision checks.
  let checked=seen.get(v);if(checked?.has(n))return true;if(!checked){checked=new Set();seen.set(v,checked);}checked.add(n);
  const keys=Reflect.ownKeys(v);if(keys.length!==n.keys.length||keys.some((k,i)=>k!==n.keys[i]))return false;
  for(const [k,child]of n.entries){const d=Object.getOwnPropertyDescriptor(v,k);if(!d||!Object.hasOwn(d,'value')||!d.enumerable||!equal(d.value,child,seen))return false;}
  return true;
 }
 return Object.freeze({token,getCurrentProjectToken(){if(stale)return `stale-${token}`;try{if(!equal(getState(),snapshot,new Map()))stale=true;}catch{stale=true;}return stale?`stale-${token}`:token;},get stale(){return stale;},logicalBytes:bytes});
}
