import {prepareContourDefinition} from './features.mjs';
import {coverContourFaces} from './contour-coverage.mjs';
import {createContourDepthContext,resolveContourDepth,contourColumnIntervals} from './contour-depth.mjs';
import {convexHull2D,fitPlanarHull} from './planar-bed-fit.mjs';

const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const fatal=e=>e?.name==='RuntimeError'||/Aborted|memory access out of bounds|unreachable|RuntimeError/i.test(e?.message||'');
const point=(data,id)=>Array.from(data.vertices.subarray(id*3,id*3+3));
function issue(code,message,details){return Object.assign(Error(message),{code,details});}
function freeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}

// Build adjacency from geometric edges: STL imports may duplicate every index.
// Components and the subsequent two-source shortest-path growth never discard
// a selected face merely because it is small or its normal is nearly tangent.
function graph(data,faces,check){
 const centers=new Map(),areas=new Map(),normals=new Map(),adj=new Map(),edges=new Map();
 for(let i=0;i<faces.length;i++){
  if(!(i%128))check();const f=faces[i],points=[0,1,2].map(k=>point(data,data.triangles[f*3+k])),[a,b,c]=points,u=b.map((x,j)=>x-a[j]),v=c.map((x,j)=>x-a[j]),normal=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],keys=points.map(p=>p.map(x=>Math.round(x*1e5)).join(','));
  centers.set(f,a.map((x,j)=>(x+b[j]+c[j])/3));areas.set(f,Math.hypot(...normal)/2);normals.set(f,normal);adj.set(f,[]);
  for(let k=0;k<3;k++){const x=keys[k],y=keys[(k+1)%3],key=x<y?x+';'+y:y+';'+x;let edge=edges.get(key);if(!edge)edges.set(key,edge={faces:[],points:[points[k],points[(k+1)%3]]});edge.faces.push(f);}
 }
 let edgeCount=0;for(const edge of edges.values()){if(!(edgeCount++%128))check();for(let i=0;i<edge.faces.length;i++)for(let j=i+1;j<edge.faces.length;j++){adj.get(edge.faces[i]).push(edge.faces[j]);adj.get(edge.faces[j]).push(edge.faces[i]);}}
 return {centers,areas,normals,adj,edges};
}
function connected(faces,g,check){
 const todo=new Set(faces),out=[];
 for(const seed of faces){if(!todo.delete(seed))continue;const part=[seed];for(let j=0;j<part.length;j++){if(!(j%128))check();for(const f of g.adj.get(part[j]))if(todo.delete(f))part.push(f);}part.sort((a,b)=>a-b);out.push(part);}
 return out;
}
class Heap{
 constructor(){this.items=[];}
 less(a,b){return a.distance<b.distance||a.distance===b.distance&&(a.f<b.f||a.f===b.f&&a.owner<b.owner);}
 push(item){const a=this.items;let i=a.length;a.push(item);while(i){const p=(i-1)>>1;if(!this.less(item,a[p]))break;a[i]=a[p];i=p;}a[i]=item;}
 pop(){const a=this.items,first=a[0],last=a.pop();if(a.length){let i=0;while(i*2+1<a.length){let j=i*2+1;if(j+1<a.length&&this.less(a[j+1],a[j]))j++;if(!this.less(a[j],last))break;a[i]=a[j];i=j;}a[i]=last;}return first;}
}
function divide(faces,g,definition,check){
 if(faces.length<2)return [];
 const axes=definition?[definition.u,definition.v,definition.n]:[[1,0,0],[0,1,0],[0,0,1]];let axis=axes[0],span=-1;
 for(const candidate of axes){let min=Infinity,max=-Infinity;for(const f of faces){const h=dot(g.centers.get(f),candidate);min=Math.min(min,h);max=Math.max(max,h);}if(max-min>span){axis=candidate;span=max-min;}}
 const order=faces.slice().sort((a,b)=>dot(g.centers.get(a),axis)-dot(g.centers.get(b),axis)||a-b),seeds=[order[0],order.at(-1)],allowed=new Set(faces),owners=new Map(),distances=new Map(),queue=new Heap();
 seeds.forEach((f,owner)=>{distances.set(f,0);queue.push({f,owner,distance:0});});let count=0;
 while(queue.items.length){if(!(count++%128))check();const q=queue.pop();if(owners.has(q.f)||q.distance!==distances.get(q.f))continue;owners.set(q.f,q.owner);const c=g.centers.get(q.f);
  for(const f of g.adj.get(q.f)){if(!allowed.has(f)||owners.has(f))continue;const n=g.centers.get(f),distance=q.distance+Math.hypot(...c.map((x,i)=>x-n[i]));if(distance<(distances.get(f)??Infinity)){distances.set(f,distance);queue.push({f,owner:q.owner,distance});}}
 }
 if(owners.size!==faces.length)throw Error('Lokale Unterteilung verlor den Zusammenhang ihrer Quellflächen.');
 return [faces.filter(f=>owners.get(f)===0),faces.filter(f=>owners.get(f)===1)].filter(part=>part.length);
}
function describe(faces,g){
 const center=[0,0,0],normal=[0,0,0];let area=0;
 for(const f of faces){const a=g.areas.get(f),c=g.centers.get(f),n=g.normals.get(f);area+=a;for(let j=0;j<3;j++){center[j]+=c[j]*a;normal[j]+=n[j];}}
 return {area,center:center.map(x=>x/Math.max(area,1e-30)),normal};
}
function segments(faces,g,check){const selected=new Set(faces),out=[];let count=0;for(const edge of g.edges.values()){if(!(count++%128))check();if(edge.faces.filter(f=>selected.has(f)).length===1)out.push(...edge.points.map(p=>[...p]));}return out;}

