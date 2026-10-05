const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const normalize=a=>{const length=Math.hypot(...a);return a.map(x=>x/length);};
function canonical(normal){normal=normalize(normal);return normal.find(x=>Math.abs(x)>1e-10)<0?normal.map(x=>-x):normal;}

/** Exact area-weighted first/second triangle moments, independent of triangle
 * density. This describes the surface's principal axes, not a solid inertia
 * tensor. It proposes directions only; native cutting validates every child. */
export function surfacePrincipalFrame(data){
 if(!data?.vertices?.length||data.vertices.length%3||!data.triangles?.length||data.triangles.length%3)throw Error('Hauptachsen benötigen ein gültiges Dreiecksnetz.');
 const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(let i=0;i<data.vertices.length;i++){const x=data.vertices[i];if(!Number.isFinite(x))throw Error('Ungültige Modellkoordinaten.');const axis=i%3;min[axis]=Math.min(min[axis],x);max[axis]=Math.max(max[axis],x);}
 const origin=min.map((x,i)=>x/2+max[i]/2),first=[0,0,0],second=Array.from({length:3},()=>[0,0,0]);let area=0;
 for(let f=0;f<data.triangles.length;f+=3){const points=[];for(let k=0;k<3;k++){const id=data.triangles[f+k];if(!Number.isInteger(id)||id<0||id>=data.vertices.length/3)throw Error('Ungültiger Dreiecksindex.');points.push(origin.map((x,i)=>data.vertices[id*3+i]-x));}
  const [a,b,c]=points,weight=Math.hypot(...cross(b.map((x,i)=>x-a[i]),c.map((x,i)=>x-a[i])))/2;if(!weight)continue;const sum=a.map((x,i)=>x+b[i]+c[i]);area+=weight;
  for(let i=0;i<3;i++){first[i]+=weight*sum[i]/3;for(let j=0;j<3;j++)second[i][j]+=weight*(sum[i]*sum[j]+points.reduce((s,p)=>s+p[i]*p[j],0))/12;}
 }
 if(!Number.isFinite(area)||area<=0)throw Error('Keine auswertbare Modelloberfläche.');const center=first.map(x=>x/area),covariance=second.map((row,i)=>row.map((x,j)=>x/area-center[i]*center[j])),vectors=[[1,0,0],[0,1,0],[0,0,1]],scale=Math.max(1,...covariance.map((row,i)=>Math.abs(row[i])));
 for(let iteration=0;iteration<32;iteration++){let p=0,q=1;for(const [i,j]of [[0,2],[1,2]])if(Math.abs(covariance[i][j])>Math.abs(covariance[p][q]))[p,q]=[i,j];if(Math.abs(covariance[p][q])<=scale*1e-13)break;
  const angle=.5*Math.atan2(2*covariance[p][q],covariance[q][q]-covariance[p][p]),c=Math.cos(angle),s=Math.sin(angle),app=c*c*covariance[p][p]-2*s*c*covariance[p][q]+s*s*covariance[q][q],aqq=s*s*covariance[p][p]+2*s*c*covariance[p][q]+c*c*covariance[q][q];
  for(let k=0;k<3;k++)if(k!==p&&k!==q){const x=covariance[k][p],y=covariance[k][q];covariance[k][p]=covariance[p][k]=c*x-s*y;covariance[k][q]=covariance[q][k]=s*x+c*y;}covariance[p][p]=app;covariance[q][q]=aqq;covariance[p][q]=covariance[q][p]=0;
  for(let k=0;k<3;k++){const x=vectors[k][p],y=vectors[k][q];vectors[k][p]=c*x-s*y;vectors[k][q]=s*x+c*y;}
 }
 const order=[0,1,2].sort((i,j)=>covariance[j][j]-covariance[i][i]||i-j);return {area,center:center.map((x,i)=>x+origin[i]),axes:order.map(i=>canonical(vectors.map(row=>row[i]))),eigenvalues:order.map(i=>covariance[i][i])};
}

/** Candidate planes in the supplied CURRENT print frame. The caller converts
 * them back to its native assembly frame before cutting. A real volume COM is
 * mandatory; neither the bounding-box center nor the surface mean replaces it.
 * This is a bounded heuristic, with no claim that any plane is safe by itself. */
export function massCutCandidates(data,{centerOfMass,maxCandidates=8}={}){
 if(!Array.isArray(centerOfMass)||centerOfMass.length!==3||!centerOfMass.every(Number.isFinite)||!Number.isInteger(maxCandidates)||maxCandidates<0)throw Error('Schnittvorschläge benötigen einen berechneten Volumenschwerpunkt und ein endliches Budget.');
 if(!maxCandidates)return [];const frame=surfacePrincipalFrame(data),directions=[];
 frame.axes.forEach((normal,axis)=>directions.push({normal,kind:'surface_principal',principalAxis:axis}));
 for(const [i,j]of [[0,1],[0,2]])for(const degrees of [-25,25,-45,45]){const angle=degrees*Math.PI/180;directions.push({normal:canonical(frame.axes[i].map((x,k)=>x*Math.cos(angle)+frame.axes[j][k]*Math.sin(angle))),kind:'surface_principal_oblique',principalAxis:i,secondaryAxis:j,degrees});}
 const ranges=directions.map(entry=>{let min=Infinity,max=-Infinity;for(let i=0;i<data.vertices.length;i+=3){const value=entry.normal[0]*data.vertices[i]+entry.normal[1]*data.vertices[i+1]+entry.normal[2]*data.vertices[i+2];min=Math.min(min,value);max=Math.max(max,value);}return {...entry,min,max};}),out=[],keys=new Set();
 const add=(entry,offset,offsetKind)=>{if(out.length>=maxCandidates||entry.max-entry.min<=.2||offset<=entry.min+.1||offset>=entry.max-.1)return;const key=[...entry.normal,offset].map(x=>Math.round(x*1e7)).join(',');if(keys.has(key))return;keys.add(key);const {min,max,...plane}=entry;out.push({...plane,normal:[...plane.normal],offset,offsetKind,span:[min,max]});};
 // First try the main axis through mass center and its range midpoint. The
 // quarter candidates allow uneven shells to retain two substantial pieces.
 const first=ranges[0];add(first,dot(first.normal,centerOfMass),'volume_center');for(const fraction of [.5,.25,.75])add(first,first.min+(first.max-first.min)*fraction,`range_${fraction}`);
 for(const entry of ranges.slice(1))add(entry,dot(entry.normal,centerOfMass),'volume_center');return out;
}

