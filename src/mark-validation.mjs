import {BufferGeometry,BufferAttribute,Vector3,Ray,DoubleSide,Box3} from 'three';
import {MeshBVH} from 'three-mesh-bvh';

export const MARK_WALL_MARGIN=.15;
const SURFACE_TOLERANCE=.15,MASK_TOLERANCE=.12,STEP=.3,MAX_SAMPLES=200000;
function tree(data){const geometry=new BufferGeometry();geometry.setAttribute('position',new BufferAttribute(data.vertices,3));geometry.setIndex(new BufferAttribute(data.triangles,1));return {geometry,bvh:new MeshBVH(geometry,{indirect:true})};}
function invalid(message){const error=Error(message);error.code='MARK_PLACEMENT';return error;}
export const fatalMarkError=error=>error?.name==='RuntimeError'||/Aborted|memory access out of bounds|unreachable|RuntimeError/i.test(error?.message||'');
export function disposeMarkNative(handles,failure){if(fatalMarkError(failure))return;let firstError;for(const handle of handles){if(!handle)continue;try{handle.delete();}catch(error){if(fatalMarkError(error))throw error;firstError??=error;}}if(firstError&&!failure)throw firstError;}

/** Check the actual final glyphs, including boundaries and triangle interiors.
 * Adaptive samples are bounded to 0.3 mm edges; the engraving additionally uses
 * a native containment guard below the surface before changing any material. */
export function validateMarkFootprint(data,label,settings,{modelTree,maskTree}={}){
 const normal=new Vector3(...settings.normal).normalize(),origin=new Vector3(...settings.point),model=modelTree?null:tree(data),mask=maskTree||!data.interiorRegion?.triangles?.length?null:tree(data.interiorRegion),surface=modelTree||model.bvh,allowed=maskTree||mask?.bvh,ray=new Ray(),point=new Vector3(),a=new Vector3(),b=new Vector3(),c=new Vector3(),seen=new Set();let samples=0,minRemaining=Infinity,maxDeviation=0;
 try{
  let top=-Infinity;for(let i=0;i<label.vertices.length;i+=3)top=Math.max(top,point.fromArray(label.vertices,i).sub(origin).dot(normal));
  const check=p=>{const key=p.toArray().map(x=>Math.round(x*1e5)).join(',');if(seen.has(key))return;seen.add(key);if(++samples>MAX_SAMPLES)throw invalid('Die Schrift ist für eine zuverlässige Platzierungsprüfung zu groß. Schrift verkleinern.');
   ray.origin.copy(p).addScaledVector(normal,2);ray.direction.copy(normal).negate();const hit=surface.raycastFirst(ray,DoubleSide),deviation=hit?hit.point.clone().sub(p).dot(normal):Infinity;
   if(!hit||Math.abs(deviation)>SURFACE_TOLERANCE+1e-5||hit.face.normal.dot(normal)<.9)throw invalid('Die vollständige Schrift passt hier nicht auf die Fläche. Markierungsstelle weiter von der Schnittkante wählen oder Schrift verkleinern.');
   maxDeviation=Math.max(maxDeviation,Math.abs(deviation));
   if(allowed){const selected=allowed.closestPointToPoint(hit.point,{},0,MASK_TOLERANCE);let side=false;if(selected){const g=allowed.geometry,pa=new Vector3().fromBufferAttribute(g.attributes.position,g.index.getX(selected.faceIndex*3)),pb=new Vector3().fromBufferAttribute(g.attributes.position,g.index.getX(selected.faceIndex*3+1)),pc=new Vector3().fromBufferAttribute(g.attributes.position,g.index.getX(selected.faceIndex*3+2));side=pb.sub(pa).cross(pc.sub(pa)).normalize().dot(normal)>.8;}if(!selected||selected.distance>MASK_TOLERANCE||!side)throw invalid('Die Schrift liegt teilweise außerhalb der gewählten Innenfläche. Markierungsstelle oder Schriftgröße korrigieren.');}
   if(!settings.emboss){ray.origin.copy(hit.point).addScaledVector(normal,-.02);const exit=surface.raycastFirst(ray,DoubleSide),remaining=exit?exit.distance+.02-settings.depth-deviation:-Infinity;
    if(!exit||exit.face.normal.dot(normal)>-.1||remaining<MARK_WALL_MARGIN-1e-5)throw invalid(`Die Wand ist für ${settings.depth.toLocaleString('de-DE')} mm Gravurtiefe zu dünn. Unter der vollständigen Schrift müssen mindestens 0,15 mm Material stehen bleiben.`);minRemaining=Math.min(minRemaining,remaining);
   }
  };
  for(let f=0;f<label.triangles.length;f+=3){a.fromArray(label.vertices,label.triangles[f]*3);b.fromArray(label.vertices,label.triangles[f+1]*3);c.fromArray(label.vertices,label.triangles[f+2]*3);if([a,b,c].some(p=>Math.abs(p.clone().sub(origin).dot(normal)-top)>.001))continue;
   const project=p=>p.clone().addScaledVector(normal,-p.clone().sub(origin).dot(normal)),stack=[[project(a),project(b),project(c)]];
   while(stack.length){const triangle=stack.pop(),lengths=[triangle[0].distanceToSquared(triangle[1]),triangle[1].distanceToSquared(triangle[2]),triangle[2].distanceToSquared(triangle[0])],longest=Math.max(...lengths);if(longest>STEP*STEP){const edge=lengths.indexOf(longest),p=triangle[edge],q=triangle[(edge+1)%3],r=triangle[(edge+2)%3],mid=p.clone().add(q).multiplyScalar(.5);stack.push([p,mid,r],[mid,q,r]);}else{triangle.forEach(check);check(triangle[0].clone().add(triangle[1]).add(triangle[2]).multiplyScalar(1/3));}}
  }
  if(!samples)throw invalid('Die Schrift enthält keine prüfbare Buchstabenfläche.');return {valid:true,samples,maxDeviation,minRemaining:Number.isFinite(minRemaining)?minRemaining:null};
 }finally{model?.geometry.dispose();mask?.geometry.dispose();}
}

