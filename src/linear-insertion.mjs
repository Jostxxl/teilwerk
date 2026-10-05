import {sweepDirection,sweepPlaneSide} from './robust-sweep-predicate.mjs';
import {prepareExactSweepObstacle,certifyExactTriangleSweep} from './exact-sweep-separation.mjs';
import {certifyNumericalParentContact} from './numerical-parent-contact.mjs';
const fatal=e=>e?.name==='RuntimeError'||/Aborted|memory access out of bounds|unreachable|RuntimeError/i.test(e?.message||'');
const vector=a=>Array.isArray(a)&&a.length===3&&a.every(Number.isFinite);
const validBox=b=>b&&['min','max'].every(k=>b[k]?.length===3&&Array.from(b[k]).every(Number.isFinite))&&b.min.every((x,i)=>x<=b.max[i]);
const copyBox=b=>({min:Array.from(b.min),max:Array.from(b.max)});
const overlaps=(a,b)=>a.min.every((x,i)=>Math.min(a.max[i],b.max[i])>Math.max(x,b.min[i]));
function unionBox(boxes){const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(const box of boxes)for(let i=0;i<3;i++){min[i]=Math.min(min[i],box.min[i]);max[i]=Math.max(max[i],box.max[i]);}return {min,max};}
function pointsBox(points){const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(const p of points)for(let i=0;i<3;i++){min[i]=Math.min(min[i],p[i]);max[i]=Math.max(max[i],p[i]);}return {min,max};}
const roundingView=new DataView(new ArrayBuffer(8));
function nextUp(value){if(value===Infinity)return value;if(value===0)return Number.MIN_VALUE;roundingView.setFloat64(0,value,false);let bits=roundingView.getBigUint64(0,false);bits+=value>0?1n:-1n;roundingView.setBigUint64(0,bits,false);return roundingView.getFloat64(0,false);}
const outwardBox=box=>({min:box.min.map(x=>-nextUp(-x)),max:box.max.map(nextUp)});
function buildTree(items){if(!items.length)return null;const box=unionBox(items.map(i=>i.box));if(items.length<=4)return {box,items};const spans=box.max.map((x,i)=>x-box.min[i]),axis=spans.indexOf(Math.max(...spans)),ordered=items.slice().sort((a,b)=>(a.box.min[axis]+a.box.max[axis])-(b.box.min[axis]+b.box.max[axis])||a.index-b.index),mid=ordered.length>>1;return {box,left:buildTree(ordered.slice(0,mid)),right:buildTree(ordered.slice(mid))};}
function query(tree,box,out=[]){if(!tree||!overlaps(tree.box,box))return out;if(tree.items){for(const item of tree.items)if(overlaps(item.box,box))out.push(item);}else{query(tree.left,box,out);query(tree.right,box,out);}return out;}
const interruption=(reason,message)=>Object.assign(Error(message),{insertionReason:reason});

/** Continuous material-intersection test for a PURE TRANSLATION from the
 * supplied body pose to that pose + motion. The reverse path occupies exactly
 * the same space. All native input handles share one coordinate frame and are
 * borrowed. Face contact is permitted; positive material overlap is blocked.
 * A caller may identify the freshly drilled parent contact. Only that pair
 * can additionally use the reported, bounded numerical contact resolution,
 * certified from all current native vertices and the actual separating motion.
 * Such a result explicitly does not claim exact zero overlap.
 *
 * The swept solid is covered by the starting solid and the triangular prisms
 * swept by every forward-facing boundary triangle, including cavity walls.
 * We test that union piecewise, without samples or a convex hull of the whole
 * concave body. The BVH contains complete obstacle AABBs, not just their surface
 * triangles, so it cannot miss a sweep fully contained inside an obstacle.
 *
 * Native getMesh positions are Float32. A property-only copy instead records
 * the original DOUBLE positions through setProperties and tags vertex IDs.
 * getMesh then supplies topology and exact integer tags, never rounded XYZ.
 * This proves a collision-free linear path at the kernel's geometric precision;
 * it does not certify load capacity, assembly flexibility or print tolerance. */
