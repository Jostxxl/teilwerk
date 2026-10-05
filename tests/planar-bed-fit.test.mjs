import test from 'node:test';import assert from 'node:assert/strict';
import {BoxGeometry,Matrix4} from 'three';
import {convexHull2D,fitPlanarHull} from '../src/planar-bed-fit.mjs';
import {orientOnCutFace} from '../src/cut-orientation.mjs';
import {transformData,bounds} from '../src/engine.mjs';
const rotate=(points,a)=>points.map(([x,y])=>[x*Math.cos(a)-y*Math.sin(a),x*Math.sin(a)+y*Math.cos(a)]);
const rectangle=(x,y)=>[[-x/2,-y/2],[x/2,-y/2],[x/2,y/2],[-x/2,y/2]];
const sizeAt=(hull,a)=>{const points=rotate(hull,a);return [0,1].map(i=>Math.max(...points.map(p=>p[i]))-Math.min(...points.map(p=>p[i])));};
test('a 330 mm long narrow part fits diagonally on a 250 mm square bed',()=>{
 const fit=fitPlanarHull(convexHull2D(rectangle(330,20)),[250,250]);assert.ok(fit);assert.ok(fit.size.every(v=>v<250));assert.ok(fit.angle>0&&fit.angle<Math.PI/2);
});
test('continuous fit finds a narrow feasible interval missed by every 15-degree sample',()=>{
 const hull=convexHull2D(rotate(rectangle(250,200),7.3*Math.PI/180)),bed=[250,200];
 for(let degrees=0;degrees<180;degrees+=15)assert.ok(sizeAt(hull,degrees*Math.PI/180).some((v,i)=>v>bed[i]+.005));
 const fit=fitPlanarHull(hull,bed);assert.ok(fit?.continuous);assert.ok(fit.size.every((v,i)=>v<=bed[i]+.005+1e-8));
});
test('full footprint width prevents a misleading diagonal-only fit',()=>{
 assert.equal(fitPlanarHull(convexHull2D(rectangle(300,200)),[250,250]),null);
});
test('convex hull keeps all extremes and discards duplicates and interior points',()=>{
 assert.deepEqual(convexHull2D([[0,0],[1,0],[1,1],[0,1],[.3,.4],[0,0],[.5,0]]),[[0,0],[1,0],[1,1],[0,1]]);
 assert.ok(fitPlanarHull(convexHull2D([[0,0],[5,0],[10,0]]),[8,8]));
});
test('real cut-face orientation uses an in-between angle and remains on its flat bed face',()=>{
 const g=new BoxGeometry(250,200,10),raw={vertices:new Float32Array(g.attributes.position.array),triangles:new Uint32Array(g.index.array),cutPlanes:[{normal:[0,0,-1],offset:5}]},data=transformData(raw,new Matrix4().makeRotationZ(7.3*Math.PI/180));
 const result=orientOnCutFace(data,[250,200,20]),box=bounds(result);assert.equal(result.bedFace,'cut');assert.ok(result.bedContactArea>49999);assert.ok(Math.abs(box.min[2])<1e-5);assert.ok(box.size.every((v,i)=>v<=[250,200,20][i]+.005));
});
test('translated asymmetric hulls agree with a dense independent feasible-angle witness',()=>{
 const hull=convexHull2D([[20,30],[150,32],[172,71],[128,110],[34,117],[-13,81]]);
 for(const bed of [[140,130],[130,120],[100,100],[155,85]]){let witness=false;for(let d=0;d<180;d+=.025)if(sizeAt(hull,d*Math.PI/180).every((v,i)=>v<=bed[i])){witness=true;break;}const fit=fitPlanarHull(hull,bed,{tolerance:0});if(witness)assert.ok(fit);if(fit)assert.ok(sizeAt(hull,fit.angle).every((v,i)=>v<=bed[i]+1e-8));}
});
