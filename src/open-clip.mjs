// Partition existing surface triangles with an extruded 2D contour. This never
// creates closing faces: every output vertex remains on its input triangle.
const compiled=new WeakMap();
const dot=(p,v)=>p[0]*v[0]+p[1]*v[1]+p[2]*v[2];
function prepare(definition){
 if(compiled.has(definition))return compiled.get(definition);
 const {u,v,n,min,max,contours}=definition,epsilon=definition.epsilon??1e-8;
 if(![u,v,n].every(axis=>Array.isArray(axis)&&axis.length===3&&axis.every(Number.isFinite))||!Number.isFinite(min)||!Number.isFinite(max)||min>max||!Number.isFinite(epsilon)||epsilon<=0||!Array.isArray(contours))throw Error('Ungültige Kontur für die offene Schnittvorschau.');
 const edges=[],bounds=[Infinity,Infinity,-Infinity,-Infinity];
 for(const contour of contours){
  if(!Array.isArray(contour)||contour.length<3||contour.some(p=>!Array.isArray(p)||p.length<2||!p.slice(0,2).every(Number.isFinite)))throw Error('Ungültiger Konturumriss für die offene Schnittvorschau.');
  for(let i=0;i<contour.length;i++){
   const a=contour[i],b=contour[(i+1)%contour.length],dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);
   bounds[0]=Math.min(bounds[0],a[0]);bounds[1]=Math.min(bounds[1],a[1]);bounds[2]=Math.max(bounds[2],a[0]);bounds[3]=Math.max(bounds[3],a[1]);
   if(length<=epsilon)continue;
   const nx=-dy/length,ny=dx/length;
   edges.push({a,b,nx,ny,offset:nx*a[0]+ny*a[1],bounds:[Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.max(a[0],b[0]),Math.max(a[1],b[1])]});
  }
 }
 const result={u,v,n,min,max,edges,bounds,epsilon};compiled.set(definition,result);return result;
}
function polygonBounds(poly){const bounds=[Infinity,Infinity,-Infinity,-Infinity];for(const p of poly){bounds[0]=Math.min(bounds[0],p[3]);bounds[1]=Math.min(bounds[1],p[4]);bounds[2]=Math.max(bounds[2],p[3]);bounds[3]=Math.max(bounds[3],p[4]);}return bounds;}
function overlaps(a,b,epsilon){return a[0]<=b[2]+epsilon&&a[2]>=b[0]-epsilon&&a[1]<=b[3]+epsilon&&a[3]>=b[1]-epsilon;}
function splitPolygon(poly,distance,epsilon){
 const distances=poly.map(p=>{const d=distance(p);return Math.abs(d)<=epsilon?0:d;});
 if(!distances.some(d=>d>0)||!distances.some(d=>d<0))return [poly];
 const positive=[],negative=[];
 for(let i=0;i<poly.length;i++){
  const a=poly[i],b=poly[(i+1)%poly.length],da=distances[i],db=distances[(i+1)%poly.length];
  if(da>=0)positive.push(a);if(da<=0)negative.push(a);
  if((da>0&&db<0)||(da<0&&db>0)){
   const t=da/(da-db),point=a.map((value,j)=>value+(b[j]-value)*t);positive.push(point);negative.push(point);
  }
 }
 return [positive,negative].filter(p=>p.length>=3);
}
function insideContour(x,y,{edges,epsilon}){
 let winding=0;
 for(const edge of edges){
  const {a,b,nx,ny,offset,bounds}=edge,side=nx*x+ny*y-offset;
  if(Math.abs(side)<=epsilon&&x>=bounds[0]-epsilon&&x<=bounds[2]+epsilon&&y>=bounds[1]-epsilon&&y<=bounds[3]+epsilon)return true;
  if(a[1]<=y){if(b[1]>y&&side>0)winding++;}else if(b[1]<=y&&side<0)winding--;
 }
 return winding!==0;
}
function triangles(poly,target){
 for(let i=1;i<poly.length-1;i++){
  const a=poly[0],b=poly[i],c=poly[i+1],ab=[b[0]-a[0],b[1]-a[1],b[2]-a[2]],ac=[c[0]-a[0],c[1]-a[1],c[2]-a[2]],cross=[ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]];
  if(dot(cross,cross)>1e-24)target.push([a.slice(0,3),b.slice(0,3),c.slice(0,3)]);
 }
}
export function clipTriangleByPrism(triangle,definition){
 const prism=prepare(definition),{u,v,n,min,max,edges,bounds,epsilon}=prism,inside=[],outside=[];
 const original=triangle.map(p=>[p[0],p[1],p[2],dot(p,u),dot(p,v),dot(p,n)]);
 if(!overlaps(polygonBounds(original),bounds,epsilon)||original.every(p=>p[5]<min-epsilon)||original.every(p=>p[5]>max+epsilon)){triangles(original,outside);return {inside,outside};}
 let cells=splitPolygon(original,p=>p[5]-min,epsilon).flatMap(poly=>splitPolygon(poly,p=>p[5]-max,epsilon));
 cells=cells.filter(poly=>{const z=poly.reduce((sum,p)=>sum+p[5],0)/poly.length;if(z<min-epsilon||z>max+epsilon){triangles(poly,outside);return false;}return true;});
 for(const edge of edges){
  cells=cells.flatMap(poly=>overlaps(polygonBounds(poly),edge.bounds,epsilon)?splitPolygon(poly,p=>edge.nx*p[3]+edge.ny*p[4]-edge.offset,epsilon):[poly]);
 }
 for(const poly of cells){const x=poly.reduce((sum,p)=>sum+p[3],0)/poly.length,y=poly.reduce((sum,p)=>sum+p[4],0)/poly.length;triangles(poly,insideContour(x,y,prism)?inside:outside);}
 return {inside,outside};
}
// A point classifier shared by the preview's ownership and display walls.
export function pointInsidePrism(point,definition){
 const prism=prepare(definition),z=dot(point,prism.n);
 if(z<prism.min-prism.epsilon||z>prism.max+prism.epsilon)return false;
 const x=dot(point,prism.u),y=dot(point,prism.v);
 if(x<prism.bounds[0]-prism.epsilon||x>prism.bounds[2]+prism.epsilon||y<prism.bounds[1]-prism.epsilon||y>prism.bounds[3]+prism.epsilon)return false;
 return insideContour(x,y,prism);
}
