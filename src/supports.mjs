import {overhangMetrics} from './overhang-metrics.mjs';
import {buildTopology,analyze,IDENTITY3} from './vendor/support-fins/overhangs.js';
import {buildFins} from './vendor/support-fins/fins.js';
import {MATERIAL} from './vendor/support-fins/materials.js';
import {bounds,toSolid,fromSolid} from './engine.mjs';
import {BufferGeometry,BufferAttribute,Matrix4,Line3} from 'three';
import {MeshBVH} from 'three-mesh-bvh';

const fatal=e=>e?.name==='RuntimeError'||/Aborted|memory access out of bounds|unreachable|RuntimeError/i.test(e?.message||'');
const identity=new Matrix4(),tolerance=.005;
function validOptions(bed,{material='pla',layerHeight=.2}={}){
 if(!Array.isArray(bed)||bed.length!==3||bed.some(v=>!Number.isFinite(v)||v<=0))throw Error('Gültigen nutzbaren Bauraum für Support Fins wählen.');
 if(!MATERIAL[material])throw Error('PLA oder PETG für Support Fins wählen.');
 if(!Number.isFinite(layerHeight)||layerHeight<.08||layerHeight>.4)throw Error('Schichthöhe 0,08–0,4 mm wählen.');
}
function geometry(data){const g=new BufferGeometry();g.setAttribute('position',new BufferAttribute(data.vertices,3));g.setIndex(new BufferAttribute(data.triangles,1));return g;}
function insideBed(box,bed){return box.min[0]>=-bed[0]/2-tolerance&&box.max[0]<=bed[0]/2+tolerance&&box.min[1]>=-bed[1]/2-tolerance&&box.max[1]<=bed[1]/2+tolerance&&box.min[2]>=-tolerance&&box.max[2]<=bed[2]+tolerance;}
function bedArea(data){let area=0;for(let i=0;i<data.triangles.length;i+=3){const p=[0,1,2].map(k=>data.triangles[i+k]*3);if(p.every(j=>Math.abs(data.vertices[j+2])<1e-4))area+=Math.abs((data.vertices[p[1]]-data.vertices[p[0]])*(data.vertices[p[2]+1]-data.vertices[p[0]+1])-(data.vertices[p[1]+1]-data.vertices[p[0]+1])*(data.vertices[p[2]]-data.vertices[p[0]]))/2;}return area;}
function uniteFin(api,data){
 if(!api)return data;
 const handles=[];let poisoned=false;
 try{const soup=toSolid(api,data);handles.push(soup);const components=soup.decompose();handles.push(...components);const united=api.Manifold.union(components);handles.push(united);if(united.status()!=='NoError')throw Error('invalid_support_solid');const pieces=united.decompose();handles.push(...pieces);if(pieces.length!==1||pieces[0].volume()<=1e-8)throw Error('disconnected_support');return fromSolid(united);}
 catch(e){poisoned=fatal(e);throw e;}finally{if(!poisoned)for(const h of handles.reverse())h.delete();}
}

// Surface intersections alone also accept a fin touching one model edge. A
// real tine must enter the model, and the native union must have one positive
// material component. Negative cavity shells remain part of that same body.
function nativeModelContact(api,model,data){
 const handles=[];let poisoned=false;
 try{
  const fin=toSolid(api,data);handles.push(fin);
  const overlap=model.intersect(fin);handles.push(overlap);
  if(overlap.status()!=='NoError')throw Error('invalid_support_solid');
  const volume=overlap.volume();if(!Number.isFinite(volume)||volume<=1e-8)throw Error('no_model_contact');
  const joined=model.add(fin);handles.push(joined);if(joined.status()!=='NoError')throw Error('invalid_support_solid');
  const components=joined.decompose();handles.push(...components);let positive=0;
  for(const component of components){const value=component.volume();if(!Number.isFinite(value))throw Error('invalid_support_solid');if(value>0)positive++;}
  if(positive!==1)throw Error('no_model_contact');
  return volume;
 }catch(error){poisoned=fatal(error);throw error;}finally{if(!poisoned)for(const handle of handles.reverse())handle.delete();}
}

