// WORK ONLY. Candidate generation, never a socket/material/insertion proof.
// Input is the already-inset native safe contours with nonzero winding fill.
const failure=(code,message)=>Object.assign(Error(message),{code});
const bits=new DataView(new ArrayBuffer(8));
function dyadic(x){bits.setFloat64(0,x);const hi=bits.getUint32(0),lo=bits.getUint32(4),exponent=(hi>>>20)&2047;let n=(BigInt(hi&1048575)<<32n)|BigInt(lo);if(exponent)n|=1n<<52n;if(hi>>>31)n=-n;return {n,e:exponent?exponent-1075:-1074};}
function subtract(a,b){const e=Math.min(a.e,b.e);return {n:(a.n<<BigInt(a.e-e))-(b.n<<BigInt(b.e-e)),e};}
function multiply(a,b){return {n:a.n*b.n,e:a.e+b.e};}
function orient(a,b,p){
 const ax=a[0]-p[0],ay=a[1]-p[1],bx=b[0]-p[0],by=b[1]-p[1],left=ax*by,right=ay*bx,det=left-right;
 if(Number.isFinite(det)&&Math.abs(left)+Math.abs(right)>=1e-300&&Math.abs(det)>(Math.abs(left)+Math.abs(right))*3.3306690738754716e-16)return Math.sign(det);
 const exact=subtract(multiply(subtract(dyadic(a[0]),dyadic(p[0])),subtract(dyadic(b[1]),dyadic(p[1]))),multiply(subtract(dyadic(a[1]),dyadic(p[1])),subtract(dyadic(b[0]),dyadic(p[0]))));return exact.n<0n?-1:exact.n>0n?1:0;
}
function integer(x,lo,hi,name){if(!Number.isInteger(x)||x<lo||x>hi)throw failure('INVALID_OPTIONS',name);return x;}
function compile(contours,maxVertices){
 if(!Array.isArray(contours)||contours.length>1024)throw failure('INVALID_CONTOURS','Expected bounded safe polygon rings.');
 const rings=[],edges=[];let vertices=0;
 for(const ring of contours){if(!Array.isArray(ring)||ring.length<3||(vertices+=ring.length)>maxVertices)throw failure('INVALID_CONTOURS','Invalid/over-budget ring.');const r=Array.from(ring,p=>{if(!Array.isArray(p)||p.length!==2||![p[0],p[1]].every(x=>Number.isFinite(x)&&Math.abs(x)<=1e9))throw failure('INVALID_CONTOURS','Finite 2D coordinates required.');return [...p];});rings.push(r);for(let i=0;i<r.length;i++){const a=r[i],b=r[(i+1)%r.length];if(a[0]===b[0]&&a[1]===b[1])continue;edges.push({a,b,length:Math.hypot(b[0]-a[0],b[1]-a[1])});}}
 return {rings,edges,vertices};
}
function classify(point,edges,tick=()=>{}){
 let winding=0,distance=Infinity;
 for(const {a,b}of edges){tick();const sign=orient(a,b,point);if(!sign&&point[0]>=Math.min(a[0],b[0])&&point[0]<=Math.max(a[0],b[0])&&point[1]>=Math.min(a[1],b[1])&&point[1]<=Math.max(a[1],b[1]))return {inside:false,boundary:true,clearance:0};
  if(a[1]<=point[1]){if(b[1]>point[1]&&sign>0)winding++;}else if(b[1]<=point[1]&&sign<0)winding--;
  const dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((point[0]-a[0])*dx+(point[1]-a[1])*dy)/(dx*dx+dy*dy)));distance=Math.min(distance,Math.hypot(point[0]-a[0]-t*dx,point[1]-a[1]-t*dy));
 }return {inside:winding!==0,boundary:false,clearance:distance};
}
export function pointStrictlyInsideContours(point,contours){if(!Array.isArray(point)||point.length!==2||![point[0],point[1]].every(Number.isFinite))return false;return classify(point,compile(contours,65536).edges).inside;}

/** Bounded and deterministic for the same literal contours/options. A result
 * only enumerates points strictly inside the supplied protected cross-section.
 * Holes follow its original nonzero winding; coordinates are never welded.
 * Every returned point still requires the existing complete native socket and
 * insertion tests. Exhaustion does not imply that the contact is impossible. */
