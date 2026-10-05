import {parseExactMesh,encodeExactMesh,parseExactRational,exactRational,exactRationalString,binary64ExactRational,exactHash} from './exact-geometry.mjs';

// Construction-only exact halfspace operands. Existing geometry is never
// transformed or rounded: a proposed print-frame plane is pulled back through
// the literal pose coefficients, then clips a rational enclosing box.
const zero=[0n,1n],identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
const add=(a,b)=>exactRational(a[0]*b[1]+b[0]*a[1],a[1]*b[1]);
const neg=a=>[-a[0],a[1]];
const sub=(a,b)=>add(a,neg(b));
const mul=(a,b)=>exactRational(a[0]*b[0],a[1]*b[1]);
const div=(a,b)=>{if(!b[0])throw Error('Division durch null in der exakten Schnittkonstruktion.');return exactRational(a[0]*b[1]*(b[0]<0n?-1n:1n),a[1]*(b[0]<0n?-b[0]:b[0]));};
const compare=(a,b)=>{const d=a[0]*b[1]-b[0]*a[1];return d<0n?-1:d>0n?1:0;};
const dot=(a,b)=>a.reduce((s,x,i)=>add(s,mul(x,b[i])),zero);
const cross=(a,b)=>[sub(mul(a[1],b[2]),mul(a[2],b[1])),sub(mul(a[2],b[0]),mul(a[0],b[2])),sub(mul(a[0],b[1]),mul(a[1],b[0]))];
const pointKey=p=>p.map(exactRationalString).join(' ');
const fail=reason=>Object.assign(Error(`Gerade Schnittfläche konnte nicht exakt aufgebaut werden: ${reason}.`),{code:'EXACT_CUTTER_REJECTED'});
function normalizedPlane(n,d){
 const pivot=n.find(x=>x[0]!==0n);if(!pivot)throw fail('Normale fehlt');const scale=[pivot[0]<0n?-pivot[0]:pivot[0],pivot[1]];
 const normal=n.map(x=>exactRationalString(div(x,scale))),offset=exactRationalString(div(d,scale));
 // Positive scaling preserves which side the cutter occupies.
 normal.forEach(parseExactRational);parseExactRational(offset);
 const plane={schema:'prinjekt-exact-plane-v1',normal,offset};return Object.freeze({...plane,normal:Object.freeze(normal),planeHash:exactHash(JSON.stringify(plane))});
}
export function validateExactPlane(plane){
 if(!plane||plane.schema!=='prinjekt-exact-plane-v1'||Object.keys(plane).some(k=>!['schema','normal','offset','planeHash'].includes(k))||!Array.isArray(plane.normal)||plane.normal.length!==3)throw fail('ungültige Ebenendaten');
 const normalized=normalizedPlane(plane.normal.map(parseExactRational),parseExactRational(plane.offset));if(JSON.stringify(normalized.normal)!==JSON.stringify(plane.normal)||normalized.offset!==plane.offset||normalized.planeHash!==plane.planeHash)throw fail('abweichende Ebenenprüfsumme');return normalized;
}
export function exactPlaneFromPrintPose({normal,offset,assemblyToPrint=identity}={}){
 if(!Array.isArray(normal)||normal.length!==3||!Array.from(normal).every(Number.isFinite)||!Number.isFinite(offset)||!Array.isArray(assemblyToPrint)||assemblyToPrint.length!==16||!Array.from(assemblyToPrint).every(Number.isFinite))throw fail('ungültiger Drucklagenvorschlag');
 const m=assemblyToPrint;if(m[3]!==0||m[7]!==0||m[11]!==0||Math.abs(m[15]-1)>8*Number.EPSILON)throw fail('Drucklage ist nicht affin');
 for(let a=0;a<3;a++)for(let b=a;b<3;b++){let product=0;for(let k=0;k<3;k++)product+=m[a*4+k]*m[b*4+k];if(Math.abs(product-(a===b?1:0))>1e-8)throw fail('Drucklage ist nicht starr');}
 const determinant=m[0]*(m[5]*m[10]-m[6]*m[9])-m[4]*(m[1]*m[10]-m[2]*m[9])+m[8]*(m[1]*m[6]-m[2]*m[5]);if(Math.abs(determinant-1)>1e-8)throw fail('Drucklage ist gespiegelt');
 const n=normal.map(binary64ExactRational),matrix=m.map(binary64ExactRational),pulled=[0,1,2].map(column=>dot(n,matrix.slice(column*4,column*4+3))),d=sub(mul(binary64ExactRational(offset),matrix[15]),dot(n,matrix.slice(12,15)));
 return normalizedPlane(pulled,d);
}
function hull(points,normal){
 const axis=normal.findIndex(x=>x[0]!==0n),dimensions=axis===0?[1,2]:axis===1?[0,2]:[0,1];
 const list=[...new Map(points.map(p=>[pointKey(p),p])).values()].sort((a,b)=>compare(a[dimensions[0]],b[dimensions[0]])||compare(a[dimensions[1]],b[dimensions[1]]));
 const turn=(a,b,c)=>sub(mul(sub(b[dimensions[0]],a[dimensions[0]]),sub(c[dimensions[1]],a[dimensions[1]])),mul(sub(b[dimensions[1]],a[dimensions[1]]),sub(c[dimensions[0]],a[dimensions[0]])))[0];
 const chain=sequence=>{const out=[];for(const p of sequence){while(out.length>=2&&turn(out.at(-2),out.at(-1),p)<=0n)out.pop();out.push(p);}return out;};
 const lower=chain(list),upper=chain([...list].reverse()),out=lower.slice(0,-1).concat(upper.slice(0,-1));
 if(out.length<3)return [];const actual=cross(out[1].map((x,i)=>sub(x,out[0][i])),out[2].map((x,i)=>sub(x,out[0][i])));if(dot(actual,normal)[0]<0n)out.reverse();return out;
}
export function createExactHalfspaceCutter(sourceMeshText,{plane,margin=1}={}){
 plane=validateExactPlane(plane);if(!Number.isFinite(margin)||margin<=0||margin>10000)throw fail('ungültiger Außenrand');
 const source=parseExactMesh(sourceMeshText);if(!source.faceCount)throw fail('Ausgangskörper ist leer');
 const n=plane.normal.map(parseExactRational),d=parseExactRational(plane.offset),pad=binary64ExactRational(margin),min=source.vertices[0].map(x=>[...x]),max=source.vertices[0].map(x=>[...x]);
 for(const p of source.vertices)for(let i=0;i<3;i++){if(compare(p[i],min[i])<0)min[i]=p[i];if(compare(p[i],max[i])>0)max[i]=p[i];}
 let negative=false,positive=false;for(const p of source.vertices){const s=sub(dot(n,p),d)[0];negative ||= s<0n;positive ||= s>0n;}if(!negative||!positive)throw fail('Ebene trennt den Ausgangskörper nicht beidseitig');
 const lo=min.map(x=>sub(x,pad)),hi=max.map(x=>add(x,pad));
 const box=[[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]].map(bits=>bits.map((bit,i)=>bit?hi[i]:lo[i]));
 const faces=[[0,3,2,1],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]],polygons=[],cap=[];
 for(const ids of faces){const polygon=ids.map(i=>box[i]),out=[];let a=polygon.at(-1),sa=sub(dot(n,a),d);
  for(const b of polygon){const sb=sub(dot(n,b),d);if((sa[0]<0n&&sb[0]>0n)||(sa[0]>0n&&sb[0]<0n)){const t=div(sa,sub(sa,sb)),p=a.map((x,i)=>add(x,mul(t,sub(b[i],x))));out.push(p);cap.push(p);}if(sb[0]<=0n)out.push(b);if(sb[0]===0n)cap.push(b);a=b;sa=sb;}
  const clean=out.filter((p,i)=>pointKey(p)!==pointKey(out[(i+out.length-1)%out.length]));if(clean.length>=3)polygons.push(clean);
 }
 const cover=hull(cap,n);if(cover.length<3)throw fail('keine geschlossene Schnittkappe');polygons.push(cover);
 const vertices=[],triangles=[],lookup=new Map(),id=p=>{const k=pointKey(p);if(!lookup.has(k)){lookup.set(k,vertices.length);vertices.push(p);}return lookup.get(k);};
 for(const polygon of polygons)for(let i=1;i<polygon.length-1;i++){const points=[polygon[0],polygon[i],polygon[i+1]],area=cross(points[1].map((x,j)=>sub(x,points[0][j])),points[2].map((x,j)=>sub(x,points[0][j])));if(area.every(x=>x[0]===0n))continue;triangles.push(points.map(id));}
 const meshText=encodeExactMesh({vertices,triangles}),sourceCanonical=encodeExactMesh(source);
 return Object.freeze({schema:'prinjekt-exact-halfspace-cutter-v1',meshText,meshHash:exactHash(meshText),sourceMeshHash:exactHash(sourceCanonical),sourceTextHash:exactHash(sourceMeshText),plane,keeps:'negative',margin,vertexCount:vertices.length,faceCount:triangles.length});
}
