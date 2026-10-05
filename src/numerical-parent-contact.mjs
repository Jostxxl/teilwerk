// A deliberately bounded contact resolution, NOT a native-kernel error bound.
// Call only with complete lossless meshes of current trusted closed solids.
// This helper neither establishes material validity nor authorizes parent IDs.
export const NUMERICAL_PARENT_CONTACT_LIMITS=Object.freeze({vertices:300000,triangles:100000,absoluteResolutionMm:1e-8,relativeResolution:128*Number.EPSILON});
const bytes=new DataView(new ArrayBuffer(8));
function dyadic(x){if(x===0)return {n:0n,e:0};bytes.setFloat64(0,x,false);const b=bytes.getBigUint64(0,false),e=Number(b>>52n&2047n),f=b&((1n<<52n)-1n);return {n:(b>>63n?-1n:1n)*(e?f+(1n<<52n):f),e:e?e-1075:-1074};}
const abs=n=>n<0n?-n:n;
function vector(value){if(!Array.isArray(value)||value.length!==3)return null;const out=[];for(let i=0;i<3;i++){const d=Object.getOwnPropertyDescriptor(value,String(i));if(!d||!Object.hasOwn(d,'value')||!Number.isFinite(d.value))return null;out.push(d.value);}return out;}
function snapshot(mesh){
 const vertices=mesh?.vertices,triangles=mesh?.triangles;
 if(!Array.isArray(vertices)||vertices.length<4||!triangles)return {reason:'invalid_mesh'};
 const array=Array.isArray(triangles),typed=triangles instanceof Uint32Array||triangles instanceof Int32Array;
 if(!array&&!typed)return {reason:'invalid_mesh'};
 const length=typed?Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint32Array.prototype),'length').get.call(triangles):triangles.length;
 if(!Number.isInteger(length)||length<12||length%3)return {reason:'invalid_mesh'};
 if(vertices.length>NUMERICAL_PARENT_CONTACT_LIMITS.vertices||length/3>NUMERICAL_PARENT_CONTACT_LIMITS.triangles)return {reason:'geometry_limit'};
 const copy=[];for(let i=0;i<vertices.length;i++){const d=Object.getOwnPropertyDescriptor(vertices,String(i)),p=d&&Object.hasOwn(d,'value')&&vector(d.value);if(!p)return {reason:'invalid_mesh'};copy.push(p);}
 // Validate the complete index buffer even though the convex bounds use ALL
 // vertices, including unreferenced ones. Do not accept sparse index arrays.
 for(let i=0;i<length;i++){const d=array?Object.getOwnPropertyDescriptor(triangles,String(i)):null,v=array?(d&&Object.hasOwn(d,'value')?d.value:undefined):triangles[i];if(!Number.isInteger(v)||v<0||v>=copy.length)return {reason:'invalid_mesh'};}
 return {vertices:copy,triangleCount:length/3};
}
function mantissa(n){n=abs(n);if(!n)return {m:0,e:0};const e=n.toString(2).length-1,shift=Math.max(0,e-52);return {m:Number(n>>BigInt(shift))/2**(e-shift),e};}
function number(n,e){const a=mantissa(n),value=(n<0n?-1:1)*a.m*2**(a.e+e);return Number.isFinite(value)?value:null;}
function distance(d,normSquared,e){const a=mantissa(d),b=mantissa(normSquared);if(!a.m)return 0;const value=a.m/Math.sqrt(b.m*(b.e%2?2:1))*2**(e+a.e-Math.floor(b.e/2));return Number.isFinite(value)?value:null;}

/** Moving must be on the positive side of the supplied contact plane and move
 * further in that direction. A proof covers this PAIR over the whole linear
 * path, allowing at most the stated initial normal penetration. Other bodies,
 * pins, topology and physical fit still require their independent checks.
 *
 * All decisions use exact dyadic integers. The decimal diagnostics are derived
 * only afterwards. Failed checkpoints propagate, including cancellation and
 * deadline exceptions. Inputs are privately copied before asynchronous work.
 */
