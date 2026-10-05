const MAX_CELLS=512,OUTER_PADDING=.01;

// A balanced grid gives every partition genuinely planar walls. Internal
// boundaries are shared exactly; only the outer cutter extends past the model.
// This prepares cutter definitions without changing or closing the source mesh.
export function straightPlanProposals(data,bed){
 if(!Array.isArray(bed)||bed.length!==3||bed.some(value=>!Number.isFinite(value)||value<=0))throw Error('Gültigen Bauraum für gerade Schnitte wählen.');
 const vertices=data?.vertices;if(!vertices||vertices.length<9||vertices.length%3)throw Error('Das Modell enthält keine gültigen räumlichen Modellgrenzen.');
 const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
 for(let i=0;i<vertices.length;i++){const value=vertices[i];if(!Number.isFinite(value))throw Error('Die Modellkoordinaten müssen endlich sein.');const axis=i%3;min[axis]=Math.min(min[axis],value);max[axis]=Math.max(max[axis],value);}
 const size=max.map((value,axis)=>value-min[axis]);if(size.some(value=>!Number.isFinite(value)||value<=0))throw Error('Das Modell benötigt eine positive Ausdehnung in allen drei Raumrichtungen.');
 const counts=size.map((value,axis)=>Math.max(1,Math.ceil(value/bed[axis]))),count=counts.reduce((product,value)=>product*value,1);
 if(!Number.isSafeInteger(count)||count>MAX_CELLS)throw Error(`Die geraden Schnitte benötigen mehr als ${MAX_CELLS} Bereiche. Größeren Bauraum wählen oder das Modell vorher in größere Abschnitte teilen.`);
 const boundaries=counts.map((count,axis)=>Array.from({length:count+1},(_,i)=>i===count?max[axis]:min[axis]+size[axis]*i/count)),cellSize=size.map((value,axis)=>value/counts[axis]),proposals=[];
 for(let z=0;z<counts[2];z++)for(let y=0;y<counts[1];y++)for(let x=0;x<counts[0];x++){
  const index=[x,y,z],cellMin=index.map((value,axis)=>boundaries[axis][value]),cellMax=index.map((value,axis)=>boundaries[axis][value+1]),actualSize=cellMax.map((value,axis)=>value-cellMin[axis]),lower=cellMin.map((value,axis)=>value-(index[axis]===0?OUTER_PADDING:0)),upper=cellMax.map((value,axis)=>value+(index[axis]===counts[axis]-1?OUTER_PADDING:0));
  proposals.push({faces:[],method:'straight',gridIndex:index,cellBounds:{min:cellMin,max:cellMax,size:actualSize},estimatedSize:actualSize,center:cellMin.map((value,axis)=>(value+cellMax[axis])/2),normal:[0,0,1],cutDefinition:{u:[1,0,0],v:[0,1,0],n:[0,0,1],contours:[[[lower[0],lower[1]],[upper[0],lower[1]],[upper[0],upper[1]],[lower[0],upper[1]]]],min:lower[2],max:upper[2]}});
 }
 proposals.grid={counts,cellSize,sourceBounds:{min,max,size},count,outerPadding:OUTER_PADDING};
 return proposals;
}
