// Closed polygon regularization: find genuine bends, then fit each intervening
// run by orthogonal least squares. Uniform arc-length samples prevent dense
// tessellation at one end from pulling the fitted line toward that end.
export function straightenContour(input,tolerance=2){
  if(!Number.isFinite(tolerance)||tolerance<.1||tolerance>20)throw Error('Linientoleranz zwischen 0,1 und 20 mm wählen.');
  if(input.length<3)throw Error('Kontur hat zu wenige Punkte.');
  const dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]),cross=(a,b)=>a[0]*b[1]-a[1]*b[0];
  const source=input.map(p=>[p[0],p[1]]),samples=[];
  const perimeter=source.reduce((s,p,i)=>s+dist(p,source[(i+1)%source.length]),0),spacing=Math.max(.25,tolerance/2,perimeter/12000);
  for(let i=0;i<source.length;i++){
    const a=source[i],b=source[(i+1)%source.length],count=Math.max(1,Math.ceil(dist(a,b)/spacing));
    for(let j=0;j<count;j++)samples.push(a.map((x,k)=>x+(b[k]-x)*j/count));
  }
  const distance=(p,a,b)=>{const dx=b[0]-a[0],dy=b[1]-a[1],l=dx*dx+dy*dy,t=l?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/l)):0;return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);};
  let split=1;for(let i=2;i<samples.length;i++)if(dist(samples[0],samples[i])>dist(samples[0],samples[split]))split=i;
  const corners=new Set([0,split]);
  function simplify(start,end){let furthest=-1,error=tolerance;for(let i=start+1;i<end;i++){const d=distance(samples[i%samples.length],samples[start%samples.length],samples[end%samples.length]);if(d>error){error=d;furthest=i;}}if(furthest>=0){corners.add(furthest%samples.length);simplify(start,furthest);simplify(furthest,end);}}
  simplify(0,split);simplify(split,samples.length);
  const ids=[...corners].sort((a,b)=>a-b);if(ids.length<3)throw Error('Linientoleranz zu groß für diese Kontur.');
  const lines=ids.map((start,i)=>{
    const end=i+1<ids.length?ids[i+1]:samples.length,points=[];for(let j=start;j<=end;j++)points.push(samples[j%samples.length]);
    const center=[0,0];for(const p of points){center[0]+=p[0]/points.length;center[1]+=p[1]/points.length;}
    let xx=0,xy=0,yy=0;for(const p of points){const x=p[0]-center[0],y=p[1]-center[1];xx+=x*x;xy+=x*y;yy+=y*y;}
    const angle=.5*Math.atan2(2*xy,xx-yy);return {center,direction:[Math.cos(angle),Math.sin(angle)]};
  });
  const result=ids.map((id,i)=>{
    const a=lines[(i+lines.length-1)%lines.length],b=lines[i],delta=b.center.map((v,k)=>v-a.center[k]),den=cross(a.direction,b.direction),anchor=samples[id];
    if(Math.abs(den)<.02)return anchor;
    const t=cross(delta,b.direction)/den,p=a.center.map((v,k)=>v+t*a.direction[k]);
    return dist(p,anchor)<=tolerance*3?p:anchor;
  });
  // Don't allow line fitting to create a new crossing or excessive displacement.
  const side=(a,b,p)=>cross(b.map((x,k)=>x-a[k]),p.map((x,k)=>x-a[k]));
  for(let i=0;i<result.length;i++)for(let j=i+2;j<result.length;j++){
    if(i===0&&j===result.length-1)continue;
    const a=result[i],b=result[(i+1)%result.length],c=result[j],d=result[(j+1)%result.length];
    if(side(a,b,c)*side(a,b,d)<0&&side(c,d,a)*side(c,d,b)<0)throw Error('Ausgleichslinien kreuzen sich. Eine kleinere Linientoleranz wählen.');
  }
  const maxDeviation=Math.max(...samples.map(p=>Math.min(...result.map((a,i)=>distance(p,a,result[(i+1)%result.length])))));
  if(maxDeviation>tolerance*2+.001)throw Error('Ausgleichslinie weicht zu stark ab. Kleinere Linientoleranz wählen.');
  return {points:result,maxDeviation,originalPoints:input.length};
}
