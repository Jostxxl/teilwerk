import {overhangMetrics} from './overhang-metrics.mjs';
import {printStability} from './print-stability.mjs';
import {comparePrintPoses,stabilityRank} from './print-pose-ranking.mjs';
import {preparePartForSupports} from './support-orientation.mjs';
import {convexHull2D,fitPlanarHull} from './planar-bed-fit.mjs';
import {Vector3,Matrix4} from 'three';
import {bounds,layFlat,transformData,ground} from './engine.mjs';

export function cuttingPlanes(prepared){
 const planes=[];
 for(const contour of prepared.contours)for(let i=0;i<contour.length;i++){
  const a=contour[i],b=contour[(i+1)%contour.length],n=prepared.u.clone().multiplyScalar(b[1]-a[1]).addScaledVector(prepared.v,a[0]-b[0]);
  if(n.lengthSq()<1e-12)continue;n.normalize();const p=prepared.u.clone().multiplyScalar(a[0]).addScaledVector(prepared.v,a[1]);planes.push({normal:n.toArray(),offset:p.dot(n)});
 }
 return planes;
}
/** All fitting, actual cut-face poses. No pose is discarded because another
 * face has a better individual stability/overhang score: cutting needs the
 * complete bank to choose the TWO children's poses jointly. */
export function cutFacePrintPoses(data,bed){
 if(!data.cutPlanes?.length)return [];
 // Geometry and cut planes are already in the current input frame. Search in
 // that frame, then append the new local transform to the assembly history.
 const localData={...data};delete localData.transform;
 const candidates=new Map(),a=new Vector3(),b=new Vector3(),c=new Vector3();
 for(let f=0;f<data.triangles.length;f+=3){
  a.fromArray(data.vertices,data.triangles[f]*3);b.fromArray(data.vertices,data.triangles[f+1]*3);c.fromArray(data.vertices,data.triangles[f+2]*3);
  const cross=b.clone().sub(a).cross(c.clone().sub(a)),area=cross.length()/2;if(area<1e-7)continue;const normal=cross.normalize();
  for(let i=0;i<data.cutPlanes.length;i++){
   const plane=data.cutPlanes[i],n=new Vector3(...plane.normal),dot=n.dot(normal);
   if(Math.abs(dot)<.9999||[a,b,c].some(p=>Math.abs(p.dot(n)-plane.offset)>.05))continue;
   const key=i+':'+Math.sign(dot),entry=candidates.get(key)||{normal:n.multiplyScalar(Math.sign(dot)).toArray(),area:0,point:a.toArray()};entry.area+=area;
   // A tolerance-matched neighboring parallel face can sit slightly above
   // the true bed. Keep the outermost candidate point; measure contact later
   // on the grounded geometry instead of adding both faces' nominal areas.
   if(entry.normal.reduce((s,x,k)=>s+x*a.getComponent(k),0)>entry.normal.reduce((s,x,k)=>s+x*entry.point[k],0))entry.point=a.toArray();
   candidates.set(key,entry);break;
  }
 }
 const poses=[];
 for(const face of candidates.values()){
  if(face.area<1)continue;
  const flat=layFlat(localData,face.normal);
  const points=[];for(let i=0;i<flat.vertices.length;i+=3)points.push([flat.vertices[i],flat.vertices[i+1]]);
  const fit=fitPlanarHull(convexHull2D(points),bed.slice(0,2));
  if(fit){
   const placed=ground(transformData(flat,new Matrix4().makeRotationZ(fit.angle)));
   // The native export applies this final local matrix ONCE to the original
   // mesh. Measure that exact materialization, not intermediate Float32
   // rotations whose rounding can move facets across overhang thresholds.
   const oriented=transformData(localData,new Matrix4().fromArray(placed.transform)),size=bounds(oriented).size,overhang=overhangMetrics(oriented);
   if(size.some((v,i)=>v>bed[i]+.005))continue;
   // Contact is only real if the selected face reaches the lowest model point.
   const matrix=new Matrix4().fromArray(oriented.transform),contact=Math.abs(new Vector3(...face.point).applyMatrix4(matrix).z)<1e-4;
   if(!contact)continue;
   const contactArea=connectedCutContactArea(oriented);if(contactArea<1)continue;
   const stability=printStability(oriented),score=overhang.severeArea*1e6+overhang.supportArea*100-contactArea+size[2]*.001;
   const transform=new Matrix4().fromArray(oriented.transform).multiply(new Matrix4().fromArray(data.transform||new Matrix4().toArray())).toArray();
   poses.push({...oriented,transform,bedFace:'cut',bedContactArea:contactArea,connectedBedContactArea:contactArea,requiresCutFace:false,overhang,printStability:stability,cutPose:{normal:[...face.normal],point:[...face.point],score}});
  }
 }
 return poses.map(p=>({...p,cutOrientation:{candidates:poses.length,objective:'stability-overhang-fit'}}));
}
export function orientOnCutFace(data,bed){
 if(!data.cutPlanes?.length){
  // The untagged import path needs the same physical pose comparison as the
  // explicit orientation action. A lowest-height box heuristic can leave a
  // stepped body tipping even when a real side face provides stable seating.
  // Pass geometry only: this branch cannot recurse, because the shared search
  // uses orientOnLargestFace (not orientOnCutFace) when no cut planes exist.
  const source={vertices:data.vertices,triangles:data.triangles},selected=preparePartForSupports(source,bed),local=new Matrix4().fromArray(selected.transform);
  // Match native final export: apply the chosen matrix once to the input mesh,
  // then measure THIS geometry. Never attach invented cut planes to imports.
  const oriented=transformData(source,local),size=bounds(oriented).size,stability=printStability(oriented),overhang=overhangMetrics(oriented);
  if(size.some((v,i)=>v>bed[i]+.005)||!Number.isFinite(stability.contact?.area)||stability.contact.area<1)throw Error('Keine Drucklage mit ebener Auflage innerhalb des Bauraums gefunden. Auflagefläche wählen oder Teil weiter aufteilen.');
  return {...oriented,transform:local.multiply(new Matrix4().fromArray(data.transform||new Matrix4().toArray())).toArray(),bedFace:'surface',bedContactArea:stability.contact.area,requiresCutFace:false,overhang,printStability:stability,supportOrientation:{...selected.supportOrientation,bedArea:stability.contact.area,severeArea:overhang.severeArea,supportArea:overhang.supportArea,height:size[2]},cutOrientation:{candidates:selected.supportOrientation.candidates,objective:'stability-overhang-fit',source:'surface'}};
 }
 const poses=cutFacePrintPoses(data,bed);let best=null;
 for(const pose of poses){const candidate={...pose,score:pose.cutPose.score};if(!best||comparePrintPoses(candidate,best)<0)best=candidate;}
 if(!best)throw Error('Keine ebene Schnittfläche lässt sich innerhalb des Bauraums auf das Druckbett stellen. Teil weiter aufteilen.');
 // transformData already carries each cut plane through the local rotations
 // and grounding. Applying the accumulated assembly transform again is wrong.
 const {score,...out}=best;return out;
}

