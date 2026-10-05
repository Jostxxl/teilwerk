import {pointInsidePrism} from './open-clip.mjs';

// These are sampled display walls, not closing geometry. Keep only boundaries
// between distinct draft groups, and display both sides with their own group.
export function groupPreviewWalls(walls,proposals,groups){
 const owners=new Int32Array(proposals.length).fill(-1),output=groups.map(()=>({vertices:[],triangles:[]}));
 groups.forEach((members,g)=>members.forEach(i=>owners[i]=g));
 const owner=point=>{for(let i=0;i<proposals.length;i++)if(pointInsidePrism(point,proposals[i].cutDefinition))return owners[i];return -1;};
 for(const wall of walls){const v=wall.vertices,t=wall.triangles;for(let f=0;f<t.length;f+=3){
  const points=Array.from({length:3},(_,k)=>Array.from(v.subarray(t[f+k]*3,t[f+k]*3+3))),[a,b,c]=points,ab=b.map((x,i)=>x-a[i]),ac=c.map((x,i)=>x-a[i]),normal=[ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]],length=Math.hypot(...normal);if(length<1e-10)continue;
  const center=a.map((x,i)=>(x+b[i]+c[i])/3),left=owner(center.map((x,i)=>x+normal[i]/length*.002)),right=owner(center.map((x,i)=>x-normal[i]/length*.002));if(left===right)continue;
  for(const g of [left,right])if(g>=0){const target=output[g],index=target.vertices.length/3;target.vertices.push(...a,...b,...c);target.triangles.push(index,index+1,index+2);}
 }}
 return output.map(p=>({vertices:new Float32Array(p.vertices),triangles:new Uint32Array(p.triangles),previewOnly:true,approximate:true}));
}
