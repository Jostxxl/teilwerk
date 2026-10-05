// Conservative fallback for a positive mathematical triangle-translation
// prism which cannot be represented reliably as a native floating solid.
// Geometry is never moved or rounded: all predicates use exact dyadic integers.
const view=new DataView(new ArrayBuffer(8)),obstacleData=new WeakMap();
const vector=p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite);
const add=(a,b)=>a.map((x,i)=>x+b[i]),sub=(a,b)=>a.map((x,i)=>x-b[i]),mul=(p,k)=>p.map(x=>x*k);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const min=values=>values.reduce((a,b)=>a<b?a:b),max=values=>values.reduce((a,b)=>a>b?a:b);
const failed=reason=>({verified:false,reason});
function dyadic(x){if(!x)return{n:0n,e:0};view.setFloat64(0,x,false);const bits=view.getBigUint64(0,false),exp=Number(bits>>52n&2047n),f=bits&((1n<<52n)-1n);return{n:(bits>>63n?-1n:1n)*(exp?f+(1n<<52n):f),e:exp?exp-1075:-1074};}
function atExponent(values,e){return values.map(p=>p.map(x=>x.n?x.n<<BigInt(x.e-e):0n));}
function box(points){return{min:[0,1,2].map(k=>min(points.map(p=>p[k]))),max:[0,1,2].map(k=>max(points.map(p=>p[k])))};}
function separated(a,b,axis){
 if(axis.every(x=>!x))return false;
 const ap=a.map(p=>dot(p,axis)),bp=b.map(p=>dot(p,axis));
 // Equality is boundary contact, not intersection with the open prism.
 return max(ap)<=min(bp)||max(bp)<=min(ap);
}
function triangleOutsideOpenPrism(prism,triangle,axes,edges){
 const te=[sub(triangle[1],triangle[0]),sub(triangle[2],triangle[1]),sub(triangle[0],triangle[2])];
 for(const axis of [...axes,cross(te[0],te[1])])if(separated(prism,triangle,axis))return true;
 for(const a of edges)for(const b of te)if(separated(prism,triangle,cross(a,b)))return true;
 return false;
}
async function buildTree(ids,boxes,checkpoint){
 await checkpoint();const bounds={min:[...boxes[ids[0]].min],max:[...boxes[ids[0]].max]};
 for(let j=1;j<ids.length;j++){if(!(j%2048))await checkpoint();const b=boxes[ids[j]];for(let k=0;k<3;k++){if(b.min[k]<bounds.min[k])bounds.min[k]=b.min[k];if(b.max[k]>bounds.max[k])bounds.max[k]=b.max[k];}}
 if(ids.length<=8)return{bounds,ids};
 let axis=0;for(let k=1;k<3;k++)if(bounds.max[k]-bounds.min[k]>bounds.max[axis]-bounds.min[axis])axis=k;
 const sorted=ids.slice().sort((a,b)=>{const d=boxes[a].min[axis]+boxes[a].max[axis]-boxes[b].min[axis]-boxes[b].max[axis];return d<0n?-1:d>0n?1:a-b;}),mid=sorted.length>>1;
 return{bounds,left:await buildTree(sorted.slice(0,mid),boxes,checkpoint),right:await buildTree(sorted.slice(mid),boxes,checkpoint)};
}
async function queryTree(tree,predicate,checkpoint,diagnostics){
 const stack=[tree],ids=[];while(stack.length){if(!(diagnostics.bvhNodes++%256))await checkpoint();const node=stack.pop();if(!predicate(node.bounds))continue;if(node.ids)ids.push(...node.ids);else stack.push(node.right,node.left);}return ids;
}
function rayIntersectsBox(bounds,q,direction,shift){
 let lower={n:0n,d:1n},upper=null;
 for(let k=0;k<3;k++){
  // All three deterministic directions have positive components. Slab
  // parameters remain rationals; cross multiplication never rounds a boundary.
  const lo={n:((bounds.min[k]<<shift)*4n)-q[k],d:direction[k]},hi={n:((bounds.max[k]<<shift)*4n)-q[k],d:direction[k]};
  if(lo.n*lower.d>lower.n*lo.d)lower=lo;if(!upper||hi.n*upper.d<upper.n*hi.d)upper=hi;
  if(upper.n*lower.d<lower.n*upper.d)return false;
 }return true;
}