/** Complete only the missing volume-COM directions from the finite principal
 * family. Used after an unsuccessful strict primary stage; not a second grid
 * of offsets and never a duplicate plane in the opposite normal convention. */
export function massComplementCandidates(data,{centerOfMass,testedPlanes=[],maxCandidates=0}={}){
 if(!Number.isInteger(maxCandidates)||maxCandidates<0||maxCandidates>8||!Array.isArray(testedPlanes))throw Error('Höchstens acht ergänzende Schwerpunktsebenen sind zulässig.');
 const key=p=>{if(!Array.isArray(p?.normal)||p.normal.length!==3||!p.normal.every(Number.isFinite)||!Number.isFinite(p.offset)||Math.hypot(...p.normal)<1e-8)throw Error('Ungültige zuvor geprüfte Schnittebene.');const length=Math.hypot(...p.normal),sign=p.normal.find(x=>Math.abs(x)>1e-8)<0?-1:1;return [...p.normal.map(x=>x/length*sign),p.offset/length*sign].map(x=>Math.round(x*1e6)).join(',');};
 const seen=new Set(testedPlanes.map(key));if(!maxCandidates)return [];
 return massCutCandidates(data,{centerOfMass,maxCandidates:32}).filter(p=>p.offsetKind==='volume_center'&&!seen.has(key(p))).slice(0,maxCandidates);
}

/** A bounded second-stage family for a body that still tips after orientation.
 * Tilts the current bed normal toward the unsupported mass projection. These
 * are only proposals; connectedness, gravity, contact, fit and both overhang
 * baselines must all be checked by the native caller without softer limits. */
export function stabilityCutCandidates(data,{centerOfMass,contactHull,maxCandidates=16}={}){
 if(!Array.isArray(centerOfMass)||centerOfMass.length!==3||!centerOfMass.every(Number.isFinite)||!Array.isArray(contactHull)||contactHull.length<3||contactHull.some(p=>!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite))||!Number.isInteger(maxCandidates)||maxCandidates<0||maxCandidates>24)throw Error('Standfestigkeitsschnitte benötigen Schwerpunkt, echte Auflagehülle und höchstens 24 Kandidaten.');
 if(!maxCandidates)return [];if(!data?.vertices?.length||data.vertices.length%3||data.vertices.some(v=>!Number.isFinite(v)))throw Error('Ungültige Modellkoordinaten.');
 let closest=null;for(let i=0;i<contactHull.length;i++){const a=contactHull[i],b=contactHull[(i+1)%contactHull.length],dx=b[0]-a[0],dy=b[1]-a[1],length=dx*dx+dy*dy;if(length<1e-16)continue;const t=Math.max(0,Math.min(1,((centerOfMass[0]-a[0])*dx+(centerOfMass[1]-a[1])*dy)/length)),point=[a[0]+t*dx,a[1]+t*dy],distance=Math.hypot(centerOfMass[0]-point[0],centerOfMass[1]-point[1]);if(!closest||distance<closest.distance)closest={point,distance};}
 if(!closest||closest.distance<=1e-8)return [];const lean=[(centerOfMass[0]-closest.point[0])/closest.distance,(centerOfMass[1]-closest.point[1])/closest.distance],out=[],seen=new Set();
 for(const degrees of [15,20,30,45]){const angle=degrees*Math.PI/180,normal=[lean[0]*Math.sin(angle),lean[1]*Math.sin(angle),Math.cos(angle)];let min=Infinity,max=-Infinity;for(let i=0;i<data.vertices.length;i+=3){const x=normal[0]*data.vertices[i]+normal[1]*data.vertices[i+1]+normal[2]*data.vertices[i+2];min=Math.min(min,x);max=Math.max(max,x);}for(const [offsetKind,offset]of [['range_0.25',min+(max-min)*.25],['range_0.5',(min+max)/2],['range_0.75',min+(max-min)*.75],['volume_center',dot(normal,centerOfMass)]]){if(out.length>=maxCandidates)return out;if(max-min<=.2||offset<=min+.1||offset>=max-.1)continue;const key=[...normal,offset].map(x=>Math.round(x*1e7)).join(',');if(seen.has(key))continue;seen.add(key);out.push({normal:[...normal],offset,kind:'bed_tilt_toward_unsupported_com',degrees,offsetKind,span:[min,max]});}}
 return out;
}
