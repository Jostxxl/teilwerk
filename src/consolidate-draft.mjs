import {neighborGraph} from './neighbor-colors.mjs';
import {convexHull2D,fitPlanarHull} from './planar-bed-fit.mjs';
import {straightCellFaceContact} from './straight-cell-adjacency.mjs';

const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const normalized=a=>{const length=Math.hypot(...a);return a.map(x=>x/length);};
function cutPlanes(definition){
 if(!definition)return [];
 const {u,v,n,min,max,contours}=definition,planes=[{normal:n,offset:min},{normal:n,offset:max}];
 for(const contour of contours)for(let i=0;i<contour.length;i++){
  const a=contour[i],b=contour[(i+1)%contour.length],nx=-(b[1]-a[1]),ny=b[0]-a[0],length=Math.hypot(nx,ny);
  if(length>1e-8)planes.push({normal:u.map((x,j)=>(x*nx+v[j]*ny)/length),offset:(nx*a[0]+ny*a[1])/length});
 }
 return planes;
}
function metrics(data){
 const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity],v=data.vertices,t=data.triangles;let area=0;
 for(let i=0;i<v.length;i+=3)for(let j=0;j<3;j++){min[j]=Math.min(min[j],v[i+j]);max[j]=Math.max(max[j],v[i+j]);}
 for(let f=0;f<t.length;f+=3){const a=t[f]*3,b=t[f+1]*3,c=t[f+2]*3,ab=[v[b]-v[a],v[b+1]-v[a+1],v[b+2]-v[a+2]],ac=[v[c]-v[a],v[c+1]-v[a+1],v[c+2]-v[a+2]];area+=Math.hypot(...cross(ab,ac))/2;}
 return {min,max,area};
}
function concatenate(items){
 const vertices=new Float32Array(items.reduce((s,p)=>s+p.vertices.length,0)),triangles=new Uint32Array(items.reduce((s,p)=>s+p.triangles.length,0));let v=0,t=0;
 for(const item of items){vertices.set(item.vertices,v);for(let i=0;i<item.triangles.length;i++)triangles[t+i]=item.triangles[i]+v/3;v+=item.vertices.length;t+=item.triangles.length;}
 return {vertices,triangles};
}