function wallAnchors(context,definition,faces,g,{depth,lineTolerance,check}){
 const anchors=[],thicknesses=[];let min=definition.surfaceMin,max=definition.surfaceMax,totalArea=0,missing=0,firstMissing=null;
 // Every face is probed. Sparse sampling misses narrow fallback regions which
 // otherwise appear to authorize an unrelated, distant side of a folded roof.
 for(let i=0;i<faces.length;i++){
  if(!(i%32))check();const f=faces[i],c=g.centers.get(f),height=dot(c,definition.n),xy=[dot(c,definition.u),dot(c,definition.v)];let intervals;
  try{intervals=contourColumnIntervals(context,definition,xy);}catch(error){if(fatal(error))throw error;missing++;firstMissing??=f;continue;}
  const matches=intervals.filter(([lo,hi])=>height>=lo-1e-4&&height<=hi+1e-4);
  if(matches.length!==1||!g.areas.get(f)){missing++;firstMissing??=f;continue;}
  const interval=matches[0],area=g.areas.get(f);min=Math.min(min,interval[0]);max=Math.max(max,interval[1]);totalArea+=area;thicknesses.push({value:interval[1]-interval[0],weight:area});anchors.push({interval,intervals});
 }
 if(missing)throw issue('MISSING_ANCHOR',`${missing} Quellflächen besitzen keinen eindeutigen lokalen Wandanker.`,{anchorFaces:faces.length,anchoredFaces:anchors.length,missingAnchors:missing,firstMissingFace:firstMissing});
 thicknesses.sort((a,b)=>a.value-b.value);let weight=0,p90=0;for(const item of thicknesses){weight+=item.weight;p90=item.value;if(weight>=totalArea*.9)break;}
 const tolerance=Math.max(depth,1.5*p90,2*lineTolerance+1);
 return {anchors,min,max,p90,tolerance,capLimits:[min-tolerance,max+tolerance]};
}
function localWall(definition,faces,probe){
 const {anchors,min,max,p90,tolerance}=probe,extensionBelow=Math.max(0,min-definition.min),extensionAbove=Math.max(0,definition.max-max);let maximumRemoteGap=0,remoteIntervals=0;
 for(const anchor of anchors)for(const interval of anchor.intervals){if(interval===anchor.interval||Math.min(interval[1],definition.max)-Math.max(interval[0],definition.min)<=1e-5)continue;remoteIntervals++;maximumRemoteGap=Math.max(maximumRemoteGap,anchor.interval[0]-interval[1],interval[0]-anchor.interval[1]);}
 const result={version:1,allFaceCenters:true,anchorFaces:faces.length,anchoredFaces:anchors.length,missingAnchors:0,sourceMin:definition.surfaceMin,sourceMax:definition.surfaceMax,anchorMin:min,anchorMax:max,weightedP90Thickness:p90,tolerance,extensionBelow,extensionAbove,remoteIntervals,maximumRemoteGap,passed:extensionBelow<=tolerance+1e-4&&extensionAbove<=tolerance+1e-4&&maximumRemoteGap<=tolerance+1e-4};
 if(!result.passed)throw issue('NONLOCAL_WALL','Die Kontur erfasst Material außerhalb der örtlich verankerten Wand.',result);
 return result;
}

