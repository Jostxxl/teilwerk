import {sha256} from '@noble/hashes/sha2.js';
import {validateExactAuthority,parseExactMesh,encodeExactMesh,exactHash,exactRational,exactRationalString,parseExactRational,binary64ExactRational,exactRationalToNumber} from './exact-geometry.mjs';
import {exactPlaneFromPrintPose} from './exact-planar-cutter.mjs';

// Permission is an oriented surface union, never a solid or a print approval.
// A caller must retain the original capture as its shared project source. Hash
// consistency is not a signature authorizing an edited project/user selection.
export const EXACT_INTERIOR_PERMISSION_LIMITS=Object.freeze({sourceFaces:1_500_000,maskFaces:500_000,triangleTests:8_000_000,polygonPoints:6_000_000,remainingPolygons:4096,durationMs:120_000,recordBytes:200*1024*1024});
const trusted=new WeakMap(),hash=/^[a-f0-9]{64}$/,zero=[0n,1n];
const fail=reason=>Object.assign(Error(`Exakte Innenfreigabe: ${reason}.`),{code:'EXACT_INTERIOR_PERMISSION_REJECTED',reason});
const freeze=v=>{if(v&&typeof v==='object'&&!Object.isFrozen(v)){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const add=(a,b)=>exactRational(a[0]*b[1]+b[0]*a[1],a[1]*b[1]),sub=(a,b)=>exactRational(a[0]*b[1]-b[0]*a[1],a[1]*b[1]),mul=(a,b)=>exactRational(a[0]*b[0],a[1]*b[1]);
const div=(a,b)=>{if(!b[0])throw fail('zero_divisor');return exactRational(a[0]*b[1]*(b[0]<0n?-1n:1n),a[1]*(b[0]<0n?-b[0]:b[0]));};
const dot=(a,b)=>a.reduce((s,x,i)=>add(s,mul(x,b[i])),zero),delta=(a,b)=>a.map((x,k)=>sub(x,b[k]));
const cross=(a,b)=>[sub(mul(a[1],b[2]),mul(a[2],b[1])),sub(mul(a[2],b[0]),mul(a[0],b[2])),sub(mul(a[0],b[1]),mul(a[1],b[0]))];
const normal=p=>cross(delta(p[1],p[0]),delta(p[2],p[0]));
const key=p=>p.map(exactRationalString).join(' '),same=(a,b)=>a.every((q,i)=>sub(q,b[i])[0]===0n);
function schema(value,fields){if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value))||Reflect.ownKeys(value).some(k=>typeof k!=='string'||!fields.includes(k)||!Object.hasOwn(Object.getOwnPropertyDescriptor(value,k),'value')))throw fail('schema');}
function context(options){schema(options,['signal','limits']);const limits={...EXACT_INTERIOR_PERMISSION_LIMITS};if(options.limits!==undefined){schema(options.limits,Object.keys(limits));for(const [k,n]of Object.entries(options.limits)){if(!Number.isSafeInteger(n)||n<1||n>limits[k])throw fail('limits');limits[k]=n;}}const signal=options.signal;if(signal!==undefined&&(!signal||typeof signal.aborted!=='boolean'))throw fail('signal');const start=Date.now();let tests=0,points=0;return{limits,check(){if(signal?.aborted)throw fail('aborted');if(Date.now()-start>limits.durationMs)throw fail('time_limit');},test(){if(++tests>limits.triangleTests)throw fail('triangle_test_limit');if((tests&1023)===0)this.check();},polygon(p){points+=p.length;if(points>limits.polygonPoints)throw fail('polygon_limit');},get tests(){return tests;}};}
function numbersHash(arrays){const h=sha256.create(),bytes=new Uint8Array(32768),v=new DataView(bytes.buffer);let offset=0;const put=n=>{v.setFloat64(offset,n,true);offset+=8;if(offset===bytes.length){h.update(bytes);offset=0;}};for(const a of arrays){put(a.length);for(const n of a)put(n);}if(offset)h.update(bytes.subarray(0,offset));return Array.from(h.digest(),x=>x.toString(16).padStart(2,'0')).join('');}
function sequence(a,max,index=false){if(!(Array.isArray(a)||ArrayBuffer.isView(a)&&!(a instanceof DataView))||a.length>max)throw fail('array');return Array.from(a,x=>{if(!Number.isFinite(x)||index&&(!Number.isSafeInteger(x)||x<0))throw fail('array_value');return x;});}
function region(value,c){schema(value,['vertices','triangles']);const vertices=sequence(value.vertices,6_000_000),triangles=sequence(value.triangles,c.limits.maskFaces*3,true);if(!vertices.length||vertices.length%3||!triangles.length||triangles.length%3||triangles.some(i=>i>=vertices.length/3))throw fail('mask_arrays');return{vertices,triangles};}
function validatedCapture(capture,c){
 schema(capture,['schema','sourceKind','geometry','meshText','meshHash','sourceRevision','metadataFingerprint','assemblyMatrix','partId','interiorPermission','sourceValidation','reviewRequired','printable','precisionReconstructed']);
 if(capture.schema!=='prinjekt-exact-part-source-v1'||!['legacy-numeric','native-binding','exact-binding'].includes(capture.sourceKind)||capture.reviewRequired!==true||capture.printable!==false||capture.precisionReconstructed!==false)throw fail('capture');
 if(!(capture.partId===null||typeof capture.partId==='string'&&capture.partId.length<=200||typeof capture.partId==='number'&&Number.isFinite(capture.partId)))throw fail('capture_part_id');
 const authority=validateExactAuthority(capture.geometry);if(authority.meshText!==capture.meshText||authority.meshHash!==capture.meshHash||authority.faceCount>c.limits.sourceFaces)throw fail('capture_source');
 const matrix=sequence(capture.assemblyMatrix,16);if(matrix.length!==16)throw fail('matrix');exactPlaneFromPrintPose({normal:[0,0,1],offset:0,assemblyToPrint:matrix});
 const p=capture.interiorPermission;schema(p,['frame','assemblyMatrix','selection','permissionHash','grantsNewFaces','validatedOnNewGeometry']);
 if(p.frame!=='part-local'||p.grantsNewFaces!==false||p.validatedOnNewGeometry!==false||JSON.stringify(p.assemblyMatrix)!==JSON.stringify(matrix))throw fail('permission_frame');
 schema(p.selection,['interiorRegion','interiorBaseRegion','interiorBaseRegionCount','interiorSeeds','interiorSeed','interiorAngle']);const selection={},fingerprint={};
 for(const k of ['interiorRegion','interiorBaseRegion'])if(Object.hasOwn(p.selection,k)){const r=p.selection[k];selection[k]=r===null?null:region(r,c);fingerprint[k]=r===null?null:numbersHash([selection[k].vertices,selection[k].triangles]);}
 if(Object.hasOwn(p.selection,'interiorSeeds')){const seeds=p.selection.interiorSeeds;if(!Array.isArray(seeds)||seeds.length>64)throw fail('seeds');selection.interiorSeeds=seeds.map(s=>{schema(s,['seed','angle']);if(!Number.isSafeInteger(s.seed)||s.seed<0||s.seed>=authority.faceCount||!Number.isFinite(s.angle)||s.angle<0||s.angle>180)throw fail('seed');return{seed:s.seed,angle:s.angle};});fingerprint.interiorSeeds=selection.interiorSeeds;}
 for(const k of ['interiorBaseRegionCount','interiorSeed','interiorAngle'])if(Object.hasOwn(p.selection,k)){const n=p.selection[k];if(n!==null&&(!Number.isFinite(n)||n<0||k!=='interiorAngle'&&!Number.isSafeInteger(n)||k==='interiorSeed'&&n>=authority.faceCount||k==='interiorAngle'&&n>180||k==='interiorBaseRegionCount'&&n>1_000_000))throw fail('selection_metadata');selection[k]=n;fingerprint[k]=n;}
 const permissionHash=exactHash(JSON.stringify({frame:'part-local',assemblyMatrixHash:numbersHash([matrix]),selection:fingerprint}));if(permissionHash!==p.permissionHash)throw fail('permission_hash');
 const m=capture.metadataFingerprint;schema(m,['sourceKind','partId','assemblyMatrixHash','displayHash','sourceAttachmentHash','explicitMergeHash','authorityHash','meshHash','permissionHash']);
 for(const k of ['assemblyMatrixHash','displayHash','authorityHash','meshHash','permissionHash'])if(!hash.test(m[k]??''))throw fail('capture_hash');for(const k of ['sourceAttachmentHash','explicitMergeHash'])if(m[k]!==null&&!hash.test(m[k]??''))throw fail('capture_hash');
 if(capture.sourceKind==='legacy-numeric'?(m.sourceAttachmentHash!==null||m.explicitMergeHash===null):(m.sourceAttachmentHash===null||m.explicitMergeHash!==null))throw fail('capture_backend');
 if(m.sourceKind!==capture.sourceKind||m.partId!==capture.partId||m.assemblyMatrixHash!==numbersHash([matrix])||m.authorityHash!==authority.authorityHash||m.meshHash!==authority.meshHash||m.permissionHash!==permissionHash)throw fail('capture_metadata');
 const canonical={sourceKind:m.sourceKind,partId:m.partId,assemblyMatrixHash:m.assemblyMatrixHash,displayHash:m.displayHash,sourceAttachmentHash:m.sourceAttachmentHash,explicitMergeHash:m.explicitMergeHash,authorityHash:m.authorityHash,meshHash:m.meshHash,permissionHash:m.permissionHash};
 if(exactHash(`EXACT_PART_SOURCE_1\n${JSON.stringify(canonical)}`)!==capture.sourceRevision)throw fail('source_revision');
 return{authority,matrix,selection,permissionHash,sourceRevision:capture.sourceRevision};
}
function clean(poly){const out=[];for(const p of poly)if(!out.length||!same(p,out.at(-1)))out.push(p);if(out.length>1&&same(out[0],out.at(-1)))out.pop();return out;}
function nonzero(poly){return poly.length>=3&&poly.slice(1,-1).some((p,i)=>normal([poly[0],p,poly[i+2]]).some(q=>q[0]!==0n));}
function half(poly,a,b,n,inside){const side=p=>dot(n,cross(delta(b,a),delta(p,a))),out=[];for(let i=0;i<poly.length;i++){const p=poly[i],q=poly[(i+1)%poly.length],dp=side(p),dq=side(q);if(inside?dp[0]>=0n:dp[0]<=0n)out.push(p);if(dp[0]<0n&&dq[0]>0n||dp[0]>0n&&dq[0]<0n){const t=div(dp,sub(dp,dq));out.push(p.map((x,j)=>add(x,mul(t,sub(q[j],x)))));}}return clean(out);}
function intersection(poly,tri){const n=normal(tri);let out=poly;for(let i=0;i<3&&out.length;i++)out=half(out,tri[i],tri[(i+1)%3],n,true);return nonzero(out)?out:[];}
function difference(poly,tri){const n=normal(tri),out=[];let remaining=poly;for(let i=0;i<3&&nonzero(remaining);i++){const outside=half(remaining,tri[i],tri[(i+1)%3],n,false);if(nonzero(outside))out.push(outside);remaining=half(remaining,tri[i],tri[(i+1)%3],n,true);}return out;}
function orientedPlane(a,b){const n=normal(a),m=normal(b);return n.some(q=>q[0]!==0n)&&dot(n,m)[0]>0n&&b.every(p=>dot(n,delta(p,a[0]))[0]===0n);}
function subset(child,parent){if(!orientedPlane(parent,child))return false;const n=normal(parent);return child.every(p=>parent.every((a,i)=>dot(n,cross(delta(parent[(i+1)%3],a),delta(p,a)))[0]>=0n));}
const floats=new DataView(new ArrayBuffer(8));
function adjacent(x,up){if(x===0)return up?Number.MIN_VALUE:-Number.MIN_VALUE;floats.setFloat64(0,x,false);let bits=floats.getBigUint64(0,false);bits+=(x>0)===up?1n:-1n;floats.setBigUint64(0,bits,false);return floats.getFloat64(0,false);}
function numericBox(points){const box=[Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity];for(const p of points)for(let k=0;k<3;k++){const x=exactRationalToNumber(p[k]).number;box[k]=Math.min(box[k],adjacent(x,false));box[k+3]=Math.max(box[k+3],adjacent(x,true));}return box;}
const overlaps=(a,b)=>[0,1,2].every(k=>a[k]<=b[k+3]&&b[k]<=a[k+3]);
function index(mesh,c){const boxes=new Float64Array(mesh.triangles.length*6),ids=Uint32Array.from({length:mesh.triangles.length},(_,i)=>i),numeric=mesh.vertices.map(p=>p.map(q=>exactRationalToNumber(q).number));for(let f=0;f<mesh.triangles.length;f++){if((f&4095)===0)c.check();for(let k=0;k<3;k++){let lo=Infinity,hi=-Infinity;for(const i of mesh.triangles[f]){lo=Math.min(lo,numeric[i][k]);hi=Math.max(hi,numeric[i][k]);}boxes[f*6+k]=adjacent(lo,false);boxes[f*6+k+3]=adjacent(hi,true);}}
 function build(start,end){c.check();const box=[Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity];for(let j=start;j<end;j++){const off=ids[j]*6;for(let k=0;k<3;k++){box[k]=Math.min(box[k],boxes[off+k]);box[k+3]=Math.max(box[k+3],boxes[off+k+3]);}}const node={box,start,end};if(end-start>24){let axis=0;for(let k=1;k<3;k++)if(box[k+3]-box[k]>box[axis+3]-box[axis])axis=k;ids.subarray(start,end).sort((a,b)=>(boxes[a*6+axis]/2+boxes[a*6+axis+3]/2)-(boxes[b*6+axis]/2+boxes[b*6+axis+3]/2)||a-b);const mid=(start+end)>>1;node.left=build(start,mid);node.right=build(mid,end);}return node;}
 const root=build(0,ids.length);return box=>{const result=[],stack=[root];while(stack.length){const node=stack.pop();if(!overlaps(node.box,box))continue;if(node.left){stack.push(node.left,node.right);}else for(let j=node.start;j<node.end;j++){const f=ids[j],b=boxes.subarray(f*6,f*6+6);if(overlaps(b,box))result.push(f);}}return result.sort((a,b)=>a-b);};}
