import {Vector3} from 'three';
import {topology} from './features.mjs';
import {exactInteriorFaceMask} from './interior-anchor-mask.mjs';

// Geometry-guided region proposals. No mesh booleans or cap construction here.
// This is deliberately a proposal generator, not a semantic object classifier.
export function suggestRegions(data,bed,progress=()=>{},maxProposals=80){
  if(!Array.isArray(bed)||bed.length!==3||bed.some(v=>!Number.isFinite(v)||v<=0))throw Error('Gültigen Bauraum für Schnittvorschläge wählen.');
  if(!Number.isInteger(maxProposals)||maxProposals<1||maxProposals>512)throw Error('1–512 Schnittvorschläge anfordern.');
  const interior=exactInteriorFaceMask(data),excluded=interior.excluded;
  if(interior.diagnostics.warning)progress(interior.diagnostics.warning);else if(interior.diagnostics.excludedSourceFaces)progress(`${interior.diagnostics.excludedSourceFaces} gespeicherte Innenflächen werden nicht als Schnittanker verwendet. Das Innenmaterial bleibt erhalten.`);
  const t=topology(data),count=t.triangles.length,areas=new Float32Array(count),centers=new Float32Array(count*3),adj=Array.from({length:count},()=>[]);
  // Blocking both seeds and adjacency also protects density flood-fill, smooth
  // growth and later attachment of tiny leftovers from crossing the mask.
  for(const e of t.edges.values())if(e.faces.length===2&&!excluded[e.faces[0]]&&!excluded[e.faces[1]]){adj[e.faces[0]].push(e.faces[1]);adj[e.faces[1]].push(e.faces[0]);}
  const candidates=[];
  t.triangles.forEach((tri,f)=>{const [a,b,c]=tri.map(id=>t.vertices[id]);areas[f]=b.clone().sub(a).cross(c.clone().sub(a)).length()/2;a.clone().add(b).add(c).multiplyScalar(1/3).toArray(centers,f*3);if(!excluded[f]&&areas[f]>.05&&t.normals[f].z>.15)candidates.push(f);});
  const smooth=new Float32Array(count*3);
  for(let f=0;f<count;f++){const n=t.normals[f].clone().multiplyScalar(areas[f]);for(const neighbor of adj[f])n.addScaledVector(t.normals[neighbor],areas[neighbor]);n.normalize().toArray(smooth,f*3);}
  const recognized=densityRegions(t,adj,areas,centers,smooth,candidates,bed,progress,maxProposals),proposals=[];
  // The final cutter uses the area-weighted surface normal. Validate against
  // that same frame, rather than the seed normal of a curved density group.
  for(const p of recognized){const fit=fitFaces(t,areas,p.faces,bed);if(fit)proposals.push({...p,estimatedSize:fit.size,normal:fit.normal.toArray()});}
  completeUncovered(t,adj,areas,centers,smooth,candidates,bed,proposals,maxProposals,progress);
  const covered=new Uint8Array(count);for(const p of proposals)for(const f of p.faces)covered[f]=1;
  let unassignedArea=0,eligibleUnassignedArea=0,unassignedFaces=0,excludedInteriorArea=0;for(let f=0;f<count;f++){if(excluded[f])excludedInteriorArea+=areas[f];if(!covered[f]){unassignedArea+=areas[f];unassignedFaces++;if(!excluded[f]&&areas[f]>.05&&t.normals[f].z>.15)eligibleUnassignedArea+=areas[f];}}
  // Callers can distinguish a requested proposal limit from complete coverage.
  // The opposite wall is assigned later by the through-wall preview, not here.
  proposals.coverage={unassignedArea,eligibleUnassignedArea,unassignedFaces,excludedInteriorArea,interiorMask:interior.diagnostics,limitReached:proposals.length>=maxProposals&&eligibleUnassignedArea>1};
  progress(`${proposals.length} Schnittvorschläge · ${Math.round(eligibleUnassignedArea)} mm² geeignete Oberfläche noch ohne Zuordnung${proposals.coverage.limitReached?' (Vorschlagslimit erreicht)':''}`);
  return proposals;
}

