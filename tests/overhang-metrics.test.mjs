import test from 'node:test';
import assert from 'node:assert/strict';
import {overhangMetrics} from '../src/overhang-metrics.mjs';

const near=(actual,expected,message='equal area')=>assert.ok(Math.abs(actual-expected)<=Math.max(1e-12,Math.abs(expected)*1e-10),`${message}: ${actual} != ${expected}`);
function triangle(points){return{vertices:points.flat(),triangles:[0,1,2]};}
function subdivide(data){const vertices=[],triangles=[];for(let i=0;i<data.triangles.length;i+=3){const [a,b,c]=[0,1,2].map(k=>Array.from(data.vertices.slice(data.triangles[i+k]*3,data.triangles[i+k]*3+3))),ab=a.map((v,k)=>(v+b[k])/2),bc=b.map((v,k)=>(v+c[k])/2),ca=c.map((v,k)=>(v+a[k])/2);for(const face of [[a,ab,ca],[ab,b,bc],[ca,bc,c],[ab,bc,ca]]){const start=vertices.length/3;vertices.push(...face.flat());triangles.push(start,start+1,start+2);}}return{vertices,triangles};}
function area(points){const [a,b,c]=points,u=b.map((v,k)=>v-a[k]),v=c.map((x,k)=>x-a[k]);return Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])/2;}

test('a densely triangulated underside retains its actual overhang area',()=>{
 let mesh={vertices:[0,0,10,2,0,10,0,2,10,2,2,10],triangles:[0,2,1,1,2,3]};const coarse=overhangMetrics(mesh);
 for(let i=0;i<5;i++)mesh=subdivide(mesh);const dense=overhangMetrics(mesh);
 assert.equal(mesh.triangles.length/3,2048);near(coarse.severeArea,4);near(dense.severeArea,4);near(dense.supportArea,4);assert.equal(dense.needsFurtherSplit,true);near(dense.maxAngle,90);
});

test('bed exclusion clips one or two raised corners by the exact similar-triangle area',()=>{
 for(const [points,fraction] of [[[[0,0,1.35],[0,10,-.65],[10,0,-.65]],.25],[[[0,0,-.65],[0,10,1.35],[10,0,1.35]],.75]]){
  const result=overhangMetrics(triangle(points));near(result.severeArea,area(points)*fraction);near(result.supportArea,result.severeArea);
 }
});

test('subdivision across the bed exclusion plane does not change metrics',()=>{
 for(const points of [[[0,0,1.15],[0,12,-.45],[12,0,.15]],[[0,0,-.85],[0,12,.95],[12,0,.45]],[[0,0,.35],[0,12,1.25],[12,0,-.55]]]){
  let mesh=triangle(points);const expected=overhangMetrics(mesh);assert.ok(expected.severeArea>0);
  for(let depth=0;depth<5;depth++){mesh=subdivide(mesh);const result=overhangMetrics(mesh);near(result.severeArea,expected.severeArea,'clipped severe area');near(result.supportArea,expected.supportArea,'clipped support area');near(result.maxAngle,expected.maxAngle,'angle');}
 }
});

test('the bed itself and surfaces below it are excluded, upward faces are not overhangs',()=>{
 for(const z of [-1,0,.35]){const result=overhangMetrics(triangle([[0,0,z],[0,2,z],[2,0,z]]));assert.deepEqual(result,{supportArea:0,severeArea:0,maxAngle:0,limit:60,needsFurtherSplit:false});}
 assert.equal(overhangMetrics(triangle([[0,0,2],[2,0,2],[0,2,2]])).severeArea,0);
 near(overhangMetrics(triangle([[0,0,.3500001],[0,2,.3500001],[2,0,.3500001]])).severeArea,2);
});

test('only zero-area degeneracies are discarded, with no fixed triangle-area floor',()=>{
 const small=overhangMetrics(triangle([[0,0,1],[0,1e-5,1],[1e-5,0,1]]));assert.ok(small.severeArea>0);near(small.severeArea,5e-11);near(small.maxAngle,90);
 assert.equal(overhangMetrics(triangle([[0,0,1],[1,1,1],[2,2,1]])).maxAngle,0);
});

test('angle thresholds and the severe warning still apply after clipping',()=>{
 function slope(degrees){const h=10/Math.tan(degrees*Math.PI/180);return triangle([[0,0,2],[0,10,2],[10,0,2+h]]);}
 near(overhangMetrics(slope(45)).supportArea,0);near(overhangMetrics(slope(60)).severeArea,0);assert.ok(overhangMetrics(slope(60.1)).severeArea>1);assert.equal(overhangMetrics(slope(60.1)).needsFurtherSplit,true);
 assert.ok(overhangMetrics(slope(50),49).severeArea>0);
});
