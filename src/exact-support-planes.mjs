import {validateExactAuthority,parseExactMesh,parseExactRational,exactRational,exactRationalString,exactRationalToNumber,binary64ExactRational,exactHash} from './exact-geometry.mjs';
import {validateExactPlane} from './exact-planar-cutter.mjs';

// Finite proposal search, not a printability or exhaustive-largest-face proof.
// Float directions only prioritize a bounded shortlist. Every returned plane
// and every counted face is checked against the literal rational coordinates.
const fail=reason=>Object.assign(Error(`Ebene Auflageflächen konnten nicht bestimmt werden: ${reason}.`),{code:'EXACT_SUPPORT_PLANES_REJECTED',reason});
const add=(a,b)=>exactRational(a[0]*b[1]+b[0]*a[1],a[1]*b[1]);
const sub=(a,b)=>exactRational(a[0]*b[1]-b[0]*a[1],a[1]*b[1]);
const mul=(a,b)=>exactRational(a[0]*b[0],a[1]*b[1]);
const abs=a=>[a[0]<0n?-a[0]:a[0],a[1]];
const div=(a,b)=>{if(!b[0])throw fail('zero_normal');return exactRational(a[0]*b[1]*(b[0]<0n?-1n:1n),a[1]*(b[0]<0n?-b[0]:b[0]));};
const dot=(a,b)=>a.reduce((s,x,i)=>add(s,mul(x,b[i])),[0n,1n]);
const cross=(u,v)=>[sub(mul(u[1],v[2]),mul(u[2],v[1])),sub(mul(u[2],v[0]),mul(u[0],v[2])),sub(mul(u[0],v[1]),mul(u[1],v[0]))];
const number=q=>exactRationalToNumber(q).number;
const equal=(a,b)=>a[0]*b[1]===b[0]*a[1];
const fixedDenominator=1n<<32n;
function triangle(mesh,index){const p=mesh.triangles[index].map(i=>mesh.vertices[i]),n=cross(p[1].map((x,k)=>sub(x,p[0][k])),p[2].map((x,k)=>sub(x,p[0][k])));return {p,n};}
function planeOf(t){
 const first=t.n.find(x=>x[0]!==0n);if(!first)return null;
 // The first nonzero component is POSITIVE, so opposite face winding yields
 // exactly the same canonical support-plane record.
 const n=t.n.map(x=>div(x,first)),d=div(dot(t.n,t.p[0]),first),record={schema:'prinjekt-exact-plane-v1',normal:n.map(exactRationalString),offset:exactRationalString(d)};
 return validateExactPlane({...record,planeHash:exactHash(JSON.stringify(record))});
}
function dominant(n){let best=0;for(let i=1;i<3;i++){const a=abs(n[i]),b=abs(n[best]);if(a[0]*b[1]>b[0]*a[1])best=i;}return best;}
function numericDescriptor(mesh,vertices,index){
 const ids=mesh.triangles[index],a=ids.map(i=>i*3),u=[0,1,2].map(k=>vertices[a[1]+k]-vertices[a[0]+k]),v=[0,1,2].map(k=>vertices[a[2]+k]-vertices[a[0]+k]);let n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],length=Math.hypot(...n),area=length/2;
 if(!(length>0)||!Number.isFinite(length)){
  const exact=triangle(mesh,index),axis=dominant(exact.n);if(!exact.n[axis][0])return null;const reference=abs(exact.n[axis]);n=exact.n.map(x=>number(div(x,reference)));length=Math.hypot(...n);let magnitude;try{magnitude=number(reference);}catch{magnitude=Infinity;}area=magnitude*length/2;
 }
 n=n.map(x=>x/length);let axis=0;for(let i=1;i<3;i++)if(Math.abs(n[i])>Math.abs(n[axis]))axis=i;if(n[axis]<0)n=n.map(x=>-x);
 const offset=n.reduce((sum,x,k)=>sum+x*vertices[a[0]+k],0);if(!Number.isFinite(offset)||!n.every(Number.isFinite))throw fail('numeric_priority_overflow');
 // Buckets can merge nearby DIFFERENT planes. That is only a shortlist hint:
 // the second pass rejects every noncoplanar triangle exactly.
 const key=n.map(x=>Math.round(x*1e6)).join(',')+':'+Math.round(offset*1e5);
 return {key,area:area||Number.MIN_VALUE,face:index};
}
class Shortlist{
 constructor(limit){this.limit=limit;this.map=new Map();this.heap=[];}
 swap(a,b){[this.heap[a],this.heap[b]]=[this.heap[b],this.heap[a]];this.heap[a].position=a;this.heap[b].position=b;}
 down(i){for(;;){let next=i;for(const j of [i*2+1,i*2+2])if(j<this.heap.length&&this.heap[j].weight<this.heap[next].weight)next=j;if(next===i)return;this.swap(i,next);i=next;}}
 add(d){let e=this.map.get(d.key);if(e){e.weight+=d.area;if(d.area>e.largest){e.face=d.face;e.largest=d.area;}this.down(e.position);return;}
  if(this.heap.length<this.limit){e={...d,weight:d.area,largest:d.area,position:this.heap.length};this.heap.push(e);this.map.set(e.key,e);let i=e.position;while(i>0){const p=(i-1)>>1;if(this.heap[p].weight<=e.weight)break;this.swap(i,p);i=p;}return;}
  const old=this.heap[0];this.map.delete(old.key);e={...d,weight:old.weight+d.area,largest:d.area,position:0};this.heap[0]=e;this.map.set(e.key,e);this.down(0);
 }
}
// Bounded typed open-address edge storage. No rational normal/plane string is
// retained per triangle. At the four-million-face limit this table's ceiling
// is 16,777,216 slots (192 MiB), rather than millions of JS Map objects.
class Edges{
 constructor(){this.keys=new Float64Array(1024);this.values=new Int32Array(1024);this.count=0;}
 slot(key){let i=(Math.imul(key>>>0,0x9e3779b1)^(Math.floor(key/4294967296)>>>0))&(this.keys.length-1);while(this.keys[i]&&this.keys[i]!==key)i=(i+1)&(this.keys.length-1);return i;}
 add(key,face){key++;if(this.count*10>=this.keys.length*7){if(this.keys.length>=16777216)throw fail('edge_work_limit');const k=this.keys,v=this.values;this.keys=new Float64Array(k.length*2);this.values=new Int32Array(v.length*2);for(let j=0;j<k.length;j++)if(k[j]){const i=this.slot(k[j]);this.keys[i]=k[j];this.values[i]=v[j];}}
  const i=this.slot(key);if(this.keys[i])return this.values[i];this.keys[i]=key;this.values[i]=face;this.count++;return -1;
 }
}

