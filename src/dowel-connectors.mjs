import {purchasedPinSettings} from './connector-project.mjs';
import {Matrix3,Matrix4,Vector3} from 'three';
import {toSolid,fromSolid,bounds} from './engine.mjs';
import {overhangMetrics} from './overhang-metrics.mjs';
import {supportBedContact} from './support-orientation.mjs';

const fatal=error=>error?.name==='RuntimeError'||/Aborted|memory access out of bounds|unreachable|RuntimeError/i.test(error?.message||'');
const vector=value=>Array.isArray(value)&&value.length===3&&value.every(Number.isFinite);
function reject(reason,message,details){return Object.assign(Error(message),{code:'CONNECTOR_REJECTED',reason,details});}
function rigid(part){
 const values=part.assemblyMatrix||new Matrix4().toArray();if(!Array.isArray(values)||values.length!==16||!values.every(Number.isFinite))throw reject('invalid_frame','Ungültige Montagelage für Passstifte.');
 const matrix=new Matrix4().fromArray(values),axes=[0,1,2].map(i=>new Vector3().setFromMatrixColumn(matrix,i));
 if(axes.some(a=>Math.abs(a.length()-1)>1e-5)||Math.abs(axes[0].dot(axes[1]))>1e-5||Math.abs(axes[0].dot(axes[2]))>1e-5||Math.abs(axes[1].dot(axes[2]))>1e-5||Math.abs(matrix.determinant()-1)>1e-5||[values[3],values[7],values[11],values[15]-1].some(x=>Math.abs(x)>1e-8))throw reject('invalid_frame','Passstifte benötigen eine starre Montagelage ohne Skalierung.');
 return matrix;
}

/** Compute two matched blind sockets and separate loose pins. Input meshes and
 * annotations are immutable. This certifies socket material, not assembly motion:
 * insertion.checked stays false until a separate continuous path check succeeds.
 * With retainNative, the caller owns result.native through result.dispose();
 * after a downstream fatal WASM failure call abandon() instead of dispose().
 * Optional nativeSources are borrowed current bodies in assembly coordinates;
 * they avoid mesh roundtrips between successive connections on the same part. */