/** Build a reusable read-only exact obstacle from a COMPLETE native NoError
 * solid's lossless mesh. Edge closure is checked independently. The returned
 * opaque handle cannot be reconstructed from persisted proof flags. */
export async function prepareExactSweepObstacle(mesh,{maxTriangles=100000,checkpoint=async()=>{}}={}){
 if(!Number.isInteger(maxTriangles)||maxTriangles<0||typeof checkpoint!=='function')throw Error('Ungültige Grenzen für die exakte Einschubprüfung.');
 const {vertices,triangles}=mesh||{};
 if(!Array.isArray(vertices)||!triangles||!Number.isInteger(triangles.length)||triangles.length%3||triangles.length<12)return{valid:false,reason:'invalid_obstacle_mesh'};
 if(triangles.length/3>maxTriangles||vertices.length>3*maxTriangles)return{valid:false,reason:'obstacle_limit'};
 const encoded=[],keys=new Map(),weld=[];let exponent=0;
 for(let i=0;i<vertices.length;i++){
  if(!(i%1024))await checkpoint();const p=vertices[i];if(!vector(p))return{valid:false,reason:'invalid_obstacle_coordinate'};
  const values=p.map(dyadic);for(const x of values)if(x.n&&x.e<exponent)exponent=x.e;encoded.push(values);
  const key=p.join(',');if(!keys.has(key))keys.set(key,keys.size);weld.push(keys.get(key));
 }
 const points=atExponent(encoded,exponent),edges=new Map(),faces=[],boxes=[];
 for(let f=0;f<triangles.length;f+=3){
  if(!(f%768))await checkpoint();const ids=Array.from(triangles.slice(f,f+3));if(ids.some(i=>!Number.isInteger(i)||i<0||i>=points.length))return{valid:false,reason:'invalid_obstacle_index'};
  const [a,b,c]=ids.map(i=>points[i]);if(cross(sub(b,a),sub(c,a)).every(x=>!x))return{valid:false,reason:'degenerate_obstacle_triangle'};
  faces.push(...ids);boxes.push(box([a,b,c]));const w=ids.map(i=>weld[i]);
  for(let k=0;k<3;k++){const a=w[k],b=w[(k+1)%3],key=a<b?a+':'+b:b+':'+a,edge=edges.get(key)||{count:0,orientation:0};edge.count++;edge.orientation+=a<b?1:-1;edges.set(key,edge);}
 }
 for(const edge of edges.values())if(edge.count!==2||edge.orientation!==0)return{valid:false,reason:'open_or_nonmanifold_obstacle'};
 const tree=await buildTree(Array.from({length:faces.length/3},(_,i)=>i),boxes,checkpoint),handle=Object.freeze({triangleCount:faces.length/3});obstacleData.set(handle,{points,triangles:faces,exponent,tree});return{valid:true,handle};
}

/** Certify that an entire EXACT triangle×[0,motion] prism avoids a closed
 * obstacle. SAT checks every obstacle face against the open convex prism.
 * A strict rational interior point must additionally have ZERO signed winding;
 * this prevents both containment and coplanar-entry false negatives. Anything
 * other than that complete certificate stays unverified, not 'zero collision'.
 *
 * budget is shared across all fallback prisms in a single insertion proof.
 * checkpoint propagates cancellation/deadline exceptions without swallowing
 * them. No native API is called here and no volume tolerance is introduced. */
