import {Matrix4,Matrix3,Vector3} from 'three';
import {bounds,toSolid,fromSolid,transformData,bestOrientation} from './engine.mjs';
import {orientOnCutFace} from './cut-orientation.mjs';
import {overhangMetrics} from './overhang-metrics.mjs';

const identity=()=>new Matrix4();
const kernelError=e=>/Aborted|memory access out of bounds|unreachable|RuntimeError/i.test(e?.message||String(e));
function assemblyMatrix(part){
 const m=part.assemblyMatrix?new Matrix4().fromArray(part.assemblyMatrix):part.transform?new Matrix4().fromArray(part.transform).invert():identity();
 const a=new Vector3().setFromMatrixColumn(m,0),b=new Vector3().setFromMatrixColumn(m,1),c=new Vector3().setFromMatrixColumn(m,2);
 if(m.elements.some(v=>!Number.isFinite(v))||Math.abs(m.determinant()-1)>1e-5||[a,b,c].some(v=>Math.abs(v.lengthSq()-1)>1e-5)||Math.max(Math.abs(a.dot(b)),Math.abs(a.dot(c)),Math.abs(b.dot(c)))>1e-5)throw Error('Montagelage muss eine starre Drehung und Verschiebung sein.');
 return m;
}
function planesInFrame(planes,m){const normalMatrix=new Matrix3().getNormalMatrix(m);return (planes||[]).map(p=>{const normal=new Vector3(...p.normal),point=normal.clone().multiplyScalar(p.offset).applyMatrix4(m);normal.applyMatrix3(normalMatrix).normalize();return {normal:normal.toArray(),offset:normal.dot(point)};});}
function uniquePlanes(planes){const map=new Map();for(const p of planes){const sign=p.normal.find(n=>Math.abs(n)>1e-8)<0?-1:1,key=[...p.normal,p.offset].map(v=>Math.round(v*sign*1e6)).join(',');map.set(key,p);}return [...map.values()];}
function appendRegions(a,b){if(!a)return b;if(!b)return a;const vertices=new Float32Array(a.vertices.length+b.vertices.length),triangles=new Uint32Array(a.triangles.length+b.triangles.length);vertices.set(a.vertices);vertices.set(b.vertices,a.vertices.length);triangles.set(a.triangles);for(let i=0;i<b.triangles.length;i++)triangles[a.triangles.length+i]=b.triangles[i]+a.vertices.length/3;return {vertices,triangles};}
const inBed=(part,bed)=>bounds(part).size.every((v,i)=>v<=bed[i]+.005);
const adjacentBoxes=(a,b,tolerance)=>a.min.every((v,i)=>v<=b.max[i]+tolerance&&a.max[i]>=b.min[i]-tolerance);

/**
 * Greedy consolidation of closed cut parts, before labels/supports are generated.
 * Input transform maps assembly -> print, or assemblyMatrix maps print -> assembly.
 * Merged outputs expose both transforms and original member indices. No snapping,
 * bridge material, fragment deletion, or globally minimal part-count claim.
 */
