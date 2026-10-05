import {exactHash,parseExactRational,exactRationalString,exactRational,createExactAuthority,validateExactFaceBirth} from './exact-geometry.mjs';
import {validateExactGridPlan,deriveExactGridOperands} from './exact-grid-plan.mjs';

// Review a fresh, trusted native grid arrangement. This validates its complete
// material-cell boundary, not a new independent CSG computation of the source.
// History/adoption/engraving are deliberately outside this initial-job format.
const LIMIT=200*1024*1024,hash=/^[a-f0-9]{64}$/;
const fail=message=>Object.assign(Error(`Exakte Rasteraufteilung ungültig: ${message}.`),{code:'EXACT_GRID_PARTITION_REJECTED'});
const cmp=(a,b)=>{const d=a[0]*b[1]-b[0]*a[1];return d<0n?-1:d>0n?1:0;};
const sub=(a,b)=>exactRational(a[0]*b[1]-b[0]*a[1],a[1]*b[1]);
const mul=(a,b)=>exactRational(a[0]*b[0],a[1]*b[1]);
function freeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const x of Object.values(value))freeze(x);Object.freeze(value);}return value;}
function reader(text){
 if(typeof text!=='string'||text.length>LIMIT||/[^\x09\x0a\x0d\x20-\x7e]/.test(text))throw fail('Dateigröße oder Zeichenkodierung');
 let offset=0;
 return {line(){if(offset>=text.length)throw fail('unvollständiger Zustand');let end=text.indexOf('\n',offset);if(end<0)end=text.length;const line=text.slice(offset,end).trim();offset=end+1;return line;},end(){if(text.slice(offset).trim())throw fail('zusätzliche Zustandsdaten');}};
}
function ints(line,length,min,max){const tokens=line.split(/\s+/);if(tokens.length!==length)throw fail('abweichende Zeilenlänge');return tokens.map(t=>{if(!/^-?(?:0|[1-9]\d*)$/.test(t)||t.length>12)throw fail('ungültiger Index');const n=Number(t);if(!Number.isSafeInteger(n)||n<min||n>max)throw fail('Index außerhalb der Grenze');return n;});}
function readState(text,plan,allowLegacyV2){
 const r=reader(text),magic=r.line(),v3=magic==='PRINJEKT_EXACT_PARTITION_3';if(!v3&&!(allowLegacyV2&&magic==='PRINJEKT_EXACT_PARTITION_2'))throw fail('nicht unterstützte Zustandsversion');
 const [labels,nv,nf,np,nc,nh]=ints(r.line(),6,0,8_000_001);
 if(labels!==4||nv<1||nv>2_000_000||nf<1||nf>4_000_000||np<1||np>nf||nc<1||nc>2*nf+1||nc*4>32*1024*1024||nh!==0||nv*6+nf*16+np*4+nc*12>text.length)throw fail('unzulässige Dimensionen oder Bearbeitungshistorie');
 const rule=ints(r.line(),v3?5:4,0,4096),owners=rule[0],grid=v3?rule[1]:1,counts=rule.slice(v3?2:1);
 if(grid!==1||owners!==counts.reduce((p,n)=>p*(n+1),1)||owners>4096||counts.some((n,i)=>n!==plan.counts[i]||n>32)||!v3&&counts.some(n=>n===0))throw fail('abweichende Rasterregel');
 const sizes=ints(r.line(),4,0,4_000_000),total=sizes.reduce((a,b)=>a+b,0);
 if(sizes[0]!==plan.sourceFaceCount||sizes.slice(1).some((n,i)=>n!==12*counts[i])||total>4_000_000)throw fail('abweichende Eingabeflächen');
 const vertices=[],unique=new Set();
 for(let i=0;i<nv;i++){
  const row=r.line().split(/\s+/);if(row.length!==3)throw fail('Punkt benötigt drei Koordinaten');const point=row.map(t=>exactRationalString(parseExactRational(t))),key=point.join(' ');
  if(unique.has(key))throw fail('mehrere Indizes für denselben exakten Punkt');unique.add(key);vertices.push(point);
 }
 unique.clear();
 const faces=new Int32Array(nf*3),birth=new Int32Array(nf),facePatches=new Int32Array(nf),savedOwners=new Int32Array(nf*2),patchLabels=new Int8Array(np).fill(-1),firstFaces=new Int32Array(np).fill(-1);
 const ends=[sizes[0],sizes[0]+sizes[1],sizes[0]+sizes[1]+sizes[2],total];
 for(let i=0;i<nf;i++){
  const f=ints(r.line(),8,-1,Math.max(nv,nf,total,owners,np));
  if(f.slice(0,3).some(x=>x<0||x>=nv)||new Set(f.slice(0,3)).size!==3||f[3]<0||f[3]>=total||f[4]<0||f[4]>=np||f[5]<0||f[5]>3||f.slice(6).some(x=>x< -1||x>=owners))throw fail('ungültige Fläche');
  let label=0;while(f[3]>=ends[label])label++;if(label!==f[5]||patchLabels[f[4]]!==-1&&patchLabels[f[4]]!==label)throw fail('widersprüchliche Flächenherkunft');
  faces.set(f.slice(0,3),i*3);birth[i]=f[3];facePatches[i]=f[4];savedOwners.set(f.slice(6),i*2);patchLabels[f[4]]=label;if(firstFaces[f[4]]<0)firstFaces[f[4]]=i;
 }
 const patches=new Int32Array(np*2);for(let i=0;i<np;i++){const p=ints(r.line(),2,0,nc-1);patches.set(p,i*2);if(firstFaces[i]<0)throw fail('leerer Flächenbereich');}
 const windings=new Int32Array(nc*4),cellOwners=new Int32Array(nc);
 for(let c=0;c<nc;c++){
  const row=ints(r.line(),6,-total,Math.max(total,owners));if(row.slice(0,4).some(w=>Math.abs(w)>total))throw fail('unbegrenzte Windungszahl');windings.set(row.slice(0,4),c*4);let expected=-1;
  if(row[0]>0){expected=0;let stride=1;for(let axis=0;axis<3;axis++){const w=row[axis+1];if(w<0||w>counts[axis])throw fail('Windungszahl außerhalb des Rasters');expected+=(counts[axis]-w)*stride;stride*=counts[axis]+1;}}
  if(row[4]!==expected||row[5]!==expected)throw fail('fehlende, doppelte oder veränderte Materialzuordnung');cellOwners[c]=expected;
 }
 r.end();
 for(let p=0;p<np;p++)for(let label=0;label<4;label++)if(windings[patches[p*2+1]*4+label]-windings[patches[p*2]*4+label]!==Number(patchLabels[p]===label))throw fail('widersprüchlicher Windungswechsel');
 const positiveArea=new Uint8Array(np);
 function nonzero(face){const points=[0,1,2].map(k=>vertices[faces[face*3+k]].map(parseExactRational)),u=points[1].map((x,k)=>sub(x,points[0][k])),v=points[2].map((x,k)=>sub(x,points[0][k]));return [[1,2],[2,0],[0,1]].some(([a,b])=>sub(mul(u[a],v[b]),mul(u[b],v[a]))[0]!==0n);}
 for(let i=0;i<nf;i++){
  const p=facePatches[i],a=patches[p*2],b=patches[p*2+1];if(savedOwners[i*2]!==cellOwners[a]||savedOwners[i*2+1]!==cellOwners[b])throw fail('abweichende gespeicherte Flächenseiten');
  if(!positiveArea[p]&&nonzero(i))positiveArea[p]=1;
 }
 if(positiveArea.some(x=>!x))throw fail('Kontaktbereich ohne positive Fläche');
 return {vertices,faces,birth,facePatches,patches,windings,cellOwners,sizes,owners,counts,nv,nf,np,nc,format:v3?3:2};
}
function bodies(state){
 const {nc,np,patches,cellOwners}=state,parent=Int32Array.from({length:nc},(_,i)=>i),root=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;};
 for(let i=0;i<np;i++){const a=patches[i*2],b=patches[i*2+1];if(cellOwners[a]>=0&&cellOwners[a]===cellOwners[b]){const ra=root(a),rb=root(b);parent[Math.max(ra,rb)]=Math.min(ra,rb);}}
 const groups=new Map();for(let c=0;c<nc;c++)if(cellOwners[c]>=0){const key=root(c);if(!groups.has(key))groups.set(key,{owner:cellOwners[c],cells:[]});groups.get(key).cells.push(c);}
 const result=[...groups.values()].sort((a,b)=>a.owner-b.owner||a.cells[0]-b.cells[0]);if(!result.length||result.length>4096)throw fail('unzulässige Anzahl Materialkörper');
 const bodyOfCell=new Int32Array(nc).fill(-1),components=new Map();result.forEach((b,i)=>{b.id=String(i+1);b.component=components.get(b.owner)||0;components.set(b.owner,b.component+1);b.cells.forEach(c=>{bodyOfCell[c]=i;});});
 return {result,bodyOfCell};
}
function bodySurfaces(state,bodyOfCell,count){
 const maps=Array.from({length:count},()=>new Map()),{nf,faces,facePatches,patches}=state;
 const add=(body,key,sign,face,direction)=>{if(body<0)return;const map=maps[body],entry=map.get(key)||[0,-1,0,-1,0];entry[0]+=sign;const slot=sign>0?1:3;if(entry[slot]<0){entry[slot]=face;entry[slot+1]=direction;}map.set(key,entry);};
 for(let i=0;i<nf;i++){
  const patch=facePatches[i],a=bodyOfCell[patches[patch*2]],b=bodyOfCell[patches[patch*2+1]];if(a===b)continue;
  const tri=Array.from(faces.subarray(i*3,i*3+3)),key=[...tri].sort((a,b)=>a-b).join(','),sign=((tri[0]>tri[1])+(tri[0]>tri[2])+(tri[1]>tri[2]))%2?-1:1;
  add(a,key,-sign,i,-1);add(b,key,sign,i,1);
 }
 return maps.map(map=>{const boundary=[];for(const entry of map.values()){if(!entry[0])continue;if(Math.abs(entry[0])!==1)throw fail('mehrfach belegte Materialgrenze');const slot=entry[0]>0?1:3;boundary.push([entry[slot],entry[slot+1]]);}map.clear();if(!boundary.length)throw fail('Materialkörper ohne vollständige Oberfläche');return boundary;});
}
function emitBody(state,boundary,body,plan){
 const {faces,vertices,birth}=state,used=new Set(),globalFaces=[];
 for(const [face,direction]of boundary){const tri=Array.from(faces.subarray(face*3,face*3+3));if(direction<0)tri.reverse();globalFaces.push(tri);tri.forEach(v=>used.add(v));}
 const ids=[...used].sort((a,b)=>a-b),map=new Map(ids.map((id,i)=>[id,i])),edges=new Map(),nv=ids.length;
 const limits=plan.counts.map((n,axis)=>{const stride=plan.counts.slice(0,axis).reduce((p,x)=>p*(x+1),1),index=Math.floor(body.owner/stride)%(n+1);return [parseExactRational(index===0?plan.bounds[0][axis]:plan.cuts[axis][index-1]),parseExactRational(index===n?plan.bounds[1][axis]:plan.cuts[axis][index])];});
 for(const id of ids)for(let k=0;k<3;k++){const value=parseExactRational(vertices[id][k]);if(cmp(value,limits[k][0])<0||cmp(value,limits[k][1])>0)throw fail('Materialpunkt außerhalb seiner Rasterzelle');}
 const local=globalFaces.map(tri=>tri.map(id=>map.get(id)));
 for(const tri of local)for(let k=0;k<3;k++){const a=tri[k],b=tri[(k+1)%3],key=Math.min(a,b)*nv+Math.max(a,b),entry=edges.get(key)||[0,0];entry[0]++;entry[1]+=a<b?1:-1;edges.set(key,entry);}
 let nonManifoldEdges=0,unbalancedEdges=0;for(const [count,winding]of edges.values()){if(count!==2)nonManifoldEdges++;if(winding)unbalancedEdges++;}
 if(unbalancedEdges)throw fail('offene oder widersprüchliche Körperkante');
 const meshText=['PRINJEKT_EXACT_MESH_1',`${nv} ${local.length}`,...ids.map(i=>vertices[i].join(' ')),...local.map(f=>f.join(' '))].join('\n')+'\n';if(meshText.length>LIMIT)throw fail('Körperdatei zu groß');
 return {meshText,meshHash:exactHash(meshText),vertexCount:nv,faceCount:local.length,nonManifoldEdges,faceBirth:boundary.map(([i])=>birth[i])};
}
function calculate(stateText,{sourceMeshText,plan,allowLegacyV2=false},materialize){
 plan=validateExactGridPlan(plan,sourceMeshText);const state=readState(stateText,plan,allowLegacyV2),{result:groups,bodyOfCell}=bodies(state),surfaces=bodySurfaces(state,bodyOfCell,groups.length);
 const operands=[{id:'source',role:'source',meshHash:plan.sourceMeshHash,faceCount:plan.sourceFaceCount},...deriveExactGridOperands(plan).map(({id,role,meshHash,faceCount})=>({id,role,meshHash,faceCount}))],parts=[],descriptors=[];
 for(let i=0;i<groups.length;i++){
  const emitted=emitBody(state,surfaces[i],groups[i],plan),descriptor={...groups[i],meshHash:emitted.meshHash,vertexCount:emitted.vertexCount,faceCount:emitted.faceCount,nonManifoldEdges:emitted.nonManifoldEdges};descriptors.push(descriptor);
  if(materialize){const provenance=validateExactFaceBirth({schema:'PRINJEKT_PARTITION_BIRTH_1',inputFaceCounts:state.sizes,faceBirth:emitted.faceBirth},emitted.faceCount,operands);parts.push({...descriptor,geometry:createExactAuthority({meshText:emitted.meshText,origin:{kind:'partition',operation:'partition',operands},provenance})});}
  surfaces[i]=null;
 }
 const metadata={kind:'exactGridPartition',version:1,frame:'assembly',stateFormat:state.format,stateHash:exactHash(stateText),sourceMeshHash:plan.sourceMeshHash,planHash:plan.planHash,counts:[...plan.counts],ownerCount:state.owners,bodyCount:groups.length,arrangementVertices:state.nv,arrangementFaces:state.nf,materialCells:groups.reduce((n,g)=>n+g.cells.length,0),parts:descriptors};
 const review=freeze({...metadata,stateText,authorityHash:exactHash(`EXACT_GRID_PARTITION_1\n${JSON.stringify(metadata)}`),reviewRequired:true,printable:false});
 return {review,parts:materialize?freeze(parts):undefined};
}
export function createExactGridPartitionReview(stateText,options){return calculate(stateText,options,false).review;}
export function validateExactGridPartitionReview(value,options){
 if(!value||value.kind!=='exactGridPartition'||typeof value.stateText!=='string'||!hash.test(value.authorityHash??''))throw fail('fehlender exakter Zustand');
 const expected=calculate(value.stateText,options,false).review;if(JSON.stringify(value)!==JSON.stringify(expected))throw fail('abweichende Rasterbindung');return expected;
}
export function materializeExactGridPartition(value,options){
 if(!value||value.kind!=='exactGridPartition'||typeof value.stateText!=='string'||!hash.test(value.authorityHash??''))throw fail('fehlender exakter Zustand');
 const result=calculate(value.stateText,options,true);if(JSON.stringify(value)!==JSON.stringify(result.review))throw fail('abweichende Rasterbindung');return result.parts;
}
