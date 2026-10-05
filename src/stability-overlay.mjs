import {BufferGeometry,Group,Line,LineBasicMaterial,LineDashedMaterial,LineLoop,Mesh,MeshBasicMaterial,SphereGeometry,Vector3} from 'three';

/** View-only evidence for the complete body's uniform-density gravity check.
 * The outline is the convex support polygon, not a filled contact surface.
 * Coordinates stay in the part's print frame; the caller applies its view pose.
 * Never add these helpers to an exported mesh or an assembly illustration. */
export function stabilityOverlay(stability){
 const point=p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite);
 if(stability?.valid!==true||!point(stability.centerOfMass)||!Number.isFinite(stability.height)||stability.height<=0)return null;
 const hull=stability.contact?.hull,bedZ=stability.criteria?.bedZ??0;
 if(!Number.isFinite(bedZ)||!Array.isArray(hull)||hull.length<3||hull.some(p=>!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite)))return null;
 const color=stability.stableUnderGravity!==true?0xf07478:stability.classification==='marginal'?0xf5b34b:0x70d4bb;
 const group=new Group();group.name='print-stability-overlay';group.userData.viewOnly=true;
 let span=stability.height;for(const p of hull)span=Math.max(span,Math.abs(p[0]-stability.centerOfMass[0])*2,Math.abs(p[1]-stability.centerOfMass[1])*2);
 const com=new Vector3(...stability.centerOfMass),projection=new Vector3(com.x,com.y,bedZ),radius=Math.max(.5,Math.min(2.5,span*.014));
 const lineMaterial=()=>new LineBasicMaterial({color,depthTest:false,depthWrite:false,transparent:true,opacity:.95});
 const outline=new LineLoop(new BufferGeometry().setFromPoints(hull.map(p=>new Vector3(p[0],p[1],bedZ))),lineMaterial());outline.name='support-polygon';group.add(outline);
 const vertical=new Line(new BufferGeometry().setFromPoints([com,projection]),new LineDashedMaterial({color,depthTest:false,depthWrite:false,dashSize:radius*2,gapSize:radius,transparent:true,opacity:.9}));vertical.computeLineDistances();vertical.name='gravity-projection';group.add(vertical);
 const ball=new Mesh(new SphereGeometry(radius,12,8),new MeshBasicMaterial({color,depthTest:false,depthWrite:false}));ball.position.copy(com);ball.name='center-of-mass';group.add(ball);
 const cross=[[-radius*2,0,0],[radius*2,0,0],[0,0,0],[0,-radius*2,0],[0,radius*2,0]].map(p=>projection.clone().add(new Vector3(...p)));
 const foot=new Line(new BufferGeometry().setFromPoints(cross),lineMaterial());foot.name='center-projection';group.add(foot);
 group.traverse(o=>{o.renderOrder=30;o.raycast=()=>{};});
 return group;
}
