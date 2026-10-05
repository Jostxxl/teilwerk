import test from 'node:test';import assert from 'node:assert/strict';
import {BoxGeometry,Matrix4,Vector3} from 'three';
import {transformData} from '../src/engine.mjs';
import {replacementColorContext,stageReplacementColors,commitSiblingColors} from '../src/replacement-colors.mjs';
import {neighborColors,neighborGraph} from '../src/neighbor-colors.mjs';
import {autoMarkLocations,selectInterior} from '../src/interior-marking.mjs';
import {assignMarkLocations,restoreMarkLocation,restoreInteriorSelection,transferInteriorSelection} from '../src/mark-locations.mjs';
const palette=['#bde780','#6fc7d4','#eab784','#b3a2ed','#e08d97','#e0d37a','#65a9e8','#ed8461','#dc9cda','#d5d9d9'];
function box(width=100,x=0){const geometry=new BoxGeometry(width,80,4);geometry.translate(x,0,0);return{vertices:new Float32Array(geometry.attributes.position.array),triangles:new Uint32Array(geometry.index.array)};}
function bottom(data){const a=new Vector3(),b=new Vector3(),c=new Vector3();for(let f=0;f<data.triangles.length/3;f++){a.fromArray(data.vertices,data.triangles[f*3]*3);b.fromArray(data.vertices,data.triangles[f*3+1]*3);c.fromArray(data.vertices,data.triangles[f*3+2]*3);if(b.sub(a).cross(c.sub(a)).normalize().z<-.999)return selectInterior(data,f).region;}throw Error('Missing bottom');}
function close(actual,expected,tolerance=1e-5){assert.ok(Math.abs(actual-expected)<tolerance,`${actual} differs from ${expected}`);}

test('a second cut recolors actual touching old siblings only when committed',()=>{
 const assembly=new Matrix4().makeTranslation(90,-40,20).multiply(new Matrix4().makeRotationZ(.7)),parent={...box(20),color:palette[1],assemblyMatrix:assembly.toArray()},sibling={...box(10,15),color:palette[0],assemblyMatrix:assembly.toArray()},committed=[parent,sibling];
 const print=new Matrix4().makeTranslation(200,300,50).multiply(new Matrix4().makeRotationY(.9)),children=[transformData(box(10,5),print),box(10,-5)];
 const subset=neighborColors(children,palette,{preview:true});assert.equal(subset.colors[0],sibling.color,'subset-only coloring really would conflict');
 const context=replacementColorContext(committed,0,children,{previewAssembly:true}),global=neighborColors(context.parts,palette);assert.equal(global.edges,2);stageReplacementColors(children,context,global.colors);
 assert.strictEqual(committed[1],sibling);assert.equal(committed[1].color,palette[0],'unconfirmed preview must not mutate old siblings');assert.ok(children.siblingColors.some(p=>p.index===1&&p.color!==sibling.color));
 commitSiblingColors(committed,children);const final=context.parts.map((part,index)=>({...part,color:global.colors[index]})),graph=neighborGraph(final);for(let i=0;i<final.length;i++)for(const j of graph.neighbors[i])assert.notEqual(final[i].color,final[j].color);assert.equal(committed[1].color,global.colors[2]);assert.ok(final.every(p=>palette.includes(p.color)));
});

test('open preview context ignores inherited print metadata and retains untouched siblings',()=>{
 const parent={...box(20),assemblyMatrix:new Matrix4().makeTranslation(100,0,0).toArray()},sibling={...box(10,15),assemblyMatrix:parent.assemblyMatrix},child={...box(10,5),transform:new Matrix4().makeTranslation(999,0,0).toArray()},context=replacementColorContext([parent,sibling],0,[child],{previewAssembly:true,openPreview:true});
 assert.equal(neighborGraph(context.parts).edges,1);assert.strictEqual(context.parts[1],sibling);
});

