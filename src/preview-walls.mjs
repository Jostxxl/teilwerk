import {BufferGeometry,BufferAttribute,Vector3,Ray,DoubleSide} from 'three';
import {MeshBVH} from 'three-mesh-bvh';

// Optional visual bridges across the roof wall. These sampled strips explain
// disconnected surface skins; they are approximate display geometry, never a
// watertight part, boolean result, export mesh, or replacement for source faces.
export function previewCutWalls(data,proposals,{spacing=3,maxDeviation=.2,maxSubdivisions=3,maxRays=200000}={}){
 if(!Number.isFinite(spacing)||spacing<.25||spacing>20||!Number.isFinite(maxDeviation)||maxDeviation<=0||maxDeviation>2||!Number.isInteger(maxSubdivisions)||maxSubdivisions<0||maxSubdivisions>6||!Number.isInteger(maxRays)||maxRays<1)throw Error('Ungültige Einstellungen für die Schnittwand-Vorschau.');
 const edgeLengths=[];
 for(const proposal of proposals){const d=proposal.cutDefinition;if(!d)continue;const {u,v,n,min,max,contours}=d;
  if(![u,v,n].every(axis=>Array.isArray(axis)&&axis.length===3&&axis.every(Number.isFinite))||!Number.isFinite(min)||!Number.isFinite(max)||min>=max||!Array.isArray(contours)||contours.some(loop=>!Array.isArray(loop)||loop.length<3||loop.some(p=>!Array.isArray(p)||p.length<2||!p.slice(0,2).every(Number.isFinite))))throw Error('Ungültige Kontur für die Schnittwand-Vorschau.');
  for(const loop of contours)for(let i=0;i<loop.length;i++){const a=loop[i],b=loop[(i+1)%loop.length],length=Math.hypot(b[0]-a[0],b[1]-a[1]);if(length>=1e-8)edgeLengths.push(length);}
 }
 // A segment needs its shared endpoint and at most 2^(depth+1)-1
 // midpoint rays. Reserve that worst case before tracing any proposal.
 const samples=distance=>edgeLengths.reduce((sum,length)=>sum+Math.max(1,Math.ceil(length/distance)),0);
 let effectiveSpacing=spacing,effectiveSubdivisions=maxSubdivisions;
 while(effectiveSubdivisions>0&&samples(20)*2**(effectiveSubdivisions+1)>maxRays)effectiveSubdivisions--;
 const factor=2**(effectiveSubdivisions+1);
 if(samples(spacing)*factor>maxRays){let lo=spacing,hi=20;for(let i=0;i<28;i++){const mid=(lo+hi)/2;if(samples(mid)*factor<=maxRays)hi=mid;else lo=mid;}effectiveSpacing=Math.min(20,Math.ceil(hi*100)/100);}
 const samplingAdapted=effectiveSpacing>spacing+1e-6||effectiveSubdivisions<maxSubdivisions;
 const geometry=new BufferGeometry();geometry.setAttribute('position',new BufferAttribute(data.vertices,3));geometry.setIndex(new BufferAttribute(data.triangles,1));geometry.computeBoundingBox();
 const tree=new MeshBVH(geometry,{indirect:true}),worldBounds=geometry.boundingBox;let totalRays=0;
 try{return proposals.map((proposal,index)=>{
  const d=proposal.cutDefinition,vertices=[],triangles=[],statistics={rays:0,segments:0,renderedSegments:0,skippedSegments:0,discontinuities:0,invalidRays:0,maxObservedDeviation:0,requestedSpacing:spacing,effectiveSpacing,requestedMaxSubdivisions:maxSubdivisions,effectiveMaxSubdivisions:effectiveSubdivisions,samplingAdapted,budgetExhausted:false,partial:false,unprocessedContours:0};
  const output=()=>{statistics.partial=statistics.budgetExhausted||statistics.discontinuities>0||statistics.invalidRays>0;
   const warnings=[];
   if(samplingAdapted)warnings.push('Schnittwände werden wegen der Modellgröße vereinfacht dargestellt.');
   if(statistics.budgetExhausted)warnings.push('Schnittwände nur teilweise dargestellt: Das Vorschau-Limit wurde erreicht.');
   else if(statistics.partial)warnings.push('Einige Schnittwandabschnitte sind in der offenen Vorschau nicht darstellbar.');
   statistics.warnings=warnings;statistics.warning=warnings.join(' ')||null;
   return {vertices:new Float32Array(vertices),triangles:new Uint32Array(triangles),proposal:index,previewOnly:true,approximate:true,statistics};};
  if(!d)return output();
  const {u,v,n,min,max,contours}=d;

  const normal=new Vector3(...n),direction=normal.clone().negate();let upper=-Infinity;
  for(const x of [worldBounds.min.x,worldBounds.max.x])for(const y of [worldBounds.min.y,worldBounds.max.y])for(const z of [worldBounds.min.z,worldBounds.max.z])upper=Math.max(upper,x*n[0]+y*n[1]+z*n[2]);upper+=1;
  const world=(x,y,z)=>[u[0]*x+v[0]*y+n[0]*z,u[1]*x+v[1]*y+n[1]*z,u[2]*x+v[2]*y+n[2]*z];
  function sample(point){
   if(totalRays>=maxRays){statistics.budgetExhausted=true;return {point,intervals:null,budgetExhausted:true};}totalRays++;statistics.rays++;
   const hits=tree.raycast(new Ray(new Vector3(...world(point[0],point[1],upper)),direction),DoubleSide).sort((a,b)=>a.distance-b.distance),intervals=[];let winding=0,start=0;
   for(let i=0;i<hits.length;){const distance=hits[i].distance;let sign=0;do{sign+=hits[i].face.normal.dot(direction);i++;}while(i<hits.length&&Math.abs(hits[i].distance-distance)<1e-5);
    if(Math.abs(sign)<1e-7)continue;
    const before=winding;winding+=sign<0?1:-1;
    if(winding<0){statistics.invalidRays++;return {point,intervals:null};}
    if(before===0&&winding>0)start=upper-distance;
    if(before>0&&winding===0){const top=Math.min(start,max),bottom=Math.max(upper-distance,min);if(top-bottom>1e-6)intervals.push({top,bottom});}
   }
   if(winding!==0){statistics.invalidRays++;return {point,intervals:null};}
   return {point,intervals};
  }
  function emit(a,b,depth=0){
   statistics.segments++;if(a.budgetExhausted||b.budgetExhausted){statistics.budgetExhausted=true;statistics.skippedSegments++;return;}
   const midpoint=sample([(a.point[0]+b.point[0])/2,(a.point[1]+b.point[1])/2]),lists=[a.intervals,b.intervals,midpoint.intervals],consistent=lists.every(list=>list!==null&&list.length===lists[0]?.length);
   if(midpoint.budgetExhausted){statistics.skippedSegments++;return;}
   let deviation=0;
   if(consistent)for(let i=0;i<a.intervals.length;i++)for(const side of ['top','bottom'])deviation=Math.max(deviation,Math.abs(midpoint.intervals[i][side]-(a.intervals[i][side]+b.intervals[i][side])/2));
   statistics.maxObservedDeviation=Math.max(statistics.maxObservedDeviation,deviation);
   if(!consistent||deviation>maxDeviation){
    if(depth<effectiveSubdivisions){emit(a,midpoint,depth+1);emit(midpoint,b,depth+1);}else{statistics.skippedSegments++;statistics.discontinuities++;}return;
   }
   if(!a.intervals.length){statistics.skippedSegments++;return;}
   for(let i=0;i<a.intervals.length;i++){
    const aa=a.intervals[i],bb=b.intervals[i],offset=vertices.length/3;
    vertices.push(...world(...a.point,aa.top),...world(...b.point,bb.top),...world(...a.point,aa.bottom),...world(...b.point,bb.bottom));
    triangles.push(offset,offset+2,offset+1,offset+1,offset+2,offset+3);
   }
   statistics.renderedSegments++;
  }
  for(let li=0;li<contours.length;li++){if(totalRays>=maxRays){statistics.budgetExhausted=true;statistics.unprocessedContours=contours.length-li;break;}const loop=contours[li],samples=[];for(let i=0;i<loop.length;i++){const a=loop[i],b=loop[(i+1)%loop.length],length=Math.hypot(b[0]-a[0],b[1]-a[1]);if(length<1e-8)continue;const count=Math.max(1,Math.ceil(length/effectiveSpacing));for(let j=0;j<count;j++)samples.push(sample([a[0]+(b[0]-a[0])*j/count,a[1]+(b[1]-a[1])*j/count]));}for(let i=0;i<samples.length;i++)emit(samples[i],samples[(i+1)%samples.length]);}
  return output();
 });}finally{geometry.dispose();}
}