// Require a connected patch, not the sum of isolated islands on the plate.
export function connectedCutContactArea(data){const parent=[],areas=[],edges=new Map(),a=new Vector3(),b=new Vector3(),c=new Vector3(),find=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;};
 for(let f=0;f<data.triangles.length;f+=3){a.fromArray(data.vertices,data.triangles[f]*3);b.fromArray(data.vertices,data.triangles[f+1]*3);c.fromArray(data.vertices,data.triangles[f+2]*3);if(Math.max(Math.abs(a.z),Math.abs(b.z),Math.abs(c.z))>1e-4)continue;const cross=b.clone().sub(a).cross(c.clone().sub(a)),length=cross.length();if(length<1e-9||cross.z/length>-.9999||!data.cutPlanes?.some(p=>[a,b,c].every(v=>Math.abs(v.dot(new Vector3(...p.normal))-p.offset)<.05)))continue;
  const index=parent.length;parent.push(index);areas.push(length/2);const keys=[a,b,c].map(p=>p.toArray().map(x=>Math.round(x*1e5)).join(','));for(let j=0;j<3;j++){const x=keys[j],y=keys[(j+1)%3],key=x<y?x+';'+y:y+';'+x;if(edges.has(key))parent[find(index)]=find(edges.get(key));else edges.set(key,index);}
 }
 const totals=new Map();areas.forEach((area,i)=>{const root=find(i);totals.set(root,(totals.get(root)||0)+area);});return Math.max(0,...totals.values());
}

/** Recheck a jointly selected pose on the CURRENT geometry. Metadata is not a
 * quality cache. Changed/unfit/unstable poses must go through a fresh search. */
export function validatedSelectedCutPose(data,bed,transform,selection,{minContactArea=50,overhangTolerance=.01}={}){
 if(selection?.version!==1||selection.method!=='joint-cut-poses'||!transform||![0,1].includes(selection.stabilityRank))return null;
 const local={...data};delete local.transform;const oriented=transformData(local,new Matrix4().fromArray(transform)),size=bounds(oriented).size,area=connectedCutContactArea(oriented);
 if(size.some((v,i)=>v>bed[i]+.005)||area<minContactArea)return null;
 const stability=printStability(oriented),overhang=overhangMetrics(oriented);
 if(!stability.valid||stability.stableUnderGravity!==true||stabilityRank(stability)>selection.stabilityRank||!Number.isFinite(selection.overhang?.severeArea)||!Number.isFinite(selection.overhang?.supportArea)||overhang.severeArea>selection.overhang.severeArea+overhangTolerance||overhang.supportArea>selection.overhang.supportArea+overhangTolerance)return null;
 return {...oriented,bedFace:'cut',bedContactArea:area,requiresCutFace:false,printStability:stability,overhang,cutOrientation:{objective:'preserved-joint-cut-poses',revalidated:true}};
}