export function drillDowelPair(api,parent,child,placement,options={}){
 const hardware=purchasedPinSettings(options);
 const {pinDiameter=3,diametralClearance=hardware ? .3 : .2,socketDepth=3,minWall=1,pinEndClearance=.1,retainNative=false,nativeSources=null}={...options,...hardware};
 if(!api?.Manifold||!parent?.id||!child?.id||String(parent.id)===String(child.id))throw reject('invalid_parts','Zwei unterschiedliche, nummerierte Teile für die Passstifte wählen.');
 if(![pinDiameter,diametralClearance,socketDepth,minWall,pinEndClearance].every(Number.isFinite)||pinDiameter<=0||diametralClearance<0||socketDepth<=0||minWall<1||pinEndClearance<0||pinEndClearance>=socketDepth)throw reject('invalid_settings','Ungültige Passstiftmaße; mindestens 1 mm Materialreserve erforderlich.');
 if(!placement||!vector(placement.normal)||Math.hypot(...placement.normal)<1e-8||!Array.isArray(placement.positions)||placement.positions.length!==2||!placement.positions.every(vector))throw reject('invalid_positions','Genau zwei gültige Bohrungsstellen und eine gemeinsame Einsteckachse wählen.');
 if(nativeSources!==null&&(!Array.isArray(nativeSources)||nativeSources.length!==2||nativeSources.some(s=>!s||typeof s.translate!=='function')))throw reject('invalid_parts','Zwei aktuelle native Körper in Montagelage werden benötigt.');
 const normal=new Vector3(...placement.normal).normalize(),positions=placement.positions.map(p=>new Vector3(...p)),holeDiameter=pinDiameter+diametralClearance,holeRadius=holeDiameter/2,pinLength=hardware?hardware.pinLength:2*(socketDepth-pinEndClearance),id=String(placement.id||`V-${parent.id}-${child.id}`),matrices=[rigid(parent),rigid(child)],entryOvercut=.05,entryPlaneTolerance=.0001;
 if(Math.abs(positions[1].clone().sub(positions[0]).dot(normal))>1e-5)throw reject('different_planes','Beide Bohrungsstellen müssen auf derselben gemeinsamen Schnittfläche liegen.');
 if(positions[0].distanceTo(positions[1])<holeDiameter+2*minWall)throw reject('holes_too_close','Die Passstifte liegen zu dicht beieinander für die Materialreserve.');
 const owned=new Set();let poisoned=false,failure;
 const call=fn=>{try{return fn();}catch(error){if(fatal(error))poisoned=true;throw error;}};
 const keep=value=>{owned.add(value);return value;};
 const drop=value=>{if(!value||!owned.delete(value)||poisoned)return;call(()=>value.delete());};
 const cleanup=()=>{if(poisoned)return;let ordinary;for(const solid of [...owned].reverse()){try{drop(solid);}catch(error){if(poisoned)throw error;ordinary??=error;}}if(ordinary&&!failure)throw ordinary;};
 const cylinder=(point,direction,radius,height,start=0)=>{
  const n=direction.clone(),u=new Vector3().crossVectors(Math.abs(n.z)<.9?new Vector3(0,0,1):new Vector3(0,1,0),n).normalize(),v=n.clone().cross(u),origin=point.clone().addScaledVector(n,start),matrix=new Matrix4().makeBasis(u,v,n).setPosition(origin),raw=keep(call(()=>api.Manifold.cylinder(height,radius,radius,64))),out=keep(call(()=>raw.transform(matrix.toArray())));drop(raw);return out;
 };
 try{
  const sources=[parent,child],world=sources.map((part,i)=>{if(nativeSources)return keep(call(()=>nativeSources[i].translate([0,0,0])));const local=keep(call(()=>toSolid(api,part))),out=keep(call(()=>local.transform(matrices[i].toArray())));drop(local);return out;}),directions=[normal.clone().negate(),normal.clone()],sourceVolumes=world.map(s=>call(()=>s.volume())),drilled=[],validation={sourceVolumes,envelopeOutsideVolumes:[],socketOutsideVolumes:[],removedVolumes:[],resultVolumes:[],positiveComponents:[],minimumWall:minWall,method:'native-complete-socket-and-material-envelope',entryOvercut,entryPlaneTolerance};
  const atMouthOnly=(outside,missing,point,direction)=>{
   if(!Number.isFinite(missing)||missing< -1e-7)return false;if(missing<=1e-7)return true;
   const u=new Vector3().crossVectors(Math.abs(direction.z)<.9?new Vector3(0,0,1):new Vector3(0,1,0),direction).normalize(),v=direction.clone().cross(u),frame=new Matrix4().makeBasis(u,v,direction).setPosition(point).invert(),local=keep(call(()=>outside.transform(frame.toArray()))),deepest=call(()=>local.boundingBox()).max[2];drop(local);
   return deepest<=entryPlaneTolerance;
  };
  // Float32 print-mesh roundtrips can shift the joint's entry face by microns.
  // Any missing material must be confined to this explicit microscopic mouth
  // slab; a side-wall or blind-bottom breach is never excused by volume alone.
  for(let side=0;side<2;side++)for(const point of positions){
   const envelope=cylinder(point,directions[side],(holeRadius+minWall)/Math.cos(Math.PI/64),socketDepth+minWall),outside=keep(call(()=>envelope.subtract(world[side]))),missing=call(()=>outside.volume()),envelopeFits=atMouthOnly(outside,missing,point,directions[side]);
   validation.envelopeOutsideVolumes.push(missing);drop(outside);drop(envelope);
   if(!envelopeFits)throw reject('insufficient_material','Die Bohrung einschließlich Materialreserve liegt nicht vollständig im Teil.',{partId:sources[side].id,outsideVolume:missing});
   const socket=cylinder(point,directions[side],holeRadius,socketDepth),socketOutside=keep(call(()=>socket.subtract(world[side]))),socketMissing=call(()=>socketOutside.volume()),socketFits=atMouthOnly(socketOutside,socketMissing,point,directions[side]);validation.socketOutsideVolumes.push(socketMissing);drop(socketOutside);drop(socket);
   if(!socketFits)throw reject('insufficient_material','Die vollständige Bohrung liegt nicht im Material.',{partId:sources[side].id,outsideVolume:socketMissing});
  }
  for(let side=0;side<2;side++){
   let current=keep(call(()=>world[side].translate([0,0,0])));
   for(const point of positions){const tool=cylinder(point,directions[side],holeRadius,socketDepth+entryOvercut,-entryOvercut),next=keep(call(()=>current.subtract(tool)));drop(tool);drop(current);current=next;}
   if(call(()=>current.status())!=='NoError')throw reject('invalid_result','Die Bohrungen ergeben keinen gültigen geschlossenen Körper.');
   const components=call(()=>current.decompose());components.forEach(keep);const positive=components.filter(s=>call(()=>s.volume())>0).length;components.forEach(drop);if(positive!==1)throw reject('disconnected_result','Die Bohrungen würden das Teil in getrennte Körper zerlegen.');
   const volume=call(()=>current.volume()),removed=sourceVolumes[side]-volume,expected=2*32*holeRadius**2*Math.sin(Math.PI/32)*socketDepth;
   if(!Number.isFinite(removed)||Math.abs(removed-expected)>Math.max(1e-6,expected*entryPlaneTolerance/socketDepth))throw reject('unexpected_removed_material','Die Bohrung entfernt nicht genau das geprüfte Bohrungsvolumen.',{partId:sources[side].id,removed,expected});
   validation.positiveComponents.push(positive);validation.removedVolumes.push(removed);validation.resultVolumes.push(volume);drilled.push(current);
  }
  const output=drilled.map((solid,side)=>{
   const nativeLocal=keep(call(()=>solid.transform(matrices[side].clone().invert().toArray()))),data=call(()=>fromSolid(nativeLocal));drop(nativeLocal);
   const out={...sources[side],...data,supports:undefined,supportNotice:undefined,connectorHoles:[...(sources[side].connectorHoles||[]),{connectionId:id,otherPartId:sources[1-side].id,positions:positions.map(p=>p.clone().applyMatrix4(matrices[side].clone().invert()).toArray()),inward:directions[side].clone().applyMatrix3(new Matrix3().getNormalMatrix(matrices[side].clone().invert())).normalize().toArray(),diameter:holeDiameter,depth:socketDepth}],overhang:overhangMetrics(data)};
   out.bedContactArea=supportBedContact(out,{requireCut:false});out.requiresCutFace=out.bedContactArea<1;out.bedFace=supportBedContact(out,{requireCut:true})>=1?'cut':'surface';
   if(out.supportOrientation)out.supportOrientation={...out.supportOrientation,bedArea:out.bedContactArea,severeArea:out.overhang.severeArea,supportArea:out.overhang.supportArea,height:bounds(out).size[2]};
   return out;
  });
  // Purchased pins retain actual solid cylinders for all interference/path checks,
  // but never acquire printable geometry or a native mesh binding in the project.
  let pinData={};
  if(!hardware){const pinLocal=keep(call(()=>api.Manifold.cylinder(pinLength,pinDiameter/2,pinDiameter/2,64)));pinData=call(()=>fromSolid(pinLocal));drop(pinLocal);}
  // A purchased round cylinder must fit inside the proof envelope. A native
  // polygon inscribed in its nominal circle would miss material between facets.
  const pinProofRadius=hardware?(pinDiameter/2)/Math.cos(Math.PI/64):pinDiameter/2;
  if(hardware)validation.pinEnvelope={type:'circumscribed-cylinder',segments:64,nominalDiameter:pinDiameter,radius:pinProofRadius,length:pinLength};
  const pinWorld=positions.map(point=>cylinder(point,normal,pinProofRadius,pinLength,-pinLength/2)),pins=pinWorld.map((solid,i)=>{
   const u=new Vector3().crossVectors(Math.abs(normal.z)<.9?new Vector3(0,0,1):new Vector3(0,1,0),normal).normalize(),v=normal.clone().cross(u),assembly=new Matrix4().makeBasis(u,v,normal).setPosition(positions[i].clone().addScaledVector(normal,-pinLength/2));return{...pinData,id:`${id}-P${i+1}`,name:`Passstift ${id}/${i+1}`,auxiliary:true,connectionId:id,assemblyMatrix:assembly.toArray(),diameter:pinDiameter,length:pinLength,...(hardware?{source:'purchased',standard:'DIN 6325',endClearance:pinEndClearance}: {})};
  });
  // Loose pins are separate objects (printed or purchased), never additions to a roof.
  const pinIntersections=[];for(const pin of pinWorld)for(const solid of drilled){const overlap=keep(call(()=>pin.intersect(solid))),volume=call(()=>overlap.volume());pinIntersections.push(volume);drop(overlap);if(!Number.isFinite(volume)||Math.abs(volume)>1e-7)throw reject('pin_interference','Der lose Stift kollidiert mit dem gebohrten Teil.');}
  validation.pinIntersections=pinIntersections;
  const result={parts:output,pins,connection:{id,parentId:String(parent.id),childId:String(child.id),status:'computed',positions:positions.map(p=>p.toArray()),normal:normal.toArray(),pin:{diameter:pinDiameter,length:pinLength,quantity:2,endClearance:pinEndClearance,...(hardware?{source:'purchased',standard:'DIN 6325'}:{})},hole:{diameter:holeDiameter,depthParent:socketDepth,depthChild:socketDepth,wallMargin:minWall},insertion:{direction:normal.clone().negate().toArray(),approachDistance:Math.max(6,2*socketDepth),checked:false,scope:'pair',obstacleIds:[String(parent.id)],reason:'Der vollständige Einschubweg wurde noch nicht geprüft.'},validation,physicalFitTestRequired:true}};
  if(retainNative){for(const solid of [...owned])if(!drilled.includes(solid)&&!pinWorld.includes(solid))drop(solid);result.native={parent:drilled[0],child:drilled[1],pins:pinWorld};result.dispose=cleanup;result.abandon=()=>{poisoned=true;owned.clear();};return result;}
  cleanup();return result;
 }catch(error){failure=error;cleanup();throw error;}
}
