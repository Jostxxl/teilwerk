import {Box3,Vector3,BufferGeometry,BufferAttribute,Ray,DoubleSide} from 'three';
import {MeshBVH} from 'three-mesh-bvh';
import {clipTriangleByPrism,pointInsidePrism} from './open-clip.mjs';

const EPS=1e-5,MARGIN=.05;
const dot=(p,n)=>p[0]*n[0]+p[1]*n[1]+p[2]*n[2];
function unsafe(message){const error=Error(`Kontur nicht sicher durchtrennbar: ${message} Eine kleinere Kontur oder einen weniger stark gebogenen Wandbereich wählen.`);error.code='UNSAFE_CONTOUR_DEPTH';return error;}

// One context can be shared by an entire proposal batch. It owns only its BVH
// geometry, never the caller's arrays or a native solid.
export function createContourDepthContext(data){
 const geometry=new BufferGeometry();geometry.setAttribute('position',new BufferAttribute(new Float32Array(data.vertices),3));geometry.setIndex(new BufferAttribute(new Uint32Array(data.triangles),1));geometry.computeBoundingBox();
 return {data,geometry,tree:new MeshBVH(geometry,{indirect:true}),bounds:geometry.boundingBox.clone(),dispose(){geometry.dispose();}};
}

function heightRange(context,n){let min=Infinity,max=-Infinity;const b=context.bounds;for(const x of [b.min.x,b.max.x])for(const y of [b.min.y,b.max.y])for(const z of [b.min.z,b.max.z]){const h=dot([x,y,z],n);min=Math.min(min,h);max=Math.max(max,h);}return [min,max];}
function projectedSurface(context,definition,range,capLimits){
 const d={...definition,min:capLimits?capLimits[0]-EPS:range[0]-1,max:capLimits?capLimits[1]+EPS:range[1]+1},box=new Box3(),u=new Vector3(...d.u),v=new Vector3(...d.v),n=new Vector3(...d.n),points=d.contours.flat();
 let xmin=Infinity,xmax=-Infinity,ymin=Infinity,ymax=-Infinity;
 for(const p of points){xmin=Math.min(xmin,p[0]);xmax=Math.max(xmax,p[0]);ymin=Math.min(ymin,p[1]);ymax=Math.max(ymax,p[1]);}
 for(const x of [xmin,xmax])for(const y of [ymin,ymax])for(const z of [d.min,d.max])box.expandByPoint(u.clone().multiplyScalar(x).addScaledVector(v,y).addScaledVector(n,z));
 box.expandByScalar(EPS);const intervals=[],probes=[];
 context.tree.shapecast({intersectsBounds:b=>box.intersectsBox(b),intersectsTriangle:triangle=>{
  const split=clipTriangleByPrism([triangle.a.toArray(),triangle.b.toArray(),triangle.c.toArray()],d);
  for(const tri of split.inside){const zs=tri.map(p=>dot(p,d.n));intervals.push([Math.min(...zs),Math.max(...zs)]);
   const xy=tri.map(p=>[dot(p,d.u),dot(p,d.v)]),area=(xy[1][0]-xy[0][0])*(xy[2][1]-xy[0][1])-(xy[1][1]-xy[0][1])*(xy[2][0]-xy[0][0]);
   if(Math.abs(area)>EPS*EPS)probes.push([xy.reduce((s,p)=>s+p[0],0)/3,xy.reduce((s,p)=>s+p[1],0)/3]);
  }return false;
 }});
 intervals.sort((a,b)=>a[0]-b[0]);const bands=[];for(const interval of intervals){const last=bands.at(-1);if(last&&interval[0]<=last[1]+EPS)last[1]=Math.max(last[1],interval[1]);else bands.push([...interval]);}
 if(!bands.length)throw unsafe('Die Kontur trifft keine Oberfläche.');
 return {bands,probes,projectedTriangles:intervals.length};
}

