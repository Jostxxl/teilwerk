import {EXACT_GEOMETRY_LIMITS,exactHash,parseExactMesh,parseExactRational,exactRationalString,exactRational,createExactAuthority,validateExactAuthority} from './exact-geometry.mjs';
import {validateExactPlane,createExactHalfspaceCutter} from './exact-planar-cutter.mjs';

// An initial single-mask partition from the trusted native arrangement. This
// validates ownership, ancestry and the full emitted boundary; it is not an
// independent recomputation of the CGAL arrangement or a printing approval.
const LIMIT=EXACT_GEOMETRY_LIMITS.bytes,hash=/^[a-f0-9]{64}$/;
const fail=reason=>Object.assign(Error(`Exakte gemeinsame Teilung ungültig: ${reason}.`),{code:'EXACT_SPLIT_PARTITION_REJECTED',reason});
const add=(a,b)=>exactRational(a[0]*b[1]+b[0]*a[1],a[1]*b[1]);
const sub=(a,b)=>exactRational(a[0]*b[1]-b[0]*a[1],a[1]*b[1]);
const mul=(a,b)=>exactRational(a[0]*b[0],a[1]*b[1]);
const dot=(a,b)=>a.reduce((s,x,i)=>add(s,mul(x,b[i])),[0n,1n]);
const cross=(a,b)=>[sub(mul(a[1],b[2]),mul(a[2],b[1])),sub(mul(a[2],b[0]),mul(a[0],b[2])),sub(mul(a[0],b[1]),mul(a[1],b[0]))];
const delta=(a,b)=>a.map((x,k)=>sub(x,b[k]));
const cmp=(a,b)=>{const n=a[0]*b[1]-b[0]*a[1];return n<0n?-1:n>0n?1:0;};
function freeze(v){if(v&&typeof v==='object'&&!Object.isFrozen(v)){Object.values(v).forEach(freeze);Object.freeze(v);}return v;}
function keys(v,allowed,reason){if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!allowed.includes(k)))throw fail(reason);}
function configuration(options){
 keys(options,['source','cutter','poseReviewHash','refinementHash'],'options');
 const source=validateExactAuthority(options.source),c=options.cutter;
 if(!source.faceCount||typeof options.poseReviewHash!=='string'||!hash.test(options.poseReviewHash)||typeof options.refinementHash!=='string'||!hash.test(options.refinementHash))throw fail('source_or_review_binding');
 if(!c||c.schema!=='prinjekt-exact-halfspace-cutter-v1')throw fail('cutter');
 const plane=validateExactPlane(c.plane),cutter=createExactHalfspaceCutter(source.meshText,{plane,margin:c.margin});
 if(JSON.stringify(c)!==JSON.stringify(cutter))throw fail('cutter_source_plane_binding');
 const sourceMesh=parseExactMesh(source.meshText,{requireCanonical:true}),mask=parseExactMesh(cutter.meshText,{requireCanonical:true});
 if(source.faceCount+mask.faceCount>EXACT_GEOMETRY_LIMITS.faces)throw fail('input_faces_limit');
 const lo=[...sourceMesh.vertices[0]],hi=[...lo];for(const p of sourceMesh.vertices)for(let k=0;k<3;k++){if(cmp(p[k],lo[k])<0)lo[k]=p[k];if(cmp(p[k],hi[k])>0)hi[k]=p[k];}
 const operands=source.origin.operands.map(o=>({...o}));if(operands.length>=EXACT_GEOMETRY_LIMITS.operands)throw fail('composed_operand_limit');
 let id='split-cutter',serial=1;while(operands.some(o=>o.id===id))id=`split-cutter:${serial++}`;
 operands.push({id,role:'cutter',meshHash:cutter.meshHash,faceCount:cutter.faceCount});
 return{source,cutter,plane,sourceMesh,mask,lo,hi,operands,poseReviewHash:options.poseReviewHash,refinementHash:options.refinementHash};
}
function reader(text){
 if(typeof text!=='string'||text.length>LIMIT||/[^\x09\x0a\x0d\x20-\x7e]/.test(text))throw fail('state_size_or_encoding');let offset=0;
 return{line(){if(offset>=text.length)throw fail('truncated_state');let end=text.indexOf('\n',offset);if(end<0)end=text.length;const s=text.slice(offset,end).trim();offset=end+1;return s;},end(){if(text.slice(offset).trim())throw fail('trailing_state');}};
}
function ints(line,n,min,max){const tokens=line.split(/\s+/);if(tokens.length!==n)throw fail('line_length');return tokens.map(t=>{if(!/^-?(?:0|[1-9]\d*)$/.test(t)||t.length>12)throw fail('integer');const x=Number(t);if(!Number.isSafeInteger(x)||x<min||x>max)throw fail('index_limit');return x;});}
function readState(text,config){
 const r=reader(text);if(r.line()!=='PRINJEKT_EXACT_PARTITION_3')throw fail('state_format');const [labels,nv,nf,np,nc,history]=ints(r.line(),6,0,8_000_001);
 if(labels!==2||nv<1||nv>2_000_000||nf<1||nf>4_000_000||np<1||np>nf||nc<1||nc>2*nf+1||history!==0||nv*6+nf*16+np*4+nc*8>text.length)throw fail('state_dimensions_or_history');
 const rule=ints(r.line(),5,0,4096);if(rule.join(',')!=='2,0,0,0,0')throw fail('single_mask_ownership_rule');
 const sizes=ints(r.line(),2,0,4_000_000),total=sizes[0]+sizes[1];if(sizes[0]!==config.source.faceCount||sizes[1]!==config.cutter.faceCount||total>4_000_000)throw fail('input_face_counts');
 const vertices=[],points=[],unique=new Set();for(let i=0;i<nv;i++){const row=r.line().split(/\s+/);if(row.length!==3)throw fail('point_arity');const p=row.map(parseExactRational),strings=p.map(exactRationalString),key=strings.join(' ');if(unique.has(key))throw fail('duplicate_exact_point');unique.add(key);vertices.push(strings);points.push(p);}unique.clear();
 const faces=new Int32Array(nf*3),birth=new Int32Array(nf),facePatches=new Int32Array(nf),savedOwners=new Int32Array(nf*2),patchLabels=new Int8Array(np).fill(-1),patchFaceCount=new Uint32Array(np);
 for(let i=0;i<nf;i++){
  const f=ints(r.line(),8,-1,Math.max(nv,nf,np,total,2));if(f.slice(0,3).some(x=>x<0||x>=nv)||new Set(f.slice(0,3)).size!==3||f[3]<0||f[3]>=total||f[4]<0||f[4]>=np||f[5]<0||f[5]>1||f.slice(6).some(x=>x< -1||x>1))throw fail('face_record');
  const label=f[3]<sizes[0]?0:1;if(label!==f[5]||patchLabels[f[4]]!==-1&&patchLabels[f[4]]!==label)throw fail('birth_label');
  faces.set(f.slice(0,3),i*3);birth[i]=f[3];facePatches[i]=f[4];savedOwners.set(f.slice(6),i*2);patchLabels[f[4]]=label;patchFaceCount[f[4]]++;
 }
 const patches=new Int32Array(np*2);for(let p=0;p<np;p++){patches.set(ints(r.line(),2,0,nc-1),p*2);if(!patchFaceCount[p])throw fail('empty_patch');}
 const windings=new Int32Array(nc*2),owners=new Int32Array(nc);for(let c=0;c<nc;c++){const row=ints(r.line(),4,-total,total),wanted=row[0]>0?(row[1]>0?0:1):-1;if(row[2]!==wanted||row[3]!==wanted)throw fail('missing_or_changed_material_owner');windings.set(row.slice(0,2),c*2);owners[c]=wanted;}r.end();
 for(let p=0;p<np;p++)for(let k=0;k<2;k++)if(windings[patches[p*2+1]*2+k]-windings[patches[p*2]*2+k]!==Number(patchLabels[p]===k))throw fail('winding_jump');
 // Every arrangement triangle must be an oriented subset of its literal
 // originating triangle. Hash binding alone would not establish ancestry.
 for(let i=0;i<nf;i++){
  const p=facePatches[i],a=patches[p*2],b=patches[p*2+1];if(savedOwners[i*2]!==owners[a]||savedOwners[i*2+1]!==owners[b])throw fail('saved_face_owners');
  const input=birth[i]<sizes[0]?config.sourceMesh:config.mask,local=birth[i]-(birth[i]<sizes[0]?0:sizes[0]),original=input.triangles[local].map(j=>input.vertices[j]),tri=Array.from(faces.subarray(i*3,i*3+3),j=>points[j]);
  const normal=cross(delta(original[1],original[0]),delta(original[2],original[0])),actual=cross(delta(tri[1],tri[0]),delta(tri[2],tri[0]));
  if(normal.every(q=>q[0]===0n)||dot(normal,actual)[0]<=0n)throw fail('degenerate_or_reversed_birth_triangle');
  for(const point of tri){if(dot(normal,delta(point,original[0]))[0]!==0n)throw fail('birth_plane');for(let edge=0;edge<3;edge++)if(dot(normal,cross(delta(original[(edge+1)%3],original[edge]),delta(point,original[edge])))[0]<0n)throw fail('birth_triangle_subset');}
 }
 return{vertices,points,faces,birth,facePatches,patches,windings,owners,sizes,nv,nf,np,nc};
}
function bodies(s){
 const parent=Int32Array.from({length:s.nc},(_,i)=>i),root=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;};
 for(let p=0;p<s.np;p++){const a=s.patches[p*2],b=s.patches[p*2+1];if(s.owners[a]>=0&&s.owners[a]===s.owners[b]){const A=root(a),B=root(b);parent[Math.max(A,B)]=Math.min(A,B);}}
 const groups=new Map();for(let c=0;c<s.nc;c++)if(s.owners[c]>=0){const key=root(c);if(!groups.has(key))groups.set(key,{owner:s.owners[c],cells:[]});groups.get(key).cells.push(c);}
 const result=[...groups.values()].sort((a,b)=>a.owner-b.owner||a.cells[0]-b.cells[0]);if(!result.length||result.length>4096)throw fail('body_count');
 const bodyOfCell=new Int32Array(s.nc).fill(-1),components=[0,0];result.forEach((g,i)=>{g.id=String(i+1);g.component=components[g.owner]++;g.cells.forEach(c=>{bodyOfCell[c]=i;});});return{result,bodyOfCell};
}
function faceKey(tri){return[...tri].sort((a,b)=>a-b).join(',');}
function sign(tri){return((tri[0]>tri[1])+(tri[0]>tri[2])+(tri[1]>tri[2]))%2?-1:1;}
function coefficient(map,key,value){const next=(map.get(key)||0)+value;if(next)map.set(key,next);else map.delete(key);}
function surfaces(s,bodyOfCell,count){
 const maps=Array.from({length:count},()=>new Map()),sourceBoundary=new Map();
 const addFace=(body,key,coefficient,face,direction)=>{if(body<0)return;const map=maps[body],record=map.get(key)||[0,-1,0,-1,0];record[0]+=coefficient;const slot=coefficient>0?1:3;if(record[slot]<0){record[slot]=face;record[slot+1]=direction;}map.set(key,record);};
 for(let i=0;i<s.nf;i++){const p=s.facePatches[i],a=s.patches[p*2],b=s.patches[p*2+1],A=bodyOfCell[a],B=bodyOfCell[b],tri=Array.from(s.faces.subarray(i*3,i*3+3)),key=faceKey(tri),d=sign(tri);if(A!==B){addFace(A,key,-d,i,-1);addFace(B,key,d,i,1);}if((s.windings[a*2]>0)!==(s.windings[b*2]>0))coefficient(sourceBoundary,key,s.windings[b*2]>0?d:-d);}
 for(const n of sourceBoundary.values())if(Math.abs(n)!==1)throw fail('ambiguous_source_boundary');
 return{sourceBoundary,boundaries:maps.map(map=>{const out=[];for(const r of map.values()){if(!r[0])continue;if(Math.abs(r[0])!==1)throw fail('ambiguous_body_boundary');const slot=r[0]>0?1:3;out.push([r[slot],r[slot+1]]);}if(!out.length)throw fail('empty_body_boundary');return out;})};
}
function emitBody(s,boundary,body,c,shared,sum){
 const used=new Set(),global=[];for(const [face,direction]of boundary){const tri=Array.from(s.faces.subarray(face*3,face*3+3));if(direction<0)tri.reverse();global.push(tri);tri.forEach(v=>used.add(v));const key=faceKey(tri),orientation=sign(tri);coefficient(sum,key,orientation);if(!shared.has(key))shared.set(key,[]);shared.get(key).push({body:body.id,owner:body.owner,orientation,face});}
 const ids=[...used].sort((a,b)=>a-b),lookup=new Map(ids.map((v,i)=>[v,i])),normal=c.plane.normal.map(parseExactRational),offset=parseExactRational(c.plane.offset),lo=[...s.points[ids[0]]],hi=[...lo];
 for(const id of ids){const p=s.points[id];for(let k=0;k<3;k++){if(cmp(p[k],c.lo[k])<0||cmp(p[k],c.hi[k])>0)throw fail('outside_source_bounds');if(cmp(p[k],lo[k])<0)lo[k]=p[k];if(cmp(p[k],hi[k])>0)hi[k]=p[k];}const side=sub(dot(normal,p),offset)[0];if(body.owner===0?side>0n:side<0n)throw fail('wrong_halfspace');}
 const local=global.map(f=>f.map(v=>lookup.get(v))),edges=new Map();for(const f of local)for(let k=0;k<3;k++){const a=f[k],b=f[(k+1)%3],key=Math.min(a,b)*ids.length+Math.max(a,b),e=edges.get(key)||[0,0];e[0]++;e[1]+=a<b?1:-1;edges.set(key,e);}
 let nonManifoldEdges=0;for(const [count,balance]of edges.values()){if(balance)throw fail('open_or_unbalanced_body_edge');if(count!==2)nonManifoldEdges++;}
 const lines=['PRINJEKT_EXACT_MESH_1',`${ids.length} ${local.length}`],append=line=>{bytes+=line.length+1;if(bytes>LIMIT)throw fail('body_bytes_limit');lines.push(line);};let bytes=lines.join('\n').length+1;ids.forEach(i=>append(s.vertices[i].join(' ')));local.forEach(f=>append(f.join(' ')));const meshText=lines.join('\n')+'\n';
 const operandIndex=[],sourceFaceIndex=[],birth=boundary.map(([i])=>s.birth[i]);for(const i of birth){if(i<s.sizes[0]){operandIndex.push(c.source.provenance.operandIndex[i]);sourceFaceIndex.push(c.source.provenance.sourceFaceIndex[i]);}else{operandIndex.push(c.operands.length-1);sourceFaceIndex.push(i-s.sizes[0]);}}
 return{meshText,meshHash:exactHash(meshText),vertexCount:ids.length,faceCount:local.length,nonManifoldEdges,bounds:[lo.map(exactRationalString),hi.map(exactRationalString)],provenance:{operandIndex,sourceFaceIndex},immediateBirth:{schema:'PRINJEKT_PARTITION_BIRTH_1',sourceAuthorityHash:c.source.authorityHash,inputFaceCounts:[...s.sizes],faceBirth:birth,arrangementFaces:boundary.map(([i])=>i),orientation:boundary.map(([,d])=>d)}};
}
function calculate(stateText,options,materialize){
 const c=configuration(options),s=readState(stateText,c),{result:groups,bodyOfCell}=bodies(s),{boundaries,sourceBoundary}=surfaces(s,bodyOfCell,groups.length),shared=new Map(),sum=new Map(),descriptors=[],parts=[];let bytes=0;
 for(let i=0;i<groups.length;i++){
  const out=emitBody(s,boundaries[i],groups[i],c,shared,sum);bytes+=out.meshText.length+out.faceCount*32;if(bytes>LIMIT)throw fail('aggregate_body_bytes_limit');
  const descriptor={...groups[i],meshHash:out.meshHash,vertexCount:out.vertexCount,faceCount:out.faceCount,nonManifoldEdges:out.nonManifoldEdges,bounds:out.bounds};descriptors.push(descriptor);
  if(materialize)parts.push({...descriptor,geometry:createExactAuthority({meshText:out.meshText,origin:{kind:'partition',operation:'partition',operands:c.operands},provenance:out.provenance}),immediateBirth:out.immediateBirth});
 }
 if(sum.size!==sourceBoundary.size||[...sum].some(([k,v])=>sourceBoundary.get(k)!==v))throw fail('source_positive_boundary_mismatch');
 let reciprocalInterfaceTriangles=0;const normal=c.plane.normal.map(parseExactRational),offset=parseExactRational(c.plane.offset);
 for(const records of shared.values())if(records.length>1){if(records.length!==2||records[0].body===records[1].body||records[0].owner===records[1].owner||records[0].orientation!==-records[1].orientation)throw fail('nonreciprocal_interface');for(const id of s.faces.subarray(records[0].face*3,records[0].face*3+3))if(sub(dot(normal,s.points[id]),offset)[0]!==0n)throw fail('interface_not_on_chosen_plane');reciprocalInterfaceTriangles++;}
 const metadata={kind:'exactSplitPartition',version:1,frame:'assembly',stateFormat:3,stateHash:exactHash(stateText),sourceMeshHash:c.source.meshHash,sourceAuthorityHash:c.source.authorityHash,cutterMeshHash:c.cutter.meshHash,plane:c.plane,poseReviewHash:c.poseReviewHash,refinementHash:c.refinementHash,ownerCount:2,bodyCount:groups.length,emptyOwners:[0,1].filter(owner=>!groups.some(g=>g.owner===owner)),arrangementVertices:s.nv,arrangementFaces:s.nf,materialCells:groups.reduce((n,g)=>n+g.cells.length,0),exteriorCells:s.nc-groups.reduce((n,g)=>n+g.cells.length,0),reciprocalInterfaceTriangles,parts:descriptors,proofScope:'trusted-native-arrangement-source-positive-boundary',poseReviewValidated:false,childPrintPosesPending:true,interiorPermissionTransferred:false};
 const review=freeze({...metadata,stateText,authorityHash:exactHash(`EXACT_SPLIT_PARTITION_1\n${JSON.stringify(metadata)}`),reviewRequired:true,printable:false});return{review,parts:materialize?freeze(parts):undefined};
}
export function createExactSplitPartitionReview(stateText,options){return calculate(stateText,options,false).review;}
export function validateExactSplitPartitionReview(value,options){if(!value||value.kind!=='exactSplitPartition'||typeof value.stateText!=='string'||!hash.test(value.authorityHash??''))throw fail('review');const result=calculate(value.stateText,options,false).review;if(JSON.stringify(value)!==JSON.stringify(result))throw fail('review_binding');return result;}
export function materializeExactSplitPartition(value,options){if(!value||value.kind!=='exactSplitPartition'||typeof value.stateText!=='string'||!hash.test(value.authorityHash??''))throw fail('review');const result=calculate(value.stateText,options,true);if(JSON.stringify(value)!==JSON.stringify(result.review))throw fail('review_binding');return result.parts;}
