import {Box3,Matrix4,Vector3} from 'three';
import {neighborGraph} from './neighbor-colors.mjs';

/** Plan in assembly coordinates. A step only joins its already built component;
 * separate geometric components are explicitly started as separate groups. */
export function assemblyOrder(parts,{neighbors,tolerance=.1,upDirection=[0,0,1]}={}){
 const up=new Vector3(...upDirection).normalize();if(!Number.isFinite(up.lengthSq())||up.lengthSq()<.5)throw Error('Ungültige Oben-Richtung für die Montage.');const right=new Vector3(1,0,0).projectOnPlane(up);if(right.lengthSq()<1e-10)right.set(0,1,0).projectOnPlane(up);right.normalize();const forward=up.clone().cross(right);
 const graph=neighbors?{neighbors,edges:0}:neighborGraph(parts,{tolerance});
 if(!Array.isArray(graph.neighbors)||graph.neighbors.length!==parts.length)throw Error('Ungültige Montagenachbarschaft.');
 const links=parts.map(()=>new Set());for(let i=0;i<parts.length;i++)for(const j of graph.neighbors[i]){if(!Number.isInteger(j)||j<0||j>=parts.length||i===j)throw Error('Ungültige Montagenachbarschaft.');links[i].add(j);links[j].add(i);}
 const all=new Box3(),point=new Vector3(),stats=parts.map(part=>{const box=new Box3(),matrix=new Matrix4().fromArray(part.assemblyMatrix||new Matrix4().toArray()),low=[Infinity,Infinity,Infinity],high=[-Infinity,-Infinity,-Infinity];for(let i=0;i<part.vertices.length;i+=3){box.expandByPoint(point.fromArray(part.vertices,i).applyMatrix4(matrix));[right,forward,up].forEach((axis,k)=>{const value=point.dot(axis);low[k]=Math.min(low[k],value);high[k]=Math.max(high[k],value);});}if(box.isEmpty())throw Error('Leeres Teil in der Montageanleitung.');all.union(box);const center=box.getCenter(new Vector3());return {box,center,minHeight:low[2],maxHeight:high[2],centerHeight:(low[2]+high[2])/2,footprint:(high[0]-low[0])*(high[1]-low[1])};});
 const height=parts.length?Math.max(...stats.map(s=>s.maxHeight))-Math.min(...stats.map(s=>s.minHeight)):0,band=Math.max(.1,height*.015),seen=new Set(),components=[];
 for(let seed=0;seed<parts.length;seed++){if(seen.has(seed))continue;const indices=[seed];seen.add(seed);for(let q=0;q<indices.length;q++)for(const j of links[indices[q]])if(!seen.has(j)){seen.add(j);indices.push(j);}const lowest=Math.min(...indices.map(i=>stats[i].minHeight)),start=indices.filter(i=>stats[i].minHeight<=lowest+band).sort((a,b)=>stats[b].footprint-stats[a].footprint||stats[a].centerHeight-stats[b].centerHeight||a-b)[0];components.push({indices,start,lowest});}
 components.sort((a,b)=>a.lowest-b.lowest||stats[b.start].footprint-stats[a.start].footprint||a.start-b.start);
 const order=[],steps=[];components.forEach((component,componentIndex)=>{const pending=new Set(component.indices),built=new Set(),local=[];let next=component.start;
  while(pending.size){if(built.size){const frontier=[...pending].filter(i=>[...links[i]].some(j=>built.has(j)));if(!frontier.length)throw Error('Zusammenhängende Montagereihenfolge konnte nicht ermittelt werden.');frontier.sort((a,b)=>stats[a].centerHeight-stats[b].centerHeight||[...links[b]].filter(i=>built.has(i)).length-[...links[a]].filter(i=>built.has(i)).length||stats[b].footprint-stats[a].footprint||a-b);next=frontier[0];}
   const contacts=[...links[next]].filter(i=>built.has(i)).sort((a,b)=>order.indexOf(a)-order.indexOf(b));steps.push({index:next,step:steps.length+1,component:componentIndex,componentStep:local.length+1,contacts,isStart:!built.size});order.push(next);local.push(next);built.add(next);pending.delete(next);
  }component.order=local;
 });
 return {order,steps,components:components.map(({indices,start,order})=>({indices,start,order})),neighbors:links.map(s=>[...s]),edges:links.reduce((sum,s)=>sum+s.size,0)/2,stats,bounds:all};
}

export function paginateGuideEntries(entries,{maxLines=32,lineLength=76}={}){
 const pages=[];let page=[],lines=0;for(const entry of entries){const text=String(entry.text??entry);for(let offset=0;offset<Math.max(1,text.length);offset+=lineLength*5){const piece={...entry,text:text.slice(offset,offset+lineLength*5),continuation:offset>0},weight=Math.max(1,Math.ceil(piece.text.length/lineLength))+Math.max(1,Math.ceil(String(entry.kind||'').length/lineLength));if(page.length&&lines+weight>maxLines){pages.push(page);page=[];lines=0;}page.push(piece);lines+=weight;}}if(page.length)pages.push(page);return pages;
}
