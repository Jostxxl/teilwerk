import {Vector3,CatmullRomCurve3,BufferGeometry,BufferAttribute,Ray,DoubleSide} from 'three';
import {MeshBVH} from 'three-mesh-bvh';
import {surfaceCutPreview,cutSurfacePatch,cutterFromDefinition} from './features.mjs';
import {resolveContourDepth} from './contour-depth.mjs';

// A local projected loop defines a ruled cutting wall. Sampling and validation
// are shared by preview and boolean so spline mode cannot silently use chords.
export function drawnContour(points,normals,style='line') {
  if(!Array.isArray(points)||points.length<3||points.length>128||
    points.some(p=>!Array.isArray(p)||p.length!==3||!p.every(Number.isFinite)))
    throw Error('Eine geschlossene Kontur mit 3–128 Punkten zeichnen.');
  if(!Array.isArray(normals)||normals.length!==points.length||normals.some(p=>!Array.isArray(p)||p.length!==3||!p.every(Number.isFinite)))
    throw Error('Oberflächennormalen der Kontur fehlen.');
  if(!['line','spline'].includes(style))throw Error('Unbekannte Kurvenart.');
  const anchors=points.map(p=>new Vector3(...p)),n=new Vector3();
  normals.forEach(p=>n.add(new Vector3(...p).normalize()));
  if(n.lengthSq()<.01)throw Error('Kontur auf einen zusammenhängenden Wandbereich begrenzen.');
  n.normalize();
  if(normals.some(p=>new Vector3(...p).normalize().dot(n)<.2))
    throw Error('Die Kontur läuft um eine zu starke Biegung. Kleineren Bereich wählen.');
  const u=new Vector3(Math.abs(n.x)<.8?1:0,Math.abs(n.x)<.8?0:1,0).cross(n).normalize(),v=n.clone().cross(u);
  let samples=[];
  if(style==='spline') samples=new CatmullRomCurve3(anchors,true,'centripetal').getPoints(Math.min(1024,Math.max(64,points.length*16))).slice(0,-1);
  else anchors.forEach((a,i)=>{const b=anchors[(i+1)%anchors.length],steps=Math.min(128,Math.max(1,Math.ceil(a.distanceTo(b)/2)));for(let k=0;k<steps;k++)samples.push(a.clone().lerp(b,k/steps));});
  const polygon=samples.map(p=>[p.dot(u),p.dot(v)]);
  const orient=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  const on=(a,b,p)=>Math.abs(orient(a,b,p))<1e-7&&p.every((x,i)=>x>=Math.min(a[i],b[i])-1e-7&&x<=Math.max(a[i],b[i])+1e-7);
  for(let i=0;i<polygon.length;i++){
    const a=polygon[i],b=polygon[(i+1)%polygon.length];
    if(Math.hypot(a[0]-b[0],a[1]-b[1])<1e-5)throw Error('Kontur enthält doppelte oder zu nahe Punkte.');
    for(let j=i+2;j<polygon.length;j++){
      if(i===0&&j===polygon.length-1)continue;
      const c=polygon[j],d=polygon[(j+1)%polygon.length];
      if((orient(a,b,c)*orient(a,b,d)<0&&orient(c,d,a)*orient(c,d,b)<0)||on(a,b,c)||on(a,b,d)||on(c,d,a)||on(c,d,b))
        throw Error('Die Kontur kreuzt oder berührt sich selbst. Punkte korrigieren.');
    }
  }
  const area=polygon.reduce((sum,a,i)=>{const b=polygon[(i+1)%polygon.length];return sum+a[0]*b[1]-b[0]*a[1];},0)/2;
  if(Math.abs(area)<1)throw Error('Die Kontur umschließt keine ausreichend große Fläche.');
  if(area<0){polygon.reverse();samples.reverse();}
  const heights=samples.map(p=>p.dot(n));
  return {contours:[polygon],samples,u,v,n,min:Math.min(...heights),max:Math.max(...heights)};
}
function prepare(api,data,points,normals,style,depth){
  if(!Number.isFinite(depth)||depth<.5||depth>100)throw Error('Schnitttiefe 0,5–100 mm wählen.');
  const frame=drawnContour(points,normals,style);
  const geometry=new BufferGeometry();geometry.setAttribute('position',new BufferAttribute(new Float32Array(data.vertices),3));geometry.setIndex(new BufferAttribute(new Uint32Array(data.triangles),1));
  try{
    const tree=new MeshBVH(geometry,{indirect:true});let top=-Infinity;
    for(let i=0;i<data.vertices.length;i+=3)top=Math.max(top,new Vector3().fromArray(data.vertices,i).dot(frame.n));
    const surface=frame.samples.map(reference=>{
      const origin=reference.clone().addScaledVector(frame.n,top+1-reference.dot(frame.n));
      const hits=tree.raycast(new Ray(origin,frame.n.clone().negate()),DoubleSide);
      hits.sort((a,b)=>a.point.distanceToSquared(reference)-b.point.distanceToSquared(reference));
      if(!hits.length){
        const nearest=tree.closestPointToPoint(reference);
        if(nearest&&nearest.distance<=1)return nearest.point;
        throw Error(`Ein Abschnitt liegt außerhalb der gewählten Wand (${nearest?.distance.toFixed(1)??'?'} mm Abstand). Konturpunkte enger setzen oder verschieben.`);
      }
      if(hits[0].point.distanceTo(reference)>Math.max(5,depth))throw Error('Ein Abschnitt liegt außerhalb der gewählten Wand. Konturpunkte enger setzen oder verschieben.');
      return hits[0].point;
    });
    frame.contours=[surface.map(p=>[p.dot(frame.u),p.dot(frame.v)])];frame.surfaceContours=[surface];frame.min=Math.min(...surface.map(p=>p.dot(frame.n)));frame.max=Math.max(...surface.map(p=>p.dot(frame.n)));
  }finally{geometry.dispose();}
  const definition=resolveContourDepth(data,{contours:frame.contours,u:frame.u.toArray(),v:frame.v.toArray(),n:frame.n.toArray(),min:frame.min-depth,max:frame.max+1,surfaceMin:frame.min,surfaceMax:frame.max});
  return {...cutterFromDefinition(api,definition),surfaceContours:frame.surfaceContours};
}
export function drawnPreview(api,data,points,normals,style,depth){
  const result=surfaceCutPreview(api,data,[],depth,prepare(api,data,points,normals,style,depth));
  if(result.missed)throw Error('Ein Abschnitt liegt außerhalb der Oberfläche. Konturpunkte enger setzen oder verschieben.');
  return {...result,smoothing:0};
}
export function drawnCut(api,data,points,normals,style,depth){
  return cutSurfacePatch(api,data,[],depth,prepare(api,data,points,normals,style,depth));
}
export function adoptDrawn(api,data,faces,depth,lineTolerance=0){
  const patch=surfaceCutPreview(api,data,faces,depth,null,lineTolerance);
  if(patch.contoursOnSurface?.length!==1)throw Error('Auswahl hat mehrere Randkonturen. Einen einfacheren Bereich wählen oder neu zeichnen.');
  if(patch.contoursOnSurface[0].some(p=>!p))throw Error('Die Randkontur liegt teilweise außerhalb der Wand. Einen kleineren Bereich wählen oder neu zeichnen.');
  const points=patch.contoursOnSurface[0].map(p=>new Vector3(...p));
  const geometry=new BufferGeometry();geometry.setAttribute('position',new BufferAttribute(new Float32Array(data.vertices),3));geometry.setIndex(new BufferAttribute(new Uint32Array(data.triangles),1));
  try{
    const tree=new MeshBVH(geometry,{indirect:true}),lengths=points.map((p,i)=>p.distanceTo(points[(i+1)%points.length])),total=lengths.reduce((a,b)=>a+b,0),count=Math.min(64,points.length),anchors=[];let edge=0,start=0;
    for(let i=0;i<count;i++){
      const distance=i*total/count;while(edge<points.length-1&&start+lengths[edge]<distance){start+=lengths[edge++];}
      const reference=points[edge].clone().lerp(points[(edge+1)%points.length],lengths[edge]?(distance-start)/lengths[edge]:0),hit=tree.closestPointToPoint(reference);
      if(!hit)throw Error('Konturpunkt konnte nicht auf die Oberfläche gesetzt werden.');
      anchors.push(hit.point.toArray());
    }
    return {points:anchors,normals:anchors.map(()=>patch.normal)};
  }finally{geometry.dispose();}
}
