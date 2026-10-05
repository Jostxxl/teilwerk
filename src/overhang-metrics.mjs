// A horizontal plane clips a triangle into similar triangles. This exact area
// fraction keeps the bed exclusion independent of the STL's triangulation.
function areaAboveBed(a,b,c){
 const da=a-.35,db=b-.35,dc=c-.35;
 if(Math.max(da,db,dc)<=0)return 0;
 if(Math.min(da,db,dc)>=0)return 1;
 const positive=Number(da>0)+Number(db>0)+Number(dc>0);
 if(positive===1){const top=da>0?da:db>0?db:dc,others=da>0?[db,dc]:db>0?[da,dc]:[da,db];return top/(top-others[0])*top/(top-others[1]);}
 const bottom=da<=0?da:db<=0?db:dc,others=da<=0?[db,dc]:db<=0?[da,dc]:[da,db];
 const first=others[0]/(others[0]-bottom),second=others[1]/(others[1]-bottom);
 return first+second-first*second;
}
// Degrees away from vertical: vertical walls = 0°, horizontal undersides = 90°.
export function overhangMetrics(data,limit=60){
 let supportArea=0,severeArea=0,maxAngle=0;
 for(let f=0;f<data.triangles.length;f+=3){
  const a=data.triangles[f]*3,b=data.triangles[f+1]*3,c=data.triangles[f+2]*3,v=data.vertices,fraction=areaAboveBed(v[a+2],v[b+2],v[c+2]);if(fraction===0)continue;
  const ux=v[b]-v[a],uy=v[b+1]-v[a+1],uz=v[b+2]-v[a+2],vx=v[c]-v[a],vy=v[c+1]-v[a+1],vz=v[c+2]-v[a+2],nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx,length=Math.hypot(nx,ny,nz);if(length===0)continue;
  const angle=Math.asin(Math.max(0,Math.min(1,-nz/length)))*180/Math.PI,area=length/2*fraction;
  maxAngle=Math.max(maxAngle,angle);if(angle>45+.01)supportArea+=area;if(angle>limit+.01)severeArea+=area;
 }
 return {supportArea,severeArea,maxAngle,limit,needsFurtherSplit:severeArea>1};
}
