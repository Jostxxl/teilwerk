import {sha256} from '@noble/hashes/sha2.js';
import {Matrix4,Vector3} from 'three';
import {snapshotNativeGeometry,restoreNativeGeometry} from './native-geometry-transport.mjs';
import {requireLegacyGeometry} from './geometry-backend-guard.mjs';

// This attachment is geometry input, never a stored collision/fit certificate.
// Hashes detect stale edits. An independent surface comparison also prevents a
// self-consistent saved hash from substituting a different native body.
const IDENTITY=new Matrix4().toArray(),MAX_BYTES=128*1024*1024,MAX_VERTICES=2000000,MAX_TRIANGLES=4000000;
const fail=reason=>Object.assign(Error(`Genaue Schnittgeometrie passt nicht zum Teil: ${reason}. Bitte den Schnitt neu berechnen.`),{code:'NATIVE_BINDING_REJECTED',reason});
const fatal=e=>e?.name==='RuntimeError'||/Aborted|memory access out of bounds|unreachable|RuntimeError/i.test(e?.message||'');
const hex=bytes=>Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');
// A general affine inverse can yield w = 0.9999999999999999. Preserve
// the literal matrix for hashing; allow only a few ULPs in this constant term.
function matrix(part){const a=part.assemblyMatrix??IDENTITY;if(!Array.isArray(a)||a.length!==16||!a.every(Number.isFinite))throw fail('invalid_assembly_matrix');const m=new Matrix4().fromArray(a),e=m.elements;if(e[3]!==0||e[7]!==0||e[11]!==0||Math.abs(e[15]-1)>8*Number.EPSILON||Math.abs(m.determinant()-1)>1e-8)throw fail('non_rigid_assembly_matrix');for(let i=0;i<3;i++)for(let j=i;j<3;j++){let dot=0;for(let k=0;k<3;k++)dot+=e[i*4+k]*e[j*4+k];if(Math.abs(dot-(i===j?1:0))>1e-8)throw fail('non_rigid_assembly_matrix');}return [...a];}
function hashRender(part){
 const {vertices:v,triangles:t}=part;if(!v||!t||v.length<12||v.length%3||v.length/3>MAX_VERTICES||t.length<12||t.length%3||t.length/3>MAX_TRIANGLES)throw fail('invalid_render_mesh');
 const hash=sha256.create(),buf=new Uint8Array(32768),view=new DataView(buf.buffer);let used=0;
 const number=x=>{if(!Number.isFinite(x))throw fail('nonfinite_render_mesh');view.setFloat64(used,x===0?0:x,true);used+=8;if(used===buf.length){hash.update(buf);used=0;}};
 number(v.length);number(t.length);for(const x of v)number(x);for(const x of t){if(!Number.isInteger(x)||x<0||x>=v.length/3)throw fail('invalid_render_index');number(x);}for(const x of matrix(part))number(x);if(used)hash.update(buf.subarray(0,used));return hex(hash.digest());
}
function encode(snapshot){
 const {vertices:v,triangles:t,mergeFromVert:f=[],mergeToVert:g=[],contactPlanes:p=[]}=snapshot;
 const size=24+v.length*8+t.length*4+f.length*8+p.length*32;if(size>MAX_BYTES)throw fail('snapshot_limit');
 const bytes=new Uint8Array(size),d=new DataView(bytes.buffer);[0x31474e50,v.length,t.length,f.length,p.length,size].forEach((x,i)=>d.setUint32(i*4,x,true));let at=24;
 for(const x of v){d.setFloat64(at,x,true);at+=8;}for(const a of [t,f,g])for(const x of a){d.setUint32(at,x,true);at+=4;}for(const plane of p)for(const x of [...plane.normal,plane.offset]){d.setFloat64(at,x,true);at+=8;}
 let text='';for(let i=0;i<bytes.length;i+=32768)text+=String.fromCharCode(...bytes.subarray(i,i+32768));return {payload:btoa(text),snapshotHash:hex(sha256(bytes))};
}
function decode(attachment){
 const p=attachment?.payload;if(attachment?.version!==1||attachment.frame!=='assembly'||attachment.encoding!=='native-f64-le-base64'||typeof p!=='string'||p.length>Math.ceil(MAX_BYTES/3)*4||p.length%4||/[^A-Za-z0-9+/=]/.test(p)||p.slice(0,-2).includes('=')||p.at(-2)==='='&&p.at(-1)!=='=')throw fail('invalid_attachment');
 let text;try{text=atob(p);}catch{throw fail('invalid_encoding');}const bytes=Uint8Array.from(text,c=>c.charCodeAt(0));if(bytes.length<24||hex(sha256(bytes))!==attachment.snapshotHash)throw fail('snapshot_hash_mismatch');
 const d=new DataView(bytes.buffer),[magic,nv,nt,nm,np,size]=Array.from({length:6},(_,i)=>d.getUint32(i*4,true));
 if(magic!==0x31474e50||nv<12||nv%3||nv/3>MAX_VERTICES||nt<12||nt%3||nt/3>MAX_TRIANGLES||nm>nv/3||np>100000||size!==bytes.length||24+nv*8+nt*4+nm*8+np*32!==size)throw fail('invalid_snapshot_lengths');
 let at=24;const read=(n,wide)=>Array.from({length:n},()=>{const x=wide?d.getFloat64(at,true):d.getUint32(at,true);at+=wide?8:4;return x;});const vertices=read(nv,true),triangles=read(nt,false),mergeFromVert=read(nm,false),mergeToVert=read(nm,false),contactPlanes=Array.from({length:np},()=>{const a=read(4,true);return {normal:a.slice(0,3),offset:a[3]};});
 if(!vertices.every(Number.isFinite)||[triangles,mergeFromVert,mergeToVert].some(a=>a.some(x=>x>=nv/3))||contactPlanes.some(p=>!p.normal.every(Number.isFinite)||!Number.isFinite(p.offset)||Math.abs(Math.hypot(...p.normal)-1)>1e-10))throw fail('invalid_snapshot_values');
 return {version:1,encoding:'native-f64-triangles',frame:'assembly',vertices,triangles,mergeFromVert,mergeToVert,contactPlanes};
}
function sameSurface(part,snapshot){
 if(part.triangles.length!==snapshot.triangles.length)throw fail('different_surface_topology');
 const v=part.vertices,p=new Vector3(),inverse=new Matrix4().fromArray(matrix(part)).invert();let scale=1,assemblyScale=1;for(const x of v)scale=Math.max(scale,Math.abs(x));for(const x of snapshot.vertices)assemblyScale=Math.max(assemblyScale,Math.abs(x));
 // fromSolid first rounds assembly coordinates to Float32; transformData then
 // rounds the moved/rotated print mesh again. A tiny part near the print origin
 // still carries that first error from its larger assembly coordinates. Bound
 // both stages: one Float32 rounding contributes at most scale * 2^-24;
 // a rigid rotation has an absolute row sum no larger than sqrt(3). Keep the
 // existing print-space allowance for previously supported display paths.
 // This only compares display meshes. Native Float64 positions, topology and
 // collision tests are unchanged; this allowance is NEVER a clearance proof.
 const tolerance=Math.max(scale*8*2**-23,(Math.sqrt(3)*assemblyScale+scale)*2**-24)+assemblyScale*Number.EPSILON*64,grid=new Map(),ids=[],exact=new Map();
 const cell=p=>p.map(x=>Math.floor(x/tolerance)),key=p=>p.join(',');
 for(let i=0;i<v.length;i+=3){const xyz=[v[i],v[i+1],v[i+2]],k=key(xyz);let id=exact.get(k);if(id===undefined){id=exact.size;exact.set(k,id);const c=key(cell(xyz)),bucket=grid.get(c)||[];bucket.push({xyz,id});grid.set(c,bucket);}ids.push(id);}
 const mapping=[];for(let i=0;i<snapshot.vertices.length;i+=3){const xyz=p.fromArray(snapshot.vertices,i).applyMatrix4(inverse).toArray(),c=cell(xyz);let best=null,distance=Infinity;for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++)for(const item of grid.get(key([c[0]+x,c[1]+y,c[2]+z]))||[]){const d=Math.max(...xyz.map((v,j)=>Math.abs(v-item.xyz[j])));if(d<=tolerance&&d<distance){best=item;distance=d;}}if(!best)throw fail('different_surface_position');mapping.push(best.id);}
 const triangle=(a,b,c)=>a<=b&&a<=c?`${a},${b},${c}`:b<=c&&b<=a?`${b},${c},${a}`:`${c},${a},${b}`,faces=new Map();
 for(let i=0;i<part.triangles.length;i+=3){const k=triangle(...[0,1,2].map(j=>ids[part.triangles[i+j]]));faces.set(k,(faces.get(k)||0)+1);}
 for(let i=0;i<snapshot.triangles.length;i+=3){const k=triangle(...[0,1,2].map(j=>mapping[snapshot.triangles[i+j]])),count=faces.get(k)||0;if(!count)throw fail('different_oriented_surface');if(count===1)faces.delete(k);else faces.set(k,count-1);}if(faces.size)throw fail('different_oriented_surface');
}
function bindSnapshot(snapshot,part){const renderHash=hashRender(part);sameSurface(part,snapshot);return {version:1,frame:'assembly',encoding:'native-f64-le-base64',renderHash,...encode(snapshot)};}
export function bindNativeGeometry(api,borrowedAssemblySolid,part,{contactPlanes=[]}={}){return bindSnapshot(snapshotNativeGeometry(api,borrowedAssemblySolid,{frame:'assembly',contactPlanes}),part);}
export function validateNativeBinding(part){requireLegacyGeometry(part);if(!Object.hasOwn(part,'nativeGeometry')||part.nativeGeometry===undefined)throw fail('missing_attachment');if(hashRender(part)!==part.nativeGeometry?.renderHash)throw fail('render_hash_mismatch');const snapshot=decode(part.nativeGeometry);sameSurface(part,snapshot);return {snapshot,contactPlanes:snapshot.contactPlanes,assemblyMatrix:matrix(part)};}
export function restoreBoundNative(api,part){const validated=validateNativeBinding(part);return {...restoreNativeGeometry(api,validated.snapshot),snapshot:validated.snapshot,contactPlanes:validated.contactPlanes};}
export function rebindNativePose(before,after){const {snapshot}=validateNativeBinding(before);return bindSnapshot(snapshot,after);}
export function captureClosedNativePart(api,{solid,part,contactPlanes,parentAssemblyMatrix,assemblyMatrix}){
 const parent=new Matrix4().fromArray(parentAssemblyMatrix||IDENTITY);matrix({assemblyMatrix:parent.toArray()});let transformed=null,failure;
 try{const identity=parent.elements.every((x,i)=>x===IDENTITY[i]);transformed=identity?null:solid.transform(parent.toArray());const planes=identity?contactPlanes:contactPlanes.map(plane=>{const n=new Vector3(...plane.normal).transformDirection(parent),p=new Vector3(...plane.normal).multiplyScalar(plane.offset).applyMatrix4(parent);return {normal:n.toArray(),offset:p.dot(n)};});return {nativeGeometry:bindNativeGeometry(api,transformed||solid,{...part,assemblyMatrix},{contactPlanes:planes||[]})};}
 catch(e){failure=e;throw e;}finally{if(transformed&&!fatal(failure))transformed.delete();}
}
