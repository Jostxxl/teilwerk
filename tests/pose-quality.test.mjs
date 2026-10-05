import test from 'node:test';
import assert from 'node:assert/strict';
import {BoxGeometry,Matrix4} from 'three';
import {layFlat,ground,transformData} from '../src/engine.mjs';
import {refreshPoseQuality} from '../src/pose-quality.mjs';
import {partQualityMessages} from '../src/part-quality.mjs';
const mesh=()=>{const g=new BoxGeometry(20,30,40);return{vertices:new Float32Array(g.attributes.position.array),triangles:new Uint32Array(g.index.array)};};
test('manual reorientation retains cut provenance and replaces stale fin/pose evidence',()=>{
 const source={...mesh(),id:'3',color:'#f59f27',cutQuality:{version:1,issues:[{reason:'small_component',volume:12}]},cutLineage:[{ownerId:2,volume:12}],supports:{enabled:true,count:1},supportNotice:'Alte Warnung',supportOrientation:{method:'current'},overhang:{severeArea:100000,needsFurtherSplit:true},largestFace:{area:500}};
 const result=refreshPoseQuality(source,layFlat(source,[1,0,0]));
 assert.equal(result.id,'3');assert.deepEqual(result.cutLineage,source.cutLineage);assert.deepEqual(result.cutQuality,source.cutQuality);assert.equal(result.supports,undefined);assert.equal(result.supportOrientation,undefined);assert.equal(result.largestFace,undefined);assert.match(result.supportNotice,/neu berechnen/);assert.equal(result.overhang.severeArea,0);assert.equal(result.requiresCutFace,false);assert.equal(result.bedContactArea,1200);assert.ok(partQualityMessages(result).some(s=>s.includes('Reststück')));assert.ok(source.supports.enabled);
});
test('a rotated box resting on an edge does not inherit a claimed flat bed face',()=>{
 const source={...mesh(),bedContactArea:600,requiresCutFace:false,bedFace:'cut'};
 const result=refreshPoseQuality(source,ground(transformData(source,new Matrix4().makeRotationX(.3))));
 assert.equal(result.bedContactArea,0);assert.equal(result.requiresCutFace,true);assert.ok(result.overhang.severeArea>1);assert.ok(partQualityMessages(result).some(s=>s.includes('Überhänge')));
});
