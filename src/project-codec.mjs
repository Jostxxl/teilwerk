import {sha256} from '@noble/hashes/sha2.js';

export const PROJECT_FILE_LIMIT=200*1024*1024;
const MAX_BUFFER_BYTES=128*1024*1024,MAX_DECODED_BYTES=256*1024*1024,MAX_REFERENCED_BYTES=512*1024*1024,MAX_BUFFERS=50000;
const hex=bytes=>Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');
const reject=message=>Object.assign(Error(`Projektdatei konnte nicht vollständig gelesen oder gespeichert werden: ${message}`),{code:'PROJECT_CODEC_REJECTED'});
const integerKeys=new Set(['triangles','faces','operandIndex','sourceFaceIndex','displayFaceToExactFace']);
const numericKeys=new Set(['vertices',...integerKeys]);
const sequence=value=>Array.isArray(value)||ArrayBuffer.isView(value)&&!(value instanceof DataView);
function base64(bytes){let text='';for(let i=0;i<bytes.length;i+=32768)text+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(text);}
function bytesFromBase64(value,expected){
 if(typeof value!=='string'||value.length!==Math.ceil(expected/3)*4||/[^A-Za-z0-9+/=]/.test(value)||value.slice(0,-2).includes('=')||value.at(-2)==='='&&value.at(-1)!=='=')throw reject('Ungültige Binärdaten.');
 let text;try{text=atob(value);}catch{throw reject('Ungültige Base64-Daten.');}if(text.length!==expected)throw reject('Die Länge der Binärdaten stimmt nicht.');return Uint8Array.from(text,c=>c.charCodeAt(0));
}
function format(project){if(project?.format!=='teilwerk'||project.version!==1||!Array.isArray(project.parts)||!project.parts.length||project.parts.length>2048)throw reject('Kein unterstütztes Teilwerk-Projekt.');}
function budget(){let nodes=0;return depth=>{if(depth>64||++nodes>2000000)throw reject('Die Projektstruktur ist zu groß oder zu tief verschachtelt.');};}
function numeric(value,key){return sequence(value)&&numericKeys.has(key);}
function width(type){if(type==='f32'||type==='u32')return 4;if(type==='f64')return 8;throw reject('Unbekannter Zahlentyp.');}
function validateNumbers(values,key){const integers=integerKeys.has(key)||values instanceof Uint32Array;for(const x of values)if(!Number.isFinite(x)||integers&&(!Number.isInteger(x)||x<0||x>4294967295))throw reject('Ungültige Geometriezahlen.');}
function encodeNumbers(values,key){
 const integers=integerKeys.has(key)||values instanceof Uint32Array;
 let type=integers?'u32':'f32';for(const x of values){if(!Number.isFinite(x)||integers&&(!Number.isInteger(x)||x<0||x>4294967295))throw reject('Ungültige Geometriezahlen.');if(!integers&&Math.fround(x)!==x)type='f64';}
 const bytesPerNumber=width(type),size=values.length*bytesPerNumber;if(!Number.isSafeInteger(size)||size>MAX_BUFFER_BYTES)throw reject('Ein Geometrieblock überschreitet 128 MB.');
 const bytes=new Uint8Array(size),view=new DataView(bytes.buffer);for(let i=0;i<values.length;i++){if(type==='u32')view.setUint32(i*4,values[i],true);else if(type==='f32')view.setFloat32(i*4,values[i],true);else view.setFloat64(i*8,values[i],true);}return {type,length:values.length,bytes};
}
function legacyEstimate(project){
 const check=budget();let numericValues=0,textBytes=0;
 const walk=(value,key,depth)=>{check(depth);if(numeric(value,key)){validateNumbers(value,key);numericValues+=value.length;return;}if(typeof value==='string'){textBytes+=value.length;return;}if(sequence(value)){for(const item of value)walk(item,'',depth+1);}else if(value&&typeof value==='object')for(const [name,item]of Object.entries(value))walk(item,name,depth+1);};walk(project,'',0);return {numericValues,textBytes};
}

/** Small projects retain the original JSON format. Large projects pack numbers
 * losslessly and share identical arrays (notably interior masks and baselines).
 * No compression, truncation, regenerated mesh or saved validity claim is used. */