export async function verifyLinearInsertion(api,movingSolid,obstacles,motion,{maxMillis=30000,maxSweeps=1000000,maxExactTriangleTests=2000000,maxExactObstacleTriangles=100000,volumeTolerance=0,parentContact=null,stop=()=>false,progress=()=>{}}={}){
 if(!api?.CrossSection?.ofPolygons||!movingSolid?.status||!Array.isArray(obstacles)||!vector(motion)||!Number.isFinite(maxMillis)||maxMillis<0||!Number.isInteger(maxSweeps)||maxSweeps<0||!Number.isInteger(maxExactTriangleTests)||maxExactTriangleTests<0||maxExactTriangleTests>2000000||!Number.isInteger(maxExactObstacleTriangles)||maxExactObstacleTriangles<0||maxExactObstacleTriangles>100000||!Number.isFinite(volumeTolerance)||volumeTolerance<0||typeof stop!=='function'||typeof progress!=='function')throw Error('Ungültige Einstellungen für den linearen Einschubtest.');
 const ids=new Set();for(const obstacle of obstacles){if(!obstacle?.solid?.status||!['number','string'].includes(typeof obstacle.id)||typeof obstacle.id==='number'&&!Number.isFinite(obstacle.id)||ids.has(obstacle.id))throw Error('Einschubhindernisse benötigen eindeutige IDs und native Körper.');ids.add(obstacle.id);}
 if(parentContact!==null&&(!ids.has(parentContact?.obstacleId)||!vector(parentContact?.normal)||!Number.isFinite(parentContact?.offset)))throw Error('Ungültige gemeinsame Kontaktfläche für den Einschubtest.');
 const started=performance.now(),owned=new Set(),checkedIds=new Set(),broadPhaseOnlyIds=[],emptyIds=[],cleanupErrors=[];let poisoned=false,result=null,bounds=null,unitPrism=null;
 const diagnostics={method:'start-and-leading-triangle-sweeps',positionPrecision:'native-float64',prismConstruction:'native-unit-triangle-extrude-warp',leadingPredicate:'filtered-exact-binary64',exactPredicates:0,continuous:true,startIntersections:0,sweepIntersections:0,totalTriangles:0,leadingTriangles:0,sweepsBuilt:0,sweepsSkippedByBounds:0,completedTriangles:0,volumeTolerance,maxMillis,maxSweeps};
 const contactCertified=new Set();let contactCertificate=null,nativeInitialContactVolume=0;
 const exactObstacles=new Map(),exactBudget={limit:maxExactTriangleTests,used:0};Object.assign(diagnostics,{exactFallbackMethod:'dyadic-prism-sat-and-signed-ray-winding',exactFallbacks:0,exactFallbacksVerified:0,exactObstacleMeshes:0,maxExactTriangleTests,maxExactObstacleTriangles});
 const call=fn=>{try{return fn();}catch(error){if(fatal(error))poisoned=true;throw error;}};
 const own=solid=>{owned.add(solid);return solid;};
 const release=solid=>{if(!solid||poisoned||!owned.delete(solid))return;call(()=>solid.delete());};
 const deadline=()=>{if(performance.now()-started>=maxMillis)throw interruption('time_limit','Zeitbudget für den durchgehenden Einschubtest erreicht.');};
 async function pause(message){deadline();if(await stop())throw interruption('stopped','Einschubtest angehalten.');if(message)await progress(message);await new Promise(resolve=>setTimeout(resolve,0));deadline();}
 let lastExactYield=performance.now(),exactProgressShown=false;
 async function exactCheckpoint(){deadline();if(performance.now()-lastExactYield>=16){await pause();lastExactYield=performance.now();}}
 const checkStatus=solid=>{const status=call(()=>solid.status());if(status!=='NoError')throw Error(`Ungültiger nativer Körper (${status}).`);};
 function inspect(solid,allowEmpty=false){checkStatus(solid);const volume=call(()=>solid.volume());if(!Number.isFinite(volume)||volume<0||!allowEmpty&&volume===0)throw Error('Einschubtest benötigt ein positives Materialvolumen.');if(volume===0)return {solid,volume,box:null};const box=call(()=>solid.boundingBox());if(!validBox(box))throw Error('Ungültige native Körpergrenzen.');return {solid,volume,box:copyBox(box)};}
 function exactMesh(solid){const positions=[];let invalid=false,tagged;
  try{tagged=own(call(()=>solid.setProperties(1,(properties,point)=>{if(!vector(point))invalid=true;properties[0]=positions.length;positions.push(Array.from(point));})));checkStatus(tagged);const mesh=call(()=>tagged.getMesh()),vertices=[];if(invalid||mesh.numProp!==4||mesh.triVerts.length%3)throw Error('Native Prismenpositionen konnten nicht verlustfrei gelesen werden.');for(let i=0;i<mesh.vertProperties.length;i+=4){const id=mesh.vertProperties[i+3];if(!Number.isInteger(id)||!positions[id])throw Error('Ungültiger nativer Prismenvertex.');vertices.push(positions[id]);}return {vertices,triangles:mesh.triVerts};}finally{release(tagged);}
 }
 function prismFor(points,expectedVolume){
  // Tiny positive motions can round all six corners onto one plane. They are
  // not safe to skip: the requested mathematical sweep is still three-D.
  if(sweepPlaneSide(points[0],points[1],points[2],points[3]).sign<=0||!Number.isFinite(expectedVolume)||expectedVolume<=0)throw interruption('unresolved_prism','Eine vorauseilende Fläche lässt sich nicht als positives dreidimensionales Prisma auflösen.');
  if(!unitPrism){let section;try{section=own(call(()=>api.CrossSection.ofPolygons([[[0,0],[1,0],[0,1]]])));unitPrism=own(call(()=>section.extrude(1)));checkStatus(unitPrism);}finally{release(section);}}
  let invalidTemplate=false,prism,completed=false;try{prism=own(call(()=>unitPrism.warp(p=>{if(![0,1].includes(p[0])||![0,1].includes(p[1])||![0,1].includes(p[2])||p[0]+p[1]>1){invalidTemplate=true;return;}const index=(p[0]===1?1:p[1]===1?2:0)+(p[2]===1?3:0);for(let k=0;k<3;k++)p[k]=points[index][k];})));checkStatus(prism);
  if(invalidTemplate)throw Error('Ungültige native Dreiecksprismen-Vorlage.');const volume=call(()=>prism.volume()),box=call(()=>prism.boundingBox()),expectedBox=pointsBox(points);
  if(!Number.isFinite(volume)||volume<=0||Math.abs(volume-expectedVolume)>expectedVolume*1e-7)throw interruption('unresolved_prism','Das native Prisma besitzt kein verlässlich aufgelöstes positives Sweep-Volumen.');
  if(!validBox(box)||['min','max'].some(key=>box[key].some((x,i)=>x!==expectedBox[key][i])))throw interruption('unresolved_prism','Die native Kollisionshülle verändert die erwarteten Prismenbegrenzungen.');
  const mesh=exactMesh(prism),matches=mesh.vertices.map(p=>points.findIndex(q=>q.every((x,k)=>x===p[k])));
  if(mesh.triangles.length!==24||matches.includes(-1)||points.some(p=>!mesh.vertices.some(q=>q.every((x,k)=>x===p[k]))))throw interruption('unresolved_prism','Die native Kollisionshülle enthält fremde oder fehlende Eckpunkte.');
  // Rounded quadrilaterals can be slightly nonplanar. The fixed template must
  // still enclose the convex sweep; a wrong diagonal may not omit any corner.
  for(let f=0;f<mesh.triangles.length;f+=3){const tri=Array.from(mesh.triangles.slice(f,f+3),i=>mesh.vertices[i]);for(const p of points)if(sweepPlaneSide(...tri,p).sign>0)throw interruption('unresolved_prism','Die gerundete Kollisionshülle schließt nicht alle Prismenpunkte konvex ein.');}
  completed=true;return prism;}finally{if(!completed)release(prism);}
 }
 async function exactPrismClear(triangle,candidates){
  diagnostics.exactFallbacks++;
  for(const obstacle of candidates){
   if(!exactProgressShown){await pause('Sehr flachen Einschubbereich mit exakten geometrischen Prädikaten prüfen …');lastExactYield=performance.now();exactProgressShown=true;}else await exactCheckpoint();checkedIds.add(obstacle.id);
   let prepared=exactObstacles.get(obstacle.solid);
   if(!prepared){
    if(call(()=>obstacle.solid.numTri())>maxExactObstacleTriangles){diagnostics.exactFallbackReason='obstacle_limit';return false;}
    prepared=await prepareExactSweepObstacle(exactMesh(obstacle.solid),{maxTriangles:maxExactObstacleTriangles,checkpoint:exactCheckpoint});exactObstacles.set(obstacle.solid,prepared);diagnostics.exactObstacleMeshes++;
   }
   if(!prepared.valid){diagnostics.exactFallbackReason=prepared.reason;return false;}
   const certificate=await certifyExactTriangleSweep(triangle,motion,prepared.handle,{budget:exactBudget,checkpoint:exactCheckpoint});diagnostics.exactFallbackReason=certificate.reason;
   if(!certificate.verified)return false;
  }
  diagnostics.exactFallbacksVerified++;return true;
 }
 function intersection(body,obstacle,phase,triangle=null){deadline();checkedIds.add(obstacle.id);diagnostics[phase==='start'?'startIntersections':'sweepIntersections']++;let common;
  try{common=own(call(()=>body.intersect(obstacle.solid)));checkStatus(common);const volume=call(()=>common.volume());if(!Number.isFinite(volume)||volume<0)throw Error('Ungültiges Kollisionsvolumen.');if(phase==='start'&&obstacle.id===parentContact?.obstacleId)nativeInitialContactVolume=volume;deadline();if(volume>volumeTolerance)return {status:'blocked',reason:phase==='start'?'initial_overlap':'swept_overlap',message:phase==='start'?'Bereits die Ausgangsposition überschneidet vorhandenes Material.':'Der gerade Einschubweg überschneidet vorhandenes Material.',volume,blockedIds:[obstacle.id],collision:{obstacleId:obstacle.id,phase,triangle,volume}};return null;}finally{release(common);}
 }
 try{
  await pause('Geraden Einschubweg und vorhandene Bauteile prüfen …');const moving=inspect(movingSolid),end={min:moving.box.min.map((x,i)=>x+motion[i]),max:moving.box.max.map((x,i)=>x+motion[i])};if(!validBox(end))throw Error('Der Einsteckweg überschreitet den darstellbaren Koordinatenbereich.');bounds={start:copyBox(moving.box),end,swept:unionBox([moving.box,end])};const relevant=[],conservativeSwept=unionBox([moving.box,outwardBox(end)]);
  for(let index=0;index<obstacles.length;index++){deadline();const input=obstacles[index],obstacle={...inspect(input.solid,true),id:input.id,index};if(!obstacle.volume){emptyIds.push(input.id);continue;}if(overlaps(conservativeSwept,obstacle.box))relevant.push(obstacle);else broadPhaseOnlyIds.push(input.id);}
  const tree=buildTree(relevant);
  for(const obstacle of query(tree,moving.box).sort((a,b)=>a.index-b.index)){
   await pause();const collision=intersection(movingSolid,obstacle,'start');
   if(obstacle.id===parentContact?.obstacleId&&call(()=>movingSolid.numTri())<=maxExactObstacleTriangles&&call(()=>obstacle.solid.numTri())<=maxExactObstacleTriangles){
    // Only this freshly drilled parent may use the bounded face-contact
    // resolution. All current vertices and the entire actual motion are
    // checked; neither an ID nor stored cut metadata authorizes an exception.
    const certificate=await certifyNumericalParentContact(exactMesh(movingSolid),exactMesh(obstacle.solid),motion,parentContact,{checkpoint:exactCheckpoint});
    diagnostics.parentContactCheck={...certificate,obstacleId:obstacle.id,nativeInitialContactVolume};
    if(certificate.verified){contactCertified.add(obstacle.id);contactCertificate={...certificate,obstacleId:obstacle.id,nativeInitialContactVolume};}
   }
   if(collision&&!contactCertified.has(obstacle.id)){result=collision;break;}
  }
  if(!result&&relevant.length&&motion.some(x=>x!==0)){
   deadline();const positions=[];let invalidPosition=false,tooManyPositions=false;
   const tagged=own(call(()=>movingSolid.setProperties(1,(properties,position)=>{const id=positions.length;if(id>=16777216)tooManyPositions=true;if(!vector(position))invalidPosition=true;positions.push(Array.from(position));properties[0]=id;})));
   checkStatus(tagged);const mesh=call(()=>tagged.getMesh());deadline();
   if(invalidPosition||tooManyPositions||mesh.numProp!==4||mesh.triVerts.length%3)throw Error('Native Dreieckspositionen konnten nicht verlustfrei zugeordnet werden.');
   const vertices=[];for(let i=0;i<mesh.vertProperties.length;i+=mesh.numProp){const id=mesh.vertProperties[i+3];if(!Number.isInteger(id)||id<0||id>=positions.length)throw Error('Ungültiger nativer Vertex-Verweis im Einschubtest.');vertices.push(positions[id]);}
   diagnostics.totalTriangles=mesh.triVerts.length/3;
   for(let f=0;f<diagnostics.totalTriangles;f++){
    if(!(f%128))await pause(`Einschubweg prüfen: ${f}/${diagnostics.totalTriangles} Flächen · ${diagnostics.sweepsBuilt} durchgehende Hüllen`);else deadline();
    const a=vertices[mesh.triVerts[f*3]],b=vertices[mesh.triVerts[f*3+1]],c=vertices[mesh.triVerts[f*3+2]];if(!a||!b||!c)throw Error('Ungültige native Dreieckstopologie.');const advance=sweepDirection(a,b,c,motion);if(advance.exact)diagnostics.exactPredicates++;
    if(advance.sign>0){diagnostics.leadingTriangles++;const points=[a,b,c,...[a,b,c].map(p=>p.map((x,i)=>x+motion[i]))],box=outwardBox(pointsBox(points)),candidates=query(tree,box).filter(obstacle=>!contactCertified.has(obstacle.id)).sort((a,b)=>a.index-b.index);
     if(!candidates.length)diagnostics.sweepsSkippedByBounds++;
     else{if(diagnostics.sweepsBuilt>=maxSweeps)throw interruption('sweep_limit','Höchstzahl durchgehender Kollisionshüllen erreicht.');let prism;
      try{
       try{prism=prismFor(points,advance.value/2);diagnostics.sweepsBuilt++;}
       catch(error){if(poisoned||error.insertionReason!=='unresolved_prism')throw error;if(!await exactPrismClear([a,b,c],candidates))throw error;}
       if(prism)for(const obstacle of candidates){const collision=intersection(prism,obstacle,'sweep',f);if(collision){result=collision;break;}}
      }finally{release(prism);}
     }
    }
    diagnostics.completedTriangles=f+1;if(result)break;
   }
   release(tagged);
  }
  if(!result){deadline();const numerical=contactCertificate?.exactZeroOverlap===false;result={status:'verified',reason:numerical?'continuous_path_with_numerical_contact':'continuous_path_clear',message:numerical?'Der gesamte gerade Weg ist geprüft; die gemeinsame Schnittfläche liegt innerhalb der begrenzten numerischen Kontaktauflösung.':'Der gesamte gerade Weg ist auf Materialüberschneidungen geprüft.',volume:numerical?nativeInitialContactVolume:0,blockedIds:[],...(contactCertificate?{parentContact:contactCertificate,contactResolutionApplied:numerical,exactZeroOverlap:!numerical}:{} )};}
 }catch(error){if(poisoned||fatal(error)){poisoned=true;throw error;}result={status:'unverified',reason:error.insertionReason||'geometry_error',message:error.message||String(error),volume:null,blockedIds:[]};}
 finally{if(!poisoned)for(const solid of [...owned]){try{release(solid);}catch(error){if(poisoned||fatal(error)){poisoned=true;throw error;}cleanupErrors.push(error.message||String(error));}}}
 if(cleanupErrors.length)result={status:'unverified',reason:'cleanup_error',message:cleanupErrors.join(' '),volume:null,blockedIds:[]};
 return {...result,verified:result.status==='verified',motion:[...motion],bounds,obstacleIds:obstacles.map(o=>o.id),checkedObstacleIds:[...checkedIds],broadPhaseOnlyIds,emptyObstacleIds:emptyIds,diagnostics:{...diagnostics,exactTriangleTests:exactBudget.used,elapsedMs:performance.now()-started,completed:result.status==='verified',cleanupErrors}};
}
