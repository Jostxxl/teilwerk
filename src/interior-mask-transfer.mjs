import {BufferGeometry,BufferAttribute,Box3,Matrix4,Vector3} from 'three';
import {MeshBVH} from 'three-mesh-bvh';

const dot=(a,b)=>a[0]*b[0]+a[1]*b[1];
const area=polygon=>polygon.reduce((sum,p,i)=>{const q=polygon[(i+1)%polygon.length];return sum+p[0]*q[1]-p[1]*q[0];},0)/2;
function intersectTriangle(polygon,triangle){
 let out=polygon;
 for(let i=0;i<3&&out.length;i++){
  const a=triangle[i],b=triangle[(i+1)%3],normal=[a[1]-b[1],b[0]-a[0]],offset=dot(a,normal),next=[];
  for(let j=0;j<out.length;j++){
   const p=out[j],q=out[(j+1)%out.length],dp=dot(p,normal)-offset,dq=dot(q,normal)-offset;
   if(dp>=0)next.push(p);if((dp>=0)!==(dq>=0)){const t=dp/(dp-dq);next.push([p[0]+t*(q[0]-p[0]),p[1]+t*(q[1]-p[1])]);}
  }out=next;
 }return out;
}
export function createInteriorMaskContext(mask){
 if(!mask?.vertices?.length||mask.vertices.length%3||!mask.triangles?.length||mask.triangles.length%3||mask.vertices.some(x=>!Number.isFinite(x))||mask.triangles.some(i=>!Number.isInteger(i)||i<0||i>=mask.vertices.length/3))throw Error('Ungültige Freigabemaske.');
 const geometry=new BufferGeometry();geometry.setAttribute('position',new BufferAttribute(mask.vertices,3));geometry.setIndex(new BufferAttribute(mask.triangles,1));
 try{const tree=new MeshBVH(geometry,{indirect:true}),context={tree,disposed:false,dispose(){if(!context.disposed){context.disposed=true;geometry.dispose();}}};return context;}catch(error){geometry.dispose();throw error;}
}
/** Intersect actual body triangles with the saved permission triangles.
 * A source triangle participates only if coplanar within serialization precision,
 * correctly facing, and actually overlapping in projection. No proximity dilation.
 * Output polygons remain on the body face, with holes and partial faces preserved.
 * toMask maps current body coordinates into the original permission-mask frame.
 */
export function transferInteriorMask(data,context,{toMask=new Matrix4(),surfaceTolerance=.0002,normalCosine=.99999,progress=()=>{}}={}){
 if(!data?.vertices?.length||data.vertices.length%3||!data.triangles?.length||data.triangles.length%3||data.vertices.some(x=>!Number.isFinite(x))||data.triangles.some(i=>!Number.isInteger(i)||i<0||i>=data.vertices.length/3)||!context?.tree||context.disposed||!Number.isFinite(surfaceTolerance)||surfaceTolerance<0||!Number.isFinite(normalCosine)||normalCosine<.99||normalCosine>1||typeof progress!=='function')throw Error('Ungültige Innenflächenübertragung.');
 if(!toMask?.isMatrix4&&(!Array.isArray(toMask)||toMask.length!==16||!toMask.every(Number.isFinite)))throw Error('Ungültige Innenflächen-Transformation.');
 const matrix=toMask.isMatrix4?toMask.clone():new Matrix4().fromArray(toMask),inverse=matrix.clone().invert();
 if(!matrix.elements.every(Number.isFinite)||Math.abs(matrix.determinant())<1e-12)throw Error('Ungültige Innenflächen-Transformation.');
 const vertices=[],triangles=[],lookup=new Map(),sourceFaces=[],report={bodyTriangles:data.triangles.length/3,matchedBodyTriangles:0,fullBodyTriangles:0,partialBodyTriangles:0,maskTriangleTests:0,coplanarTests:0,generatedTriangles:0,area:0,surfaceTolerance,normalCosine};
 const index=point=>{const p=[point.x,point.y,point.z],key=p.join(',');let id=lookup.get(key);if(id===undefined){id=vertices.length/3;vertices.push(...p);lookup.set(key,id);}return id;};
 const emit=(points,face)=>{const a=points[0];for(let i=1;i<points.length-1;i++){const b=points[i],c=points[i+1],cross=b.clone().sub(a).cross(c.clone().sub(a));if(cross.lengthSq()<1e-18)continue;const ids=[index(a),index(b),index(c)];if(new Set(ids).size<3)continue;triangles.push(...ids);sourceFaces.push(face);report.area+=cross.length()/2;}};
 const a=new Vector3(),b=new Vector3(),c=new Vector3(),box=new Box3();
 for(let f=0;f<data.triangles.length;f+=3){
  if(f%60000===0)progress(f/3,data.triangles.length/3);
  a.fromArray(data.vertices,data.triangles[f]*3).applyMatrix4(matrix);b.fromArray(data.vertices,data.triangles[f+1]*3).applyMatrix4(matrix);c.fromArray(data.vertices,data.triangles[f+2]*3).applyMatrix4(matrix);
  const normal=b.clone().sub(a).cross(c.clone().sub(a)),doubleArea=normal.length();if(doubleArea<1e-10)continue;normal.divideScalar(doubleArea);
  const u=b.clone().sub(a).normalize(),v=normal.clone().cross(u),xy=point=>{const d=point.clone().sub(a);return[d.dot(u),d.dot(v)];},body2D=[xy(a),xy(b),xy(c)],bodyArea=doubleArea/2,pieces=[];let full=false;
  box.makeEmpty().expandByPoint(a).expandByPoint(b).expandByPoint(c).expandByScalar(surfaceTolerance);
  context.tree.shapecast({intersectsBounds:bound=>!full&&box.intersectsBox(bound),intersectsTriangle:triangle=>{
   report.maskTriangleTests++;const points=[triangle.a,triangle.b,triangle.c],sourceNormal=triangle.b.clone().sub(triangle.a).cross(triangle.c.clone().sub(triangle.a));if(sourceNormal.lengthSq()<1e-20||sourceNormal.normalize().dot(normal)<normalCosine||points.some(p=>Math.abs(p.clone().sub(a).dot(normal))>surfaceTolerance))return false;
   report.coplanarTests++;const selected2D=points.map(xy),polygon=intersectTriangle(selected2D,body2D);if(polygon.length<3)return false;const polygonArea=area(polygon);if(polygonArea<=1e-12)return false;
   // A single original selected triangle fully covers this body triangle.
   // Prove containment of every corner; a relative-area shortcut can hide a
   // small unselected strip on a large triangle and widen saved permissions.
   if(body2D.every(p=>selected2D.every((q,i)=>{const r=selected2D[(i+1)%3];return (r[0]-q[0])*(p[1]-q[1])-(r[1]-q[1])*(p[0]-q[0])>=0;}))){full=true;return true;}
   pieces.push(polygon);return false;
  }});
  if(full){report.matchedBodyTriangles++;report.fullBodyTriangles++;emit([a,b,c].map(p=>p.clone().applyMatrix4(inverse)),f/3);}
  else if(pieces.length){report.matchedBodyTriangles++;report.partialBodyTriangles++;for(const polygon of pieces)emit(polygon.map(p=>a.clone().addScaledVector(u,p[0]).addScaledVector(v,p[1]).applyMatrix4(inverse)),f/3);}
 }
 report.generatedTriangles=triangles.length/3;
 return {region:triangles.length?{vertices:new Float64Array(vertices),triangles:new Uint32Array(triangles)}:undefined,sourceFaces:new Uint32Array(sourceFaces),report};
}