/** Same glyph prism, moved wholly below the permitted surface variation.
 * Native (guard minus body) must be empty: this catches even holes or edge
 * excursions narrower than the adaptive surface samples. */
export function markGuardMesh(label,settings){
 const normal=new Vector3(...settings.normal).normalize(),origin=new Vector3(...settings.point),point=new Vector3(),vertices=new Float32Array(label.vertices.length);let min=Infinity,max=-Infinity;
 for(let i=0;i<label.vertices.length;i+=3){const h=point.fromArray(label.vertices,i).sub(origin).dot(normal);min=Math.min(min,h);max=Math.max(max,h);}
 const bottom=settings.emboss?-.25:-settings.depth-MARK_WALL_MARGIN,top=-SURFACE_TOLERANCE;
 for(let i=0;i<label.vertices.length;i+=3){point.fromArray(label.vertices,i);const h=point.clone().sub(origin).dot(normal),target=bottom+(h-min)/(max-min)*(top-bottom);point.addScaledVector(normal,target-h).toArray(vertices,i);}
 return {vertices,triangles:new Uint32Array(label.triangles)};
}

/** Exact projected glyph coverage in the user's selected local surface mask.
 * This supplements samples so even a small unselected hole cannot be bridged
 * by a letter. Only nearby, correctly facing mask material participates. */
export function validateMarkMaskCoverage(api,data,label,settings){
 if(!data.interiorRegion?.triangles?.length)return {checked:false};
 const normal=new Vector3(...settings.normal).normalize(),origin=new Vector3(...settings.point),reference=Math.abs(normal.z)<.9?new Vector3(0,0,1):new Vector3(0,1,0),u=reference.cross(normal).normalize(),v=normal.clone().cross(u),point=new Vector3(),box=new Box3(),footprint=[],selected=[];let top=-Infinity,glyph,maskSection,outside,failure;const mask=tree(data.interiorRegion);
 const height=p=>p.clone().sub(origin).dot(normal),xy=p=>{const d=p.clone().sub(origin);return [d.dot(u),d.dot(v)];};
 function clip(points,offset,sign){const output=[];for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length],da=(height(a)-offset)*sign,db=(height(b)-offset)*sign;if(da>=0)output.push(a);if((da>=0)!==(db>=0))output.push(a.clone().lerp(b,da/(da-db)));}return output;}
 try{
  for(let i=0;i<label.vertices.length;i+=3){point.fromArray(label.vertices,i);box.expandByPoint(point);top=Math.max(top,height(point));}box.expandByScalar(.2);
  for(let f=0;f<label.triangles.length;f+=3){const triangle=[0,1,2].map(k=>new Vector3().fromArray(label.vertices,label.triangles[f+k]*3));if(triangle.every(p=>Math.abs(height(p)-top)<.001))footprint.push(triangle.map(xy));}
  mask.bvh.shapecast({intersectsBounds:bound=>box.intersectsBox(bound),intersectsTriangle:triangle=>{const [a,b,c]=[triangle.a,triangle.b,triangle.c];if(b.clone().sub(a).cross(c.clone().sub(a)).normalize().dot(normal)<.8)return false;let polygon=clip([a,b,c],-SURFACE_TOLERANCE-1e-4,1);if(polygon.length)polygon=clip(polygon,SURFACE_TOLERANCE+1e-4,-1);if(polygon.length>=3)selected.push(polygon.map(xy));return false;}});
  glyph=api.CrossSection.ofPolygons(footprint,'Positive');maskSection=api.CrossSection.ofPolygons(selected,'Positive');outside=glyph.subtract(maskSection);const area=outside.area();if(!Number.isFinite(area)||area>Math.max(1e-5,glyph.area()*1e-6))throw invalid('Die vollständigen Buchstabenkonturen liegen nicht in der gewählten Innenfläche. Markierungsstelle oder Schriftgröße korrigieren.');return {checked:true,unselectedArea:area};
 }catch(error){failure=error;throw error;}finally{mask.geometry.dispose();disposeMarkNative([glyph,maskSection,outside],failure);}
}