function frames(normal){
 const n=normal.clone().normalize(),u0=new Vector3(Math.abs(n.x)<.8?1:0,Math.abs(n.x)<.8?0:1,0).cross(n).normalize(),v0=n.clone().cross(u0),out=[];
 for(let angle=0;angle<Math.PI-1e-6;angle+=Math.PI/6){const u=u0.clone().multiplyScalar(Math.cos(angle)).addScaledVector(v0,Math.sin(angle));out.push([u,n.clone().cross(u),n]);}return out;
}
function fitFaces(t,areas,faces,bed){
 const normal=new Vector3(),vertices=new Set();let area=0;for(const f of faces){normal.addScaledVector(t.normals[f],areas[f]);area+=areas[f];for(const id of t.triangles[f])vertices.add(id);}if(normal.lengthSq()<1e-12)return null;normal.normalize();
 let best=null;for(const axes of frames(normal)){const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];let valid=true;for(const id of vertices){for(let k=0;k<3;k++){const x=t.vertices[id].dot(axes[k]);min[k]=Math.min(min[k],x);max[k]=Math.max(max[k],x);if(max[k]-min[k]>bed[k]*(k===2?.85:.995)){valid=false;break;}}if(!valid)break;}if(valid){const size=max.map((x,k)=>x-min[k]),score=size[0]*size[1];if(!best||score<best.score)best={normal,area,size,score};}}
 return best;
}
function describeFaces(t,areas,centers,faces,fit,method){
 const selected=new Set(faces),segments=[],center=new Vector3();let edgeLength=0,creaseLength=0;
 for(const f of faces){center.addScaledVector(new Vector3().fromArray(centers,f*3),areas[f]);const tri=t.triangles[f];for(let j=0;j<3;j++){const a=tri[j],b=tri[(j+1)%3],edge=t.edges.get(a<b?`${a},${b}`:`${b},${a}`);if(edge.faces.length===2&&edge.faces.every(g=>selected.has(g)))continue;const length=t.vertices[a].distanceTo(t.vertices[b]),other=edge.faces.find(g=>g!==f);edgeLength+=length;if(other!==undefined&&t.normals[f].dot(t.normals[other])<Math.cos(7*Math.PI/180))creaseLength+=length;segments.push(t.vertices[a].toArray(),t.vertices[b].toArray());}}
 return {faces,segments,area:fit.area,estimatedSize:fit.size,creaseFraction:edgeLength?creaseLength/edgeLength:0,seed:faces[0],normal:fit.normal.toArray(),center:center.divideScalar(Math.max(fit.area,1e-12)).toArray(),method};
}

// Density recognition supplies feature boundaries, but some complete features
// exceed the bed. Grow connected patches over the uncovered surface instead of
// silently dropping those features. Traversal prefers smooth, coarse faces;
// the bounds of a patch, not an arbitrary global grid, stop its growth.
function completeUncovered(t,adj,areas,centers,smooth,candidates,bed,proposals,limit,progress){
 const count=areas.length,owner=new Int32Array(count).fill(-1),deferred=new Uint8Array(count),seen=new Uint32Array(count);let stamp=0,added=0,attached=0;
 for(let i=0;i<proposals.length;i++)for(const f of proposals[i].faces)owner[f]=i;
 const nn=f=>new Vector3().fromArray(smooth,f*3),minArea=Math.min(600,bed[0]*bed[1]*.01);
 candidates.sort((a,b)=>areas[b]-areas[a]);
 function grow(seed,scale){
  const normal=nn(seed);if(normal.dot(t.normals[seed])<.5)normal.copy(t.normals[seed]);
  const states=frames(normal).map(axes=>({axes,min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity],valid:true})),heap=new Heap(),faces=[];++stamp;seen[seed]=stamp;heap.push([0,seed]);
  while(heap.items.length){const [cost,f]=heap.pop();if(owner[f]>=0||nn(f).dot(normal)<.35||t.normals[f].dot(normal)<.1)continue;
   const updates=[];for(const state of states){if(!state.valid)continue;const min=[...state.min],max=[...state.max];let valid=true;for(const id of t.triangles[f]){for(let k=0;k<3;k++){const x=t.vertices[id].dot(state.axes[k]);min[k]=Math.min(min[k],x);max[k]=Math.max(max[k],x);if(max[k]-min[k]>bed[k]*(k===2?.85:scale)){valid=false;break;}}if(!valid)break;}if(valid)updates.push({state,min,max});}
   if(!updates.length)continue;for(const state of states)state.valid=false;for(const update of updates)Object.assign(update.state,{min:update.min,max:update.max,valid:true});faces.push(f);
   for(const g of adj[f])if(owner[g]<0&&seen[g]!==stamp){seen[g]=stamp;const dx=centers[f*3]-centers[g*3],dy=centers[f*3+1]-centers[g*3+1],dz=centers[f*3+2]-centers[g*3+2],crease=1-Math.max(-1,Math.min(1,nn(f).dot(nn(g)))),density=1+Math.min(8,1/Math.max(areas[g],.05));heap.push([cost+Math.max(.001,Math.hypot(dx,dy,dz))*density*(1+crease*12),g]);}
  }return faces;
 }
 for(const seed of candidates){if(proposals.length>=limit)break;if(owner[seed]>=0||deferred[seed])continue;let faces,fit;
  for(let attempt=0;attempt<4;attempt++){faces=grow(seed,.98*Math.pow(.9,attempt));if(!faces.length)break;fit=fitFaces(t,areas,faces,bed);if(fit)break;}
  if(!fit||fit.area<minArea){for(const f of faces||[seed])deferred[f]=1;deferred[seed]=1;continue;}
  const id=proposals.length;for(const f of faces)owner[f]=id;proposals.push(describeFaces(t,areas,centers,faces,fit,'connected'));added++;if(added%10===0)progress(`${added} zusammenhängende Ergänzungen für zuvor zu große oder unzugeordnete Bereiche`);
 }
 // Small fragments stay with a touching printable patch where possible. They
 // never become tiny standalone proposals merely to claim complete coverage.
 const visited=new Uint8Array(count);
 for(let seed=0;seed<count;seed++){if(!deferred[seed]||owner[seed]>=0||visited[seed])continue;const faces=[seed];visited[seed]=1;let area=0;for(let q=0;q<faces.length;q++){const f=faces[q];area+=areas[f];for(const g of adj[f])if(deferred[g]&&owner[g]<0&&!visited[g]){visited[g]=1;faces.push(g);}}if(area>=minArea)continue;
  const neighbors=new Map();for(const f of faces)for(const g of adj[f])if(owner[g]>=0)neighbors.set(owner[g],(neighbors.get(owner[g])||0)+1);
  for(const [id]of [...neighbors].sort((a,b)=>b[1]-a[1])){const joined=[...proposals[id].faces,...faces],fit=fitFaces(t,areas,joined,bed);if(!fit)continue;proposals[id]=describeFaces(t,areas,centers,joined,fit,proposals[id].method);for(const f of faces)owner[f]=id;attached++;break;}
 }
 if(added||attached)progress(`${added} zusätzliche zusammenhängende Vorschläge · ${attached} kleine Randbereiche an Nachbarteile angefügt`);
}