// One interior point for every loop is sufficient to test occupancy after all
// intersecting surface triangles have been excluded at that height. Hole-loop
// probes lie just outside the hole, on the material side of the footprint.
function footprintProbes(d){
 const points=[],classifier={...d,min:-1,max:1};
 for(const contour of d.contours){let found;
  for(let i=0;i<contour.length&&!found;i++){const a=contour[i],b=contour[(i+1)%contour.length],dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);if(length<EPS)continue;
   for(const shift of [1e-4,.001,.01,.1])for(const sign of [1,-1]){const p=[(a[0]+b[0])/2-sign*dy/length*shift,(a[1]+b[1])/2+sign*dx/length*shift],world=d.u.map((x,k)=>x*p[0]+d.v[k]*p[1]);if(pointInsidePrism(world,classifier)){found=p;break;}if(found)break;}
  }if(!found)throw unsafe('Der Konturumriss ist zu schmal oder ungültig.');points.push(found);
 }return points;
}

export function contourColumnIntervals(context,definition,xy){
 const n=new Vector3(...definition.n),range=heightRange(context,definition.n),origin=new Vector3(...definition.u).multiplyScalar(xy[0]).addScaledVector(new Vector3(...definition.v),xy[1]).addScaledVector(n,range[1]+2);
 const hits=context.tree.raycast(new Ray(origin,n.clone().negate()),DoubleSide).sort((a,b)=>a.distance-b.distance),events=[];
 for(const hit of hits){const z=hit.point.dot(n),sign=hit.face.normal.dot(n);if(Math.abs(sign)<1e-8)continue;const last=events.at(-1);if(last&&Math.abs(last.z-z)<EPS)last.sign+=sign;else events.push({z,sign});}
 const intervals=[];let top=null;
 for(const event of events){if(event.sign>1e-8){if(top===null)top=event.z;}else if(event.sign< -1e-8&&top!==null){if(top-event.z>EPS)intervals.push([event.z,top]);top=null;}}
 if(top!==null)throw unsafe('Die Wand besitzt an der Kontur keine eindeutig geschlossene Rückseite.');
 return intervals;
}

function emptyGap(surface,columns,start,direction,range,capLimits){
 let level=start;
 for(let attempt=0;attempt<=surface.bands.length+2;attempt++){
  if(capLimits&&(level<capLimits[0]||level>capLimits[1]))throw unsafe('Innerhalb der örtlichen Wandgrenzen gibt es keine freie Schnitthöhe.');
  const crossing=surface.bands.find(([lo,hi])=>level>=lo-EPS&&level<=hi+EPS);
  if(crossing){level=(direction<0?crossing[0]:crossing[1])+direction*MARGIN;continue;}
  const occupied=columns.some(intervals=>intervals.some(([lo,hi])=>level>lo+EPS&&level<hi-EPS));
  if(!occupied){const below=surface.bands.filter(b=>b[1]<level).at(-1),above=surface.bands.find(b=>b[0]>level);return {level,low:Math.max(capLimits?.[0]??-Infinity,below?below[1]+MARGIN:range[0]-1000),high:Math.min(capLimits?.[1]??Infinity,above?above[0]-MARGIN:range[1]+1000)};}
  const next=direction<0?surface.bands.filter(b=>b[1]<level).at(-1):surface.bands.find(b=>b[0]>level);
  if(!next)throw unsafe('Die Höhenbegrenzung liegt im Material und es wurde kein sicherer Wandabschluss gefunden.');
  level=(direction<0?next[0]:next[1])+direction*MARGIN;
 }throw unsafe('Für die Kontur wurde keine gemeinsame freie Höhenbegrenzung gefunden.');
}

