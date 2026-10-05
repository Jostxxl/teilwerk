// Surface-only grouping for an exploded draft. No boolean, capping, or
// watertight-body operation is used here. Unassigned triangles stay visible.
export function openSurfacePlan(data,proposals){
 const count=data.triangles.length/3,owner=new Int32Array(count).fill(-1);
 proposals.forEach((p,i)=>p.faces.forEach(f=>{if(Number.isInteger(f)&&f>=0&&f<count&&owner[f]===-1)owner[f]=i;}));
 const groups=Array.from({length:proposals.length+1},()=>[]);
 for(let f=0;f<count;f++)groups[owner[f]<0?proposals.length:owner[f]].push(f);
 return groups.map((faces,i)=>{
  if(!faces.length)return null;
  const lookup=new Map(),vertices=[],triangles=[];
  for(const f of faces)for(let k=0;k<3;k++){
   const source=data.triangles[f*3+k];let index=lookup.get(source);
   if(index===undefined){index=vertices.length/3;lookup.set(source,index);vertices.push(...data.vertices.subarray(source*3,source*3+3));}triangles.push(index);
  }
  return {vertices:new Float32Array(vertices),triangles:new Uint32Array(triangles),proposal:i<proposals.length?i:null,unassigned:i===proposals.length};
 }).filter(Boolean);
}