function record(payload,c){const text=JSON.stringify(payload);if(text.length>c.limits.recordBytes)throw fail('record_limit');return freeze({...payload,reviewHash:exactHash(text)});}
function savedEqual(saved,fresh){if(!saved||saved.reviewHash!==fresh.reviewHash||JSON.stringify(saved)!==JSON.stringify(fresh))throw fail('saved_permission_mismatch');return fresh;}

// Full original triangles are the common roof-selection case. This is exact
// oriented coordinate equality, not a near-surface shortcut or an index weld:
// every coincident source face keeps its own source-face identity. Reversed,
// displaced and partial mask triangles continue through the rational clip path.
function literalMaskFaces(mesh,vertices,triangles,map,polygonOrigins,c){
 const pointIds=new Map(),sourceIds=new Uint32Array(mesh.vertices.length),maskIds=new Uint32Array(vertices.length),missing=0xffffffff;
 for(let i=0;i<mesh.vertices.length;i++){if((i&4095)===0)c.check();const k=key(mesh.vertices[i]);if(!pointIds.has(k))pointIds.set(k,pointIds.size);sourceIds[i]=pointIds.get(k);}
 for(let i=0;i<vertices.length;i++){if((i&4095)===0)c.check();maskIds[i]=pointIds.get(key(vertices[i]))??missing;}
 const cycle=(a,b,d)=>a<=b&&a<=d?`${a},${b},${d}`:b<=a&&b<=d?`${b},${d},${a}`:`${d},${a},${b}`,pending=new Map();
 for(let f=0;f<triangles.length;f+=3){if((f&4095)===0)c.check();const ids=[maskIds[triangles[f]],maskIds[triangles[f+1]],maskIds[triangles[f+2]]];if(ids.includes(missing))continue;const k=cycle(...ids);if(!pending.has(k))pending.set(k,{indices:[],found:false});pending.get(k).indices.push(f/3);}
 if(pending.size)for(let f=0;f<mesh.faceCount;f++){
  c.test();const ids=mesh.triangles[f].map(i=>sourceIds[i]),entry=pending.get(cycle(...ids));if(!entry)continue;const original=mesh.triangles[f].map(i=>mesh.vertices[i]);if(!nonzero(original))continue;
  if(!entry.polygons)entry.polygons=entry.indices.map(maskFace=>{const polygon=triangles.slice(maskFace*3,maskFace*3+3).map(i=>vertices[i]);polygonOrigins.set(polygon,maskFace);return polygon;});
  for(const polygon of entry.polygons)c.polygon(polygon);map.set(f,[...entry.polygons]);entry.found=true;
 }
 const matched=new Uint8Array(triangles.length/3);let count=0;for(const entry of pending.values())if(entry.found)for(const f of entry.indices){matched[f]=1;count++;}
 return{matched,count};
}