// Each record is a complete fin, including its flange and contact teeth. Keep
// or reject the whole record: trimming a wall to the bed would leave open mesh.
// The source part is never translated, cut or changed here.
export function validatedSupportGeometry(data,built,bed,{nativeApi,layerHeight=.2}={}){
 const g=geometry(data),tree=new MeshBVH(g,{indirect:true}),offset=built.offset||{x:0,y:0,z:0},shift=[offset.x,offset.y,offset.z],accepted=[],rejected=[];
 let modelSolid,poisoned=false;
 const records=[...(built.fins||[]).map(fin=>({...fin,pad:false})),...(built.padTriangles?.length?[{id:'pad',kind:'pad',pad:true,triRanges:[[0,built.padTriangles.length]]}]:[])];
 try{for(const record of records){
  const points=record.pad?built.padTriangles:built.triangles,ranges=record.triRanges||[];let length=0;
  if(!ranges.length||ranges.some(r=>!Array.isArray(r)||r.length!==2||!r.every(Number.isInteger)||r[0]<0||r[1]<=r[0]||r[1]>points.length||r[0]%3||r[1]%3)){rejected.push({id:record.id,kind:record.kind,reason:'invalid_geometry'});continue;}
  for(const [a,b]of ranges)length+=b-a;
  const raw={vertices:new Float32Array(length*3),triangles:Uint32Array.from({length},(_,i)=>i)};let index=0;
  for(const [a,b]of ranges)for(let i=a;i<b;i++){for(let k=0;k<3;k++){const value=points[i][k]-shift[k];raw.vertices[index*3+k]=k===2&&Math.abs(value)<1e-5?0:value;}index++;}
  let fin=raw,finGeometry;
  try{
   if(!fin.vertices.every(Number.isFinite))throw Error('invalid_geometry');
   if(!insideBed(bounds(fin),bed))throw Error('outside_bed');
   if(bedArea(fin)<.01)throw Error('no_plate_contact');
   fin=uniteFin(nativeApi,fin);
   if(!insideBed(bounds(fin),bed))throw Error('outside_bed');
   const contactArea=bedArea(fin);if(contactArea<.01)throw Error('no_plate_contact');
   finGeometry=geometry(fin);const finTree=new MeshBVH(finGeometry,{indirect:true}),line=new Line3();let contactHeight=0;
   const contacts=tree.bvhcast(finTree,identity,{intersectsTriangles:(a,b)=>{if(!a.intersectsTriangle(b,line,true))return false;const height=Math.max(line.start.z,line.end.z);if(height<=(record.pad ? .01 : Math.max(.6,layerHeight*2)))return false;contactHeight=height;return true;}});
   if(!contacts)throw Error('no_model_contact');
   let modelContactVolume;
   if(nativeApi){modelSolid??=toSolid(nativeApi,data);modelContactVolume=nativeModelContact(nativeApi,modelSolid,fin);}
   accepted.push({data:fin,id:record.id,kind:record.kind,pad:record.pad,bedArea:contactArea,contactHeight,...(modelContactVolume!==undefined?{modelContactVolume}:{}),bounds:bounds(fin)});
  }catch(e){if(fatal(e))throw e;rejected.push({id:record.id,kind:record.kind,reason:/^(outside_bed|no_plate_contact|no_model_contact|disconnected_support|invalid_geometry|invalid_support_solid)$/.test(e.message)?e.message:'invalid_support_solid'});}
  finally{finGeometry?.dispose();}
 }}catch(error){poisoned=fatal(error);throw error;}finally{g.dispose();if(!poisoned)modelSolid?.delete();}
 const vertexLength=accepted.reduce((n,r)=>n+r.data.vertices.length,0),triangleLength=accepted.reduce((n,r)=>n+r.data.triangles.length,0),vertices=new Float32Array(vertexLength),triangles=new Uint32Array(triangleLength),fins=[];let vertexAt=0,triangleAt=0;
 for(const fin of accepted){vertices.set(fin.data.vertices,vertexAt);for(let i=0;i<fin.data.triangles.length;i++)triangles[triangleAt+i]=fin.data.triangles[i]+vertexAt/3;fins.push({id:fin.id,kind:fin.kind,pad:fin.pad,triangleStart:triangleAt/3,triangleCount:fin.data.triangles.length/3,bedArea:fin.bedArea,contactHeight:fin.contactHeight,...(fin.modelContactVolume!==undefined?{modelContactVolume:fin.modelContactVolume}:{}),bounds:fin.bounds});vertexAt+=fin.data.vertices.length;triangleAt+=fin.data.triangles.length;}
 return{vertices,triangles,fins,count:fins.filter(f=>!f.pad).length,pad:fins.some(f=>f.pad),rejected,candidateCount:records.filter(r=>!r.pad).length,validation:nativeApi?'native-connected-and-contact':'bounds-and-contact',contactValidation:nativeApi?'native-positive-volume-and-union':'surface-intersection-only'};
}

