// Straight-grid cells may share a face, an edge, or only one vertex. Only a
// positive two-dimensional face can connect two printable draft groups.
// null means the rule does not apply to these non-grid contour definitions.
export function straightCellFaceContact(a,b,{tolerance=1e-6}={}){
 if(a?.method!=='straight'||b?.method!=='straight')return null;
 if(!Number.isFinite(tolerance)||tolerance<=0)throw Error('Ungültige Toleranz für Raster-Nachbarschaften.');
 const boxes=[a.cellBounds,b.cellBounds];if(boxes.some(box=>!Array.isArray(box?.min)||!Array.isArray(box?.max)||box.min.length!==3||box.max.length!==3||box.min.some((v,i)=>!Number.isFinite(v)||!Number.isFinite(box.max[i])||box.max[i]<=v)))return false;
 let touching=0,positive=0;for(let i=0;i<3;i++){const overlap=Math.min(boxes[0].max[i],boxes[1].max[i])-Math.max(boxes[0].min[i],boxes[1].min[i]);if(overlap< -tolerance)return false;if(overlap>tolerance)positive++;else touching++;}
 return touching===1&&positive===2;
}

export function faceConnectedStraightGroup(members,proposals,options){
 if(!Array.isArray(members)||!members.length||members.some(i=>!Number.isInteger(i)||!proposals[i]||proposals[i].method!=='straight')||new Set(members).size!==members.length)return false;
 const reached=new Set([members[0]]),queue=[members[0]];for(let q=0;q<queue.length;q++)for(const id of members)if(!reached.has(id)&&straightCellFaceContact(proposals[queue[q]],proposals[id],options)){reached.add(id);queue.push(id);}return reached.size===members.length;
}
