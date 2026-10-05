const array=value=>Array.isArray(value)||ArrayBuffer.isView(value)&&typeof value.length==='number';
const vertexKey=(vertices,index)=>`${vertices[index*3]},${vertices[index*3+1]},${vertices[index*3+2]}`;
function faceKey(a,b,c){if(a>b)[a,b]=[b,a];if(b>c)[b,c]=[c,b];if(a>b)[a,b]=[b,a];return `${a},${b},${c}`;}

// This is an exact annotation-to-source match, not surface projection. In
// particular a mask over an older triangulation must never blacklist nearby
// exterior triangles merely because both surfaces occupy the same space.
export function exactInteriorFaceMask(data){
 if(!array(data?.vertices)||!array(data?.triangles)||data.vertices.length%3||data.triangles.length%3)throw Error('Ungültiges Quellnetz für die Innenflächenzuordnung.');
 const excluded=new Uint8Array(data.triangles.length/3),region=data.interiorRegion,diagnostics={version:1,matchMode:'exact-triangle',provided:region!=null,status:region==null?'absent':'matched',maskTriangles:0,uniqueMaskTriangles:0,duplicateMaskTriangles:0,matchedMaskTriangles:0,unmatchedMaskTriangles:0,excludedSourceFaces:0,warning:null};
 if(region==null)return {excluded,diagnostics};
 if(!array(region.vertices)||!array(region.triangles)||!region.vertices.length||!region.triangles.length||region.vertices.length%3||region.triangles.length%3||region.vertices.some(x=>!Number.isFinite(x))||region.triangles.some(i=>!Number.isInteger(i)||i<0||i>=region.vertices.length/3)){
  diagnostics.status='invalid';diagnostics.warning='Die gespeicherte Innenauswahl ist ungültig. Schnittanker werden ohne Innenfilter gesucht; Innenflächen bitte erneut prüfen.';return {excluded,diagnostics};
 }
 const vertexIds=new Map(),maskRemap=new Int32Array(region.vertices.length/3),maskFaces=new Set();
 for(let i=0;i<maskRemap.length;i++){const key=vertexKey(region.vertices,i);let id=vertexIds.get(key);if(id===undefined){id=vertexIds.size;vertexIds.set(key,id);}maskRemap[i]=id;}
 for(let i=0;i<region.triangles.length;i+=3)maskFaces.add(faceKey(maskRemap[region.triangles[i]],maskRemap[region.triangles[i+1]],maskRemap[region.triangles[i+2]]));
 diagnostics.maskTriangles=region.triangles.length/3;diagnostics.uniqueMaskTriangles=maskFaces.size;diagnostics.duplicateMaskTriangles=diagnostics.maskTriangles-maskFaces.size;
 const sourceRemap=new Int32Array(data.vertices.length/3).fill(-1);for(let i=0;i<sourceRemap.length;i++){const id=vertexIds.get(vertexKey(data.vertices,i));if(id!==undefined)sourceRemap[i]=id;}
 const matched=new Set();for(let f=0;f<excluded.length;f++){
  const ia=data.triangles[f*3],ib=data.triangles[f*3+1],ic=data.triangles[f*3+2];if(![ia,ib,ic].every(i=>Number.isInteger(i)&&i>=0&&i<sourceRemap.length))throw Error('Ungültige Dreiecksindizes für die Innenflächenzuordnung.');
  const a=sourceRemap[ia],b=sourceRemap[ib],c=sourceRemap[ic];if(a<0||b<0||c<0)continue;const key=faceKey(a,b,c);if(maskFaces.has(key)){excluded[f]=1;matched.add(key);diagnostics.excludedSourceFaces++;}
 }
 diagnostics.matchedMaskTriangles=matched.size;diagnostics.unmatchedMaskTriangles=maskFaces.size-matched.size;
 if(diagnostics.unmatchedMaskTriangles){diagnostics.status=matched.size?'partial':'unmatched';diagnostics.warning=matched.size?`${diagnostics.unmatchedMaskTriangles} gespeicherte Innenflächen passen nicht exakt zum aktuellen Dreiecksnetz. Nur die ${matched.size} exakt passenden Flächen werden als Schnittanker ausgeschlossen; Innenauswahl prüfen.`:'Die gespeicherte Innenauswahl passt nicht exakt zum aktuellen Dreiecksnetz. Schnittanker werden ohne Innenfilter gesucht; Innenflächen bitte erneut prüfen.';}
 return {excluded,diagnostics};
}
