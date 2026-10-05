import {Vector3,Matrix4} from 'three';
import {layFlat,bounds} from './engine.mjs';
import {overhangMetrics} from './overhang-metrics.mjs';
import {transferInteriorSelection,transformMarkLocation} from './mark-locations.mjs';

// Group connected coplanar triangles, rather than treating the largest STL
// triangle as the largest face. A usable face must support the whole model.
export function largestSupportingFace(data,{tolerance=.05}={}){
 if(!data?.vertices?.length||!data?.triangles?.length||!Number.isFinite(tolerance)||tolerance<=0)throw Error('Kein gültiges Modell für die Flächensuche.');
 const buckets=new Map(),a=new Vector3(),b=new Vector3(),c=new Vector3(),normal=new Vector3(),areas=new Float64Array(data.triangles.length/3);
 for(let f=0;f<data.triangles.length;f+=3){
  a.fromArray(data.vertices,data.triangles[f]*3);b.fromArray(data.vertices,data.triangles[f+1]*3);c.fromArray(data.vertices,data.triangles[f+2]*3);normal.copy(b).sub(a).cross(c.clone().sub(a));const area=normal.length()/2;if(area<1e-9)continue;normal.normalize();const offset=normal.dot(a),key=[...normal.toArray().map(v=>Math.round(v*1000)),Math.round(offset/(2*tolerance))].join(',');
  let bucket=buckets.get(key);if(!bucket){bucket={normal:normal.toArray(),offset,area:0,maxTriangle:0,faces:[]};buckets.set(key,bucket);}bucket.area+=area;bucket.faces.push(f/3);areas[f/3]=area;if(area>bucket.maxTriangle){bucket.normal=normal.toArray();bucket.offset=offset;bucket.maxTriangle=area;}
 }
 let best=null;
 for(const bucket of [...buckets.values()].sort((a,b)=>b.area-a.area)){
  if(best&&bucket.area<best.area)break;const n=new Vector3(...bucket.normal);let maximum=-Infinity;
  for(let i=0;i<data.vertices.length;i+=3)maximum=Math.max(maximum,n.x*data.vertices[i]+n.y*data.vertices[i+1]+n.z*data.vertices[i+2]);
  if(maximum-bucket.offset>tolerance)continue;
  const parent=[],members=[],edges=new Map(),root=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;};
  for(const face of bucket.faces){
   const points=[0,1,2].map(k=>new Vector3().fromArray(data.vertices,data.triangles[face*3+k]*3));if(points.some(p=>Math.abs(p.dot(n)-bucket.offset)>tolerance))continue;
   const index=parent.length;parent.push(index);members.push(face);const keys=points.map(p=>p.toArray().map(x=>Math.round(x*1e5)).join(','));
   for(let k=0;k<3;k++){const x=keys[k],y=keys[(k+1)%3],key=x<y?`${x};${y}`:`${y};${x}`;if(edges.has(key))parent[root(index)]=root(edges.get(key));else edges.set(key,index);}
  }
  const groups=new Map();members.forEach((face,i)=>{const key=root(i),group=groups.get(key)||{area:0,faces:[]};group.area+=areas[face];group.faces.push(face);groups.set(key,group);});
  for(const group of groups.values())if(!best||group.area>best.area)best={normal:bucket.normal,offset:bucket.offset,area:group.area,faces:group.faces,tolerance};
 }
 if(!best)throw Error('Keine ebene äußere Fläche zum Auflegen gefunden. Eine Fläche am Modell auswählen.');return best;
}

export function orientOnLargestFace(data,options={}){
 const face=largestSupportingFace(data,options),result=layFlat(data,face.normal),box=bounds(result);
 if(Math.abs(box.min[2])>.05)throw Error('Die größte Fläche konnte nicht auf das Druckbett gelegt werden.');
 const local=new Matrix4().fromArray(result.transform).multiply(new Matrix4().fromArray(data.transform||new Matrix4().toArray()).invert());
 return {...data,...result,...transferInteriorSelection(data,local.toArray(),true),plannedMark:transformMarkLocation(data.plannedMark,local),mark:transformMarkLocation(data.mark,local),bedFace:'surface',bedContactArea:face.area,largestFace:{area:face.area,triangles:face.faces.length,tolerance:face.tolerance},requiresCutFace:false,overhang:overhangMetrics(result),supports:undefined};
}