export function consolidateParts(api,parts,bed,{progress=()=>{},stop=()=>false,requireCutFace=true,smallVolume=1000,smallSpan=Math.min(...bed)*.15,contactTolerance=.02,volumeRelativeTolerance=5e-6,overhangTolerance=1,maxSevereArea=1,maxAttempts=Infinity}={}){
 if(!Array.isArray(parts)||!Array.isArray(bed)||bed.length!==3||bed.some(v=>!Number.isFinite(v)||v<=0))throw Error('Ungültige Teile oder Bauraummaße.');
 if([smallVolume,smallSpan,contactTolerance,volumeRelativeTolerance,overhangTolerance,maxSevereArea].some(v=>!Number.isFinite(v)||v<0)||!(maxAttempts>=0))throw Error('Ungültige Einstellungen für das Zusammenfassen.');
 let nextId=parts.length,merges=0,attempted=0,stopped=false,kernelFailure=null;const originalVolumes=parts.map(()=>null);
 const groups=parts.map((part,i)=>({key:i,members:[i],output:part,volume:null,solid:null,box:null,planes:[],mask:null,protected:!!(part.mark||part.plannedMark)})),rejections=[],mergeHistory=[],tested=new Set();
 const tolerance=v=>Math.max(1e-6,v*volumeRelativeTolerance),dispose=s=>{if(s&&!kernelFailure)try{s.delete();}catch(e){if(kernelError(e))kernelFailure=e.message;else throw e;}};
 const isSmall=g=>g.volume!==null&&(g.volume<smallVolume||Math.max(...bounds(g.output).size)<smallSpan);
 try{
  for(const group of groups){if(stop()){stopped=true;break;}let source;
   try{const matrix=assemblyMatrix(group.output);source=toSolid(api,group.output);group.volume=source.volume();group.exportVolume=group.volume;originalVolumes[group.members[0]]=group.volume;group.solid=source.transform(matrix.toArray());const components=group.solid.decompose();group.components=components.length;components.forEach(dispose);group.box=group.solid.boundingBox();group.planes=planesInFrame(group.output.cutPlanes,matrix);group.mask=group.output.interiorRegion?transformData(group.output.interiorRegion,matrix):null;group.overhang=overhangMetrics(group.output);}
   catch(e){if(kernelError(e)){kernelFailure=e.message;break;}group.error=e.message;}
   finally{dispose(source);}
  }
  while(!stopped&&!kernelFailure){
   if(stop()){stopped=true;break;}
   const candidates=[];
   for(let i=0;i<groups.length;i++)for(let j=i+1;j<groups.length;j++){
    const a=groups[i],b=groups[j],key=`${a.key}:${b.key}`;if(tested.has(key)||!a.solid||!b.solid||a.error||b.error||a.protected||b.protected||a.components!==1||b.components!==1||!adjacentBoxes(a.box,b.box,contactTolerance))continue;
    const span=a.box.max.map((v,k)=>Math.max(v,b.box.max[k])-Math.min(a.box.min[k],b.box.min[k]));if(Math.max(...span)>Math.hypot(...bed)+.01||a.volume+b.volume>bed.reduce((x,y)=>x*y,1)+tolerance(a.volume+b.volume))continue;
    candidates.push({i,j,key,small:isSmall(a)||isSmall(b),minimum:Math.min(a.volume,b.volume),volume:a.volume+b.volume});
   }
   candidates.sort((a,b)=>Number(b.small)-Number(a.small)||(a.small?a.minimum-b.minimum:0)||b.volume-a.volume||a.i-b.i||a.j-b.j);
   let accepted=false;
   for(const pair of candidates){
    if(stop()){stopped=true;break;}if(attempted>=maxAttempts){stopped=true;break;}attempted++;tested.add(pair.key);const a=groups[pair.i],b=groups[pair.j];let union,verification;
    progress(`Nachbarteile zusammenfassen: ${groups.length} Teile · ${merges} Verbindungen · Prüfung ${attempted}`);
    try{
     union=a.solid.add(b.solid);const components=union.decompose(),connected=components.length===1;components.forEach(dispose);if(!connected){rejections.push({members:[...a.members,...b.members],reason:'disconnected'});continue;}
     const volume=union.volume();if(Math.abs(volume-pair.volume)>tolerance(pair.volume)){rejections.push({members:[...a.members,...b.members],reason:'volume_change'});continue;}
     const planes=uniquePlanes([...a.planes,...b.planes]),data={...fromSolid(union),cutPlanes:planes};if(requireCutFace&&!planes.length){rejections.push({members:[...a.members,...b.members],reason:'no_cut_face'});continue;}
     let oriented;try{oriented=planes.length?orientOnCutFace(data,bed):bestOrientation(data,bed);}catch(e){if(kernelError(e))throw e;rejections.push({members:[...a.members,...b.members],reason:'no_fitting_cut_face'});continue;}
     if(!inBed(oriented,bed)){rejections.push({members:[...a.members,...b.members],reason:'build_volume'});continue;}
     const overhang=overhangMetrics(oriented),oldSevere=a.overhang.severeArea+b.overhang.severeArea,oldSupport=a.overhang.supportArea+b.overhang.supportArea;
     if(overhang.severeArea>Math.min(maxSevereArea,oldSevere+overhangTolerance)||overhang.supportArea>oldSupport+overhangTolerance){rejections.push({members:[...a.members,...b.members],reason:'overhang_increase'});continue;}
     verification=toSolid(api,oriented);if(Math.abs(verification.volume()-pair.volume)>tolerance(pair.volume)){rejections.push({members:[...a.members,...b.members],reason:'export_volume_change'});continue;}
     const members=[...a.members,...b.members].sort((x,y)=>x-y),mask=appendRegions(a.mask,b.mask),output={...oriented,volume:verification.volume(),members,consolidationMembers:members,overhang,assemblyMatrix:new Matrix4().fromArray(oriented.transform).invert().toArray()};if(mask)output.interiorRegion=transformData(mask,new Matrix4().fromArray(oriented.transform));
     const compact=union.asOriginal();dispose(union);union=compact;
     const group={key:nextId++,members,solid:union,volume,exportVolume:verification.volume(),planes,mask,output,overhang,box:union.boundingBox(),components:1,protected:false};union=null;dispose(a.solid);dispose(b.solid);groups[pair.i]=group;groups.splice(pair.j,1);merges++;mergeHistory.push({members,volume,dimensions:bounds(output).size});accepted=true;break;
    }catch(e){if(kernelError(e)){kernelFailure=e.message;break;}rejections.push({members:[...a.members,...b.members],reason:'geometry_error',message:e.message});}
    finally{dispose(union);dispose(verification);}
   }
   if(!accepted)break;
  }
  const unresolved=[];for(let i=0;i<groups.length;i++){const g=groups[i],base={part:i,members:g.members,volume:g.volume,retained:true};if(g.error)unresolved.push({...base,reason:'invalid_geometry',message:g.error});else if(g.components>1)unresolved.push({...base,reason:'disconnected_bodies',components:g.components});else if(groups.length>1&&g.protected)unresolved.push({...base,reason:'protected_annotation'});else if(groups.length>1&&isSmall(g))unresolved.push({...base,reason:'small_part_cannot_merge'});if(!inBed(g.output,bed))unresolved.push({...base,reason:'outside_build_volume'});if(g.overhang?.severeArea>maxSevereArea)unresolved.push({...base,reason:'severe_overhang',area:g.overhang.severeArea});}
  const output=groups.map(g=>({...g.output,members:g.members,consolidationMembers:g.members}));return {parts:output,merges,attempted,stopped,kernelFailure,unresolved,rejections,mergeHistory,volume:groups.every(g=>g.volume!==null)?groups.reduce((sum,g)=>sum+g.volume,0):null,volumeBefore:originalVolumes.every(v=>v!==null)?originalVolumes.reduce((sum,v)=>sum+v,0):null,volumeAfter:groups.every(g=>g.exportVolume!=null)?groups.reduce((sum,g)=>sum+g.exportVolume,0):null,heuristic:true,criteria:{smallVolume,smallSpan,requireCutFace,maxSevereArea}};
 }finally{groups.forEach(g=>dispose(g.solid));}
}