export function serializeProjectDocument(project,{mode='auto'}={}){
 format(project);if(!['auto','legacy','packed'].includes(mode))throw reject('Unbekannter Speichermodus.');
 const estimate=legacyEstimate(project),packed=mode==='packed'||mode==='auto'&&(estimate.numericValues>200000||estimate.textBytes>2*1024*1024);let contents,statistics;
 if(!packed){contents=JSON.stringify(project,(_,x)=>ArrayBuffer.isView(x)?Array.from(x):x);statistics={buffers:0,sharedReferences:0,decodedBytes:0};}
 else{
  const buffers=[],texts=[],lookup=new Map(),textLookup=new Map(),check=budget();let decodedBytes=0,sharedReferences=0,referencedBytes=0;
  const walk=(value,key,depth)=>{
   check(depth);
   if(numeric(value,key)){
    const block=encodeNumbers(value,key);referencedBytes+=block.bytes.length;if(referencedBytes>MAX_REFERENCED_BYTES)throw reject('Die entfaltete Projektgeometrie überschreitet 512 MB.');const digest=hex(sha256(block.bytes)),identity=block.type+':'+block.length+':'+digest;let index=lookup.get(identity);
    if(index===undefined){decodedBytes+=block.bytes.length;if(decodedBytes>MAX_DECODED_BYTES||buffers.length>=MAX_BUFFERS)throw reject('Zu viele Geometriedaten.');index=buffers.length;lookup.set(identity,index);buffers.push({type:block.type,length:block.length,sha256:digest,data:base64(block.bytes)});}else sharedReferences++;
    return {$buffer:index};
   }
   if(typeof value==='string'&&value.length>4096){let index=textLookup.get(value);if(index===undefined){if(texts.length>=MAX_BUFFERS)throw reject('Zu viele Datenblöcke.');index=texts.length;textLookup.set(value,index);texts.push(value);}else sharedReferences++;return {$text:index};}
   if(sequence(value))return Array.from(value,item=>walk(item,'',depth+1));
   if(value&&typeof value==='object'){const out={};for(const [name,item]of Object.entries(value)){if(['__proto__','constructor','prototype'].includes(name))throw reject('Ungültiger Projektschlüssel.');out[name]=walk(item,name,depth+1);}return out;}
   return value;
  };
  const document=walk(project,'',0);contents=JSON.stringify({format:'teilwerk',version:2,encoding:'binary-arrays-le-v1',document,buffers,texts});statistics={buffers:buffers.length,texts:texts.length,sharedReferences,decodedBytes,referencedBytes};
 }
 const fileBytes=new Blob([contents]).size;if(fileBytes>PROJECT_FILE_LIMIT)throw reject('Das vollständige Projekt überschreitet 200 MB. Es wurde keine unvollständige Datei gespeichert.');
 return {contents,packed,fileBytes,...statistics};
}

/** Decode geometry input, never persisted proofs. The ordinary project importer
 * must still revalidate solids, interior selections and connector plans. */
export function parseProjectDocument(contents){
 if(typeof contents!=='string'||contents.length>PROJECT_FILE_LIMIT||new Blob([contents]).size>PROJECT_FILE_LIMIT)throw reject('Projektdatei zu groß (maximal 200 MB).');
 let stored;try{stored=JSON.parse(contents);}catch{throw reject('Ungültiges JSON.');}
 if(stored?.format==='teilwerk'&&stored.version===1){format(stored);legacyEstimate(stored);return stored;}
 if(stored?.format!=='teilwerk'||stored.version!==2||stored.encoding!=='binary-arrays-le-v1'||!Array.isArray(stored.buffers)||stored.buffers.length>MAX_BUFFERS||!Array.isArray(stored.texts)||stored.texts.length>MAX_BUFFERS)throw reject('Unbekanntes Projektformat.');
 let total=0;const sizes=stored.buffers.map(block=>{if(!block||!Number.isSafeInteger(block.length)||block.length<0||typeof block.sha256!=='string'||!/^[0-9a-f]{64}$/.test(block.sha256))throw reject('Ungültiger Geometrieblock.');const size=block.length*width(block.type);total+=size;if(!Number.isSafeInteger(size)||size>MAX_BUFFER_BYTES||total>MAX_DECODED_BYTES)throw reject('Zu viele entpackte Geometriedaten.');return size;});
 if(stored.texts.some(text=>typeof text!=='string'||text.length>PROJECT_FILE_LIMIT))throw reject('Ungültiger Textblock.');
 const buffers=stored.buffers.map((block,index)=>{const bytes=bytesFromBase64(block.data,sizes[index]);if(hex(sha256(bytes))!==block.sha256)throw reject('Eine Geometrie-Prüfsumme stimmt nicht.');const view=new DataView(bytes.buffer),result=block.type==='u32'?new Uint32Array(block.length):block.type==='f32'?new Float32Array(block.length):new Float64Array(block.length),step=width(block.type);for(let i=0;i<result.length;i++){const x=block.type==='u32'?view.getUint32(i*step,true):block.type==='f32'?view.getFloat32(i*step,true):view.getFloat64(i*step,true);if(!Number.isFinite(x))throw reject('Nicht endliche Geometriezahl.');result[i]=x;}return result;});
 const check=budget();let referencedBytes=0;
 const walk=(value,depth)=>{
  check(depth);if(Array.isArray(value))return value.map(item=>walk(item,depth+1));
  if(value&&typeof value==='object'){
   const keys=Object.keys(value);if(Object.hasOwn(value,'$buffer')||Object.hasOwn(value,'$text')){const isBuffer=Object.hasOwn(value,'$buffer'),index=value[isBuffer?'$buffer':'$text'],table=isBuffer?buffers:stored.texts;if(keys.length!==1||!Number.isInteger(index)||index<0||index>=table.length)throw reject('Ungültiger Datenverweis.');if(isBuffer){referencedBytes+=sizes[index];if(referencedBytes>MAX_REFERENCED_BYTES)throw reject('Zu viele referenzierte Geometriedaten.');}return table[index];}
   const out={};for(const name of keys){if(['__proto__','constructor','prototype'].includes(name))throw reject('Ungültiger Projektschlüssel.');out[name]=walk(value[name],depth+1);}return out;
  }return value;
 };
 const project=walk(stored.document,0);format(project);return project;
}
