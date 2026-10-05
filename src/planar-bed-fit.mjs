const pi=Math.PI, cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
export function convexHull2D(points){
 const sorted=points.map(p=>[p[0],p[1]]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
 if(!sorted.length||sorted.some(p=>!p.every(Number.isFinite)))throw Error('Ungültige Grundfläche.');
 const unique=sorted.filter((p,i)=>!i||p[0]!==sorted[i-1][0]||p[1]!==sorted[i-1][1]);if(unique.length<3)return unique;
 const lower=[],upper=[];for(const p of unique){while(lower.length>1&&cross(lower.at(-2),lower.at(-1),p)<=0)lower.pop();lower.push(p);}for(let i=unique.length-1;i>=0;i--){const p=unique[i];while(upper.length>1&&cross(upper.at(-2),upper.at(-1),p)<=0)upper.pop();upper.push(p);}lower.pop();upper.pop();return lower.concat(upper);
}
function extent(hull,angle){
 const c=Math.cos(angle),s=Math.sin(angle),min=[Infinity,Infinity],max=[-Infinity,-Infinity],support=[null,null,null,null];
 for(const p of hull){const x=p[0]*c-p[1]*s,y=p[0]*s+p[1]*c;if(x<min[0]){min[0]=x;support[0]=p;}if(x>max[0]){max[0]=x;support[1]=p;}if(y<min[1]){min[1]=y;support[2]=p;}if(y>max[1]){max[1]=y;support[3]=p;}}
 return {angle,min,max,size:max.map((v,i)=>v-min[i]),support};
}
function roots(a,b,limit,lo,hi){
 const radius=Math.hypot(a,b);if(!radius||limit>radius||limit< -radius)return [];
 const phase=Math.atan2(b,a),alpha=Math.acos(Math.max(-1,Math.min(1,limit/radius))),out=[];
 for(const sign of [-1,1])for(let k=-1;k<=1;k++){const value=phase+sign*alpha+k*2*pi;if(value>lo+1e-12&&value<hi-1e-12)out.push(value);}return out;
}
// Between hull-edge events, each bounding-box side is supported by one fixed
// vertex. Its width is A*cos(angle)+B*sin(angle), so exact roots of the two bed
// limits partition the interval into feasible/infeasible ranges. No angular
// sampling step can skip a narrow fitting interval.
export function fitPlanarHull(hull,bed,{tolerance=.005,coarseFirst=true,check=()=>{}}={}){
 if(!Array.isArray(hull)||!hull.length||hull.some(p=>p.length!==2||!p.every(Number.isFinite))||!Array.isArray(bed)||bed.length!==2||bed.some(v=>!Number.isFinite(v)||v<=0)||!Number.isFinite(tolerance)||tolerance<0||typeof check!=='function')throw Error('Ungültige Druckbettprüfung.');
 const fits=r=>r.size.every((v,i)=>v<=bed[i]+tolerance+1e-9),clean=(r,continuous)=>({angle:r.angle,min:r.min,max:r.max,size:r.size,continuous});
 if(coarseFirst)for(let degrees=0;degrees<180;degrees+=15){const r=extent(hull,degrees*pi/180);if(fits(r))return clean(r,false);}
 const events=[0,pi];for(let i=0;i<hull.length;i++){const a=hull[i],b=hull[(i+1)%hull.length],direction=Math.atan2(b[1]-a[1],b[0]-a[0]);for(const offset of [0,pi/2])events.push(((-direction+offset)%pi+pi)%pi);}
 const sorted=events.sort((a,b)=>a-b).filter((v,i,all)=>!i||v-all[i-1]>1e-12);
 for(let i=0;i<sorted.length-1;i++){
  check();
  const lo=sorted[i],hi=sorted[i+1],sample=extent(hull,(lo+hi)/2),[xmin,xmax,ymin,ymax]=sample.support;
  const divisions=[lo,hi,...roots(xmax[0]-xmin[0],xmin[1]-xmax[1],bed[0]+tolerance,lo,hi),...roots(ymax[1]-ymin[1],ymax[0]-ymin[0],bed[1]+tolerance,lo,hi)].sort((a,b)=>a-b);
  // Prefer the middle of a feasible interval over a limit-touching root to
  // leave numerical room when the chosen pose is exported to Float32.
  for(let j=0;j<divisions.length-1;j++){const r=extent(hull,(divisions[j]+divisions[j+1])/2);if(fits(r))return clean(r,true);}
  for(const angle of divisions){const r=extent(hull,angle);if(fits(r))return clean(r,true);}
 }
 return null;
}