export function prepareExactInteriorPermission(capture,options={}){
 const c=context(options);c.check();const input=validatedCapture(capture,c),mesh=parseExactMesh(input.authority.meshText),mask=input.selection.interiorRegion,map=new Map(),polygonOrigins=new WeakMap(),unmapped=[];
 let literalFullMaskFaceCount=0;
 if(mask){const m=input.matrix.map(binary64ExactRational),w=m[15],vertices=[],identity=input.matrix.every((n,i)=>n===[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1][i]);for(let i=0;i<mask.vertices.length;i+=3){if((i&4095)===0)c.check();const p=mask.vertices.slice(i,i+3).map(binary64ExactRational);vertices.push(identity?p:[0,1,2].map(axis=>div(p.reduce((s,x,k)=>add(s,mul(m[k*4+axis],x)),m[12+axis]),w)));}
  const literal=literalMaskFaces(mesh,vertices,mask.triangles,map,polygonOrigins,c);literalFullMaskFaceCount=literal.count;let query=null;
  for(let f=0;f<mask.triangles.length;f+=3){c.check();if(literal.matched[f/3])continue;const tri=mask.triangles.slice(f,f+3).map(i=>vertices[i]);if(!nonzero(tri)){unmapped.push({maskFaceIndex:f/3,reason:'degenerate_mask_face'});continue;}let remaining=[tri],matches=0;
   query??=index(mesh,c);for(const face of query(numericBox(tri))){c.test();const original=mesh.triangles[face].map(i=>mesh.vertices[i]);if(!orientedPlane(original,tri))continue;const clipped=intersection(tri,original);if(!clipped.length)continue;c.polygon(clipped);polygonOrigins.set(clipped,f/3);matches++;if(!map.has(face))map.set(face,[]);map.get(face).push(clipped);remaining=remaining.flatMap(p=>difference(p,original));if(remaining.length>c.limits.remainingPolygons)throw fail('remaining_polygon_limit');}
   if(remaining.length)unmapped.push({maskFaceIndex:f/3,reason:matches?'partially_mapped':'not_on_oriented_source_surface'});
  }
 }
 const sourceFacePolygons=[...map].sort((a,b)=>a[0]-b[0]).map(([sourceFaceIndex,polygons])=>({sourceFaceIndex,polygons:polygons.sort((a,b)=>polygonOrigins.get(a)-polygonOrigins.get(b)).map(poly=>poly.map(p=>p.map(exactRationalString)))}));
 const review=record({schema:'prinjekt-exact-interior-permission-v1',version:1,frame:'assembly',sourceRevision:input.sourceRevision,sourceAuthorityHash:input.authority.authorityHash,sourceMeshHash:input.authority.meshHash,permissionHash:input.permissionHash,sourceFacePolygons,maskFaceCount:mask?.triangles.length/3||0,unmapped,complete:unmapped.length===0,regionSemantics:'union-of-oriented-surface-polygons',proofScope:'exact-subsets-of-captured-literal-source-and-current-mask',grantsNewFaces:false,printable:false},c);
 trusted.set(review,{input,mesh,map,diagnostics:Object.freeze({literalFullMaskFaceCount,triangleTests:c.tests})});c.check();return review;
}
export function validateExactInteriorPermission(saved,capture,options={}){return savedEqual(saved,prepareExactInteriorPermission(capture,options));}
// Implementation-path counters are deliberately outside canonical saved rights.
export function getExactInteriorPermissionDiagnostics(review){const own=trusted.get(review);if(!own)throw fail('unvalidated_source_permission');return own.diagnostics;}