export function sampleDowelContactContours(contours,{maxPoints=160,maxCandidates=2048,maxScanlines=128,maxVertices=65536,maxEdgeTests=2000000,minSeparation=12,signal,checkpoint}={}){
 integer(maxPoints,1,256,'maxPoints');integer(maxCandidates,maxPoints,8192,'maxCandidates');integer(maxScanlines,1,512,'maxScanlines');integer(maxVertices,3,65536,'maxVertices');integer(maxEdgeTests,1,10000000,'maxEdgeTests');if(!Number.isFinite(minSeparation)||minSeparation<=0||checkpoint!==undefined&&typeof checkpoint!=='function')throw failure('INVALID_OPTIONS','Invalid candidate options.');
 const {rings,edges,vertices}=compile(contours,maxVertices),diagnostics={method:'contour-scanlines-spread-v1',inputRings:rings.length,inputVertices:vertices,scanlines:0,edgeTests:0,candidateCount:0,returned:0,truncated:false,exhaustedReason:null,strictBoundaryExcluded:true,nativeSafetyVerified:false};
 const check=()=>{if(signal?.aborted)throw failure('ABORTED','Contact sampling cancelled.');checkpoint?.();};check();
 const tick=()=>{if(diagnostics.edgeTests>=maxEdgeTests)throw failure('WORK_LIMIT','Edge-test limit.');diagnostics.edgeTests++;if(diagnostics.edgeTests%1024===0)check();};
 if(!edges.length)return {points:[],diagnostics};
 // Real long edges supply the first directions, preventing an oblique sliver
 // from being reduced to the single point hit by an axis-aligned grid.
 const ordered=[...edges].sort((a,b)=>b.length-a.length||a.a[0]-b.a[0]||a.a[1]-b.a[1]||a.b[0]-b.b[0]||a.b[1]-b.b[1]),axes=[];
 function axis(x,y){const length=Math.hypot(x,y);if(!length)return;x/=length;y/=length;if(x<0||x===0&&y<0){x=-x;y=-y;}if(!axes.some(a=>Math.abs(a[0]*x+a[1]*y)>.98))axes.push([x,y]);}
 for(const e of ordered){axis(e.b[0]-e.a[0],e.b[1]-e.a[1]);if(axes.length>=2)break;}axis(1,0);axis(0,1);
 const frames=axes.map(u=>{const v=[-u[1],u[0]],project=p=>[p[0]*u[0]+p[1]*u[1],p[0]*v[0]+p[1]*v[1]],rs=rings.map(r=>r.map(project)),levels=[],seen=new Set();const push=x=>{if(Number.isFinite(x)&&!seen.has(x)){seen.add(x);levels.push(x);}};
  const ys=rs.flatMap(r=>r.map(p=>p[1])).sort((a,b)=>a-b),unique=[...new Set(ys)],low=ys[0],high=ys.at(-1);for(const r of rs){const yy=r.map(p=>p[1]);push(Math.min(...yy)+(Math.max(...yy)-Math.min(...yy))/2);}
  // Each vertex slab has constant crossing topology. Prefer broad slabs but
  // keep deterministic thin-slab representatives when the budget permits.
  const slabs=[];for(let i=1;i<unique.length;i++)slabs.push({y:unique[i-1]+(unique[i]-unique[i-1])/2,width:unique[i]-unique[i-1]});slabs.sort((a,b)=>b.width-a.width||a.y-b.y);for(const s of slabs)push(s.y);for(let i=1;i<=16;i++)push(low+(high-low)*i/17);
  return {u,v,levels,edges:edges.map(e=>({a:project(e.a),b:project(e.b)}))};});
 diagnostics.directions=axes.map(a=>[...a]);const candidates=[],seenPoints=new Set();let levelIndex=0;
 try{
  outer:while(diagnostics.scanlines<maxScanlines){let found=false;for(const frame of frames){if(levelIndex>=frame.levels.length)continue;found=true;if(diagnostics.scanlines>=maxScanlines)break outer;check();diagnostics.scanlines++;const y=frame.levels[levelIndex],crossings=[];
   for(const {a,b}of frame.edges){tick();if((a[1]<=y&&b[1]>y)||(b[1]<=y&&a[1]>y)){const x=a[0]+(y-a[1])*(b[0]-a[0])/(b[1]-a[1]);if(Number.isFinite(x))crossings.push(x);}}
   crossings.sort((a,b)=>a-b);for(let i=1;i<crossings.length;i++){const left=crossings[i-1],right=crossings[i];if(!(right>left))continue;const inset=Math.min(.02,(right-left)*.1)/(right-left);for(const fraction of [.5,.125,.875,inset,1-inset]){const x=left+(right-left)*fraction,p=[frame.u[0]*x+frame.v[0]*y,frame.u[1]*x+frame.v[1]*y],key=p.join(',');if(seenPoints.has(key))continue;seenPoints.add(key);const measured=classify(p,edges,tick);if(!measured.inside)continue;candidates.push({point:p,clearance:measured.clearance});if(candidates.length>=maxCandidates){diagnostics.truncated=true;diagnostics.exhaustedReason='candidate_limit';break outer;}}}
  }if(!found)break;levelIndex++;}
  if(diagnostics.scanlines>=maxScanlines){diagnostics.truncated=true;diagnostics.exhaustedReason??='scanline_limit';}
 }catch(error){if(error.code!=='WORK_LIMIT')throw error;diagnostics.truncated=true;diagnostics.exhaustedReason='edge_test_limit';}
 check();diagnostics.candidateCount=candidates.length;
 // Space-filling prefix: after the deepest point, distant components/ends are
 // visited before the centre monopolizes the first64 native successes.
 const result=[],remaining=candidates.map((c,i)=>({...c,index:i,near:Infinity}));let selected=remaining.reduce((best,c)=>!best||c.clearance>best.clearance?c:best,null);
 while(selected&&result.length<maxPoints){check();result.push(selected.point);remaining.splice(remaining.indexOf(selected),1);let best=null;for(const c of remaining){c.near=Math.min(c.near,Math.hypot(c.point[0]-selected.point[0],c.point[1]-selected.point[1]));if(!best||c.near>best.near||c.near===best.near&&c.clearance>best.clearance)best=c;}selected=best;}
 diagnostics.returned=result.length;diagnostics.maxPairDistance=0;for(let i=0;i<result.length;i++)for(let j=0;j<i;j++)diagnostics.maxPairDistance=Math.max(diagnostics.maxPairDistance,Math.hypot(result[i][0]-result[j][0],result[i][1]-result[j][1]));diagnostics.hasSeparatedPair=diagnostics.maxPairDistance>=minSeparation;
 return {points:result.map(p=>[...p]),diagnostics};
}
