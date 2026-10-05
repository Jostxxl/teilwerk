import * as THREE from 'three';
import {requireLegacyGeometry} from './geometry-backend-guard.mjs';

export function bounds(data) {
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(let i=0;i<data.vertices.length;i++) {const a=i%3,v=data.vertices[i]; min[a]=Math.min(min[a],v);max[a]=Math.max(max[a],v);}
  return {min,max,size:max.map((v,i)=>v-min[i])};
}
export function usableBed(bed,margin) {
  if(!Array.isArray(bed)||bed.length!==3||bed.some(v=>!Number.isFinite(v)||v<=0)||!Number.isFinite(margin)||margin<0) throw Error('Bitte gültige positive Bauraummaße und einen nichtnegativen Rand eingeben.');
  const usable=bed.map(v=>v-2*margin);
  if(usable.some(v=>v<1)) throw Error('Der Sicherheitsrand lässt weniger als 1 mm nutzbaren Bauraum übrig.');
  return usable;
}
export function transformData(data,matrix) {
  requireLegacyGeometry(data);
  const vertices=new Float32Array(data.vertices.length),p=new THREE.Vector3();
  for(let i=0;i<vertices.length;i+=3){p.fromArray(data.vertices,i).applyMatrix4(matrix).toArray(vertices,i);}
  const transform=matrix.clone().multiply(new THREE.Matrix4().fromArray(data.transform||new THREE.Matrix4().toArray())).toArray();
  const cutPlanes=data.cutPlanes?.map(plane=>{const p=new THREE.Vector3(...plane.normal).multiplyScalar(plane.offset).applyMatrix4(matrix),n=new THREE.Vector3(...plane.normal).applyMatrix3(new THREE.Matrix3().getNormalMatrix(matrix)).normalize();return{normal:n.toArray(),offset:p.dot(n)};});
  return {vertices,triangles:new Uint32Array(data.triangles),transform,...(cutPlanes?{cutPlanes}: {})};
}
export function ground(data) {
  const b=bounds(data);return transformData(data,new THREE.Matrix4().makeTranslation(-(b.min[0]+b.max[0])/2,-(b.min[1]+b.max[1])/2,-b.min[2]));
}
export function layFlat(data,normal) {
  const n=new THREE.Vector3(...normal).normalize();
  if(n.lengthSq()<0.5)throw Error('Keine gültige Fläche gewählt.');
  return ground(transformData(data,new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(n,new THREE.Vector3(0,0,-1)))));
}
export function bestOrientation(data,bed) {
  // Sample substantial face normals, then test roll angles; deterministic heuristic.
  const normals=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]], areas=new Map();
  const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();
  const step=Math.max(1,Math.ceil(data.triangles.length/3/6000));
  for(let f=0;f<data.triangles.length;f+=3*step){a.fromArray(data.vertices,data.triangles[f]*3);b.fromArray(data.vertices,data.triangles[f+1]*3);c.fromArray(data.vertices,data.triangles[f+2]*3);const n=b.sub(a).cross(c.sub(a)),area=n.length();if(area<1e-10)continue;n.normalize();const key=n.toArray().map(v=>Math.round(v*12)).join(',');const old=areas.get(key);areas.set(key,{n:n.toArray(),area:area+(old?.area||0)});}
  normals.push(...[...areas.values()].sort((a,b)=>b.area-a.area).slice(0,18).map(v=>v.n));
  let best=null;
  for(const normal of normals){const q=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(...normal),new THREE.Vector3(0,0,-1));
    for(let angle=0;angle<180;angle+=30){const m=new THREE.Matrix4().makeRotationZ(angle*Math.PI/180).multiply(new THREE.Matrix4().makeRotationFromQuaternion(q));const candidate=transformData(data,m),size=bounds(candidate).size;
      const cells=size.reduce((n,s,i)=>n*Math.max(1,Math.ceil((s-1e-4)/bed[i])),1);
      const overflow=Math.max(...size.map((s,i)=>s/bed[i]));
      const score=cells*1e6+Math.max(0,overflow-1)*1e4+size[2]+size[0]*size[1]*1e-6;
      if(!best||score<best.score)best={score,data:candidate,cells};
    }
  }
  return ground(best.data);
}
export function toSolid(api,data) {
  requireLegacyGeometry(data);
  if(!data?.vertices?.length||data.vertices.length%3||!data.triangles?.length||data.triangles.length%3)throw Error('Die Datei enthält kein Dreiecksnetz.');
  if(data.vertices.length>27000000||data.triangles.length>9000000)throw Error('Dieses Modell überschreitet das Limit von 3 Millionen Dreiecken bzw. 9 Millionen Eingangspunkten.');
  if(data.vertices.some(v=>!Number.isFinite(v))||data.triangles.some(i=>i>=data.vertices.length/3))throw Error('Ungültige Modellkoordinaten oder Dreiecksindizes.');
  const mesh=new api.Mesh({numProp:3,vertProperties:new Float32Array(data.vertices),triVerts:new Uint32Array(data.triangles)});mesh.merge();
  let solid;
  try {solid=new api.Manifold(mesh);if(solid.status()!=='NoError'||solid.volume()<=1e-8)throw Error('invalid');return solid;}
  catch (error) {if(error?.name==='RuntimeError'||/Aborted|memory access out of bounds|unreachable|RuntimeError/i.test(error?.message||''))throw error;solid?.delete();throw Error('Das Netz ist offen, inkonsistent orientiert oder kein gültiger Volumenkörper. Bitte im Slicer oder MeshLab reparieren und erneut als STL exportieren.');}
}
export function fromSolid(solid) {
  const mesh=solid.getMesh(),vertices=new Float32Array(mesh.numVert*3);
  for(let i=0;i<mesh.numVert;i++)for(let j=0;j<3;j++)vertices[i*3+j]=mesh.vertProperties[i*mesh.numProp+j];
  return {vertices,triangles:new Uint32Array(mesh.triVerts),volume:solid.volume()};
}
export function validate(api,data){const s=toSolid(api,data);try{return fromSolid(s);}finally{s.delete();}}
export function splitPlane(api,data,normal,offset) {
  if(normal.some(v=>!Number.isFinite(v))||Math.hypot(...normal)<1e-8||!Number.isFinite(offset))throw Error('Ungültige Schnittebene.');
  const s=toSolid(api,data),halves=[];
  try {halves.push(...s.splitByPlane(normal,offset));if(halves.some(h=>h.isEmpty()||h.volume()<1e-8))throw Error('Die Ebene muss durch das Innere des gewählten Teils verlaufen.');
    const result=[];for(const h of halves){const bodies=h.decompose();try{result.push(...bodies.filter(b=>!b.isEmpty()).map(b=>({...fromSolid(b),cutPlanes:[...(data.cutPlanes||[]),{normal:new THREE.Vector3(...normal).normalize().toArray(),offset:offset/Math.hypot(...normal)}]})));}finally{bodies.forEach(b=>b.delete());}}return result;
  }finally {s.delete();halves.forEach(h=>h.delete());}
}
export function automaticSplit(api,data,bed,progress=()=>{}) {
  const b=bounds(data),counts=b.size.map((s,i)=>Math.max(1,Math.ceil((s-1e-4)/bed[i])));
  if(counts.reduce((a,b)=>a*b,1)>256)throw Error('Mehr als 256 Rasterzellen nötig. Bauraum vergrößern oder das Modell zuerst gezielt schneiden.');
  let solids=[toSolid(api,data)];
  try {
    for(let axis=0;axis<3;axis++)for(let k=1;k<counts[axis];k++){
      const offset=b.min[axis]+b.size[axis]*k/counts[axis],normal=[0,0,0];normal[axis]=1;const next=[];
      try {for(const s of solids){const box=s.boundingBox();if(offset<=box.min[axis]+1e-5||offset>=box.max[axis]-1e-5){next.push(s);continue;}
        const pair=s.splitByPlane(normal,offset);next.push(...pair);}
      }catch(e){next.filter(s=>!solids.includes(s)).forEach(s=>s.delete());throw e;}
      solids.filter(s=>!next.includes(s)).forEach(s=>s.delete());solids=next;progress(`Raster ${axis+1}/3 · ${solids.length} Teilkörper`);
    }
    const result=[];for(const s of solids){const bodies=s.decompose();try{result.push(...bodies.filter(b=>!b.isEmpty()).map(b=>({...fromSolid(b),transform:data.transform})));}finally{bodies.forEach(b=>b.delete());}}return result;
  }finally{solids.forEach(s=>s.delete());}
}
export function smartRegion(data,seed,angle=40,radius=80) {
  if(!Number.isFinite(angle)||angle<0||angle>90||!Number.isFinite(radius)||radius<=0)throw Error('Auswahlwinkel muss zwischen 0 und 90° liegen; der Radius muss positiv sein.');
  const count=data.triangles.length/3;if(seed<0||seed>=count)throw Error('Ungültige Auswahl.');
  const normals=[],centers=[],neighbors=Array.from({length:count},()=>[]),edges=new Map();
  const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();
  for(let f=0;f<count;f++){
    const ids=Array.from(data.triangles.slice(f*3,f*3+3));a.fromArray(data.vertices,ids[0]*3);b.fromArray(data.vertices,ids[1]*3);c.fromArray(data.vertices,ids[2]*3);
    centers.push(a.clone().add(b).add(c).multiplyScalar(1/3));normals.push(b.clone().sub(a).cross(c.clone().sub(a)).normalize());
    for(let j=0;j<3;j++){const x=ids[j],y=ids[(j+1)%3],key=x<y?`${x},${y}`:`${y},${x}`;if(edges.has(key)){const prev=edges.get(key);neighbors[f].push(prev);neighbors[prev].push(f);}else edges.set(key,f);}
  }
  const selected=new Set([seed]),queue=[seed],limit=Math.cos(angle*Math.PI/180),origin=centers[seed];
  for(let q=0;q<queue.length;q++)for(const f of neighbors[queue[q]])if(!selected.has(f)&&normals[f].dot(normals[seed])>=limit&&centers[f].distanceTo(origin)<=radius){selected.add(f);queue.push(f);}
  const n=normals[seed],points=[];for(const f of selected)for(let j=0;j<3;j++)points.push(new THREE.Vector3().fromArray(data.vertices,data.triangles[f*3+j]*3));
  const minProjection=points.reduce((m,p)=>Math.min(m,p.dot(n)),Infinity),box=bounds(data),extent=Math.hypot(...box.size);
  // Start a small distance behind the selected surface; user adjusts the visible plane.
  const offset=minProjection-Math.min(radius*0.25,extent*0.08);
  return {faces:[...selected],normal:n.toArray(),offset,point:origin.toArray()};
}
export function binarySTL(data) {
  const count=data.triangles.length/3,buffer=new ArrayBuffer(84+count*50),view=new DataView(buffer);view.setUint32(80,count,true);
  const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();
  for(let f=0;f<count;f++){const at=84+f*50;a.fromArray(data.vertices,data.triangles[f*3]*3);b.fromArray(data.vertices,data.triangles[f*3+1]*3);c.fromArray(data.vertices,data.triangles[f*3+2]*3);const n=b.clone().sub(a).cross(c.clone().sub(a)).normalize();[...n.toArray(),...a.toArray(),...b.toArray(),...c.toArray()].forEach((v,i)=>view.setFloat32(at+i*4,v,true));}return new Uint8Array(buffer);
}
