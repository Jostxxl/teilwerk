import {exactSourceFromPart} from './exact-source-part.mjs';
import {createBalancedExactGridPlan} from './exact-grid-plan.mjs';
import {exactAuthorityDisplaySource,exactRationalToNumber,parseExactRational} from './exact-geometry.mjs';
import {throughSurfacePlan} from './through-plan.mjs';

// These are display work limits, not restrictions on the captured operands or
// the subsequent exact job. A limited preview always retains the whole source.
export const EXACT_MODEL_PREVIEW_LIMITS=Object.freeze({sourceFaces:200_000,cells:256,triangleCellVisits:1_000_000,estimatedFragments:2_000_000,outputFaces:2_000_000,durationMs:8_000});
const identity=Object.freeze([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
const preparedValues=new WeakSet();
const fail=reason=>Object.assign(new Error(`Exakte Modellvorschau ungültig: ${reason}.`),{code:'EXACT_MODEL_PREVIEW_REJECTED',reason});
const number=text=>exactRationalToNumber(parseExactRational(text)).number;
function freeze(value){if(value&&typeof value==='object'&&!ArrayBuffer.isView(value)&&!Object.isFrozen(value)){for(const v of Object.values(value))freeze(v);Object.freeze(value);}return value;}
function displayPart(data,id,cell=null){return {...data,id,assemblyMatrix:[...identity],frame:'assembly',openPreview:true,displayOnly:true,exactReviewOnly:true,gridCell:cell,printable:false,perBodyPrintOrientationPending:true};}

function cells(plan,axes){
 const proposals=[];
 // X is the fast axis, exactly as in the native grid owner classifier.
 for(let z=0;z<=plan.counts[2];z++)for(let y=0;y<=plan.counts[1];y++)for(let x=0;x<=plan.counts[0];x++){
  const [x0,x1]=axes[0].slice(x,x+2),[y0,y1]=axes[1].slice(y,y+2),[z0,z1]=axes[2].slice(z,z+2);
  proposals.push({faces:[],cell:[x,y,z],cutDefinition:{u:[1,0,0],v:[0,1,0],n:[0,0,1],min:z0,max:z1,contours:[[[x0,y0],[x1,y0],[x1,y1],[x0,y1]]]}});
 }
 return proposals;
}

function triangleArea(data,f){
 const {vertices:v,triangles:t}=data,a=t[f]*3,b=t[f+1]*3,c=t[f+2]*3;
 const x=v[b]-v[a],y=v[b+1]-v[a+1],z=v[b+2]-v[a+2],u=v[c]-v[a],w=v[c+1]-v[a+1],q=v[c+2]-v[a+2];
 return Math.hypot(y*q-z*w,z*u-x*q,x*w-y*u)/2;
}
function surfaceArea(data){let sum=0,error=0;for(let f=0;f<data.triangles.length;f+=3){const n=triangleArea(data,f)-error,next=sum+n;error=(next-sum)-n;sum=next;}return sum;}

function precisionReason(data,axes){
 if(data.rounding.distinctExactPointsCollapsed||data.rounding.nonzeroCoordinatesRoundedToZero)return 'display_coordinate_precision';
 // throughSurfacePlan emits Float32 display meshes. Do not manufacture a
 // seemingly complete exploded view when adjacent grid edges collapse there.
 if(axes.some(axis=>axis.some((x,i)=>!Number.isFinite(Math.fround(x))||i&&Math.fround(x)<=Math.fround(axis[i-1]))))return 'display_grid_precision';
 return null;
}
function preflight(data,plan,axes){
 const limit=EXACT_MODEL_PREVIEW_LIMITS;
 if(plan.sourceFaceCount>limit.sourceFaces)return 'source_face_limit';
 if(plan.ownerCount>limit.cells)return 'cell_limit';
 const precision=precisionReason(data,axes);if(precision)return precision;
 let visits=0,fragments=0;
 const {vertices:v,triangles:t}=data;
 for(let f=0;f<t.length;f+=3){
  let crossed=0,cellVisits=1;
  for(let axis=0;axis<3;axis++){
   const a=v[t[f]*3+axis],b=v[t[f+1]*3+axis],c=v[t[f+2]*3+axis],lo=Math.min(a,b,c),hi=Math.max(a,b,c);
   let count=0,touched=0;
   for(let j=1;j<axes[axis].length-1;j++){const cut=axes[axis][j];if(cut>lo&&cut<hi)count++;if(cut>=lo-.001&&cut<=hi+.001)touched++;}
   crossed+=count;cellVisits*=Math.min(axes[axis].length-1,touched+1);
  }
  visits+=cellVisits;fragments+=8*(crossed+1)*(crossed+1);
  if(visits>limit.triangleCellVisits)return 'triangle_cell_limit';
  if(fragments>limit.estimatedFragments)return 'fragment_limit';
 }
 return null;
}

/** Capture the actually selected part and prepare only its open numeric view.
 * No Manifold/CSG job, cap generation, permission transfer or print pose occurs.
 * The capture's authority is already absolute assembly geometry; its original
 * assemblyMatrix is retained for the local permission capsule, never reapplied.
 */
export function prepareExactModelPreview({part,usableBed}={}){
 const capture=exactSourceFromPart(part),plan=createBalancedExactGridPlan(capture.meshText,usableBed);
 const source=exactAuthorityDisplaySource(capture.geometry),axes=plan.cuts.map((cuts,i)=>[plan.bounds[0][i],...cuts,plan.bounds[1][i]].map(number));
 const cutPlanes=plan.cuts.flatMap((cuts,axis)=>cuts.map((coordinate,index)=>({normal:[0,1,2].map(i=>i===axis?1:0),offset:number(coordinate),axis,index,coordinate,frame:'assembly',displayOnly:true})));
 let reason=null,parts,numericAreaRelativeError=null;
 if(plan.ownerCount===1){
  parts=[displayPart({vertices:source.vertices,triangles:source.triangles},'grid-0',[0,0,0])];
  reason=precisionReason(source,axes);
 }else{
  reason=preflight(source,plan,axes);
  if(!reason){
   const proposals=cells(plan,axes),deadline=Date.now()+EXACT_MODEL_PREVIEW_LIMITS.durationMs;
   try{
    const clipped=throughSurfacePlan(source,proposals,()=>{if(Date.now()>=deadline)throw fail('display_time_limit');});
    if(Date.now()>=deadline)reason='display_time_limit';
    else if(clipped.some(p=>p.unassigned))reason='unassigned_display_surface';
    else if(clipped.reduce((n,p)=>n+p.triangles.length/3,0)>EXACT_MODEL_PREVIEW_LIMITS.outputFaces)reason='output_face_limit';
    else{
     const before=surfaceArea(source),after=clipped.reduce((n,p)=>n+surfaceArea(p),0);
     numericAreaRelativeError=Math.abs(after-before)/Math.max(Number.MIN_VALUE,before);
     // A numerical display diagnostic, deliberately not a material proof.
     if(!clipped.length||!Number.isFinite(numericAreaRelativeError)||numericAreaRelativeError>1e-6)reason='display_surface_discrepancy';
     else parts=clipped.map(p=>displayPart(p,`grid-${p.proposal}`,proposals[p.proposal].cell));
    }
   }catch(error){reason=error?.reason==='display_time_limit'?'display_time_limit':'display_clipping_failed';}
  }
 }
 if(!parts)parts=[displayPart({vertices:source.vertices,triangles:source.triangles},'whole-source')];
 const limited=reason!==null,mode=limited?'whole-source-with-planes':plan.ownerCount===1?'whole-source':'open-grid-surfaces';
 const display=freeze({parts,cutPlanes,open:true,limited,reason,mode,frame:'assembly',displayOnly:true,completeSourceShown:mode!=='open-grid-surfaces',surfacePartitionShown:mode==='open-grid-surfaces',newCapFaces:0,materialConservationProven:false,numericAreaRelativeError,rounding:{...source.rounding},perBodyPrintOrientationPending:true,reviewRequired:true,printable:false});
 const descriptor=freeze({schema:'prinjekt-exact-model-preview-v1',sourceRevision:capture.sourceRevision,planHash:plan.planHash,sourceMeshHash:capture.meshHash,sourceKind:capture.sourceKind,partId:capture.partId,permissionHash:capture.interiorPermission.permissionHash,usableBed:[...plan.usableBed],ownerCount:plan.ownerCount,cutCounts:[...plan.counts],displayPartCount:parts.length,limited,reason,mode,frame:'assembly',perBodyPrintOrientationPending:true,reviewRequired:true,printable:false,message:limited?'Begrenzte offene Vorschau: Das vollständige Ausgangsmodell und die Schnittebenen bleiben sichtbar.':'Offene Rastervorschau ohne neue Abschlussflächen. Drucklagen werden erst nach dem Schließen geprüft.'});
 const prepared=Object.freeze({capture,plan,display,descriptor});preparedValues.add(prepared);return prepared;
}

/** Same-worker capability, not a digest-based trust claim. A copied or forged
 * envelope is not a prepared source; the owning worker keeps this object private.
 */
export function validatePreparedExactModel(prepared){if(!preparedValues.has(prepared))throw fail('unrecognized_prepared_model');return prepared;}