export async function certifyExactTriangleSweep(triangle,motion,handle,{budget={limit:2000000,used:0},checkpoint=async()=>{}}={}){
 const obstacle=obstacleData.get(handle);
 if(!Array.isArray(triangle)||triangle.length!==3||!triangle.every(vector)||!vector(motion)||!obstacle)return failed('invalid_exact_sweep');
 if(!budget||!Number.isInteger(budget.limit)||budget.limit<0||!Number.isInteger(budget.used)||budget.used<0||typeof checkpoint!=='function')throw Error('Ungültiges Arbeitsbudget für die exakte Einschubprüfung.');
 const diagnostics={triangles:handle.triangleCount,bvhNodes:0,boxSeparated:0,satTested:0,rayTests:0,rayDirections:0},limited=Symbol('exact-work-limit');
 async function tick(){if(++budget.used>budget.limit)throw limited;if(!(budget.used%256))await checkpoint();}
 try{
  await checkpoint();const encoded=[...triangle,motion].map(p=>p.map(dyadic));let exponent=obstacle.exponent;for(const p of encoded)for(const x of p)if(x.n&&x.e<exponent)exponent=x.e;
  const [a,b,c,m]=atExponent(encoded,exponent),shift=BigInt(obstacle.exponent-exponent),points=[];
  for(let i=0;i<obstacle.points.length;i++){if(!(i%1024))await checkpoint();points.push(shift?obstacle.points[i].map(x=>x<<shift):obstacle.points[i]);}
  const n=cross(sub(b,a),sub(c,a));if(dot(n,m)<=0n)return{...failed('nonpositive_exact_prism'),diagnostics};
  // Endpoints are exact SUMS here, not binary64 values p + motion.
  const prism=[a,b,c,...[a,b,c].map(p=>add(p,m))],edges=[sub(b,a),sub(c,b),sub(a,c),m],axes=[n,...edges.slice(0,3).map(e=>cross(e,m))],bounds=box(prism),indices=obstacle.triangles;
  const nearby=await queryTree(obstacle.tree,b=>[0,1,2].every(k=>bounds.max[k]>(b.min[k]<<shift)&&(b.max[k]<<shift)>bounds.min[k]),checkpoint,diagnostics);diagnostics.boxSeparated=handle.triangleCount-nearby.length;
  for(const face of nearby){
   await tick();const f=face*3,tri=[points[indices[f]],points[indices[f+1]],points[indices[f+2]]],tb=box(tri);
   if([0,1,2].some(k=>bounds.max[k]<=tb.min[k]||tb.max[k]<=bounds.min[k])){diagnostics.boxSeparated++;continue;}
   diagnostics.satTested++;if(!triangleOutsideOpenPrism(prism,tri,axes,edges))return{...failed('obstacle_boundary_in_prism'),diagnostics};
  }
  // (a+b+2c+2m)/4 has positive barycentric weights and t=1/2.
  // Scale obstacle coordinates by4; the test point stays an exact integer.
  const q=add(add(add(a,b),mul(c,2n)),mul(m,2n));
  for(const direction of [[1n,3n,7n],[2n,5n,11n],[7n,11n,19n]]){
   diagnostics.rayDirections++;let hits=0,winding=0,ambiguous=false;
   const rayFaces=await queryTree(obstacle.tree,b=>rayIntersectsBox(b,q,direction,shift),checkpoint,diagnostics);
   for(const face of rayFaces){
    await tick();diagnostics.rayTests++;const f=face*3,x=mul(points[indices[f]],4n),y=mul(points[indices[f+1]],4n),z=mul(points[indices[f+2]],4n),e1=sub(y,x),e2=sub(z,x),h=cross(direction,e2),t=sub(q,x);let d=dot(e1,h);
    if(!d){if(!dot(cross(e1,e2),t)){ambiguous=true;break;}continue;}
    const crossing=d<0n?-1:1,v2=cross(t,e1);let u=dot(t,h),v=dot(direction,v2),distance=dot(e2,v2);if(d<0n){d=-d;u=-u;v=-v;distance=-distance;}
    if(u<0n||v<0n||u+v>d||distance<0n)continue;
    if(!u||!v||u+v===d||!distance){ambiguous=true;break;}hits++;winding+=crossing;
   }
   // Signed crossings preserve material in nested equally oriented shells;
   // an even hit count alone would incorrectly turn winding2 into a cavity.
   if(!ambiguous)return{verified:winding===0,reason:winding?'prism_inside_obstacle':'exact_prism_clear',diagnostics:{...diagnostics,rayHits:hits,rayWinding:winding}};
  }
  return{...failed('ambiguous_containment_ray'),diagnostics};
 }catch(error){if(error===limited)return{...failed('exact_work_limit'),diagnostics};throw error;}
}