// Cap planes must lie in genuinely empty gaps throughout the ACTUAL footprint,
// including its smoothing/offset. The first such gap is used, rather than a
// global model extent which could cut a distant, opposite roof wall as well.
// Shingle lips can produce several material intervals in one column. Record
// those for inspection; only the later solid partition can decide whether they
// form one connected part. A ray gap alone cannot identify an opposite wall.
export function resolveContourDepth(data,definition,options={}){
 const capLimits=options.capLimits;
 if(capLimits&&(!Array.isArray(capLimits)||capLimits.length!==2||capLimits.some(v=>!Number.isFinite(v))||capLimits[0]>=capLimits[1]))throw Error('Ungültige örtliche Wandgrenzen.');
 const own=!options.context,context=options.context||createContourDepthContext(data);
 try{
  if(context.data!==data)throw Error('Konturprüfung verwendet eine andere Modellgeometrie.');
  let surfaceMin=definition.surfaceMin,surfaceMax=definition.surfaceMax;
  if(options.faces?.length){surfaceMin=Infinity;surfaceMax=-Infinity;for(const f of options.faces)for(let k=0;k<3;k++){const id=data.triangles[f*3+k];if(id===undefined)throw unsafe('Die Oberflächenauswahl ist veraltet.');const z=dot(Array.from(data.vertices.subarray(id*3,id*3+3)),definition.n);surfaceMin=Math.min(surfaceMin,z);surfaceMax=Math.max(surfaceMax,z);}}
  if(options.anchors?.length){surfaceMin=Math.min(...options.anchors.map(p=>dot(p,definition.n)));surfaceMax=Math.max(...options.anchors.map(p=>dot(p,definition.n)));}
  if(!Number.isFinite(surfaceMin)||!Number.isFinite(surfaceMax)||surfaceMin>surfaceMax)throw unsafe('Der Bezug zur gewählten Oberfläche fehlt.');
  if(capLimits&&(surfaceMin-MARGIN<capLimits[0]||surfaceMax+MARGIN>capLimits[1]))throw unsafe('Die gewählte Oberfläche liegt außerhalb der örtlichen Wandgrenzen.');
  const range=heightRange(context,definition.n),surface=projectedSurface(context,definition,range,capLimits),representatives=footprintProbes(definition),cache=new Map();
  const column=xy=>{const key=xy.map(v=>Math.round(v*1e5)).join(',');if(!cache.has(key))cache.set(key,contourColumnIntervals(context,definition,xy));return cache.get(key);};
  const columns=representatives.map(column),lower=emptyGap(surface,columns,surfaceMin-MARGIN,-1,range,capLimits),upper=emptyGap(surface,columns,surfaceMax+MARGIN,1,range,capLimits);
  const min=Math.max(lower.low,Math.min(lower.level,definition.min)),max=Math.min(upper.high,Math.max(upper.level,definition.max));
  if(!Number.isFinite(min)||!Number.isFinite(max)||min>=max||min>=surfaceMin||max<=surfaceMax)throw unsafe('Zwischen den gewählten Oberflächen liegt kein geeigneter Wandbereich.');
  const sampleCount=Math.min(128,surface.probes.length),samples=Array.from({length:sampleCount},(_,i)=>surface.probes[Math.floor(i*surface.probes.length/sampleCount)]);
  let overlapSampleCount=0,maxInternalGap=0;
  for(const xy of [...representatives,...samples]){const intervals=column(xy).filter(([lo,hi])=>Math.min(hi,max)-Math.max(lo,min)>EPS);if(intervals.length>1)overlapSampleCount++;
   for(let i=1;i<intervals.length;i++){const upper=intervals[i-1],lower=intervals[i],gap=upper[0]-lower[1];maxInternalGap=Math.max(maxInternalGap,gap);}
  }
  return {...definition,min,max,surfaceMin,surfaceMax,depthCheck:{version:1,capPlanesClear:true,...(capLimits?{capLimits:[...capLimits]}:{}),projectedTriangles:surface.projectedTriangles,probedColumns:cache.size,overlapSampleCount,overlapSampling:true,maxInternalGap,requiresConnectivityCheck:true,extendedBelow:min<definition.min-EPS,extendedAbove:max>definition.max+EPS,limitedToLocalWall:min>definition.min+EPS||max<definition.max-EPS}};
 }finally{if(own)context.dispose();}
}
