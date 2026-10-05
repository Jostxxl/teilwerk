import {createFreshContactPriority} from './frontier-priority-completion.mjs';
import {sampleDowelContactContours} from './dowel-contact-sampler.mjs';
import {purchasedPinSettings} from './connector-project.mjs';
import {createFrontierRejections} from './frontier-rejections.mjs';
import {createFrontierPriority} from './frontier-priority.mjs';
import {Matrix3,Matrix4,Vector3} from 'three';
import {toSolid,bounds,bestOrientation} from './engine.mjs';
import {neighborGraph} from './neighbor-colors.mjs';
import {assemblyOrder} from './assembly-order.mjs';
import {pointInsidePrism} from './open-clip.mjs';
import {drillDowelPair} from './dowel-connectors.mjs';
import {verifyLinearInsertion} from './linear-insertion.mjs';
import {printStability} from './print-stability.mjs';
import {rebuildManualFins} from './manual-fins.mjs';
import {validateNativeBinding,restoreBoundNative,bindNativeGeometry} from './native-geometry-binding.mjs';

const fatal=e=>e?.name==='RuntimeError'||/Aborted|memory access out of bounds|unreachable|RuntimeError/i.test(e?.message||'');
const vector=v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite);
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),sub=(a,b)=>a.map((v,i)=>v-b[i]);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const normalized=v=>{const length=Math.hypot(...v);return v.map(x=>x/length);};
function canonical(normal,offset){const length=Math.hypot(...normal);normal=normal.map(v=>v/length);offset/=length;if(normal.find(v=>Math.abs(v)>1e-7)<0){normal=normal.map(v=>-v);offset=-offset;}return{normal,offset};}
function basis(plane){const n=plane.normal,u=normalized(cross(Math.abs(n[2])<.9?[0,0,1]:[0,1,0],n)),v=cross(n,u);return{u,v,n,min:plane.offset-1,max:plane.offset+1};}
function worldMesh(part,precise=null){
 const values=part.assemblyMatrix||new Matrix4().toArray();if(!Array.isArray(values)||values.length!==16||!values.every(Number.isFinite))throw Error('Ungültige Montagelage für Passstifte.');
 const matrix=new Matrix4().fromArray(values),axes=[0,1,2].map(i=>new Vector3().setFromMatrixColumn(matrix,i));
 if(axes.some(v=>Math.abs(v.lengthSq()-1)>1e-5)||Math.abs(axes[0].dot(axes[1]))>1e-5||Math.abs(axes[0].dot(axes[2]))>1e-5||Math.abs(axes[1].dot(axes[2]))>1e-5||Math.abs(matrix.determinant()-1)>1e-5||[values[3],values[7],values[11],values[15]-1].some(v=>Math.abs(v)>1e-8))throw Error('Passstifte benötigen starre Montagelagen.');
 const vertices=new Float64Array(precise?precise.snapshot.vertices:part.vertices.length),triangles=precise?new Uint32Array(precise.snapshot.triangles):part.triangles,point=new Vector3(),normalMatrix=new Matrix3().getNormalMatrix(matrix);
 if(!precise)for(let i=0;i<vertices.length;i+=3)point.fromArray(part.vertices,i).applyMatrix4(matrix).toArray(vertices,i);
 // Exact snapshots already live in assembly coordinates. Keep the literal
 // shared source plane; a print-pose inverse or second normalization can turn
 // an exactly common face into two slightly different surfaces/axes.
 let planes=precise?precise.contactPlanes.map(p=>{const sign=p.normal.find(v=>Math.abs(v)>1e-7)<0?-1:1;return{normal:p.normal.map(v=>v*sign),offset:p.offset*sign};}):(part.cutPlanes||[]).filter(p=>vector(p.normal)&&Number.isFinite(p.offset)&&Math.hypot(...p.normal)>1e-7).map(p=>{const n=new Vector3(...p.normal).normalize(),q=n.clone().multiplyScalar(p.offset/Math.hypot(...p.normal)).applyMatrix4(matrix);n.applyMatrix3(normalMatrix).normalize();return canonical(n.toArray(),q.dot(n));});
 // Imported planar bodies also work without saved cutting-plane metadata.
 if(!planes.length){const groups=new Map();for(let f=0;f<triangles.length;f+=3){const p=[0,1,2].map(k=>Array.from(vertices.slice(triangles[f+k]*3,triangles[f+k]*3+3))),n=cross(sub(p[1],p[0]),sub(p[2],p[0])),area=Math.hypot(...n)/2;if(area<1e-6)continue;const plane=canonical(n,dot(n,p[0])),key=[...plane.normal.map(v=>Math.round(v*1e5)),Math.round(plane.offset*100)].join(',');const group=groups.get(key)||{...plane,area:0};group.area+=area;groups.set(key,group);}planes=[...groups.values()].sort((a,b)=>b.area-a.area).slice(0,24);}
 return{vertices,triangles,planes,matrix};
}

