// Sign of ((b-a) x (c-a)) · motion on the ORIGINAL binary64 inputs.
// The conservative filter includes subtraction error. Near cancellation we
// operate on exact dyadic integers, not already rounded coordinate differences.
const bytes=new ArrayBuffer(8),view=new DataView(bytes);
function dyadic(value){if(!value)return {n:0n,e:0};view.setFloat64(0,value,false);const bits=view.getBigUint64(0,false),exponent=Number(bits>>52n&2047n),fraction=bits&((1n<<52n)-1n);return {n:(bits>>63n?-1n:1n)*(exponent?fraction+(1n<<52n):fraction),e:exponent?exponent-1075:-1074};}
const sub=(a,b)=>a.map((x,i)=>x-b[i]);
function exactNumber(n,e){if(!n)return 0;const sign=n<0n?-1:1;n=n<0n?-n:n;const shift=Math.max(0,n.toString(2).length-52);return sign*Number(n>>BigInt(shift))*2**(e+shift);}
function exactDeterminant(a,b,c,last,point=false){
 const encoded=[a,b,c,last].map(p=>p.map(dyadic)),nonzero=encoded.flat().filter(x=>x.n),exponent=nonzero.length?Math.min(...nonzero.map(x=>x.e)):0,points=encoded.map(p=>p.map(x=>x.n?x.n<<BigInt(x.e-exponent):0n)),x=sub(points[1],points[0]),y=sub(points[2],points[0]),m=point?sub(points[3],points[0]):points[3],det=(x[1]*y[2]-x[2]*y[1])*m[0]+(x[2]*y[0]-x[0]*y[2])*m[1]+(x[0]*y[1]-x[1]*y[0])*m[2];
 return {sign:det<0n?-1:det>0n?1:0,value:exactNumber(det,exponent*3),exact:true};
}
/** Exact side of the oriented triangle plane, including the final subtraction. */
export function sweepPlaneSide(a,b,c,point){
 if(![a,b,c,point].every(p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite)))throw Error('Ungültige Koordinaten für die Prismenprüfung.');return exactDeterminant(a,b,c,point,true);
}
export function sweepDirection(a,b,c,motion){
 if(![a,b,c,motion].every(p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite)))throw Error('Ungültige Koordinaten für die Führungsrichtung.');
 const u=sub(b,a),v=sub(c,a),value=(u[1]*v[2]-u[2]*v[1])*motion[0]+(u[2]*v[0]-u[0]*v[2])*motion[1]+(u[0]*v[1]-u[1]*v[0])*motion[2],bu=b.map((x,i)=>Math.abs(x)+Math.abs(a[i])),cv=c.map((x,i)=>Math.abs(x)+Math.abs(a[i]));
 const permanent=(bu[1]*cv[2]+bu[2]*cv[1])*Math.abs(motion[0])+(bu[2]*cv[0]+bu[0]*cv[2])*Math.abs(motion[1])+(bu[0]*cv[1]+bu[1]*cv[0])*Math.abs(motion[2]),error=32*Number.EPSILON*permanent+64*Number.MIN_VALUE;
 if(Number.isFinite(value)&&Number.isFinite(error)&&Math.abs(value)>error)return {sign:Math.sign(value),value,exact:false};
 return exactDeterminant(a,b,c,motion);
}
