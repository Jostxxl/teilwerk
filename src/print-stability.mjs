const finite=Number.isFinite;
const accumulator=()=>({sum:0,correction:0});
function accumulate(state,value){const y=value-state.correction,next=state.sum+y;state.correction=(next-state.sum)-y;state.sum=next;}
const cross2=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
function hull(points){
 const sorted=[...new Map(points.map(p=>[`${p[0]},${p[1]}`,p])).values()].sort((a,b)=>a[0]-b[0]||a[1]-b[1]);if(sorted.length<3)return sorted;
 const lower=[],upper=[];for(const p of sorted){while(lower.length>1&&cross2(lower.at(-2),lower.at(-1),p)<=0)lower.pop();lower.push(p);}for(let i=sorted.length-1;i>=0;i--){const p=sorted[i];while(upper.length>1&&cross2(upper.at(-2),upper.at(-1),p)<=0)upper.pop();upper.push(p);}return [...lower.slice(0,-1),...upper.slice(0,-1)];
}
function polygonMetrics(polygon,point){
 let area=0,margin=Infinity,width=Infinity,diameter=0,opposite=1;
 for(let i=0;i<polygon.length;i++){
  const a=polygon[i],b=polygon[(i+1)%polygon.length],length=Math.hypot(b[0]-a[0],b[1]-a[1]);area+=a[0]*b[1]-a[1]*b[0];margin=Math.min(margin,cross2(a,b,point)/length);
  // Antipodal vertices advance monotonically around this convex CCW polygon.
  let advances=0;while(advances++<polygon.length){const next=(opposite+1)%polygon.length;if(cross2(a,b,polygon[next])<=cross2(a,b,polygon[opposite]))break;opposite=next;}
  width=Math.min(width,cross2(a,b,polygon[opposite])/length);diameter=Math.max(diameter,Math.hypot(a[0]-polygon[opposite][0],a[1]-polygon[opposite][1]),Math.hypot(b[0]-polygon[opposite][0],b[1]-polygon[opposite][1]));
 }
 return {area:area/2,margin,width,diameter};
}

/** Geometric tipping estimate for a complete, closed, consistently oriented
 * rigid body of UNIFORM density on a horizontal bed. The COM comes from signed
 * volume integrals (including cavity shells), not the bounding-box center.
 * Actual downward bed triangles define the convex support polygon. This does
 * not predict adhesion, nozzle forces, flexible shells, infill distribution or
 * the changing center of mass during printing. No mesh or pose is modified. */
