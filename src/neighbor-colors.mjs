import {BufferGeometry,BufferAttribute,Matrix4} from 'three';
import {MeshBVH} from 'three-mesh-bvh';

function adjacency(graph){
 const neighbors=Array.from({length:graph.length},()=>new Set());
 graph.forEach((links,i)=>{for(const j of links){if(!Number.isInteger(j)||j<0||j>=graph.length||j===i)throw Error('Ungültige Teilnachbarschaft.');neighbors[i].add(j);neighbors[j].add(i);}});
 return neighbors;
}
export function colorGraph(graph,palette){
 if(!Array.isArray(palette)||!palette.length||palette.some(c=>typeof c!=='string'||!/^#[0-9a-f]{6}$/i.test(c)))throw Error('Mindestens eine gültige Farbe festlegen.');
 const colors=[...new Set(palette.map(c=>c.toLowerCase()))],neighbors=adjacency(graph),assigned=Array(graph.length).fill(-1);
 function next(){
  let chosen=-1,saturation=-1,forbidden;
  for(let i=0;i<graph.length;i++){
   if(assigned[i]>=0)continue;
   const used=new Set([...neighbors[i]].map(j=>assigned[j]).filter(c=>c>=0));
   if(used.size>saturation||(used.size===saturation&&neighbors[i].size>(neighbors[chosen]?.size??-1))){chosen=i;saturation=used.size;forbidden=used;}
  }
  return {chosen,forbidden};
 }
 // DSATUR normally suffices for a roof's sparse contact graph. A greedy dead end
 // does not prove palette exhaustion, so retry it with bounded backtracking.
 let greedy=true;
 for(let step=0;step<graph.length;step++){
  const {chosen,forbidden}=next(),c=colors.findIndex((_,i)=>!forbidden.has(i));
  if(c<0){greedy=false;break;}assigned[chosen]=c;
 }
 if(!greedy){
  assigned.fill(-1);let visited=0;const deadline=performance.now()+2500;
  function search(remaining,usedCount){
   if(!remaining)return true;
   if(++visited>25000||performance.now()>deadline)throw Error('Für diese Palette wurde noch keine konfliktfreie Zuordnung gefunden. Weitere unterschiedliche Farben festlegen oder Aufteilung ändern.');
   const {chosen,forbidden}=next();
   // Unused colors are interchangeable; test only the next new color.
   for(let c=0;c<Math.min(colors.length,usedCount+1);c++){
    if(forbidden.has(c))continue;
    assigned[chosen]=c;if(search(remaining-1,Math.max(usedCount,c+1)))return true;assigned[chosen]=-1;
   }
   return false;
  }
  if(!search(graph.length,0))throw Error('Die Palette reicht für diese Nachbarschaften nicht aus. Weitere unterschiedliche Farben festlegen oder Aufteilung ändern.');
 }
 return assigned.map(i=>colors[i]);
}

// Contacts are tested in assembly coordinates, independently of print poses or
// explosion offsets. Point/edge contacts count too: their parts must differ.
export function neighborGraph(parts,{preview=false,tolerance=.1}={}){
 if(!Number.isFinite(tolerance)||tolerance<=0)throw Error('Die Kontakttoleranz muss größer als null sein.');
 const geometries=[],graph=parts.map(()=>new Set()),identity=new Matrix4();let edges=0;
 try{
  for(const p of parts){
   const g=new BufferGeometry();geometries.push(g);
   g.setAttribute('position',new BufferAttribute(new Float32Array(p.vertices),3));g.setIndex(new BufferAttribute(new Uint32Array(p.triangles),1));
   const m=new Matrix4();if(preview&&p.transform)m.fromArray(p.transform).invert();else if(!preview&&p.assemblyMatrix)m.fromArray(p.assemblyMatrix);
   g.applyMatrix4(m);g.computeBoundingBox();g.boundsTree=new MeshBVH(g,{indirect:true});
  }
  for(let i=0;i<parts.length;i++)for(let j=i+1;j<parts.length;j++){
   if(!geometries[i].boundingBox.clone().expandByScalar(tolerance).intersectsBox(geometries[j].boundingBox))continue;
   const hit=geometries[i].boundsTree.closestPointToGeometry(geometries[j],identity,{},null,Math.min(.001,tolerance),tolerance);
   if(hit&&hit.distance<=tolerance){graph[i].add(j);graph[j].add(i);edges++;}
  }
  return {neighbors:graph.map(s=>[...s]),edges};
 }finally{geometries.forEach(g=>g.dispose());}
}
export function neighborColors(parts,palette,options={}){
 const result=neighborGraph(parts,options);
 return {...result,colors:colorGraph(result.neighbors,palette)};
}
