import {EXACT_GEOMETRY_LIMITS,parseExactMesh,encodeExactMesh,parseExactRational,exactRational,exactRationalString,binary64ExactRational,exactHash} from './exact-geometry.mjs';

// Initial assembly-axis partition proposal, not a print pose or material proof.
// Source coordinates never pass through Number. A later refinement must choose
// each body's print orientation before changing its cut positions.
// The explicit-grid native protocol must support 0 cuts (v7 or newer); legacy
// v6 interprets the zero-axis case differently and is not a valid executor.
export const EXACT_GRID_PLAN_LIMITS=Object.freeze({cutsPerAxis:32,owners:4096,gridBytes:2*1024*1024});
const identity=Object.freeze([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
const schema='prinjekt-exact-grid-plan-v1',hashPattern=/^[a-f0-9]{64}$/,maxRationalLength=2*EXACT_GEOMETRY_LIMITS.digits+2;
const fields=['schema','version','mode','frame','assemblyToGrid','sourceMeshHash','sourceTextHash','sourceVertexCount','sourceFaceCount','usableBed','bounds','counts','cuts','binSize','ownerCount','gridText','gridHash','perBodyPrintOrientationPending','reviewRequired','printable','planHash'];
const fail=reason=>Object.assign(Error(`Exakter Rasterplan ungültig: ${reason}.`),{code:'EXACT_GRID_PLAN_REJECTED',reason});
const add=(a,b)=>exactRational(a[0]*b[1]+b[0]*a[1],a[1]*b[1]);
const subtract=(a,b)=>exactRational(a[0]*b[1]-b[0]*a[1],a[1]*b[1]);
const multiply=(a,b)=>exactRational(a[0]*b[0],a[1]*b[1]);
const compare=(a,b)=>{const x=a[0]*b[1]-b[0]*a[1];return x<0n?-1:x>0n?1:0;};
function freeze(value){if(value&&typeof value==='object'){for(const v of Object.values(value))freeze(v);Object.freeze(value);}return value;}
function bedValues(value){if(!Array.isArray(value)||value.length!==3||!Array.from(value).every(x=>Number.isFinite(x)&&x>0))throw fail('usable_bed');return Array.from(value);}
function boundedRational(value){const text=exactRationalString(value);try{parseExactRational(text);}catch{throw fail('constructed_rational_limit');}return text;}
function mesh(text){try{return parseExactMesh(text);}catch{throw fail('source_mesh');}}

function calculatePlan(min,max,bed,sourceMetadata){
 if(min.some((q,i)=>compare(q,max[i])>0))throw fail('reversed_bounds');
 const spans=min.map((q,i)=>subtract(max[i],q)),cuts=[],counts=[],binSize=[];let ownerCount=1;
 for(let axis=0;axis<3;axis++){
  const extent=spans[axis],capacity=binary64ExactRational(bed[axis]);
  const numerator=extent[0]*capacity[1],denominator=extent[1]*capacity[0];
  // Exact ceiling: even a non-dyadic excess lost by Float64 still needs a bin.
  const required=(numerator+denominator-1n)/denominator,bins=required>0n?required:1n;
  if(bins>BigInt(EXACT_GRID_PLAN_LIMITS.cutsPerAxis+1))throw fail('axis_cut_limit');
  const count=Number(bins)-1;ownerCount*=count+1;if(ownerCount>EXACT_GRID_PLAN_LIMITS.owners)throw fail('owner_limit');
  const width=exactRational(extent[0],extent[1]*bins);if(compare(width,capacity)>0)throw fail('bin_exceeds_bed');
  const axisCuts=[];let previous=min[axis];
  for(let i=1;i<=count;i++){
   const position=add(min[axis],multiply(extent,[BigInt(i),bins]));
   if(compare(position,previous)<=0||compare(position,max[axis])>=0)throw fail('non_straddling_cut');
   axisCuts.push(boundedRational(position));previous=position;
  }
  cuts.push(axisCuts);counts.push(count);binSize.push(boundedRational(width));
 }
 const totalCuts=counts.reduce((a,b)=>a+b,0);
 if(sourceMetadata.sourceVertexCount+totalCuts*8>EXACT_GEOMETRY_LIMITS.vertices||sourceMetadata.sourceFaceCount+totalCuts*12>EXACT_GEOMETRY_LIMITS.faces)throw fail('combined_geometry_limit');
 const gridText=`PRINJEKT_EXACT_GRID_1\n${counts.join(' ')}\n${cuts.map(axis=>axis.join(' ')).join('\n')}\n`;
 if(gridText.length>EXACT_GRID_PLAN_LIMITS.gridBytes)throw fail('grid_text_limit');
 const payload={schema,version:1,mode:'coarse-axis-aligned',frame:'assembly',assemblyToGrid:[...identity],...sourceMetadata,usableBed:bed,bounds:[min.map(boundedRational),max.map(boundedRational)],counts,cuts,binSize,ownerCount,gridText,gridHash:exactHash(gridText),perBodyPrintOrientationPending:true,reviewRequired:true,printable:false};
 return freeze({...payload,planHash:exactHash(JSON.stringify(payload))});
}

export function createBalancedExactGridPlan(sourceMeshText,usableBed){
 const bed=bedValues(usableBed),source=mesh(sourceMeshText);
 if(source.faceCount===0||source.vertexCount===0)throw fail('empty_source');
 const min=source.vertices[0].map(q=>[...q]),max=source.vertices[0].map(q=>[...q]);
 // Include unused points as the native enclosing-box constructor does. They
 // remain source data; this codec neither welds nor discards any vertex/face.
 for(const vertex of source.vertices)for(let axis=0;axis<3;axis++){
  if(compare(vertex[axis],min[axis])<0)min[axis]=vertex[axis];
  if(compare(vertex[axis],max[axis])>0)max[axis]=vertex[axis];
 }
 let sourceCanonical;try{sourceCanonical=encodeExactMesh(source);}catch{throw fail('source_canonical_limit');}
 return calculatePlan(min,max,bed,{sourceMeshHash:exactHash(sourceCanonical),sourceTextHash:exactHash(sourceMeshText),sourceVertexCount:source.vertexCount,sourceFaceCount:source.faceCount});
}

function keys(value,expected){return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===expected.length&&Object.keys(value).every(k=>expected.includes(k));}
function rationals(value,count){return Array.isArray(value)&&value.length===count&&Array.from(value).every(x=>typeof x==='string'&&x.length<=maxRationalLength);}
function equal(a,b){if(a===null||typeof a!=='object')return a===b;if(Array.isArray(a))return Array.isArray(b)&&a.length===b.length&&a.every((v,i)=>equal(v,b[i]));return keys(b,Object.keys(a))&&Object.keys(a).every(k=>equal(a[k],b[k]));}

function validateShape(plan){
 if(!keys(plan,fields)||plan.schema!==schema||plan.version!==1||plan.mode!=='coarse-axis-aligned'||plan.frame!=='assembly'||plan.perBodyPrintOrientationPending!==true||plan.reviewRequired!==true||plan.printable!==false)throw fail('plan_schema');
 if(!Array.isArray(plan.assemblyToGrid)||plan.assemblyToGrid.length!==16||!identity.every((x,i)=>plan.assemblyToGrid[i]===x))throw fail('nonidentity_grid_frame');
 for(const key of ['sourceMeshHash','sourceTextHash','gridHash','planHash'])if(typeof plan[key]!=='string'||!hashPattern.test(plan[key]))throw fail('plan_hash');
 if(!Number.isSafeInteger(plan.sourceVertexCount)||plan.sourceVertexCount<1||plan.sourceVertexCount>EXACT_GEOMETRY_LIMITS.vertices||!Number.isSafeInteger(plan.sourceFaceCount)||plan.sourceFaceCount<1||plan.sourceFaceCount>EXACT_GEOMETRY_LIMITS.faces)throw fail('source_counts');
 bedValues(plan.usableBed);
 if(!Array.isArray(plan.bounds)||plan.bounds.length!==2||![0,1].every(i=>rationals(plan.bounds[i],3))||!rationals(plan.binSize,3))throw fail('bounds_shape');
 if(!Array.isArray(plan.counts)||plan.counts.length!==3||!Array.from(plan.counts).every(n=>Number.isSafeInteger(n)&&n>=0&&n<=EXACT_GRID_PLAN_LIMITS.cutsPerAxis)||!Array.isArray(plan.cuts)||plan.cuts.length!==3||![0,1,2].every(i=>rationals(plan.cuts[i],plan.counts[i])))throw fail('grid_counts');
 if(!Number.isSafeInteger(plan.ownerCount)||plan.ownerCount<1||plan.ownerCount>EXACT_GRID_PLAN_LIMITS.owners||typeof plan.gridText!=='string'||plan.gridText.length>EXACT_GRID_PLAN_LIMITS.gridBytes)throw fail('grid_limits');
}

/** Validate against the original complete source, not merely stored digests.
 * Returned data is detached and deeply frozen. No result geometry is adopted. */
export function validateExactGridPlan(plan,sourceMeshText){
 validateShape(plan);
 const expected=createBalancedExactGridPlan(sourceMeshText,plan.usableBed);
 if(!equal(expected,plan))throw fail('source_or_plan_mismatch');return expected;
}

/** Derive the three canonical operands exactly as native gridOperands does.
 * This checks plan consistency, not the stored source hash's authenticity.
 * The runner must first validateExactGridPlan against its actual source. */
export function deriveExactGridOperands(plan){
 validateShape(plan);let bounds;
 try{bounds=plan.bounds.map(axis=>axis.map(parseExactRational));}catch{throw fail('bounds_rational');}
 const metadata={sourceMeshHash:plan.sourceMeshHash,sourceTextHash:plan.sourceTextHash,sourceVertexCount:plan.sourceVertexCount,sourceFaceCount:plan.sourceFaceCount};
 const expected=calculatePlan(bounds[0],bounds[1],bedValues(plan.usableBed),metadata);if(!equal(expected,plan))throw fail('plan_mismatch');
 const boxFaces=[[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]],bits=[[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]];
 let serial=0;const result=[];
 for(let axis=0;axis<3;axis++){
  const vertices=[],triangles=[];
  for(const coordinate of expected.cuts[axis]){
   const cut=parseExactRational(coordinate),padding=[BigInt(++serial),1n],lo=bounds[0].map(q=>subtract(q,padding)),hi=bounds[1].map((q,j)=>j===axis?cut:add(q,padding)),base=vertices.length;
   for(const corner of bits)vertices.push(corner.map((bit,j)=>bit?hi[j]:lo[j]));for(const face of boxFaces)triangles.push(face.map(i=>base+i));
  }
  let meshText;try{meshText=encodeExactMesh({vertices,triangles});}catch{throw fail('operand_geometry_limit');}
  result.push({id:['grid_x','grid_y','grid_z'][axis],role:'cutter',meshText,meshHash:exactHash(meshText),faceCount:triangles.length});
 }
 return freeze(result);
}
