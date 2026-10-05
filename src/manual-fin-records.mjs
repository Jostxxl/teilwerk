export function extractManualFin(supports,record){
 const start=record.triangleStart*3,end=start+record.triangleCount*3;
 if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end>supports.triangles.length||end<=start)throw Error('Ungültige gespeicherte Finnengeometrie.');
 const map=new Map(),vertices=[],triangles=[];for(let i=start;i<end;i++){const old=supports.triangles[i];if(!Number.isInteger(old)||old<0||old*3+2>=supports.vertices.length)throw Error('Ungültige gespeicherte Finnengeometrie.');if(!map.has(old)){map.set(old,vertices.length/3);vertices.push(...Array.from(supports.vertices.slice(old*3,old*3+3)));}triangles.push(map.get(old));}return {vertices:new Float32Array(vertices),triangles:new Uint32Array(triangles)};
}
export function packManualFins(records,metadata){
 const vertices=new Float32Array(records.reduce((n,r)=>n+r.data.vertices.length,0)),triangles=new Uint32Array(records.reduce((n,r)=>n+r.data.triangles.length,0)),fins=[];let v=0,t=0;
 for(const {data,...record} of records){vertices.set(data.vertices,v);for(let i=0;i<data.triangles.length;i++)triangles[t+i]=data.triangles[i]+v/3;fins.push({...record,triangleStart:t/3,triangleCount:data.triangles.length/3});v+=data.vertices.length;t+=data.triangles.length;}
 return {...metadata,kind:'manual',vertices,triangles,fins,count:fins.length,pad:false,source:'gittrahan/support-fins',validation:'native-connected-and-contact',contactValidation:'native-positive-volume-and-union'};
}