class Heap{
  constructor(){this.items=[];}
  push(item){const a=this.items;a.push(item);let i=a.length-1;while(i>0){const p=(i-1)>>1;if(a[p][0]<=item[0])break;a[i]=a[p];i=p;}a[i]=item;}
  pop(){const a=this.items,first=a[0],last=a.pop();if(a.length){let i=0;while(i*2+1<a.length){let c=i*2+1;if(c+1<a.length&&a[c+1][0]<a[c][0])c++;if(a[c][0]>=last[0])break;a[i]=a[c];i=c;}a[i]=last;}return first;}
}
function densityRegions(t,adj,areas,centers,smooth,candidates,bed,progress,maxProposals){
  const distribution=candidates.map(f=>areas[f]).sort((a,b)=>a-b);if(distribution.length<100)return[];
  const median=distribution[Math.floor(distribution.length*.5)],threshold=distribution[Math.floor(distribution.length*.9)];
  if(threshold<median*5)return[];
  const count=areas.length,seen=new Uint8Array(count),owner=new Int32Array(count).fill(-1),distance=new Float64Array(count).fill(Infinity),groups=[];
  const nn=f=>new Vector3().fromArray(smooth,f*3),cc=f=>new Vector3().fromArray(centers,f*3);
  for(const seed of candidates){if(seen[seed]||areas[seed]<threshold)continue;const queue=[seed];seen[seed]=1;let area=0;const normal=new Vector3();for(let q=0;q<queue.length;q++){const f=queue[q];area+=areas[f];normal.addScaledVector(nn(f),areas[f]);for(const g of adj[f])if(!seen[g]&&areas[g]>=threshold&&nn(f).dot(nn(g))>.87&&nn(seed).dot(nn(g))>.6){seen[g]=1;queue.push(g);}}
    if(area<Math.min(400,bed[0]*bed[1]*.006)||queue.length<4)continue;const id=groups.length;groups.push({id,faces:[],normal:normal.normalize(),area:0,neighbors:new Set(),vertices:new Set()});for(const f of queue){owner[f]=id;distance[f]=0;}
  }
  if(groups.length<3||groups.length>2000)return[];progress(`${groups.length} Flächenkerne aus der Netzdichte erkannt`);
  const heap=new Heap();for(let f=0;f<count;f++)if(owner[f]>=0)heap.push([0,f,owner[f]]);
  while(heap.items.length){const [cost,f,id]=heap.pop();if(cost!==distance[f]||owner[f]!==id)continue;for(const g of adj[f]){
    if(nn(g).dot(groups[id].normal)<.25)continue;const length=cc(f).distanceTo(cc(g)),densityPenalty=1+Math.min(10,threshold/Math.max(areas[g],.02)),next=cost+Math.max(.001,length)*densityPenalty;
    if(next<distance[g]){distance[g]=next;owner[g]=id;heap.push([next,g,id]);}
  }}
  for(let f=0;f<count;f++)if(owner[f]>=0){const g=groups[owner[f]];g.faces.push(f);g.area+=areas[f];for(const v of t.triangles[f])g.vertices.add(v);}
  for(const e of t.edges.values())if(e.faces.length===2){const [a,b]=e.faces.map(f=>owner[f]);if(a>=0&&b>=0&&a!==b){groups[a].neighbors.add(b);groups[b].neighbors.add(a);}}
  const parent=groups.map((_,i)=>i),root=i=>{while(parent[i]!==i)i=parent[i];return i;};
  function fitting(a,b){const normal=a.normal.clone().multiplyScalar(a.area).addScaledVector(b?.normal||a.normal,b?.area||0).normalize(),u0=new Vector3(Math.abs(normal.x)<.8?1:0,Math.abs(normal.x)<.8?0:1,0).cross(normal).normalize(),v0=normal.clone().cross(u0),vertices=b?[...a.vertices,...b.vertices]:[...a.vertices];
    for(let angle=0;angle<Math.PI;angle+=Math.PI/6){const u=u0.clone().multiplyScalar(Math.cos(angle)).addScaledVector(v0,Math.sin(angle)),v=normal.clone().cross(u),axes=[u,v,normal],min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];let tooLarge=false;for(const id of vertices){const p=t.vertices[id];for(let k=0;k<3;k++){const x=p.dot(axes[k]);min[k]=Math.min(min[k],x);max[k]=Math.max(max[k],x);if(max[k]-min[k]>bed[k]*(k===2?.85:.995)){tooLarge=true;break;}}if(tooLarge)break;}if(!tooLarge)return max.map((x,i)=>x-min[i]);}return null;
  }
  let merges=0;
  for(;;){let best=null;for(const a of groups){if(parent[a.id]!==a.id)continue;for(const other of a.neighbors){const id=root(other);if(id<=a.id)continue;const b=groups[id],score=a.area+b.area;if(best&&score<=best.score)continue;const size=fitting(a,b);if(size)best={a,b,size,score};}}
    if(!best)break;const {a,b}=best;a.normal.multiplyScalar(a.area).addScaledVector(b.normal,b.area).normalize();a.area+=b.area;a.faces.push(...b.faces);for(const v of b.vertices)a.vertices.add(v);for(const id of b.neighbors)a.neighbors.add(root(id));parent[b.id]=a.id;a.neighbors.delete(a.id);a.neighbors.delete(b.id);merges++;
  }
  progress(`${merges} benachbarte Oberflächenbereiche für den Bauraum zusammengefasst`);
  const proposals=[];
  for(const g of groups){if(parent[g.id]!==g.id||!g.faces.length)continue;const size=fitting(g);if(!size)continue;const segments=[];let edgeLength=0,creaseLength=0;
    for(const f of g.faces){const tri=t.triangles[f];for(let j=0;j<3;j++){const a=tri[j],b=tri[(j+1)%3],edge=t.edges.get(a<b?`${a},${b}`:`${b},${a}`);if(edge.faces.length===2&&edge.faces.every(other=>owner[other]>=0&&root(owner[other])===g.id))continue;const length=t.vertices[a].distanceTo(t.vertices[b]);edgeLength+=length;const other=edge.faces.find(other=>other!==f);if(areas[f]<threshold||other!==undefined&&areas[other]<threshold)creaseLength+=length;segments.push(t.vertices[a].toArray(),t.vertices[b].toArray());}}
    if(!edgeLength)continue;proposals.push({faces:g.faces,segments,area:g.area,estimatedSize:size,creaseFraction:creaseLength/edgeLength,seed:g.faces[0],normal:g.normal.toArray(),center:cc(g.faces[0]).toArray(),method:'density',densityThreshold:threshold});
  }
  return proposals.sort((a,b)=>b.area/(1+b.estimatedSize[2]**2/400)-a.area/(1+a.estimatedSize[2]**2/400)).slice(0,maxProposals);
}
