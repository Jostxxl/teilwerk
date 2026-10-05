import {serializeProjectDocument,parseProjectDocument} from './project-codec.mjs';

const fail=reason=>Object.assign(Error(`Drucklagenauftrag: ${reason}.`),{code:'EXACT_PROJECT_POSE_PAYLOAD_REJECTED',reason});
const typed=[Float32Array,Float64Array,Uint32Array,Uint16Array,Uint8Array,Int32Array,Int16Array,Int8Array];
const integerKeys=new Set(['triangles','faces','operandIndex','sourceFaceIndex','displayFaceToExactFace']);
const meshKeys=new Set(['vertices','triangles','faces','operandIndex','sourceFaceIndex','displayFaceToExactFace']);
function literals(project){
 const out=[];let nodes=0;
 function walk(v,path,key){if(++nodes>2000000)throw fail('literal_nodes');if(v===undefined||Object.is(v,-0)){out.push({path,kind:v===undefined?'undefined':'negative-zero'});return;}
  if(!v||typeof v!=='object')return;if((Array.isArray(v)||ArrayBuffer.isView(v))&&meshKeys.has(key))return;
  if(ArrayBuffer.isView(v)){for(let i=0;i<v.length;i++)if(Object.is(v[i],-0))out.push({path:[...path,String(i)],kind:'negative-zero'});return;}
  for(const [k,item]of Object.entries(v))walk(item,[...path,k],k);
 }walk(project,[],'');return out;
}
// Own a bounded detached snapshot before the codec can read any properties.
// This is a transport representation only; the worker revalidates all authority.
function snapshot(value){
 let bytes=0,objects=0;const active=new Set(),memo=new Map();
 const add=n=>{bytes+=n;if(bytes>512*1024*1024)throw fail('input_bytes');};
 function copy(v,depth,parentKey){
  if(v==null||typeof v==='boolean'){add(8);return v;}
  if(typeof v==='number'){if(!Number.isFinite(v))throw fail('number');add(8);return v;}
  if(typeof v==='string'){add(v.length*2);return v;}
  if(typeof v!=='object'||depth>100||active.has(v))throw fail('shape');
  if(memo.has(v)){const out=memo.get(v);if(integerKeys.has(parentKey)&&(Array.isArray(out)||ArrayBuffer.isView(out)))for(const n of out)if(Object.is(n,-0))throw fail('negative_zero_index');return out;}if(++objects>2000000)throw fail('objects');
  if(ArrayBuffer.isView(v)){const C=typed.find(C=>Object.getPrototypeOf(v)===C.prototype);if(!C||['length','byteLength','buffer','constructor'].some(k=>Object.hasOwn(v,k))||v.length>16000000||Reflect.ownKeys(v).length!==v.length)throw fail('view');add(v.byteLength);const out=C.prototype.slice.call(v);for(const n of out){if(!Number.isFinite(n))throw fail('number');if(integerKeys.has(parentKey)&&Object.is(n,-0))throw fail('negative_zero_index');}memo.set(v,out);return out;}
  const list=Array.isArray(v),proto=Object.getPrototypeOf(v),keys=Reflect.ownKeys(v);if(list?proto!==Array.prototype:proto!==Object.prototype&&proto!==null)throw fail('prototype');
  if(keys.some(k=>typeof k!=='string'||['__proto__','constructor','prototype','toJSON'].includes(k))||list&&(v.length>16000000||keys.length!==v.length+1))throw fail('keys');
  const out=list?[]:{};active.add(v);memo.set(v,out);add(16);
  for(const k of keys){if(list&&k==='length')continue;const d=Object.getOwnPropertyDescriptor(v,k);if(!d?.enumerable||!Object.hasOwn(d,'value')||list&&(!/^(0|[1-9]\d*)$/.test(k)||Number(k)>=v.length))throw fail('accessor');if(!list)add(k.length*2);if(list&&integerKeys.has(parentKey)&&Object.is(d.value,-0))throw fail('negative_zero_index');out[k]=copy(d.value,depth+1,k);}
  active.delete(v);return out;
 }
 return copy(value,0);
}
export function encodeExactProjectPosePayload(input){
 const value=snapshot(input);if(!value||Array.isArray(value)||Object.keys(value).some(k=>!['parts','permissionSources','usableBed','projectToken'].includes(k))||typeof value.projectToken!=='string'||!value.projectToken.length||value.projectToken.length>200)throw fail('input');
 const project={format:'teilwerk',version:1,parts:value.parts,bed:value.usableBed,margin:0,exactPermissionSources:value.permissionSources};
 // JSON has no -0/undefined notation. Mesh blocks already retain their exact
 // numeric bits; preserve these remaining literal metadata values explicitly.
 project.poseTransportLiterals=literals(project);
 const packed=serializeProjectDocument(project,{mode:'packed'});
 return {document:packed.contents,projectToken:value.projectToken};
}
export function decodeExactProjectPosePayload(document){
 const project=parseProjectDocument(document);if(Object.keys(project).some(k=>!['format','version','parts','bed','margin','exactPermissionSources','poseTransportLiterals'].includes(k))||project.margin!==0||!Array.isArray(project.poseTransportLiterals)||project.poseTransportLiterals.length>2000000)throw fail('document');
 const seen=new Set();for(const item of project.poseTransportLiterals){if(!item||Object.keys(item).sort().join()!=='kind,path'||!['negative-zero','undefined'].includes(item.kind)||!Array.isArray(item.path)||!item.path.length||item.path.length>100||!['parts','bed','exactPermissionSources'].includes(item.path[0])||item.path.some(k=>typeof k!=='string'||meshKeys.has(k)||['__proto__','constructor','prototype','toJSON'].includes(k)))throw fail('literal_path');const identity=JSON.stringify(item.path);if(seen.has(identity))throw fail('literal_duplicate');seen.add(identity);let target=project;for(const key of item.path.slice(0,-1)){if(!target||typeof target!=='object'||!Object.hasOwn(target,key))throw fail('literal_path');target=target[key];}const key=item.path.at(-1);if(!target||typeof target!=='object'||(Array.isArray(target)||ArrayBuffer.isView(target))&&(!/^(0|[1-9]\d*)$/.test(key)||Number(key)>=target.length))throw fail('literal_path');if(item.kind==='negative-zero'){if(!Object.hasOwn(target,key)||target[key]!==0)throw fail('literal_value');target[key]=-0;}else{if(Object.hasOwn(target,key)&&target[key]!==null)throw fail('literal_value');target[key]=undefined;}}
 return {parts:project.parts,permissionSources:project.exactPermissionSources,usableBed:project.bed};
}