/** Immutable base parts in their FINAL print poses. Only complete native socket
 * checks plus continuous pin and child insertion proofs commit a connection.
 * All native edits remain in assembly coordinates until the final mesh export.
 * A partial plan explicitly retains unresolved contacts; it is not a complete
 * mechanical assembly or strength proof. */
export async function planDowelConnections(api,parts,bed,options={}){return run(api,parts,bed,options,null);}

/** Saved generated meshes/proof flags are never trusted. Replay exact placements
 * from the immutable unbored base and prove every computed connection again. */
export async function restoreDowelPlan(api,baseParts,savedPlan,bed,options={}){
 if(!savedPlan||!Array.isArray(savedPlan.connections)||!Array.isArray(savedPlan.order)||!savedPlan.settings)throw Error('Unvollständiger gespeicherter Passstiftplan.');
 const savedHardware=purchasedPinSettings(savedPlan.settings),merged={...savedPlan.settings,...options},replayedHardware=purchasedPinSettings(merged);
 if(!!savedHardware!==!!replayedHardware||(savedHardware&&['pinSource','pinLength','pinEndClearance','socketDepth','pinDiameter','diametralClearance'].some(key=>merged[key]!==savedPlan.settings[key])))throw Error('Gespeicherte Kaufstiftmaße dürfen beim Wiederöffnen nicht verändert werden.');
 if(savedPlan.connections.some(c=>c.status==='computed'&&((c.pin?.source==='purchased')!==!!savedHardware||c.pin?.source!==undefined&&!['purchased','printed'].includes(c.pin.source))))throw Error('Gespeicherte Passstiftquelle und Verbindungen sind widersprüchlich.');
 return run(api,baseParts,bed,merged,savedPlan);
}

// Large local projects need enough time for three continuous path proofs per
// accepted connection. Apply the same bounded allowance when replaying their
// saved placements, so a valid large plan can also be opened again.
export function dowelPlanningBudget(parts){
 if(!Array.isArray(parts))throw Error('Ungültige Teile für die Passstiftplanung.');
 const triangles=parts.reduce((sum,part)=>sum+(part?.triangles?.length||0)/3,0);
 return Math.min(900000,Math.max(120000,Math.ceil((parts.length*5000+triangles*.15)/10000)*10000));
}