export function printGeometry(data){
 const support=data.supports;if(!support?.enabled||!support.triangles?.length)return data;
 const vertices=new Float32Array(data.vertices.length+support.vertices.length);vertices.set(data.vertices);vertices.set(support.vertices,data.vertices.length);
 const triangles=new Uint32Array(data.triangles.length+support.triangles.length);triangles.set(data.triangles);for(let i=0;i<support.triangles.length;i++)triangles[data.triangles.length+i]=support.triangles[i]+data.vertices.length/3;
 return {...data,vertices,triangles};
}
export function supportFins(data,bed,{material='pla',sway=true,layerHeight=.2,nativeApi}={}){
 validOptions(bed,{material,layerHeight});
 const overhang=overhangMetrics(data);
 const before=bounds(data);if(Math.abs(before.min[2])>.05)throw Error('Das Teil zuerst auf dem Druckbett ausrichten.');
 if(!insideBed(before,bed))throw Error('Das Teil zuerst passend im nutzbaren Bauraum auf dem Druckbett ausrichten.');
 const soup=new Float32Array(data.triangles.length*3);for(let i=0;i<data.triangles.length;i++)for(let k=0;k<3;k++)soup[i*3+k]=data.vertices[data.triangles[i]*3+k];
 const topology=buildTopology({getAttribute:()=>({array:soup})}),analysis=analyze(topology,45,IDENTITY3);
 const built=buildFins(topology,analysis,IDENTITY3,{mode:'prop',bedPad:true,tines:true,layerHeight,coverage:.15,sway:{on:sway&&before.size[2]>80&&before.size[2]/Math.max(1,Math.min(before.size[0],before.size[1]))>5},tunables:{...MATERIAL[material],padStyle:'auto',cutout:'none'}});
 const validated=validatedSupportGeometry(data,{...built,offset:analysis.offset},bed,{nativeApi,layerHeight});
 const supports={...validated,enabled:true,material,sway,layerHeight,coverage:.15,source:'gittrahan/support-fins',sourceOverhang:overhang,warnings:[],contact:{tineBite:MATERIAL[material].tineBite,bodyGap:MATERIAL[material].propGap}};
 if(overhang.needsFurtherSplit)supports.warnings.push('Überhänge über 60° bleiben bestehen. Finnen ergänzen lokale Abstützung, ersetzen dafür aber keine weitere Slicerprüfung.');
 if(built.floating?.length)supports.warnings.push('Das Teil enthält schwebende Bereiche; im Slicer prüfen.');
 if(built.unserved>0)supports.warnings.push(`${built.unserved} Überhangbereiche werden von den Finnen nicht erreicht; Ausrichtung oder Aufteilung prüfen.`);
 if(built.sagRisk)supports.warnings.push('Zwischen den Finnen bleiben große freie Spannweiten; im Slicer prüfen.');
 const skipped=reason=>validated.rejected.filter(r=>r.reason===reason).length,outside=skipped('outside_bed'),unseated=skipped('no_plate_contact'),unconnected=validated.rejected.length-outside-unseated;
 if(outside)supports.warnings.push(`${outside} Finnen außerhalb des nutzbaren Bauraums ausgelassen.`);
 if(unseated)supports.warnings.push(`${unseated} Zwischenstützen ohne direkte Bettauflage ausgelassen.`);
 if(unconnected)supports.warnings.push(`${unconnected} Finnen ohne geprüften Zusammenhang oder Modellkontakt ausgelassen.`);
 if(!supports.triangles.length&&overhang.supportArea>1)supports.warnings.push('Keine geeigneten Bettfinnen gefunden; vorhandene Überhänge bleiben unverändert.');
 return supports;
}