export async function certifyNumericalParentContact(movingMesh,obstacleMesh,motion,contactPlane,{checkpoint=async()=>{}}={}){
 if(typeof checkpoint!=='function')throw Error('Ungültiger Kontrollpunkt für die numerische Kontaktprüfung.');
 const failed=reason=>({verified:false,reason,exactZeroOverlap:false});
 const normal=vector(contactPlane?.normal),offset=contactPlane?.offset,move=vector(motion);
 if(!normal||!normal.some(x=>x!==0)||!Number.isFinite(offset))return failed('invalid_contact_plane');
 if(!move)return failed('invalid_motion');
 const moving=snapshot(movingMesh),obstacle=snapshot(obstacleMesh);if(moving.reason||obstacle.reason)return failed(moving.reason||obstacle.reason);
 await checkpoint();
 let coordinateScale=1,exponent=0,visited=0;
 const include=x=>{const d=dyadic(x);if(d.n&&d.e<exponent)exponent=d.e;};
 for(const x of [...normal,offset,...move])include(x);
 for(const mesh of [moving,obstacle])for(const p of mesh.vertices){if(!(visited++%256))await checkpoint();for(const x of p){coordinateScale=Math.max(coordinateScale,Math.abs(x));include(x);}}
 const resolutionMm=Math.min(NUMERICAL_PARENT_CONTACT_LIMITS.absoluteResolutionMm,NUMERICAL_PARENT_CONTACT_LIMITS.relativeResolution*coordinateScale);include(resolutionMm);
 const integer=x=>{const d=dyadic(x);return d.n?d.n<<BigInt(d.e-exponent):0n;},n=normal.map(integer),m=move.map(integer),dot=(a,b)=>a.reduce((sum,x,k)=>sum+x*b[k],0n),normSquared=dot(n,n),planeOffset=integer(offset)<<BigInt(-exponent),tau=integer(resolutionMm),boundSquared=tau*tau*normSquared,motionDot=dot(n,m);
 async function range(mesh){let lo=null,hi=null;for(let i=0;i<mesh.vertices.length;i++){if(!(i%256))await checkpoint();const value=dot(n,mesh.vertices[i].map(integer));if(lo===null||value<lo)lo=value;if(hi===null||value>hi)hi=value;}return {lo,hi};}
 const a=await range(moving),b=await range(obstacle),depth=b.hi-a.lo,positiveDepth=depth>0n?depth:0n,movingPlane=a.lo-planeOffset,obstaclePlane=b.hi-planeOffset;
 const diagnostics={exactZeroOverlap:depth<=0n,measuredMaxDepthMm:distance(positiveDepth,normSquared,exponent),resolutionMm,coordinateScale,plane:{normal:[...normal],offset},motionDot:number(motionDot,2*exponent),motionDotSign:motionDot<0n?-1:motionDot>0n?1:0,motionDotExact:{integer:motionDot.toString(),exponent:2*exponent},movingContactPlaneDistanceMm:distance(abs(movingPlane),normSquared,exponent),obstacleContactPlaneDistanceMm:distance(abs(obstaclePlane),normSquared,exponent),movingVertexCount:moving.vertices.length,obstacleVertexCount:obstacle.vertices.length,method:'exact-dyadic-support-intervals',resolutionIsKernelErrorBound:false,scope:'current-trusted-closed-material-pair-only'};
 const reject=reason=>({verified:false,reason,...diagnostics});
 await checkpoint();
 if(motionDot<=0n)return reject('motion_not_separating');
 // These squared comparisons are invariant under positive rescaling of the
 // plane. No normalization, square root or rounded end position decides them.
 if(positiveDepth*positiveDepth>boundSquared)return reject('contact_depth_exceeds_resolution');
 if(movingPlane*movingPlane>boundSquared||obstaclePlane*obstaclePlane>boundSquared)return reject('contact_plane_mismatch');
 if(a.lo+motionDot<b.hi)return reject('end_not_separated');
 return {verified:true,reason:depth<=0n?'exact_parent_separation':'numerical_parent_contact',...diagnostics,numericalContactResolutionApplied:depth>0n,endExactlySeparated:true};
}
