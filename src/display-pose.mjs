import {Box3,Matrix4,Vector3} from 'three';

const matrix=value=>value?.isMatrix4?value.clone():new Matrix4().fromArray(value||new Matrix4().elements);

// Geometry is kept in its current printing coordinates. Only the view matrix
// restores the assembly position, including a preview's relative print pose.
export function partAssemblyMatrix(part,{preview=false,parentAssembly,previewAssembly=false,openPreview=false}={}){
 if(preview||openPreview){const result=matrix(parentAssembly);if(previewAssembly&&!openPreview&&part.transform)result.multiply(matrix(part.transform).invert());return result;}
 return matrix(part.assemblyMatrix);
}

export function displayPartMatrices(source,options={}){
 const {mode='assembly',explode=0}=options,whole=new Box3(),point=new Vector3();
 const poses=source.map((part,i)=>{
  const assemblyMatrix=partAssemblyMatrix(part,{...options,...options.perPart?.[i]}),box=new Box3();
  // Transform vertices, not just their local bounding box. The resulting
  // center is unchanged by choosing a different print orientation.
  for(let k=0;k<part.vertices.length;k+=3)box.expandByPoint(point.fromArray(part.vertices,k).applyMatrix4(assemblyMatrix));
  if(!box.isEmpty())whole.union(box);
  return {assemblyMatrix,assemblyCenter:box.isEmpty()?new Vector3():box.getCenter(new Vector3())};
 });
 const center=whole.isEmpty()?new Vector3():whole.getCenter(new Vector3()),amount=Number.isFinite(explode)?Math.max(0,explode):0;
 return poses.map(p=>{const offset=p.assemblyCenter.clone().sub(center).multiplyScalar(amount*.75),base=mode==='print'?new Matrix4():p.assemblyMatrix.clone();return {...p,offset,matrix:new Matrix4().makeTranslation(...offset.toArray()).multiply(base)};});
}

// The object may already have a local translation/rotation (a drawn plane or
// control-point group). Premultiply it once by its associated model pose.
export function applyDisplayPose(object,pose){
 object.updateMatrix();object.matrix.premultiply(pose);object.matrixAutoUpdate=false;object.matrixWorldNeedsUpdate=true;return object;
}