/** Atomic with respect to input objects. A cooperative stop returns the entire
 * original partition; fatal kernel failures propagate without further calls. */
export async function supportFinsAll(parts,bed,{options={},nativeApi,preparePart,progress=()=>{},stop=()=>false}={}){
 validOptions(bed,options);if(!Array.isArray(parts)||!parts.length)throw Error('Zuerst Teile laden.');
 const output=[],failed=[],notices=[];let generatedParts=0,finCount=0;
 for(let i=0;i<parts.length;i++){
  if(stop())return{parts,generatedParts:0,finCount:0,unchangedParts:parts.length,failed:[],notices:[],stopped:true,discardedParts:output.length};
  await progress(`Support Fins für Teil ${i+1}/${parts.length} prüfen …`);await new Promise(resolve=>setTimeout(resolve,0));if(stop())return{parts,generatedParts:0,finCount:0,unchangedParts:parts.length,failed:[],notices:[],stopped:true,discardedParts:output.length};
  const part=parts[i];
  try{const prepared=preparePart?await preparePart(part,bed):part;if(prepared.remaining||prepared.requiresCutFace)throw Error('Restbereich oder fehlende ebene Druckauflage: keine automatischen Finnen ergänzt.');const supports=supportFins(prepared,bed,{...options,nativeApi}),supportNotice=[prepared.supportOrientation?.notice,...supports.warnings].filter(Boolean).join(' ');output.push({...prepared,supports,supportNotice:supportNotice||undefined});if(supports.triangles.length)generatedParts++;finCount+=supports.count;if(supportNotice)notices.push({part:i,id:part.id||String(i+1),reason:supportNotice});}
  catch(e){if(fatal(e))throw e;output.push({...part,supportNotice:e.message});failed.push({part:i,id:part.id||String(i+1),reason:e.message});notices.push({part:i,id:part.id||String(i+1),reason:e.message});}
 }
 if(stop())return{parts,generatedParts:0,finCount:0,unchangedParts:parts.length,failed:[],notices:[],stopped:true,discardedParts:output.length};
 return{parts:output,generatedParts,finCount,unchangedParts:parts.length-generatedParts,failed,notices,stopped:false};
}

export function restoreSupports(s){
 if(!s)return undefined;
 if(!Array.isArray(s.vertices)||!Array.isArray(s.triangles)||s.vertices.length%3||s.triangles.length%3||s.vertices.length>9000000||s.triangles.length>9000000||s.vertices.some(v=>!Number.isFinite(v))||s.triangles.some(i=>!Number.isInteger(i)||i<0||i>=s.vertices.length/3))throw Error('Ungültige Support-Fin-Geometrie im Projekt.');
 return {...s,vertices:new Float32Array(s.vertices),triangles:new Uint32Array(s.triangles),enabled:!!s.enabled};
}