export function transferExactInteriorPermission(review,childAuthority,options={}){
 const own=trusted.get(review);if(!own)throw fail('unvalidated_source_permission');const c=context(options);c.check();const child=validateExactAuthority(childAuthority),mesh=parseExactMesh(child.meshText);if(mesh.faceCount>c.limits.sourceFaces)throw fail('child_face_limit');
 const direct=child.authorityHash===own.input.authority.authorityHash,operands=child.origin.operands,matching=operands.map((o,i)=>o.id==='source'&&o.role==='source'&&o.meshHash===review.sourceMeshHash&&o.faceCount===own.mesh.faceCount?i:-1).filter(i=>i>=0);
 if(!direct&&matching.length!==1)throw fail('original_source_operand');const sourceOperand=matching[0],vertices=[],triangles=[],sourceFaceIndices=[],childFaceIndices=[],lookup=new Map();let excludedCutterFaces=0;
 const vertex=p=>{const k=key(p);if(!lookup.has(k)){lookup.set(k,vertices.length);vertices.push(p);}return lookup.get(k);};
 for(let f=0;f<mesh.faceCount;f++){
  c.test();const operand=child.provenance.operandIndex[f];if(!direct&&operand!==sourceOperand){if(operands[operand].role!=='cutter')throw fail('unrelated_source_operand');excludedCutterFaces++;continue;}
  const sourceFace=direct?f:child.provenance.sourceFaceIndex[f],original=own.mesh.triangles[sourceFace]?.map(i=>own.mesh.vertices[i]),tri=mesh.triangles[f].map(i=>mesh.vertices[i]);if(!original||!subset(tri,original))throw fail('child_not_oriented_source_subset');
  for(const polygon of own.map.get(sourceFace)||[]){const clipped=intersection(polygon,tri);if(!clipped.length)continue;c.polygon(clipped);for(let k=1;k<clipped.length-1;k++){const face=[clipped[0],clipped[k],clipped[k+1]];if(!nonzero(face))continue;triangles.push(face.map(vertex));sourceFaceIndices.push(sourceFace);childFaceIndices.push(f);}}
 }
 let rationalRegion=null;if(triangles.length){const meshText=encodeExactMesh({vertices,triangles});rationalRegion={meshText,meshHash:exactHash(meshText),vertexCount:vertices.length,faceCount:triangles.length};}
 c.check();return record({schema:'prinjekt-exact-child-interior-permission-v1',version:1,frame:'assembly',sourceRevision:review.sourceRevision,sourceAuthorityHash:review.sourceAuthorityHash,sourceMeshHash:review.sourceMeshHash,permissionHash:review.permissionHash,sourcePermissionHash:review.reviewHash,childAuthorityHash:child.authorityHash,rationalRegion,sourceFaceIndices,childFaceIndices,excludedCutterFaces,unmapped:review.unmapped.map(x=>({...x})),complete:review.complete,regionSemantics:review.regionSemantics,proofScope:'exact-source-birth-subset-and-original-mask-intersection',grantsNewFaces:false,printable:false},c);
}
export function validateTransferredExactInteriorPermission(saved,review,childAuthority,options={}){return savedEqual(saved,transferExactInteriorPermission(review,childAuthority,options));}