test('unchecked auto IDs preserve and remap the full interior mask across an oriented split',()=>{
 const source=box(),region=bottom(source),poses=[new Matrix4().makeTranslation(20,30,40).multiply(new Matrix4().makeRotationY(.8)),new Matrix4().makeTranslation(-10,80,2).multiply(new Matrix4().makeRotationX(.6))],parts=[-25,25].map((x,i)=>({...transformData(box(50,x),poses[i]),id:`T001.${i+1}`})),result=autoMarkLocations(parts,{data:region},{generateMarks:false});
 assert.equal(result.masksOnly,true);assert.equal(result.assigned,0);assert.equal(result.unassigned,0);
 for(let i=0;i<parts.length;i++){
  const out=result.parts[i];assert.ok(out.interiorRegion);assert.equal(out.plannedMark,undefined);assert.strictEqual(out.vertices,parts[i].vertices);
  const mapped=transferInteriorSelection(out,null,false),restored=restoreInteriorSelection(mapped,out);assert.ok(restored.interiorRegion);
  const mask=restored.interiorRegion,inverse=poses[i].clone().invert(),points=[];let area=0;
  for(let k=0;k<mask.vertices.length;k+=3){const p=new Vector3().fromArray(mask.vertices,k).applyMatrix4(inverse);points.push(p);close(p.z,-2);assert.ok(p.x>=-50+i*50-1e-5&&p.x<=i*50+1e-5);assert.ok(Math.abs(p.y)<=40+1e-5);}
  // Intersecting with the original permission triangles can retriangulate a
  // face. Require the entire correct child surface, not a fixed triangle count.
  for(let f=0;f<mask.triangles.length;f+=3){const [a,b,c]=[0,1,2].map(j=>points[mask.triangles[f+j]]),cross=b.clone().sub(a).cross(c.clone().sub(a));assert.ok(cross.z<0);area+=cross.length()/2;}
  close(area,4000,.001);
 }
 assert.equal(region.triangles.length,6,'source mask is retained independently of child masks');
});

test('mask-only mapping preserves a manually selected position even with automatic ID text',()=>{
 const source=box(),manual={point:[20,0,-2],normal:[0,0,-1],text:'T001.7',size:4,depth:.6,rotation:15,emboss:false,autoId:true,placement:'manual'},part={...source,id:'T001.7',plannedMark:manual},result=autoMarkLocations([part],{data:bottom(source)},{generateMarks:false});
 assert.strictEqual(result.parts[0].plannedMark,manual);assert.ok(result.parts[0].interiorRegion);assert.equal(result.assigned,1);
});

test('a manually picked anchor wins when native absorption merges old preview groups',()=>{
 const part={...box(),id:'T001.1'},automatic={point:[-20,0,2],normal:[0,0,1],text:'T001.2',size:4,depth:.6,rotation:0,emboss:false,autoId:true,placement:'automatic'},manual={...automatic,point:[20,0,2],text:'CUSTOM',autoId:false,placement:'manual'};
 assert.deepEqual(assignMarkLocations([part],[automatic,manual]),{assigned:1,unassigned:1});assert.equal(part.plannedMark.text,'CUSTOM');assert.deepEqual(part.plannedMark.point,[20,0,2]);assert.equal(restoreMarkLocation(part.plannedMark).placement,'manual');
});

test('automatic anchors are rechecked against final ID width and available surface',()=>{
 const source=box(),region=bottom(source),result=autoMarkLocations([{...source,id:'T001.99',plannedMark:{point:[500,500,-2],normal:[0,0,-1],text:'T1',size:8,depth:.6,rotation:0,emboss:false,autoId:true,placement:'automatic'}}],{data:region});
 assert.equal(result.assigned,1);assert.equal(result.parts[0].plannedMark.text,'T001.99');assert.equal(result.parts[0].plannedMark.placement,'automatic');assert.ok(Math.abs(result.parts[0].plannedMark.point[0])<50,'invalid old anchor is not kept merely because one was stored');
});
