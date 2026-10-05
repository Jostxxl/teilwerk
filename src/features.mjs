import {cuttingPlanes} from './cut-orientation.mjs';
import {validateMarkFootprint,markGuardMesh,validateMarkMaskCoverage,disposeMarkNative,fatalMarkError} from './mark-validation.mjs';
import {restoreBoundNative,bindNativeGeometry} from './native-geometry-binding.mjs';
import {straightenContour} from './straighten.mjs';
import {resolveContourDepth,createContourDepthContext,contourColumnIntervals} from './contour-depth.mjs';
import * as THREE from 'three';
import {FontLoader} from 'three/addons/loaders/FontLoader.js';
import {TextGeometry} from 'three/addons/geometries/TextGeometry.js';
import fontData from 'three/examples/fonts/helvetiker_regular.typeface.json' with {type:'json'};
import {bounds,toSolid,fromSolid,validate} from './engine.mjs';

const edgeKey=(a,b)=>a<b?`${a},${b}`:`${b},${a}`;
export function topology(data){
  const vertices=[],mapping=[],lookup=new Map(),triangles=[],normals=[],edges=new Map();
  for(let i=0;i<data.vertices.length;i+=3){const xyz=Array.from(data.vertices.slice(i,i+3)),key=xyz.map(v=>Math.round(v*1e5)).join(',');if(!lookup.has(key)){lookup.set(key,vertices.length);vertices.push(new THREE.Vector3(...xyz));}mapping.push(lookup.get(key));}
  for(let i=0;i<data.triangles.length;i+=3){const t=Array.from(data.triangles.slice(i,i+3),v=>mapping[v]),f=triangles.length;triangles.push(t);normals.push(vertices[t[1]].clone().sub(vertices[t[0]]).cross(vertices[t[2]].clone().sub(vertices[t[0]])).normalize());for(let j=0;j<3;j++){const a=t[j],b=t[(j+1)%3],key=edgeKey(a,b);if(!edges.has(key))edges.set(key,{a,b,faces:[]});edges.get(key).faces.push(f);}}
  return{vertices,triangles,normals,edges};
}
export function detectSeams(data,angle=25,minPerimeter=30){
  if(!Number.isFinite(angle)||angle<1||angle>175||!Number.isFinite(minPerimeter)||minPerimeter<=0)throw Error('Kantenwinkel 1–175° und positive Mindestlänge eingeben.');
  const t=topology(data),graph=new Map(),threshold=Math.cos(angle*Math.PI/180),sharp=[];
  for(const edge of t.edges.values())if(edge.faces.length===2&&t.normals[edge.faces[0]].dot(t.normals[edge.faces[1]])<threshold){sharp.push(edge);for(const [a,b] of [[edge.a,edge.b],[edge.b,edge.a]]){if(!graph.has(a))graph.set(a,[]);graph.get(a).push(b);}}
  if(sharp.length>500000)throw Error('Zu viele Kanten für die Konturerkennung. Kantenwinkel erhöhen oder Modell vereinfachen.');
  const used=new Set(),found=new Set(),loops=[];
  for(const edge of sharp){if(used.has(edgeKey(edge.a,edge.b)))continue;
    const path=[edge.a,edge.b],seen=new Set(path);let closed=false;
    for(let step=0;step<8192;step++){const prev=path[path.length-2],current=path[path.length-1],incoming=t.vertices[current].clone().sub(t.vertices[prev]).normalize();const candidates=(graph.get(current)||[]).filter(id=>id!==prev&&(!seen.has(id)||id===path[0])).sort((a,b)=>incoming.dot(t.vertices[b].clone().sub(t.vertices[current]).normalize())-incoming.dot(t.vertices[a].clone().sub(t.vertices[current]).normalize()));if(!candidates.length)break;const next=candidates[0];if(next===path[0]){closed=path.length>=3;break;}path.push(next);seen.add(next);}
    for(let i=1;i<path.length;i++)used.add(edgeKey(path[i-1],path[i]));
    if(!closed)continue;
    let perimeter=0;const n=new THREE.Vector3(),center=new THREE.Vector3();for(let i=0;i<path.length;i++){const a=t.vertices[path[i]],b=t.vertices[path[(i+1)%path.length]];perimeter+=a.distanceTo(b);n.add(a.clone().cross(b));center.add(a);}center.divideScalar(path.length);
    // Reject almost retraced zigzags and sliver contours before expensive booleans.
    const projectedArea=n.length()/2;
    if(perimeter<minPerimeter||projectedArea<1e-5||projectedArea/(perimeter*perimeter)<.001)continue;n.normalize();
    const points=path.map(i=>t.vertices[i].toArray()),signature=points.map(p=>p.map(v=>Math.round(v*1000)).join(',')).sort().join(';');
    if(found.has(signature))continue;found.add(signature);for(let i=0;i<path.length;i++)used.add(edgeKey(path[i],path[(i+1)%path.length]));
    loops.push({points,signature,perimeter,normal:n.toArray(),center:center.toArray(),deviation:Math.max(...path.map(i=>Math.abs(t.vertices[i].clone().sub(center).dot(n))))});if(loops.length>=128)break;
  }
  return loops.sort((a,b)=>b.perimeter-a.perimeter);
}
export function cutSeam(api,data,seam){
  const t=topology(data),lookup=new Map(t.vertices.map((v,i)=>[v.toArray().map(x=>Math.round(x*1e5)).join(','),i])),path=seam.points.map(p=>lookup.get(p.map(x=>Math.round(x*1e5)).join(',')));
  if(path.some(v=>v===undefined))throw Error('Kante gehört nicht mehr zur aktuellen Geometrie. Erkennung erneut starten.');
  const blocked=new Set(path.map((v,i)=>edgeKey(v,path[(i+1)%path.length]))),start=t.edges.get(edgeKey(path[0],path[1]))?.faces[0];if(start===undefined)throw Error('Kontur ist nicht geschlossen.');
  const neighbors=Array.from({length:t.triangles.length},()=>[]);for(const [key,e] of t.edges)if(!blocked.has(key)&&e.faces.length===2){neighbors[e.faces[0]].push(e.faces[1]);neighbors[e.faces[1]].push(e.faces[0]);}
  const selected=new Set([start]),queue=[start];for(let i=0;i<queue.length;i++)for(const f of neighbors[queue[i]])if(!selected.has(f)){selected.add(f);queue.push(f);}
  if(selected.size===t.triangles.length)throw Error('Diese Kante trennt keine zwei Oberflächenbereiche. Andere Kontur wählen.');
  // Order boundary in the selected surface's winding, then close both sides with the same cap.
  const first=t.triangles[start],direct=first.some((v,i)=>v===path[0]&&first[(i+1)%3]===path[1]);if(!direct)path.reverse();
  const n=new THREE.Vector3();for(let i=0;i<path.length;i++)n.add(t.vertices[path[i]].clone().cross(t.vertices[path[(i+1)%path.length]]));n.normalize();
  const u=new THREE.Vector3(Math.abs(n.x)<.8?1:0,Math.abs(n.x)<.8?0:1,0).cross(n).normalize(),v=n.clone().cross(u),points=path.map(id=>[t.vertices[id].dot(u),t.vertices[id].dot(v)]),cap=api.triangulate([points],1e-6,false);
  const left=[],right=[];t.triangles.forEach((tri,i)=>(selected.has(i)?left:right).push(...tri));for(const tri of cap){left.push(path[tri[2]],path[tri[1]],path[tri[0]]);right.push(path[tri[0]],path[tri[1]],path[tri[2]]);}
  const vertices=new Float32Array(t.vertices.flatMap(v=>v.toArray()));let a,b,original;
  try{a=toSolid(api,{vertices,triangles:new Uint32Array(left)});b=toSolid(api,{vertices,triangles:new Uint32Array(right)});original=toSolid(api,data);if(Math.abs(a.volume()+b.volume()-original.volume())>Math.max(.01,original.volume()*1e-4))throw Error('Konturverschluss verändert das Volumen zu stark. Bitte eine andere Kontur wählen.');
    return [fromSolid(a),fromSolid(b)];
  }catch(e){throw Error(`Kantenschnitt nicht sicher möglich: ${e.message}`);}finally{a?.delete();b?.delete();original?.delete();}
}
export function autoSeams(api,data,options,progress=()=>{}){
  const parts=[data],done=new Set();let cuts=0,rejected=0;const body=toSolid(api,data),minVolume=Math.max(1,body.volume()*.00005);body.delete();
  while(cuts<options.maxCuts){let made=false;for(let i=0;i<parts.length;i++){
    const seams=detectSeams(parts[i],options.angle,options.minPerimeter);
    for(const seam of seams){if(done.has(seam.signature))continue;done.add(seam.signature);try{const result=cutSeam(api,parts[i],seam);if(result.some(p=>p.volume<minVolume))throw Error('Splitter');parts.splice(i,1,...result);cuts++;made=true;progress(`${cuts} Kantenschnitte · ${parts.length} Teile`);break;}catch{rejected++;}}
    if(made)break;
  }if(!made)break;}
  if(!cuts)throw Error('Keine sicher trennbare geschlossene Kantenkontur gefunden. Winkel/Mindestlänge anpassen oder Smart Selection verwenden.');
  return {parts,cuts,rejected};
}
const font=new FontLoader().parse(fontData);
export function closeCandidates(api,data,seams,progress=()=>{}){
  const parts=[data],solid=toSolid(api,data),minVolume=Math.max(1,solid.volume()*.00005);solid.delete();let cuts=0,rejected=0;
  for(let index=0;index<seams.length;index++){const seam=seams[index];let success=false;
    for(let i=0;i<parts.length;i++){const b=bounds(parts[i]);if(!seam.points.every(p=>p.every((v,j)=>v>=b.min[j]-.01&&v<=b.max[j]+.01)))continue;
      try{const cut=cutSeam(api,parts[i],seam);if(cut.some(p=>p.volume<minVolume))continue;parts.splice(i,1,...cut);cuts++;success=true;break;}catch{/* This candidate is unsuitable for this body. */}
    }if(!success)rejected++;progress(`Kontur ${index+1}/${seams.length} · ${cuts} Schnitte geschlossen`);
  }
  if(!cuts)throw Error('Die vorgeschlagenen Konturen ergeben keine geeigneten geschlossenen Teilkörper. Modell bleibt unverändert.');return{parts,cuts,rejected};
}
export function surfacePatch(data,faces,depth=20,prepared=null){
  if(!Number.isFinite(depth)||depth<.5||depth>100)throw Error('Schnitttiefe durch die Wand muss 0,5–100 mm betragen.');
  const t=prepared||topology(data),selected=new Set(faces),normalSums=new Map(),boundary=[];
  if(!selected.size||selected.size>=t.triangles.length)throw Error('Eine begrenzte Oberflächenregion auswählen.');
  for(const f of selected){const tri=t.triangles[f];if(!tri)throw Error('Ungültige Oberflächenauswahl.');const [a,b,c]=tri.map(i=>t.vertices[i]),normal=b.clone().sub(a).cross(c.clone().sub(a));for(const id of tri){if(!normalSums.has(id))normalSums.set(id,new THREE.Vector3());normalSums.get(id).add(normal);}for(let j=0;j<3;j++){const a=tri[j],b=tri[(j+1)%3],edge=t.edges.get(edgeKey(a,b));if(!edge.faces.every(id=>selected.has(id)))boundary.push([a,b]);}}
  if(!boundary.length)throw Error('Die Auswahl besitzt keine offene Randkontur.');
  const ids=[...normalSums.keys()],map=new Map(ids.map((id,i)=>[id,i])),vertices=new Float32Array(ids.length*6),triangles=[],walls=[],n=ids.length;
  // A shared extrusion direction avoids folding the cut surface around tiny
  // sculpted grooves. The 3D boundary itself remains unchanged and non-planar.
  const direction=new THREE.Vector3();for(const normal of normalSums.values())direction.add(normal);direction.normalize();
  ids.forEach((id,i)=>{t.vertices[id].clone().addScaledVector(direction,.25).toArray(vertices,i*3);t.vertices[id].clone().addScaledVector(direction,-depth).toArray(vertices,(i+n)*3);});
  for(const f of selected){const [a,b,c]=t.triangles[f].map(id=>map.get(id));triangles.push(a,b,c,c+n,b+n,a+n);}
  for(const [x,y] of boundary){const a=map.get(x),b=map.get(y);walls.push(b,a,a+n,b,a+n,b+n);}for(const index of walls)triangles.push(index);
  return {cutter:{vertices,triangles:new Uint32Array(triangles)},walls:{vertices,triangles:new Uint32Array(walls)},boundaryCount:boundary.length};
}
export function prepareContourDefinition(api,data,faces,depth=20,lineTolerance=0){
  if(!Number.isFinite(depth)||depth<.5||depth>100)throw Error('Schnitttiefe 0,5–100 mm wählen.');
  const n=new THREE.Vector3(),triangles=[],point=id=>new THREE.Vector3().fromArray(data.vertices,id*3);
  for(const f of faces){const tri=Array.from(data.triangles.slice(f*3,f*3+3),point);if(tri.length!==3)throw Error('Ungültige Auswahl.');n.add(tri[1].clone().sub(tri[0]).cross(tri[2].clone().sub(tri[0])));triangles.push(tri);}n.normalize();
  const u=new THREE.Vector3(Math.abs(n.x)<.8?1:0,Math.abs(n.x)<.8?0:1,0).cross(n).normalize(),v=n.clone().cross(u);let min=Infinity,max=-Infinity;
  const polygons=triangles.map(tri=>{const poly=tri.map(p=>{const z=p.dot(n);min=Math.min(min,z);max=Math.max(max,z);return[p.dot(u),p.dot(v)];});const area=(poly[1][0]-poly[0][0])*(poly[2][1]-poly[0][1])-(poly[1][1]-poly[0][1])*(poly[2][0]-poly[0][0]);if(area<0)poly.reverse();return poly;});
  let section,simplified,expanded,closedContour,failure;
  try{section=api.CrossSection.ofPolygons(polygons,'Positive');simplified=section.simplify(.3);expanded=simplified.offset(.6,'Round');closedContour=expanded.offset(-.3,'Round');const contours=lineTolerance?closedContour.toPolygons().map(p=>straightenContour(p,lineTolerance).points):closedContour.toPolygons();return {contours,u:u.toArray(),v:v.toArray(),n:n.toArray(),min:min-depth,max:max+1,surfaceMin:min,surfaceMax:max};}
  catch(error){failure=error;throw error;}
  finally{if(failure?.name!=='RuntimeError'&&!/Aborted|memory access out of bounds|unreachable|RuntimeError/i.test(failure?.message||'')){section?.delete();simplified?.delete();expanded?.delete();closedContour?.delete();}}
}
export function cutterFromDefinition(api,definition){
  const {contours,min,max}=definition,u=new THREE.Vector3(...definition.u),v=new THREE.Vector3(...definition.v),n=new THREE.Vector3(...definition.n);let section,extruded,failure;
  try{section=api.CrossSection.ofPolygons(contours,'NonZero');extruded=section.extrude(max-min);const matrix=new THREE.Matrix4().makeBasis(u,v,n);matrix.setPosition(n.clone().multiplyScalar(min));return {solid:extruded.transform(matrix.toArray()),contours,u,v,n,min,max:max-1,definition};}
  catch(error){failure=error;throw error;}
  finally{if(failure?.name!=='RuntimeError'&&!/Aborted|memory access out of bounds|unreachable|RuntimeError/i.test(failure?.message||'')){section?.delete();extruded?.delete();}}
}
export function prepareSurfaceCutter(api,data,faces,depth=20,lineTolerance=0){return cutterFromDefinition(api,resolveContourDepth(data,prepareContourDefinition(api,data,faces,depth,lineTolerance),{faces}));}
export function surfaceCutPreview(api,data,faces,depth=20,custom=null,lineTolerance=0){
  const prepared=custom||prepareSurfaceCutter(api,data,faces,depth,lineTolerance),context=createContourDepthContext(data),vertices=[],triangles=[],contoursOnSurface=[];let missed=0,skippedTransitions=0;
  try{
    const definition=prepared.definition;if(!definition?.depthCheck?.capPlanesClear)throw Error('Schnitttiefe vor der Vorschau erneut prüfen.');
    const at=(xy,z)=>prepared.u.clone().multiplyScalar(xy[0]).addScaledVector(prepared.v,xy[1]).addScaledVector(prepared.n,z);
    for(const contour of prepared.contours){
      const sampled=prepared.surfaceContours?contour:contour.flatMap((a,i)=>{const b=contour[(i+1)%contour.length],count=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/2));return Array.from({length:count},(_,j)=>a.map((x,k)=>x+(b[k]-x)*j/count));});
      const columns=sampled.map(xy=>contourColumnIntervals(context,definition,xy).filter(([lo,hi])=>Math.min(hi,definition.max)-Math.max(lo,definition.min)>1e-5));
      contoursOnSurface.push(sampled.map((xy,i)=>columns[i].length?at(xy,columns[i][0][1]).toArray():null));
      for(let i=0;i<sampled.length;i++){
        const next=(i+1)%sampled.length,a=columns[i],b=columns[next];
        if(!a.length||!b.length){missed++;continue;}
        // Do not draw a bridge through air when a lip starts or ends on this
        // segment. The remaining ruled walls describe the actual material.
        if(a.length!==b.length){skippedTransitions++;continue;}
        for(let k=0;k<a.length;k++){const index=vertices.length/3;vertices.push(...at(sampled[i],a[k][1]).toArray(),...at(sampled[next],b[k][1]).toArray(),...at(sampled[i],a[k][0]).toArray(),...at(sampled[next],b[k][0]).toArray());triangles.push(index,index+1,index+2,index+1,index+3,index+2);}
      }
    }
    return {walls:{vertices:new Float32Array(vertices),triangles:new Uint32Array(triangles)},boundaryCount:vertices.length/12,missed,skippedTransitions,contoursOnSurface,smoothing:.3,normal:prepared.n.toArray(),cutDefinition:prepared.definition,depthCheck:prepared.definition.depthCheck};
  }finally{prepared.solid.delete();context.dispose();}
}
export function cutSurfaceSolids(body,cutter,allowMultiple=false){
  const halves=[],inside=[],outside=[],pieces=[];let returned=false;
  const copy=s=>s.translate([0,0,0]);
  try{
    halves.push(...body.split(cutter));
    if(halves.some(s=>s.status()!=='NoError'||s.isEmpty()||!Number.isFinite(s.volume())||s.volume()<=0))throw Error('Die Konturfläche trennt kein sinnvolles Teil ab. Auswahl oder Schnitttiefe ändern.');
    inside.push(...halves[0].decompose());outside.push(...halves[1].decompose());
    const insideVolumes=inside.map(s=>s.volume()),outsideVolumes=outside.map(s=>s.volume());
    if([...insideVolumes,...outsideVolumes].some(v=>!Number.isFinite(v)))throw Error('Ungültiges Teilvolumen beim Konturschnitt.');
    const requiresRegroup=inside.length!==1||outside.length!==1||[...insideVolumes,...outsideVolumes].some(v=>v<=0);
    let inheritedRemainder=false;
    if(requiresRegroup&&!allowMultiple&&inside.length===1&&insideVolumes[0]>0){
      const originalComponents=body.decompose();
      try{inheritedRemainder=outside.length<=originalComponents.length;}finally{originalComponents.forEach(s=>s.delete());}
    }
    if(requiresRegroup&&!allowMultiple&&!inheritedRemainder)throw Error(`Die Kontur erzeugt ${inside.length} Ausschnittkörper und ${outside.length} Restkörper statt zweier zusammenhängender Teile. Kontur oder Schnitttiefe anpassen. Der Schnitt wurde nicht übernommen.`);
    // Keep the exact two Boolean regions. Selecting only the largest inside
    // body would leave valid pieces inside the requested opening as tabs.
    // Signed nested boundaries must remain together to preserve hollow volumes.
    const signedInside=insideVolumes.some(v=>v<=0),retained=signedInside?[halves[0]]:inside;
    pieces.push(...retained.map(copy),copy(halves[1]));
    const sum=pieces.reduce((total,s)=>total+s.volume(),0),volume=body.volume();
    if(Math.abs(sum-volume)>Math.max(1e-6,volume*1e-7))throw Error('Volumenprüfung des Konturschnitts fehlgeschlagen.');
    returned=true;return {pieces,numericalVolume:0,requiresRegroup,insideComponents:inside.length,remainingComponents:outside.length,componentVolumes:{inside:insideVolumes,remainder:outsideVolumes},partitionFaithful:true};
  }finally{if(!returned)pieces.forEach(s=>s.delete());halves.forEach(s=>s.delete());inside.forEach(s=>s.delete());outside.forEach(s=>s.delete());}
}
export function cutSurfacePatch(api,data,faces,depth=20,custom=null,lineTolerance=0,allowMultiple=false){
  const prepared=custom||prepareSurfaceCutter(api,data,faces,depth,lineTolerance);let body,result;
  try{body=toSolid(api,data);result=cutSurfaceSolids(body,prepared.solid,allowMultiple);return result.pieces.map((s,i)=>({...fromSolid(s),cutPlanes:cuttingPlanes(prepared),numericalCleanupVolume:i===0?result.numericalVolume:0,partitionFaithful:result.partitionFaithful,requiresRegroup:i===result.pieces.length-1?result.remainingComponents>1:result.componentVolumes.inside.some(v=>v<=0),depthCheck:prepared.definition?.depthCheck}));}
  finally{body?.delete();prepared.solid.delete();result?.pieces.forEach(s=>s.delete());}
}
export function loopSurfaceFaces(data,seam){
  const t=topology(data),lookup=new Map(t.vertices.map((v,i)=>[v.toArray().map(x=>Math.round(x*1e5)).join(','),i])),path=seam.points.map(p=>lookup.get(p.map(x=>Math.round(x*1e5)).join(',')));
  if(path.some(v=>v===undefined))throw Error('Kontur gehört nicht zum Teil.');const blocked=new Set(path.map((v,i)=>edgeKey(v,path[(i+1)%path.length]))),start=t.edges.get(edgeKey(path[0],path[1]))?.faces[0];if(start===undefined)throw Error('Keine geschlossene Kontur.');
  const neighbors=Array.from({length:t.triangles.length},()=>[]);for(const [key,e] of t.edges)if(!blocked.has(key)&&e.faces.length===2){neighbors[e.faces[0]].push(e.faces[1]);neighbors[e.faces[1]].push(e.faces[0]);}const chosen=new Set([start]),queue=[start];for(let i=0;i<queue.length;i++)for(const f of neighbors[queue[i]])if(!chosen.has(f)){chosen.add(f);queue.push(f);}if(chosen.size===t.triangles.length)throw Error('Kontur umschließt keinen abtrennbaren Oberflächenbereich.');
  const areas=[0,0],groups=[[],[]];t.triangles.forEach((tri,f)=>{const [a,b,c]=tri.map(id=>t.vertices[id]),side=chosen.has(f)?0:1;areas[side]+=b.clone().sub(a).cross(c.clone().sub(a)).length();groups[side].push(f);});return groups[areas[0]<=areas[1]?0:1];
}
export function textMesh(text,point,normal,size=8,depth=.4,rotation=0,emboss=false){
  if(!/^[A-Za-z0-9 ._-]{1,24}$/.test(text))throw Error('Markierung: 1–24 Zeichen aus A–Z, a–z, 0–9, Punkt, Leerzeichen, _ oder -.');
  if(!Number.isFinite(size)||size<1||size>100||!Number.isFinite(depth)||depth<.1||depth>5||!Number.isFinite(rotation))throw Error('Schrifthöhe 1–100 mm und Tiefe 0,1–5 mm wählen.');
  const g=new TextGeometry(text,{font,size,depth:depth+.25,curveSegments:4,bevelEnabled:false});g.computeBoundingBox();const width=g.boundingBox.max.x-g.boundingBox.min.x,height=g.boundingBox.max.y-g.boundingBox.min.y;g.translate(-width/2,-height/2,emboss?-.25:-depth);
  const q=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1),new THREE.Vector3(...normal).normalize()),m=new THREE.Matrix4().makeRotationFromQuaternion(q).multiply(new THREE.Matrix4().makeRotationZ(rotation*Math.PI/180));m.setPosition(...point);g.applyMatrix4(m);
  const vertices=new Float32Array(g.attributes.position.array),triangles=g.index?new Uint32Array(g.index.array):Uint32Array.from({length:vertices.length/3},(_,i)=>i);g.dispose();return{vertices,triangles};
}
export function markPart(api,data,settings){
  settings={depth:.4,rotation:0,emboss:false,...settings};
  const label=textMesh(settings.text,settings.point,settings.normal,settings.size,settings.depth,settings.rotation,settings.emboss);
  validateMarkFootprint(data,label,settings);validateMarkMaskCoverage(api,data,label,settings);
  const owned=[],keep=solid=>{owned.push(solid);return solid;};let bound,failure;
  try{
    // The display mesh and all user anchors stay in the print frame. A native
    // binding owns the assembly-frame body; only the small tools change frame.
    // A stale attachment is an error, never permission to use rounded geometry.
    bound=data.nativeGeometry!==undefined?restoreBoundNative(api,data):null;
    const assembly=bound?new THREE.Matrix4().fromArray(data.assemblyMatrix||new THREE.Matrix4().toArray()):null;
    const body=bound?.solid||keep(toSolid(api,data));
    const tool=mesh=>{const local=keep(toSolid(api,mesh));return assembly?keep(local.transform(assembly.toArray())):local;};
    const guard=tool(markGuardMesh(label,settings)),outside=keep(guard.subtract(body));
    if(outside.volume()>Math.max(1e-5,guard.volume()*1e-6))throw Error('Unter der vollständigen Schrift fehlt Material oder Wandstärke. Markierungsstelle weiter von Kanten wählen, Schrift verkleinern oder Gravurtiefe verringern.');
    const cutter=tool(label),result=keep(settings.emboss?body.add(cutter):body.subtract(cutter));
    if(result.status()!=='NoError'||result.isEmpty()||Math.abs(result.volume()-body.volume())<1e-5)throw Error('Die Schrift berührt das Teil nicht. Position, Größe oder Tiefe ändern.');
    const components=result.decompose();owned.push(...components);
    if(components.length!==1||components[0].volume()<=0)throw Error('Markierung erzeugt lose Körper. Schrift kleiner wählen oder auf einer größeren ebenen Fläche platzieren.');
    if(!bound)return fromSolid(result);
    const print=keep(result.transform(assembly.clone().invert().toArray())),mesh=fromSolid(print);
    const nativeGeometry=bindNativeGeometry(api,result,{...data,...mesh},{contactPlanes:bound.contactPlanes});
    return {...mesh,nativeGeometry};
  }catch(error){failure=error;if(fatalMarkError(error))bound?.abandon();throw error;}
  finally{
    // A fatal delete poisons the same kernel as a fatal boolean. In that case
    // the restored-body owner must also abandon, not make another native call.
    let cleanupFailure;
    try{disposeMarkNative(owned.reverse(),failure);}
    catch(error){if(fatalMarkError(error)){bound?.abandon();throw error;}cleanupFailure=error;}
    if(!fatalMarkError(failure))try{bound?.dispose();}
    catch(error){if(fatalMarkError(error)){bound?.abandon();throw error;}cleanupFailure??=error;}
    if(cleanupFailure&&!failure)throw cleanupFailure;
  }
}