async function run(api,input,bed,options={},replay){
 if(options.frontierPolicy!==undefined&&options.frontierPolicy!=='fresh-contact-first-v1')throw Error('Ungültige Kontaktsuchpriorität.');
 if(options.compactPairFallback!==undefined&&typeof options.compactPairFallback!=='boolean')throw Error('Ungültige kompakte Passstiftsuche.');
 const hardware=purchasedPinSettings(options);
 const {pinDiameter=3,diametralClearance=hardware ? .3 : .2,socketDepth=3,minWall=1,maxMillis=dowelPlanningBudget(input),maxPairsPerContact=4,stop=()=>false,progress=()=>{}}={...options,...hardware};
 if(!api?.Manifold||!Array.isArray(input)||!input.length||!vector(bed)||bed.some(v=>v<=0)||![pinDiameter,diametralClearance,socketDepth,minWall,maxMillis].every(Number.isFinite)||pinDiameter<=0||diametralClearance<0||socketDepth<=.1||minWall<1||maxMillis<=0||!Number.isInteger(maxPairsPerContact)||maxPairsPerContact<1||typeof stop!=='function'||typeof progress!=='function')throw Error('Ungültige Einstellungen für automatische Passstifte.');
 const ids=input.map(p=>String(p.id));if(new Set(ids).size!==ids.length||ids.some(id=>!/^[1-9]\d*$/.test(id)))throw Error('Passstifte benötigen eindeutige einfache Teilnummern.');
 if(input.some(p=>p.connectorHoles?.length))throw Error('Vor einer neuen Passstiftplanung die bisherige Verbindung entfernen.');
 if(input.some(p=>p.plannedMark&&!p.mark))throw Error('Vorgemerkte Nummern zuerst gravieren, dann Passstifte berechnen.');
 if(input.some(p=>bounds(p).size.some((s,i)=>s>bed[i]+.01)))throw Error('Vor den Passstiften alle Teile passend zum Bauraum ausrichten.');
 // A present but stale attachment is a request error, even for an isolated
 // part. Never hide a binding mismatch among ordinary candidate rejections.
 const precise=input.map(p=>p.nativeGeometry!==undefined?validateNativeBinding(p):null);
 const settings={pinDiameter,diametralClearance,socketDepth,minWall,maxMillis,maxPairsPerContact,...(hardware||{}),...(options.pinSource==='printed'?{pinSource:'printed'}:{}),...(options.compactPairFallback?{compactPairFallback:true}:{}),...(options.frontierPolicy?{frontierPolicy:options.frontierPolicy}:{})},started=performance.now(),parts=input.map(p=>({...p})),owned=new Set(),native=new Map(),sections=new Map(),pinSolids=[],pins=[],connections=[],unresolved=[],attempts=[],world=input.map((p,i)=>worldMesh(p,precise[i])),built=[];
 const priority=options.frontierPolicy?createFreshContactPriority(input.length):createFrontierPriority(input.length),rejectionCache=createFrontierRejections(input.length);
 const contactPoints=new WeakMap(),contactSampling={method:'grid-then-contour-fallback-v1',fallbackContacts:0,candidatePoints:0,materialPoints:0,truncatedSamplers:0};
 let poisoned=false,stopped=false,stopReason=null,failure=null;
 const call=fn=>{try{return fn();}catch(e){if(fatal(e))poisoned=true;throw e;}};
 const keep=value=>{owned.add(value);return value;};
 const drop=value=>{if(value&&owned.delete(value)&&!poisoned)call(()=>value.delete());};
 async function pause(message){await progress(message);await new Promise(r=>setTimeout(r,0));if(await stop()){stopped=true;stopReason='requested';}else if(performance.now()-started>=maxMillis){stopped=true;stopReason='time_budget';}return stopped;}
 const remaining=()=>Math.max(0,maxMillis-(performance.now()-started));
 function body(index){if(!native.has(index)){
  let solid;
  if(precise[index]){const restored=call(()=>restoreBoundNative(api,input[index]));try{solid=keep(call(()=>restored.solid.asOriginal()));}finally{if(poisoned)restored.abandon();else call(()=>restored.dispose());}}
  else{const local=keep(call(()=>toSolid(api,input[index])));solid=keep(call(()=>local.transform(world[index].matrix.toArray())));drop(local);}
  const volume=call(()=>solid.volume());if(call(()=>solid.status())!=='NoError'||!Number.isFinite(volume)||volume<=0)throw Error('Passstifte benötigen geschlossene Körper mit positivem Materialvolumen.');native.set(index,solid);
 }return native.get(index);}
 function section(index,plane){
  const key=index+':'+[...plane.normal,plane.offset].map(v=>v.toPrecision(13)).join(',');if(sections.has(key))return sections.get(key);
  const data=world[index],frame=basis(plane),polygons=[];let signedArea=0;
  for(let f=0;f<data.triangles.length;f+=3){const tri=[0,1,2].map(k=>Array.from(data.vertices.slice(data.triangles[f+k]*3,data.triangles[f+k]*3+3)));if(tri.some(p=>Math.abs(dot(p,plane.normal)-plane.offset)>.005))continue;const n=cross(sub(tri[1],tri[0]),sub(tri[2],tri[0])),area=Math.hypot(...n)/2;if(!area||Math.abs(dot(n,plane.normal)/(2*area))<.9999)continue;const sign=Math.sign(dot(n,plane.normal));signedArea+=sign*area;const polygon=tri.map(p=>[dot(p,frame.u),dot(p,frame.v)]);if(sign<0)polygon.reverse();polygons.push(polygon);}
  const result=polygons.length?{solid:keep(call(()=>api.CrossSection.ofPolygons(polygons,'Positive'))),outward:Math.sign(signedArea),basis:frame}:null;sections.set(key,result);return result;
 }
 function contacts(a,b){const result=[],checked=[];for(const plane of world[a].planes){if(checked.some(p=>Math.abs(p.offset-plane.offset)<.01&&dot(p.normal,plane.normal)>.99999)||!world[b].planes.some(p=>Math.abs(p.offset-plane.offset)<.01&&dot(p.normal,plane.normal)>.99999))continue;checked.push(plane);const sa=section(a,plane),sb=section(b,plane);if(!sa||!sb||sa.outward===sb.outward)continue;let joint,safe;try{joint=keep(call(()=>sa.solid.intersect(sb.solid)));safe=keep(call(()=>joint.offset(-((pinDiameter+diametralClearance)/2+minWall),'Round')));const safeArea=call(()=>safe.area());if(safeArea>1e-5)result.push({a,b,plane,basis:sa.basis,outwardA:sa.outward,safeArea,contours:call(()=>safe.toPolygons())});}finally{drop(safe);drop(joint);}}return result.sort((a,b)=>b.safeArea-a.safeArea);}
 function cylinder(point,n,radius,height){const frame=basis({normal:n,offset:0}),raw=keep(call(()=>api.Manifold.cylinder(height,radius,radius,64))),matrix=new Matrix4().makeBasis(new Vector3(...frame.u),new Vector3(...frame.v),new Vector3(...n)).setPosition(new Vector3(...point)),solid=keep(call(()=>raw.transform(matrix.toArray())));drop(raw);return{solid,matrix};}
 function socketRoom(index,point,n){let envelope,outside,local;try{const tool=cylinder(point,n,((pinDiameter+diametralClearance)/2+minWall)/Math.cos(Math.PI/64),socketDepth+minWall);envelope=tool.solid;outside=keep(call(()=>envelope.subtract(body(index))));const volume=call(()=>outside.volume());if(!Number.isFinite(volume)||volume< -1e-7)return false;if(volume<=1e-7)return true;local=keep(call(()=>outside.transform(tool.matrix.clone().invert().toArray())));return call(()=>local.boundingBox()).max[2]<=.0001;}finally{drop(local);drop(outside);drop(envelope);}}
 async function placements(contact){
  const flat=contact.contours.flat();if(!flat.length)return[];const lo=[Infinity,Infinity],hi=[-Infinity,-Infinity];for(const p of flat)for(let i=0;i<2;i++){lo[i]=Math.min(lo[i],p[i]);hi[i]=Math.max(hi[i],p[i]);}const center=lo.map((v,i)=>(v+hi[i])/2),grid=[];
  const step=Math.max(2,(pinDiameter+diametralClearance)/1.2,Math.max(...hi.map((v,i)=>v-lo[i]))/20);
  // Always sample the middle of narrow strips and both protected ends. A grid
  // beginning exactly at the boundary can miss every usable row on a thin wall.
  const samples=lo.map((low,i)=>{const inset=Math.min(.02,(hi[i]-low)*.1),values=new Set([low+inset,center[i],hi[i]-inset]);for(let x=low+step/2;x<hi[i];x+=step)values.add(x);return[...values].sort((a,b)=>a-b);});
  for(const y of samples[1])for(const x of samples[0]){const p=contact.basis.u.map((v,i)=>v*x+contact.basis.v[i]*y+contact.basis.n[i]*contact.plane.offset);if(pointInsidePrism(p,{...contact.basis,contours:contact.contours}))grid.push({p,distance:Math.hypot(x-center[0],y-center[1])});}
  grid.sort((a,b)=>a.distance-b.distance);const points=[];
  for(const {p}of grid.slice(0,160)){if(await pause('Passstiftstellen und verbleibende Wandstärke prüfen …'))break;const n=contact.plane.normal;if(socketRoom(contact.a,p,n.map(v=>-v*contact.outwardA))&&socketRoom(contact.b,p,n.map(v=>v*contact.outwardA)))points.push(p);if(points.length>=64)break;}
  contactPoints.set(contact,points);
  const pairs=[];for(let i=0;i<points.length;i++)for(let j=i+1;j<points.length;j++){const separation=Math.hypot(...sub(points[i],points[j]));if(separation>=Math.max(12,pinDiameter+diametralClearance+2*minWall))pairs.push({positions:[points[i],points[j]],separation});}
  // Use a spread pair to constrain rotation, without driving pins toward edges.
  pairs.sort((a,b)=>b.separation-a.separation);return pairs.slice(0,maxPairsPerContact);
 }

 // Preserve the old search first. This second, bounded candidate bank follows
 // the actual protected polygon contours, including holes and oblique strips.
 // Being inside this 2D region never replaces the complete native envelope or
 // either pin's and the child's continuous insertion proof.
 async function contourPlacements(contact){
  if(await pause('Kontaktkontur für weitere Passstiftstellen prüfen …'))return[];
  const separation=Math.max(12,pinDiameter+diametralClearance+2*minWall);
  const expired=Error('Zeitbudget der Passstift-Kontursuche.');let sampled;
  try{sampled=sampleDowelContactContours(contact.contours,{maxPoints:64,minSeparation:separation,checkpoint:()=>{if(stopped||remaining()<=0){stopped=true;stopReason??='time_budget';throw expired;}}});}
  catch(error){if(error===expired)return[];throw error;}
  contactSampling.fallbackContacts++;if(sampled.diagnostics.truncated)contactSampling.truncatedSamplers++;
  // Failed pair attempts leave both native bodies unchanged. Keep their
  // already checked points and combine them with the additional contour bank.
  const points=[...(contactPoints.get(contact)||[])],oldCount=points.length,n=contact.plane.normal;
  for(const [x,y]of sampled.points){
   if(await pause('Weitere Passstiftstellen entlang der Kontaktkontur prüfen …'))break;
   const p=contact.basis.u.map((v,i)=>v*x+contact.basis.v[i]*y+contact.basis.n[i]*contact.plane.offset);
   if(points.some(q=>q.every((v,i)=>v===p[i])))continue;
   contactSampling.candidatePoints++;
   if(socketRoom(contact.a,p,n.map(v=>-v*contact.outwardA))&&socketRoom(contact.b,p,n.map(v=>v*contact.outwardA))){points.push(p);contactSampling.materialPoints++;}
  }
  contactPoints.set(contact,points);
  const pairs=[];
  for(let i=0;i<points.length;i++)for(let j=i+1;j<points.length;j++){
   if(j<oldCount)continue;
   const distance=Math.hypot(...sub(points[i],points[j]));if(distance>=separation)pairs.push({positions:[points[i],points[j]],separation:distance});
  }
  pairs.sort((a,b)=>b.separation-a.separation);return pairs.slice(0,maxPairsPerContact);
 }
 // Explicit last-resort SEARCH policy. Bore dimensions, wall reserve and all
 // native material/motion gates below remain unchanged. Fewer than 12 mm is
 // less rotational leverage, so this cannot claim mechanical strength.
 async function compactPlacements(contact){
  if(await pause('Kompakte geschützte Passstiftpaare prüfen …'))return[];
  const minimum=Math.max(6,pinDiameter+diametralClearance+2*minWall),preferred=Math.max(12,pinDiameter+diametralClearance+2*minWall),points=contactPoints.get(contact)||[],pairs=[];
  for(let i=0;i<points.length;i++)for(let j=i+1;j<points.length;j++){
   const separation=Math.hypot(...sub(points[i],points[j]));
   if(separation>=minimum&&separation<preferred)pairs.push({positions:[points[i],points[j]],separation});
  }
  pairs.sort((a,b)=>b.separation-a.separation);return pairs.slice(0,maxPairsPerContact);
 }
 async function tryConnection(parent,child,placement){let result;const copies=[];
  try{
   result=call(()=>drillDowelPair(api,parts[parent],parts[child],placement,{pinDiameter,diametralClearance,socketDepth,minWall,...(hardware||{}),retainNative:true,nativeSources:[body(parent),body(child)]}));
   const approach=result.connection.insertion.approachDistance,normal=result.connection.normal,previous=[...built.map(i=>({id:ids[i],solid:i===parent?result.native.parent:body(i)})),...pinSolids],checks=[];
   for(let i=0;i<2;i++){const proof=await verifyLinearInsertion(api,result.native.pins[i],[...previous,...result.native.pins.flatMap((solid,k)=>k===i?[]:[{id:result.pins[k].id,solid}])],normal.map(v=>v*approach),{maxMillis:Math.min(10000,remaining()),maxSweeps:150000,stop,progress});checks.push({id:result.pins[i].id,proof});if(!proof.verified)throw Object.assign(Error(proof.message),{reason:'pin_insertion_'+proof.reason,proof});}
   const proof=await verifyLinearInsertion(api,result.native.child,[...previous,...result.native.pins.map((solid,i)=>({id:result.pins[i].id,solid}))],normal.map(v=>v*approach),{maxMillis:Math.min(20000,remaining()),maxSweeps:200000,parentContact:{obstacleId:ids[parent],normal,offset:dot(normal,result.connection.positions[0])},stop,progress});
   if(!proof.verified)throw Object.assign(Error(proof.message),{reason:'child_insertion_'+proof.reason,proof});
   const next=result.parts.map((part,i)=>{const source=parts[[parent,child][i]],out={...part,printStability:printStability(part)};if(source.printStability?.stableUnderGravity&&!out.printStability.stableUnderGravity)throw Error('Die Bohrungen würden die geprüfte Standfestigkeit verschlechtern.');if(source.supports?.kind==='manual'){out.supports=call(()=>rebuildManualFins(api,out,bed,source.supports));out.supportNotice=out.supports?.warnings?.join(' ');}return out;});
   const printPins=hardware?result.pins:result.pins.map(pin=>{let printed=pin;if(bounds(pin).size.some((s,i)=>s>bed[i]+.005)){const posed=bestOrientation(pin,bed);printed={...pin,...posed,assemblyMatrix:new Matrix4().fromArray(pin.assemblyMatrix).multiply(new Matrix4().fromArray(posed.transform).invert()).toArray()};}const stability=printStability(printed);if(bounds(printed).size.some((s,i)=>s>bed[i]+.005)||!stability.stableUnderGravity)throw Error('Der lose Passstift kann nicht passend und mit Schwerpunkt über der Auflage ausgerichtet werden.');return{...printed,printStability:stability};});
   for(const solid of [result.native.parent,result.native.child,...result.native.pins]){const copy=keep(call(()=>solid.asOriginal()));copies.push(copy);const volume=call(()=>solid.volume());if(call(()=>copy.status())!=='NoError'||Math.abs(call(()=>copy.volume())-volume)>Math.max(1e-7,volume*1e-9))throw Error('Native Passstiftkopie verändert das geprüfte Material.');}
   // Snapshot only after every geometry/path/printing check passed, and before
   // committing any replacement. Failed transport leaves the prior partition.
   next.forEach((part,i)=>{part.nativeGeometry=call(()=>bindNativeGeometry(api,copies[i],part,{contactPlanes:world[[parent,child][i]].planes}));});
   if(!hardware)printPins.forEach((pin,i)=>{pin.nativeGeometry=call(()=>bindNativeGeometry(api,copies[i+2],pin));});
   const connection={...result.connection,insertion:{...result.connection.insertion,checked:true,reason:proof.message,scope:'assembled-parts',method:proof.diagnostics.method,obstacleIds:built.map(i=>ids[i]),collisions:[],sweepDiagnostics:proof.diagnostics,proof},pinInsertion:{checked:true,direction:normal.map(v=>-v),approachDistance:approach,scope:'assembled-parts',checks}};
   drop(native.get(parent));drop(native.get(child));native.set(parent,copies[0]);native.set(child,copies[1]);result.pins.forEach((pin,i)=>pinSolids.push({id:pin.id,solid:copies[i+2]}));copies.length=0;
   parts[parent]=next[0];parts[child]=next[1];pins.push(...printPins);connections.push(connection);priority.committed(parent,child);rejectionCache.committed(parent,child);return true;
  }catch(e){if(fatal(e)){poisoned=true;result?.abandon();throw e;}if(replay)throw Error(`Gespeicherte Verbindung ${placement.id} konnte nicht erneut geprüft werden: ${e.message}`);attempts.push({parentId:ids[parent],childId:ids[child],reason:e.reason||'geometry_error',message:e.message,proof:e.proof?{status:e.proof.status,reason:e.proof.reason,blockedIds:e.proof.blockedIds,volume:e.proof.volume}:undefined});return false;}
  finally{if(!poisoned){copies.forEach(drop);result?.dispose();}}
 }
 let graph,order,preferredOrder;const deferred=[];
 async function attemptChild(child){
  const neighbors=graph.neighbors[child].filter(i=>built.includes(i));let parentFallback,accepted=false,reason='Keine gemeinsame ebene Fläche mit zwei ausreichend geschützten Stiftstellen.';
  if(!stopped){const contactOptions=neighbors.flatMap(parent=>contacts(parent,child)).sort((a,b)=>b.safeArea-a.safeArea).slice(0,4);
   // Run every original contact/raster attempt before spending the remaining
   // budget on extra contour candidates. Existing first-pass successes keep
   // their old placements and assembly order.
   for(const sample of [placements,contourPlacements,...(options.compactPairFallback?[compactPlacements]:[])]){
    for(const contact of contactOptions){const parent=contact.a;parentFallback??=parent;const normal=contact.plane.normal.map(v=>v*contact.outwardA),candidates=await sample(contact);
     for(const candidate of candidates){if(stopped||remaining()<=0){stopped=true;stopReason??='time_budget';break;}accepted=await tryConnection(parent,child,{id:`V-${ids[parent]}-${ids[child]}`,normal,positions:candidate.positions});if(accepted)break;const rejected=attempts.at(-1);if(rejected?.message){parentFallback=parent;reason=rejected.message;}
      if(rejected?.reason?.startsWith('child_insertion_'))break;
     }if(accepted||stopped)break;
    }if(accepted||stopped)break;
   }
  }
  if(stopped)reason='Zeitbudget oder Abbruch der Passstiftplanung.';
  return {child,accepted,parentFallback,reason};
 }
 function appendUnresolved(child,parent,reason){if(parent===undefined)return;const entry={id:`V-${ids[parent]}-${ids[child]}`,parentId:ids[parent],childId:ids[child],status:'unresolved',reason};connections.push(entry);unresolved.push(entry);}
 try{
  await pause('Gemeinsame Schnittflächen und Montagereihenfolge prüfen …');
  if(replay){order=[...replay.order];if(order.length!==parts.length||new Set(order).size!==parts.length||order.some(i=>!Number.isInteger(i)||i<0||i>=parts.length))throw Error('Ungültige gespeicherte Passstiftreihenfolge.');const children=new Set(),connectionIds=new Set();for(const c of replay.connections){if(!['computed','unresolved'].includes(c.status)||!ids.includes(String(c.parentId))||!ids.includes(String(c.childId))||order.indexOf(ids.indexOf(String(c.parentId)))>=order.indexOf(ids.indexOf(String(c.childId)))||children.has(String(c.childId))||typeof c.id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(c.id)||connectionIds.has(c.id))throw Error('Ungültige gespeicherte Passstiftverbindung.');children.add(String(c.childId));connectionIds.add(c.id);}}
  if(replay){
   // Saved order is part of the proven assembly. Revalidate it exactly rather
   // than silently choosing a new route while restoring a project.
   for(const child of order){
    if(await pause(`Passstifte: Teil ${ids[child]} · ${connections.filter(c=>c.status==='computed').length} geprüfte Verbindungen`))throw Error('Erneute Passstiftprüfung wurde angehalten.');
    const saved=replay.connections.find(c=>String(c.childId)===ids[child]);
    if(saved?.status==='computed'){
     if(hardware&&(saved.pin?.source!=='purchased'||saved.pin.length!==hardware.pinLength||saved.pin.endClearance!==hardware.pinEndClearance||saved.pin.diameter!==pinDiameter||saved.hole?.diameter!==pinDiameter+diametralClearance||saved.hole.depthParent!==socketDepth||saved.hole.depthChild!==socketDepth))throw Error('Gespeicherte Kaufstiftverbindung und Maße sind widersprüchlich.');
     const parent=ids.indexOf(String(saved.parentId));if(!built.includes(parent))throw Error('Gespeicherte Passstiftreihenfolge ist widersprüchlich.');await tryConnection(parent,child,{id:saved.id,positions:saved.positions,normal:saved.normal});}
    else if(saved){connections.push({...saved});unresolved.push({...saved});}
    built.push(child);
   }
  }else{
   graph=neighborGraph(parts);preferredOrder=assemblyOrder(parts,{neighbors:graph.neighbors}).order;order=[];const pending=new Set(preferredOrder);
   while(pending.size){
    await pause(`Montagefolge prüfen · ${built.length}/${parts.length} Teile · ${connections.filter(c=>c.status==='computed').length} geprüfte Verbindungen`);
    const frontier=preferredOrder.filter(i=>pending.has(i)&&graph.neighbors[i].some(j=>built.includes(j)));
    if(!frontier.length){const root=preferredOrder.find(i=>pending.has(i));order.push(root);built.push(root);pending.delete(root);continue;}
    let accepted=null;const rejected=[];
    for(const {child,tier} of priority.rank(frontier,graph.neighbors,built)){
     if(stopped||await pause(`Passstifte: Teil ${ids[child]} · ${connections.filter(c=>c.status==='computed').length} geprüfte Verbindungen`))break;
     const beforeAttempts=attempts.length;
     const reused=rejectionCache.reuse(child,graph.neighbors,built,pinSolids);
     const candidate=reused||await attemptChild(child);
     if(!reused&&!candidate.accepted)rejectionCache.remember(child,graph.neighbors,built,pinSolids,candidate,{complete:!stopped&&remaining()>0,attempts:attempts.slice(beforeAttempts)});
     if(candidate.accepted){accepted=child;break;}
     priority.rejected(child,graph.neighbors,built);rejected.push(candidate);deferred.push({childId:ids[child],builtIds:built.map(i=>ids[i]),reason:candidate.reason,priorityTier:tier,...(candidate.rejectionReuse?{rejectionReuse:candidate.rejectionReuse}:{})});
    }
    if(accepted!==null){order.push(accepted);built.push(accepted);pending.delete(accepted);continue;}
    // A failed tentative connection leaves both bodies untouched. Only when
    // this whole frontier has no verified route (or the budget ends) do we
    // retain ONE explicit unresolved assembly step. It remains an obstacle
    // for all later checks, including subsequent components.
    const child=frontier[0],candidate=rejected.find(item=>item.child===child),parent=candidate?.parentFallback??graph.neighbors[child].find(i=>built.includes(i));
    appendUnresolved(child,parent,stopped?'Zeitbudget oder Abbruch der Passstiftplanung.':candidate?.reason||'Keine geprüfte Passstiftverbindung für diesen Montageschritt gefunden.');
    order.push(child);built.push(child);pending.delete(child);
   }
  }
  return{version:1,parts,pins,connections,order,unresolved,completed:unresolved.length===0&&!stopped,stopped,stopReason,settings,attempts,...(!replay?{assemblySearch:{contactSampling,method:'verified-frontier',priority:options.frontierPolicy||'untried-new-neighbor-revised-contact-unchanged',preferredOrder,deferred}}:{}),elapsedMs:performance.now()-started,physicalFitTestRequired:true};
 }catch(e){failure=e;if(fatal(e))poisoned=true;throw e;}
 finally{if(!poisoned){let cleanupError;for(const solid of [...owned].reverse()){try{drop(solid);}catch(e){if(poisoned)throw e;cleanupError??=e;}}if(cleanupError&&!failure)throw cleanupError;}}
}