// Draft surfaces must be in their common assembly coordinate frame. Merging
// concatenates existing surface triangles; it does not union cutters, close
// meshes, change the original boolean sequence, or discard any fragments.
export function consolidateDraft(surfaces,proposals,bed,{progress=()=>{},maxMillis=20000,smallArea=1000,planeTolerance=.05,minContactArea=1}={}){
 if(!Array.isArray(bed)||bed.length!==3||bed.some(x=>!Number.isFinite(x)||x<=0)||!Number.isFinite(maxMillis)||maxMillis<=0||!Number.isFinite(smallArea)||smallArea<0||!Number.isFinite(planeTolerance)||planeTolerance<=0||!Number.isFinite(minContactArea)||minContactArea<0)throw Error('Ungültige Einstellungen für die Vorschau-Zusammenfassung.');
 const started=performance.now(),deadline=started+maxMillis,budget=Symbol('draft grouping budget'),assigned=[],rest=[];
 surfaces.forEach((surface,index)=>{if(surface.unassigned){rest.push({surface,index});return;}if(!Number.isInteger(surface.proposal)||surface.proposal<0||surface.proposal>=proposals.length)throw Error('Oberflächenvorschau ohne zugehörige Kontur.');assigned.push({surface,index});});
 const leaf=assigned.map(({surface,index})=>({...metrics(surface),surface,index,planes:cutPlanes(proposals[surface.proposal].cutDefinition),ranges:new Map(),hulls:new Map()})),contact=neighborGraph(assigned.map(p=>({vertices:p.surface.vertices,triangles:p.surface.triangles}))),eligibleNeighbors=contact.neighbors.map((neighbors,i)=>neighbors.filter(j=>straightCellFaceContact(proposals[leaf[i].surface.proposal],proposals[leaf[j].surface.proposal])!==false)),eligibleContactEdges=eligibleNeighbors.reduce((sum,neighbors)=>sum+neighbors.length,0)/2,records=leaf.map((l,i)=>({active:true,leaves:[i],neighbors:new Set(eligibleNeighbors[i]),area:l.area,min:l.min,max:l.max,fit:null,annotated:!!(l.surface.mark||l.surface.plannedMark)}));
 // Each merge follows one retained face-contact edge. The union therefore
 // stays connected in this graph, including after neighbor sets are updated.
 const beforeSmall=records.filter(g=>g.area<smallArea).length;let merges=0,testedPairs=0,complete=true,stopReason=null;
 function checkBudget(){if(performance.now()>deadline)throw budget;}
 function range(leaves,axis,limit=Infinity){
  const key=axis.join(','),result={min:Infinity,max:-Infinity};
  for(const id of leaves){const l=leaf[id],cached=l.ranges.get(key);if(cached){result.min=Math.min(result.min,cached.min);result.max=Math.max(result.max,cached.max);if(result.max-result.min>limit+1e-6)return null;continue;}
   let min=Infinity,max=-Infinity;const v=l.surface.vertices;
   for(let i=0;i<v.length;i+=3){if((i&12287)===0)checkBudget();const value=v[i]*axis[0]+v[i+1]*axis[1]+v[i+2]*axis[2];min=Math.min(min,value);max=Math.max(max,value);if(Math.max(result.max,max)-Math.min(result.min,min)>limit+1e-6)return null;}
   l.ranges.set(key,{min,max});result.min=Math.min(result.min,min);result.max=Math.max(result.max,max);
  }
  return result;
 }
 function contactArea(leaves,plane){
  let first=null,farthest=null,longest=0,height=0;const points=[];
  for(const id of leaves){const v=leaf[id].surface.vertices;for(let i=0;i<v.length;i+=3){const distance=v[i]*plane.normal[0]+v[i+1]*plane.normal[1]+v[i+2]*plane.normal[2]-plane.offset;if(Math.abs(distance)>planeTolerance)continue;const p=[v[i],v[i+1],v[i+2]];points.push(p);if(!first)first=p;const delta=p.map((x,j)=>x-first[j]),length=dot(delta,delta);if(length>longest){longest=length;farthest=p;}}}
  if(!farthest||longest<1e-10)return 0;
  const line=farthest.map((x,i)=>x-first[i]);for(const p of points)height=Math.max(height,Math.hypot(...cross(line,p.map((x,i)=>x-first[i])))/Math.sqrt(longest));
  return Math.sqrt(longest)*height/2;
 }
 function fitting(a,b){
  const leaves=[...a.leaves,...b.leaves],span=a.max.map((x,i)=>Math.max(x,b.max[i])-Math.min(a.min[i],b.min[i]));if(Math.max(...span)>Math.hypot(...bed)+1e-6)return null;
  const tried=new Set();
  for(const id of leaves)for(const plane of leaf[id].planes){
   checkBudget();const key=[...plane.normal,plane.offset].join(',');if(tried.has(key))continue;tried.add(key);
   const zRange=range(leaves,plane.normal,bed[2]);if(!zRange)continue;
   let up,zmin,zmax;if(Math.abs(zRange.min-plane.offset)<=planeTolerance){up=plane.normal;zmin=zRange.min;zmax=zRange.max;}else if(Math.abs(zRange.max-plane.offset)<=planeTolerance){up=plane.normal.map(x=>-x);zmin=-zRange.max;zmax=-zRange.min;}else continue;
   const base=normalized(cross(Math.abs(up[0])<.8?[1,0,0]:[0,1,0],up)),side=cross(up,base);
   for(let degrees=0;degrees<180;degrees+=15){const angle=degrees*Math.PI/180,x=base.map((value,j)=>value*Math.cos(angle)+side[j]*Math.sin(angle)),y=cross(up,x),xr=range(leaves,x,bed[0]);if(!xr)continue;const yr=range(leaves,y,bed[1]);if(!yr)continue;
    const area=contactArea(leaves,plane);if(area<minContactArea)break;
    return {axes:[x,y,up],offset:[-xr.min,-yr.min,-zmin],size:[xr.max-xr.min,yr.max-yr.min,zmax-zmin],bedPlane:{normal:up,offset:zmin},contactAreaEstimate:area};
   }
   // Check angles between the coarse samples using the complete projected
   // convex hull. Cache each source hull for this supporting-plane frame.
   const hullKey=[...base,...side].join(','),points=[];
   for(const leafId of leaves){checkBudget();const l=leaf[leafId];let hull=l.hulls.get(hullKey);if(!hull){const projected=[],v=l.surface.vertices;for(let k=0;k<v.length;k+=3)projected.push([v[k]*base[0]+v[k+1]*base[1]+v[k+2]*base[2],v[k]*side[0]+v[k+1]*side[1]+v[k+2]*side[2]]);hull=convexHull2D(projected);l.hulls.set(hullKey,hull);}points.push(...hull);}
   const fit=fitPlanarHull(convexHull2D(points),bed.slice(0,2),{tolerance:1e-6,coarseFirst:false,check:checkBudget});
   if(fit){const area=contactArea(leaves,plane);if(area<minContactArea)continue;const x=base.map((value,j)=>value*Math.cos(fit.angle)-side[j]*Math.sin(fit.angle)),y=cross(up,x),xr=range(leaves,x,bed[0]),yr=range(leaves,y,bed[1]);if(xr&&yr)return {axes:[x,y,up],offset:[-xr.min,-yr.min,-zmin],size:[xr.max-xr.min,yr.max-yr.min,zmax-zmin],bedPlane:{normal:up,offset:zmin},contactAreaEstimate:area};}
  }
  return null;
 }
 try{
  progress(`${records.length} offene Teile: tatsächliche Nachbarschaften und Bauraum prüfen …`);
  for(;;){checkBudget();let merged=false;
   const order=records.map((r,i)=>({r,i})).filter(({r})=>r.active&&!r.annotated).sort((a,b)=>a.r.area-b.r.area||a.i-b.i);
   for(const {r:a,i} of order){const candidates=[...a.neighbors].filter(j=>records[j].active&&!records[j].annotated).sort((j,k)=>records[k].area-records[j].area||j-k);
    for(const j of candidates){checkBudget();const b=records[j];testedPairs++;const fit=fitting(a,b);if(!fit)continue;
     a.leaves.push(...b.leaves);a.area+=b.area;a.fit=fit;a.min=a.min.map((x,k)=>Math.min(x,b.min[k]));a.max=a.max.map((x,k)=>Math.max(x,b.max[k]));b.active=false;
     for(const neighbor of b.neighbors){records[neighbor].neighbors.delete(j);if(neighbor!==i&&records[neighbor].active){records[neighbor].neighbors.add(i);a.neighbors.add(neighbor);}}a.neighbors.delete(i);a.neighbors.delete(j);merges++;merged=true;progress(`${merges} Nachbargruppen zusammengefasst · ${records.filter(r=>r.active).length} offene Teile`);break;
    }
    if(merged)break;
   }
   if(!merged)break;
  }
 }catch(e){if(e!==budget)throw e;complete=false;stopReason='Zeitlimit erreicht. Bereits geprüfte Gruppen bleiben erhalten; weitere Zusammenfassungen sind noch ungeprüft.';progress(stopReason);}
 const active=records.filter(r=>r.active).sort((a,b)=>Math.min(...a.leaves.map(i=>leaf[i].index))-Math.min(...b.leaves.map(i=>leaf[i].index))),groups=active.map(r=>r.leaves.map(i=>leaf[i].surface.proposal).sort((a,b)=>a-b)),result=active.map((r,i)=>{
  const items=r.leaves.slice().sort((a,b)=>leaf[a].index-leaf[b].index).map(j=>leaf[j].surface),members=groups[i];
  return {...items[0],...(items.length>1?concatenate(items):{}),members,cutDefinitions:members.map(j=>proposals[j].cutDefinition),draftFit:r.fit,sourceSurfaceIndexes:r.leaves.map(j=>leaf[j].index).sort((a,b)=>a-b)};
 });
 // Residual geometry is not eligible for these merges and keeps its exact buffers.
 for(const r of rest)result.push(r.surface);
 return {surfaces:result,groups,merges,complete,stopReason,testedPairs,contactEdges:contact.edges,eligibleContactEdges,rejectedCellContacts:contact.edges-eligibleContactEdges,assignedBefore:assigned.length,assignedAfter:active.length,small:{areaThreshold:smallArea,before:beforeSmall,after:active.filter(r=>r.area<smallArea).length},skippedAnnotatedGroups:records.filter(r=>r.active&&r.annotated).length,elapsedMs:performance.now()-started};
}