export function deriveExactSupportPlanes(authority,{maximumPlanes=24,minimumArea=50}={}){
 if(!Number.isInteger(maximumPlanes)||maximumPlanes<1||maximumPlanes>128||!Number.isFinite(minimumArea)||minimumArea<0)throw fail('options');
 const input=validateExactAuthority(authority),mesh=parseExactMesh(input.meshText);if(!mesh.faceCount)return Object.freeze([]);
 const vertices=new Float64Array(mesh.vertexCount*3);try{for(let i=0;i<mesh.vertexCount;i++)for(let k=0;k<3;k++)vertices[i*3+k]=number(mesh.vertices[i][k]);}catch{throw fail('numeric_coordinate_overflow');}
 const shortlist=new Shortlist(Math.min(1024,Math.max(128,maximumPlanes*8)));for(let face=0;face<mesh.faceCount;face++){const d=numericDescriptor(mesh,vertices,face);if(d)shortlist.add(d);}
 const candidates=[],byHash=new Map(),byBucket=new Map();
 for(const entry of shortlist.heap){const plane=planeOf(triangle(mesh,entry.face));if(!plane)continue;let id=byHash.get(plane.planeHash);if(id===undefined){id=candidates.length;byHash.set(plane.planeHash,id);const normal=plane.normal.map(parseExactRational),axis=dominant(normal),unit=normal.map(q=>div(q,abs(normal[axis])));candidates.push({plane,normal,offset:parseExactRational(plane.offset),axis,normSquared:dot(unit,unit),largestFixed:0n});}byBucket.set(entry.key,id);}
 const nf=mesh.faceCount,parent=new Int32Array(nf).fill(-1),owner=new Int16Array(nf).fill(-1),area=new Array(nf),edges=new Edges(),find=i=>{let r=i;while(parent[r]!==r)r=parent[r];while(parent[i]!==i){const next=parent[i];parent[i]=r;i=next;}return r;};
 const union=(a,b)=>{a=find(a);b=find(b);if(a===b)return;if(a>b)[a,b]=[b,a];parent[b]=a;area[a]+=area[b];area[b]=null;};
 for(let face=0;face<nf;face++){
  const d=numericDescriptor(mesh,vertices,face),id=d?byBucket.get(d.key):undefined;if(id===undefined)continue;const candidate=candidates[id],t=triangle(mesh,face),axis=candidate.axis;if(!t.n[axis][0])continue;
  if(!equal(dot(candidate.normal,t.p[0]),candidate.offset)||[0,1,2].some(k=>!equal(mul(t.n[k],candidate.normal[axis]),mul(t.n[axis],candidate.normal[k]))))continue;
  const scalar=abs(t.n[axis]);parent[face]=face;owner[face]=id;area[face]=scalar[0]*fixedDenominator/scalar[1];
  const tri=mesh.triangles[face];for(let j=0;j<3;j++){const a=tri[j],b=tri[(j+1)%3],other=edges.add(Math.min(a,b)*mesh.vertexCount+Math.max(a,b),face);if(other>=0&&owner[other]===id)union(face,other);}
 }
 for(let face=0;face<nf;face++)if(parent[face]===face){const c=candidates[owner[face]];if(area[face]>c.largestFixed)c.largestFixed=area[face];}
 const required=binary64ExactRational(minimumArea);
 const accepted=candidates.filter(c=>{
  if(!c.largestFixed)return false;
  // Sum floor(crossDominant*2^32) <= exact sum. Squaring and the exact rational
  // squared-normal factor certify the lower area bound without accumulating
  // an enormous least-common denominator across independently cut vertices.
  return c.largestFixed*c.largestFixed*c.normSquared[0]*required[1]*required[1]>=4n*required[0]*required[0]*fixedDenominator*fixedDenominator*c.normSquared[1];
 });
 accepted.sort((a,b)=>{const x=a.largestFixed*a.largestFixed*a.normSquared[0]*b.normSquared[1],y=b.largestFixed*b.largestFixed*b.normSquared[0]*a.normSquared[1];return x===y?a.plane.planeHash.localeCompare(b.plane.planeHash):x>y?-1:1;});
 return Object.freeze(accepted.slice(0,maximumPlanes).map(c=>c.plane));
}