// Accepted definitions are finished before any open-surface clipping cache sees
// them. Callers must pass this flat list, in this order, to BOTH preview and the
// native grouped closure; rejected faces remain part of the original remainder.
export function prepareLocalContours(api,data,proposals,bed,{depth=20,lineTolerance=2,maxDepth=6,maxLeaves=2048,maxMillis=120000,progress=()=>{}}={}){
 if(!Array.isArray(proposals)||!Array.isArray(bed)||bed.length!==3||bed.some(x=>!Number.isFinite(x)||x<=0)||!Number.isFinite(depth)||depth<.5||depth>100||!Number.isFinite(lineTolerance)||lineTolerance<0||!Number.isInteger(maxDepth)||maxDepth<0||!Number.isInteger(maxLeaves)||maxLeaves<1||!Number.isFinite(maxMillis)||maxMillis<0||typeof progress!=='function')throw Error('Ungültige Einstellungen für lokale Konturen.');
 if(!data?.vertices?.length||!data?.triangles?.length||data.vertices.length%3||data.triangles.length%3)throw Error('Lokale Konturen benötigen ein gültiges Dreiecksnetz.');
 const started=performance.now(),accepted=[],rejected=[],roots=proposals.map((p,parent)=>{if(!Array.isArray(p.faces)&&!ArrayBuffer.isView(p.faces))throw Error('Ein Konturvorschlag benötigt Quellflächen.');return {parent,faces:[...new Set(p.faces)].sort((a,b)=>a-b),path:[0],level:0,graph:null};}),stack=roots.slice().reverse(),diagnostics={version:1,inputProposals:proposals.length,inputFaceReferences:proposals.reduce((sum,p)=>sum+p.faces.length,0),inputFaces:roots.reduce((sum,r)=>sum+r.faces.length,0),attempts:0,subdivisions:0,initialComponents:0,acceptedFaces:0,rejectedFaces:0,acceptedArea:0,rejectedArea:0,knownRejectedArea:0,unmeasuredRejectedFaces:0,budgetExceeded:false,stopReason:null,reasons:{},limits:{maxDepth,maxLeaves,maxMillis},allSourceFacesRetained:true};
 let context=null,current=null;
 const check=()=>{if(performance.now()-started>=maxMillis)throw issue('TIME_BUDGET','Zeitbudget für lokale Konturen erreicht.');};
 const reject=(item,error)=>{const description=item.graph?describe(item.faces,item.graph):null;rejected.push({parentProposalIndex:item.parent,proposal:item.parent,subdivisionPath:item.path.join('.'),faces:Object.freeze([...item.faces]),reason:error.message,code:error.code||'CONTOUR_REJECTED',...(error.details?{localWallCheck:error.details}:{}),area:description?.area??null,retained:true});diagnostics.reasons[error.code||'CONTOUR_REJECTED']=(diagnostics.reasons[error.code||'CONTOUR_REJECTED']||0)+1;diagnostics.rejectedFaces+=item.faces.length;if(description)diagnostics.knownRejectedArea+=description.area;else diagnostics.unmeasuredRejectedFaces+=item.faces.length;diagnostics.rejectedArea=diagnostics.unmeasuredRejectedFaces?null:diagnostics.knownRejectedArea;};
 try{
  while(stack.length){
   current=stack.pop();check();
   if(accepted.length>=maxLeaves){diagnostics.budgetExceeded=true;diagnostics.stopReason??='LEAF_BUDGET';reject(current,issue('LEAF_BUDGET','Höchstzahl lokaler Konturen erreicht.'));current=null;continue;}
   if(!current.faces.length||current.faces.some(f=>!Number.isInteger(f)||f<0||f>=data.triangles.length/3)){reject(current,issue('INVALID_FACES','Die Quellflächenauswahl ist leer oder veraltet.'));current=null;continue;}
   if(!current.graph){current.graph=graph(data,current.faces,check);const components=connected(current.faces,current.graph,check);diagnostics.initialComponents+=components.length;if(components.length>1){for(let i=components.length-1;i>=0;i--)stack.push({...current,faces:components[i],path:[i]});current=null;continue;}}
   context??=createContourDepthContext(data);check();const description=describe(current.faces,current.graph);let definition=null,tolerance=lineTolerance,error=null,wallCheck=null,fit=null;diagnostics.attempts++;progress(`Lokale Kontur ${current.parent+1}/${proposals.length} · Bereich ${current.path.join('.')} · ${accepted.length} geprüft`);
   try{
    if(Math.hypot(...description.normal)<1e-10)throw issue('AMBIGUOUS_NORMAL','Die Quellflächen benötigen mehrere örtliche Schnittrichtungen.');
    for(let retry=0;retry<4;retry++){check();try{definition=prepareContourDefinition(api,data,current.faces,depth,tolerance);break;}catch(e){if(fatal(e))throw e;if(!/Ausgleichslinie|Linientoleranz/.test(e.message)||!tolerance||retry===3)throw e;tolerance/=2;}}
    check();definition=coverContourFaces(api,data,current.faces,definition,{maxPadding:Math.max(.6,2*tolerance+.6)});check();
    const anchors=wallAnchors(context,definition,current.faces,current.graph,{depth,lineTolerance:tolerance,check});check();
    definition=resolveContourDepth(data,definition,{context,faces:current.faces,capLimits:anchors.capLimits});check();
    wallCheck=localWall(definition,current.faces,anchors);check();
    const thickness=definition.max-definition.min,hull=convexHull2D(definition.contours.flat());fit=fitPlanarHull(hull,bed.slice(0,2),{check});
    if(!fit||thickness>bed[2]+.005)throw issue('OUTSIDE_BED','Der lokale Schnittkörper passt in dieser ebenen Drucklage noch nicht in den Bauraum.',{...wallCheck,projectedFit:!!fit,depth:thickness});
   }catch(e){if(fatal(e)||e.code==='TIME_BUDGET')throw e;error=e;}
   if(!error){
    const faces=Object.freeze([...current.faces]),boundary=segments(faces,current.graph,check),cutDefinition=freeze(definition);check();accepted.push({...proposals[current.parent],faces,method:'local-contour',sourceMethod:proposals[current.parent].method,parentProposalIndex:current.parent,subdivisionPath:current.path.join('.'),estimatedSize:[...fit.size,definition.max-definition.min],normal:[...definition.n],center:description.center,area:description.area,segments:boundary,seed:faces[0],lineTolerance:tolerance,cutDefinition,localWallCheck:freeze({...wallCheck,projectedFit:true,bedAngle:fit.angle,continuousBedFit:fit.continuous})});diagnostics.acceptedFaces+=faces.length;diagnostics.acceptedArea+=description.area;current=null;continue;
   }
   if(current.level>=maxDepth){reject(current,issue('DEPTH_LIMIT',`Unterteilungsgrenze erreicht: ${error.message}`,error.details));current=null;continue;}
   const children=divide(current.faces,current.graph,definition,check);
   if(children.length<2){reject(current,error);current=null;continue;}
   if(accepted.length+stack.filter(item=>item.graph).length+children.length>maxLeaves){diagnostics.budgetExceeded=true;diagnostics.stopReason??='LEAF_BUDGET';reject(current,issue('LEAF_BUDGET',`Höchstzahl lokaler Konturen erreicht: ${error.message}`,error.details));current=null;continue;}
   diagnostics.subdivisions++;for(let i=children.length-1;i>=0;i--)stack.push({...current,faces:children[i],path:[...current.path,i],level:current.level+1});current=null;
  }
 }catch(error){
  if(error.code!=='TIME_BUDGET')throw error;diagnostics.budgetExceeded=true;diagnostics.stopReason='TIME_BUDGET';if(current)reject(current,error);for(const item of stack)reject(item,error);stack.length=0;
 }finally{context?.dispose();}
 const compare=(a,b)=>a.parentProposalIndex-b.parentProposalIndex||comparePath(a.subdivisionPath,b.subdivisionPath);accepted.sort(compare);rejected.sort(compare);
 // This is a source-face ownership invariant, independently of prism overlap.
 // It is intentionally checked per parent because two original proposals may
 // legitimately reference the same source triangle.
 const ownership=roots.map(()=>[]);for(const item of [...accepted,...rejected])for(const face of item.faces)ownership[item.parentProposalIndex].push(face);
 for(let i=0;i<roots.length;i++){const actual=ownership[i].sort((a,b)=>a-b),expected=roots[i].faces;if(actual.length!==expected.length||actual.some((f,j)=>f!==expected[j]))throw Error('Lokale Konturvorbereitung hat Quellflächen verloren oder doppelt zugeordnet.');}
 diagnostics.complete=rejected.length===0;diagnostics.accepted=accepted.length;diagnostics.rejected=rejected.length;diagnostics.elapsedMs=performance.now()-started;diagnostics.duplicateInputReferences=diagnostics.inputFaceReferences-diagnostics.inputFaces;
 return {proposals:accepted,rejected,diagnostics};
}
function comparePath(a,b){const aa=a.split('.').map(Number),bb=b.split('.').map(Number);for(let i=0;i<Math.min(aa.length,bb.length);i++)if(aa[i]!==bb[i])return aa[i]-bb[i];return aa.length-bb.length;}