export function printStability(data,{bedZ=0,contactTolerance=1e-4,narrowBaseRatio=.08,minimumTiltDegrees=5}={}){
 if(![bedZ,contactTolerance,narrowBaseRatio,minimumTiltDegrees].every(finite)||contactTolerance<0||narrowBaseRatio<0||minimumTiltDegrees<0||minimumTiltDegrees>=90)throw Error('Ungültige Einstellungen für die geometrische Kippprüfung.');
 const criteria={bedZ,contactTolerance,narrowBaseRatio,minimumTiltDegrees},assumptions={density:'uniform',body:'complete-rigid-closed',bed:'horizontal',adhesionConsidered:false,printingProgressConsidered:false};
 const limitations='Geometrische Kippprüfung des vollständigen Körpers bei einheitlicher Dichte. Haftung, Düsenkräfte und der wechselnde Schwerpunkt während des Drucks sind nicht geprüft.';
 const invalid=(code,message,extra={})=>({valid:false,classification:'invalid',stableUnderGravity:null,volume:null,centerOfMass:null,minimumMargin:null,gravityMargin:null,contact:null,warnings:[{code,message}],criteria,assumptions,limitations,...extra});
 if(!data?.vertices?.length||data.vertices.length%3||!data.triangles?.length||data.triangles.length%3)return invalid('invalid_mesh','Für die Kippprüfung wird ein vollständiges Dreiecksnetz benötigt.');
 const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
 for(let i=0;i<data.vertices.length;i++){const value=data.vertices[i];if(!finite(value))return invalid('invalid_mesh','Das Netz enthält ungültige Koordinaten.');const axis=i%3;min[axis]=Math.min(min[axis],value);max[axis]=Math.max(max[axis],value);}
 const size=max.map((value,i)=>value-min[i]),reference=min.map((value,i)=>value/2+max[i]/2);if(!size.every(finite))return invalid('invalid_mesh','Die Modellabmessungen sind nicht endlich.');
 const volume=accumulator(),moments=[accumulator(),accumulator(),accumulator()],area=accumulator(),flux=[accumulator(),accumulator(),accumulator()],contactArea=accumulator(),contactPoints=[];let contactTriangles=0;
 for(let f=0;f<data.triangles.length;f+=3){
  const ids=[data.triangles[f],data.triangles[f+1],data.triangles[f+2]];if(ids.some(i=>!Number.isInteger(i)||i<0||i>=data.vertices.length/3))return invalid('invalid_mesh','Das Netz enthält ungültige Dreiecksindizes.');
  const p=ids.map(id=>reference.map((origin,k)=>data.vertices[id*3+k]-origin)),[a,b,c]=p,u=b.map((v,k)=>v-a[k]),v=c.map((v,k)=>v-a[k]),normal=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],twiceArea=Math.hypot(...normal);
  if(twiceArea===0)continue;accumulate(area,twiceArea);normal.forEach((value,k)=>accumulate(flux[k],value));
  const tetra=(a[0]*(b[1]*c[2]-b[2]*c[1])+a[1]*(b[2]*c[0]-b[0]*c[2])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6;accumulate(volume,tetra);for(let k=0;k<3;k++)accumulate(moments[k],tetra*(a[k]+b[k]+c[k])/4);
  if(normal[2]/twiceArea<=-1+1e-6&&ids.every(id=>Math.abs(data.vertices[id*3+2]-bedZ)<=contactTolerance)){
   contactTriangles++;accumulate(contactArea,-normal[2]/2);for(const point of p)contactPoints.push(point.slice(0,2));
  }
 }
 if(!finite(volume.sum)||volume.sum<=0||moments.some(m=>!finite(m.sum)))return invalid('invalid_volume','Das Netz besitzt kein positives, berechenbares Materialvolumen.');
 const closureResidual=Math.hypot(...flux.map(p=>p.sum))/area.sum;
 if(!finite(closureResidual)||closureResidual>1e-6)return invalid('open_or_inconsistent_surface','Die orientierten Flächen schließen sich nicht; der Schwerpunkt ist nicht verlässlich.',{closureResidual});
 const localCOM=moments.map(m=>m.sum/volume.sum),centerOfMass=localCOM.map((v,i)=>reference[i]+v),height=max[2]-bedZ,comHeight=centerOfMass[2]-bedZ;
 const common={valid:true,volume:volume.sum,centerOfMass,centerOfMassProjection:centerOfMass.slice(0,2),height,comHeight,bounds:{min,max,size},closureResidual,criteria,assumptions,limitations};
 if(min[2]<bedZ-contactTolerance)return invalid('below_bed','Das Modell liegt teilweise unter der Druckplatte.',{...common,valid:false,classification:'invalid'});
 const polygon=hull(contactPoints),worldHull=polygon.map(p=>[p[0]+reference[0],p[1]+reference[1]]),contact={triangleCount:contactTriangles,area:contactArea.sum,hull:worldHull,hullArea:0,minimumSpan:0,maximumSpan:0};
 if(polygon.length<3||contactArea.sum<=0)return {...common,classification:'no-contact',stableUnderGravity:false,insideSupportPolygon:false,minimumMargin:null,contactSpanToHeight:0,gravityMargin:null,contact,warnings:[{code:'no_bed_contact',message:'Keine echte ebene Auflagefläche auf der Druckplatte erkannt.'}]};
 const metrics=polygonMetrics(polygon,localCOM.slice(0,2));if(!finite(metrics.area)||metrics.area<=0||!finite(metrics.width)||metrics.width<=0||comHeight<=0||height<=0)return invalid('invalid_support_polygon','Auflagefläche oder Schwerpunktlage sind nicht auswertbar.',{...common,valid:false,classification:'invalid',contact});
 contact.hullArea=metrics.area;contact.minimumSpan=metrics.width;contact.maximumSpan=metrics.diameter;
 const tolerance=Number.EPSILON*Math.max(1,...size)*32,minimumMargin=Math.abs(metrics.margin)<=tolerance?0:metrics.margin,insideSupportPolygon=minimumMargin>=0,criticalTiltDegrees=Math.atan2(minimumMargin,comHeight)*180/Math.PI,contactSpanToHeight=metrics.width/height;
 const warnings=[];if(!insideSupportPolygon)warnings.push({code:'center_outside_support',message:'Die Schwerpunktprojektion liegt außerhalb der Auflagefläche. Der vollständige Körper kann ohne Haftung oder weitere Abstützung kippen.',margin:minimumMargin});
 else if(minimumMargin===0)warnings.push({code:'center_on_support_edge',message:'Die Schwerpunktprojektion liegt am Rand der Auflagefläche; es besteht keine geometrische Kippreserve.'});
 if(contactSpanToHeight<narrowBaseRatio)warnings.push({code:'narrow_base',message:'Die Auflage ist im Verhältnis zur Modellhöhe sehr schmal.',ratio:contactSpanToHeight,threshold:narrowBaseRatio});
 if(insideSupportPolygon&&criticalTiltDegrees<minimumTiltDegrees)warnings.push({code:'low_tipping_margin',message:'Die geometrische Kippreserve des vollständigen Körpers ist gering.',degrees:criticalTiltDegrees,threshold:minimumTiltDegrees});
 return {...common,classification:!insideSupportPolygon?'unstable':warnings.length?'marginal':'stable',stableUnderGravity:minimumMargin>0,insideSupportPolygon,minimumMargin,contactSpanToHeight,gravityMargin:{marginMm:minimumMargin,criticalTiltDegrees,criticalHorizontalAccelerationG:minimumMargin/comHeight},contact,warnings};
}
