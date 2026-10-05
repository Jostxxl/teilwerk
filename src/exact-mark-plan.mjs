import {Matrix4,Quaternion,Vector3} from 'three';
import {textMesh} from './features.mjs';
import {restoreExactProjectPart} from './exact-project.mjs';
import {parseExactMesh,encodeExactMesh,exactHash,exactRational,exactRationalString,binary64ExactRational,exactRationalToNumber} from './exact-geometry.mjs';

// A plan proves continuous surface permission. It deliberately does not replace
// exact solid containment, material-removal or final-body checks at execution.
export const EXACT_MARK_PLAN_LIMITS=Object.freeze({sourceFaces:1_500_000,glyphFaces:10000,candidateFaces:20000,polygonTests:2_000_000,remainderPolygons:20000,durationMs:120000});
const zero=[0n,1n],q=n=>binary64ExactRational(n),depth=[2n,5n],top=[1n,4n],variation=[3n,20n],margin=[3n,20n];
const fail=reason=>Object.assign(Error(`Exakte Gravurplanung: ${reason}.`),{code:'EXACT_MARK_PLAN_REJECTED',reason});
const add=(a,b)=>exactRational(a[0]*b[1]+b[0]*a[1],a[1]*b[1]),sub=(a,b)=>exactRational(a[0]*b[1]-b[0]*a[1],a[1]*b[1]),mul=(a,b)=>exactRational(a[0]*b[0],a[1]*b[1]),neg=a=>[-a[0],a[1]];
const div=(a,b)=>{if(!b[0])throw fail('singular_frame');return exactRational(a[0]*b[1]*(b[0]<0n?-1n:1n),a[1]*(b[0]<0n?-b[0]:b[0]));},cmp=(a,b)=>{const n=a[0]*b[1]-b[0]*a[1];return n<0n?-1:n>0n?1:0;};
const dot=(a,b)=>a.reduce((s,x,i)=>add(s,mul(x,b[i])),zero),delta=(a,b)=>a.map((x,i)=>sub(x,b[i])),cross=(a,b)=>[sub(mul(a[1],b[2]),mul(a[2],b[1])),sub(mul(a[2],b[0]),mul(a[0],b[2])),sub(mul(a[0],b[1]),mul(a[1],b[0]))],normal=p=>cross(delta(p[1],p[0]),delta(p[2],p[0]));
const cross2=(a,b,c)=>sub(mul(sub(b[0],a[0]),sub(c[1],a[1])),mul(sub(b[1],a[1]),sub(c[0],a[0]))),same=(a,b)=>a.every((x,i)=>cmp(x,b[i])===0),key=p=>p.map(exactRationalString).join(' ');
const freeze=v=>{if(v&&typeof v==='object'&&!Object.isFrozen(v)){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const vector=v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite);
function context(options){
 if(!options||typeof options!=='object'||Object.keys(options).some(k=>!['context','permissionSources','signal','limits'].includes(k)))throw fail('options');
 const limits={...EXACT_MARK_PLAN_LIMITS};for(const [k,n]of Object.entries(options.limits||{})){if(!Object.hasOwn(limits,k)||!Number.isSafeInteger(n)||n<1||n>limits[k])throw fail('limits');limits[k]=n;}
 const start=Date.now();let tests=0;return{limits,check(){if(options.signal?.aborted)throw fail('aborted');if(Date.now()-start>limits.durationMs)throw fail('time_limit');},test(){if(++tests>limits.polygonTests)throw fail('polygon_test_limit');if((tests&255)===0)this.check();},get tests(){return tests;}};
}
function markSettings(value){
 if(!value||typeof value!=='object'||Object.keys(value).some(k=>!['point','normal','text','size','depth','rotation','emboss','autoId','placement'].includes(k))||!vector(value.point)||!vector(value.normal)||Math.hypot(...value.normal)<1e-8||typeof value.text!=='string'||!/^\d{1,8}$/.test(value.text)||!Number.isFinite(value.size)||value.size<1||value.size>100||value.depth!==undefined&&value.depth!==.4||value.emboss!==undefined&&value.emboss!==false||!Number.isFinite(value.rotation??0))throw fail('mark_settings');
 if(value.autoId!==undefined&&typeof value.autoId!=='boolean'||value.placement!==undefined&&!['manual','automatic'].includes(value.placement))throw fail('mark_settings');
 return{point:[...value.point],normal:[...value.normal],text:value.text,size:value.size,depth:.4,rotation:value.rotation??0,emboss:false,...(value.autoId!==undefined?{autoId:value.autoId}:{}),...(value.placement?{placement:value.placement}:{})};
}
function frame(mark,assemblyMatrix){
 const quaternion=new Quaternion().setFromUnitVectors(new Vector3(0,0,1),new Vector3(...mark.normal).normalize()),print=new Matrix4().makeRotationFromQuaternion(quaternion).multiply(new Matrix4().makeRotationZ(mark.rotation*Math.PI/180));print.setPosition(...mark.point);
 const m=assemblyMatrix.map(q),p=print.toArray().map(q),transform=(v,point)=>[0,1,2].map(axis=>div(v.reduce((s,x,k)=>add(s,mul(m[k*4+axis],x)),point?m[12+axis]:zero),m[15]));
 const origin=transform(p.slice(12,15),true),axes=[0,1,2].map(k=>transform(p.slice(k*4,k*4+3),false)),cofactors=[cross(axes[1],axes[2]),cross(axes[2],axes[0]),cross(axes[0],axes[1])],det=dot(axes[0],cofactors[0]);if(det[0]<=0n)throw fail('singular_frame');
 return{print:print.toArray(),origin,axes,toAssembly:v=>origin.map((x,i)=>v.reduce((s,n,k)=>add(s,mul(axes[k][i],n)),x)),toLocal:v=>cofactors.map(row=>div(dot(row,delta(v,origin)),det))};
}
function clean(poly){const out=[];for(const p of poly)if(!out.length||!same(p,out.at(-1)))out.push(p);if(out.length>1&&same(out[0],out.at(-1)))out.pop();return out;}
function nonzero(poly){return poly.length>=3&&poly.slice(1,-1).some((p,i)=>poly[0].length===2?cross2(poly[0],p,poly[i+2])[0]!==0n:normal([poly[0],p,poly[i+2]]).some(x=>x[0]!==0n));}
function half(poly,side,positive=true){const out=[];for(let i=0;i<poly.length;i++){const p=poly[i],r=poly[(i+1)%poly.length],a=side(p),b=side(r);if(positive?a[0]>=0n:a[0]<=0n)out.push(p);if(a[0]<0n&&b[0]>0n||a[0]>0n&&b[0]<0n){const t=div(a,sub(a,b));out.push(p.map((x,k)=>add(x,mul(t,sub(r[k],x)))));}}return clean(out);}
function clipXY(poly,triangle){for(let k=0;k<3&&poly.length;k++)poly=half(poly,p=>cross2(triangle[k],triangle[(k+1)%3],p));return nonzero(poly)?poly:[];}
function difference(poly,triangle){const out=[];for(let k=0;k<3&&nonzero(poly);k++){const side=p=>cross2(triangle[k],triangle[(k+1)%3],p),outside=half(poly,side,false);if(nonzero(outside))out.push(outside);poly=half(poly,side);}return out;}
const heightClip=(poly,low,high)=>half(half(poly,p=>sub(p[2],low)),p=>sub(high,p[2]));
function bounds2(poly){return[0,1].map(k=>poly.reduce((a,p)=>cmp(p[k],a)<0?p[k]:a,poly[0][k])).concat([0,1].map(k=>poly.reduce((a,p)=>cmp(p[k],a)>0?p[k]:a,poly[0][k])));}
const overlap2=(a,b)=>[0,1].every(k=>cmp(a[k],b[k+2])<=0&&cmp(b[k],a[k+2])<=0);
function fullyCovered(poly,allowed,c){let remaining=[poly];for(const target of allowed){if(!remaining.length)break;if(!overlap2(bounds2(poly),target.box))continue;c.test();remaining=remaining.flatMap(p=>difference(p,target.triangle));if(remaining.length>c.limits.remainderPolygons)throw fail('polygon_remainder_limit');}return remaining.length===0;}
function frontFacing(triangle){const n=normal(triangle);return n[2][0]>0n&&cmp(mul(mul(n[2],n[2]),[100n,1n]),mul(dot(n,n),[81n,1n]))>=0;}
function glyph(mark,c){
 const raw=textMesh(mark.text,[0,0,0],[0,0,1],mark.size,.4,0,false);let max=-Infinity;for(let i=2;i<raw.vertices.length;i+=3)max=Math.max(max,raw.vertices[i]);const vertices=[],triangles=[],lookup=new Map();
 const vertex=i=>{const p=[q(raw.vertices[i*3]),q(raw.vertices[i*3+1])],k=key(p);if(!lookup.has(k)){lookup.set(k,vertices.length);vertices.push(p);}return lookup.get(k);};
 for(let i=0;i<raw.triangles.length;i+=3){const ids=Array.from(raw.triangles.slice(i,i+3));if(!ids.every(j=>raw.vertices[j*3+2]===max))continue;const face=ids.map(vertex),points=face.map(j=>vertices[j]);if(cross2(...points)[0]<=0n)throw fail('glyph_cap_orientation');triangles.push(face);}
 if(!triangles.length||triangles.length>c.limits.glyphFaces)throw fail('glyph_limit');
 const edges=new Map();for(const face of triangles)for(let k=0;k<3;k++){const a=face[k],b=face[(k+1)%3],edge=`${a},${b}`;if(edges.has(edge))throw fail('glyph_nonmanifold');edges.set(edge,[a,b]);}
 const boundary=[...edges.values()].filter(([a,b])=>!edges.has(`${b},${a}`));
 return{vertices,triangles,boundary,footprints:triangles.map(f=>{const triangle=f.map(i=>vertices[i]);return{triangle,box:bounds2(triangle)};})};
}
function prism(g,low,high,f){const vertices=[...g.vertices.map(p=>f.toAssembly([...p,low])),...g.vertices.map(p=>f.toAssembly([...p,high]))],n=g.vertices.length,triangles=[];for(const [a,b,d]of g.triangles)triangles.push([d,b,a],[a+n,b+n,d+n]);for(const [a,b]of g.boundary)triangles.push([a,b,b+n],[a,b+n,a+n]);const edges=new Set();for(const face of triangles)for(let k=0;k<3;k++){const e=`${face[k]},${face[(k+1)%3]}`;if(edges.has(e))throw fail('cutter_topology');edges.add(e);}for(const e of edges){const [a,b]=e.split(',');if(!edges.has(`${b},${a}`))throw fail('cutter_open');}const meshText=encodeExactMesh({vertices,triangles});return{meshText,meshHash:exactHash(meshText),vertexCount:vertices.length,faceCount:triangles.length};}
const floatBits=new DataView(new ArrayBuffer(8));
function adjacent(x,up){if(x===0)return up?Number.MIN_VALUE:-Number.MIN_VALUE;floatBits.setFloat64(0,x);let bits=floatBits.getBigUint64(0);bits+=(x>0)===up?1n:-1n;floatBits.setBigUint64(0,bits);return floatBits.getFloat64(0);}
function numericBox(points){const box=[Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity];for(const p of points)for(let k=0;k<3;k++){const n=exactRationalToNumber(p[k]).number;box[k]=Math.min(box[k],adjacent(n,false));box[k+3]=Math.max(box[k+3],adjacent(n,true));}return box;}
const overlap3=(a,b)=>[0,1,2].every(k=>a[k]<=b[k+3]&&b[k]<=a[k+3]);

export function createExactMarkPlan(part,settings=part?.plannedMark,options={}){
 const c=context(options);c.check();const checked=restoreExactProjectPart(part,{...(options.context!==undefined?{context:options.context}:{permissionSources:options.permissionSources})}),mark=markSettings(settings),authority=checked.exactGeometry.authority,rights=checked.exactInteriorPermission;
 if(!rights?.rationalRegion)throw fail('no_exact_interior_permission');if(authority.faceCount>c.limits.sourceFaces)throw fail('source_face_limit');if(!checked.exactPoseReview?.selected)throw fail('print_pose_required');
 const f=frame(mark,checked.assemblyMatrix),g=glyph(mark,c),cutter=prism(g,neg(depth),top,f),guard=prism(g,neg(add(depth,margin)),neg(variation),f),cutBox=numericBox(parseExactMesh(cutter.meshText).vertices),region=parseExactMesh(rights.rationalRegion.meshText),source=parseExactMesh(authority.meshText),allowed=[],byFace=new Map(),localSource=new Map();
 const localPoint=i=>{if(!localSource.has(i))localSource.set(i,f.toLocal(source.vertices[i]));return localSource.get(i);};
 for(let i=0;i<region.faceCount;i++){
  c.test();const points=region.triangles[i].map(j=>region.vertices[j]);if(!overlap3(numericBox(points),cutBox))continue;const triangle=points.map(f.toLocal);if(!frontFacing(triangle))continue;
  const childFace=rights.childFaceIndices[i];if(!byFace.has(childFace))byFace.set(childFace,[]);const full={triangle:triangle.map(p=>p.slice(0,2)),box:bounds2(triangle)};byFace.get(childFace).push(full);
  const clipped=heightClip(triangle,neg(variation),variation);for(let j=1;j<clipped.length-1;j++){const triangle=[clipped[0],clipped[j],clipped[j+1]].map(p=>p.slice(0,2));if(nonzero(triangle))allowed.push({triangle,box:bounds2(triangle)});}
 }
 for(const entry of g.footprints)if(!fullyCovered(entry.triangle,allowed,c))throw fail('glyph_outside_original_permission');
 let candidates=0,touched=0;const touchedSheets=[];
 for(let i=0;i<source.faceCount;i++){
  if((i&1023)===0)c.check();const ids=source.triangles[i],points=ids.map(j=>source.vertices[j]);if(!overlap3(numericBox(points),cutBox))continue;if(++candidates>c.limits.candidateFaces)throw fail('candidate_face_limit');
  const triangle=ids.map(localPoint),clipped=heightClip(triangle,neg(depth),top);if(!nonzero(clipped))continue;const box=bounds2(clipped);let faceTouched=false;
  for(const entry of g.footprints){if(!overlap2(box,entry.box))continue;c.test();const patch=clipXY(clipped,entry.triangle);if(!nonzero(patch))continue;
   if(!frontFacing(triangle))throw fail('cutter_touches_unapproved_direction');if(patch.some(p=>cmp(p[2],neg(variation))<0||cmp(p[2],variation)>0))throw fail('surface_outside_height_band');
   if(!fullyCovered(patch.map(p=>p.slice(0,2)),byFace.get(i)||[],c))throw fail('cutter_touches_unapproved_surface');faceTouched=true;
  }
  if(faceTouched){touched++;touchedSheets.push({triangle,projected:triangle.map(p=>p.slice(0,2)),box:bounds2(triangle)});}
 }
 if(!touched)throw fail('no_source_contact');
 // Two differently positioned forward surfaces under a glyph are ambiguous.
 // This is an exact local sheet check; shared edges and coplanar duplicates pass.
 for(let a=0;a<touchedSheets.length;a++)for(let b=a+1;b<touchedSheets.length;b++){
  const left=touchedSheets[a],right=touchedSheets[b];if(!overlap2(left.box,right.box))continue;c.test();const overlap=clipXY(left.projected,right.projected);if(!nonzero(overlap))continue;
  const n=normal(left.triangle);if(right.triangle.every(p=>dot(n,delta(p,left.triangle[0]))[0]===0n))continue;
  if(g.footprints.some(entry=>overlap2(bounds2(overlap),entry.box)&&nonzero(clipXY(overlap,entry.triangle))))throw fail('multiple_surface_layers');
 }
 c.check();const payload={schema:'prinjekt-exact-mark-plan-v1',version:1,operation:'engrave',sourceAuthorityHash:authority.authorityHash,sourceMeshHash:authority.meshHash,permissionReviewHash:rights.reviewHash,sourcePermissionHash:rights.sourcePermissionHash,poseReviewHash:checked.exactPoseReview.reviewHash,assemblyMatrix:[...checked.assemblyMatrix],mark,printFrame:f.print,cutter,guard,coverage:{method:'exact-continuous-glyph-and-touched-surface-subsets',glyphTriangles:g.triangles.length,touchedSourceFaces:touched,fullFootprint:true,allTouchedSurfacesPermitted:true,surfaceVariationMm:.15,minimumRemainingWallMm:.15},requiredChecks:['guard-minus-source-empty','actual-positive-material-removal','closed-single-positive-result'],printable:false,completedEngraving:false};return freeze({...payload,planHash:exactHash(JSON.stringify(payload))});
}
export function validateExactMarkPlan(saved,part,options={}){if(!saved||saved.schema!=='prinjekt-exact-mark-plan-v1')throw fail('plan_schema');const fresh=createExactMarkPlan(part,saved.mark,options);if(saved.planHash!==fresh.planHash||JSON.stringify(saved)!==JSON.stringify(fresh))throw fail('plan_mismatch');return fresh;}
