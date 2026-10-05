import test from 'node:test';
import assert from 'node:assert/strict';
import {BoxGeometry,Matrix4} from 'three';
import {neighborColors,neighborGraph,colorGraph} from '../src/neighbor-colors.mjs';
function box(x=0,y=0,z=0){const g=new BoxGeometry(10,10,10);g.translate(x,y,z);return{vertices:g.attributes.position.array,triangles:g.index.array};}
const palette=['#ff0000','#00ff00','#0000ff'];
function proper(graph,colors){graph.forEach((adjacent,i)=>adjacent.forEach(j=>assert.notEqual(colors[i],colors[j])));}
test('contact tolerance includes small gaps and excludes larger gaps',()=>{assert.equal(neighborGraph([box(),box(10.05)]).edges,1);assert.equal(neighborGraph([box(),box(10.11)]).edges,0);});
test('edge and corner contacts are counted',()=>{assert.equal(neighborGraph([box(),box(10,10)]).edges,1);assert.equal(neighborGraph([box(),box(10,10,10)]).edges,1);});
test('overlapping bounding boxes alone do not imply surface contact',()=>{const small=box();small.vertices=Float32Array.from(small.vertices,v=>v*.5);assert.equal(neighborGraph([box(),small]).edges,0);});
test('preview inverse print transform restores original contact',()=>{const moved=box(110);moved.transform=new Matrix4().makeTranslation(100,0,0).toArray();assert.equal(neighborColors([box(),moved],palette,{preview:true}).edges,1);assert.equal(neighborColors([box(),moved],palette).edges,0);});
test('neighbor analysis does not mutate mesh buffers',()=>{const a=box(),b=box(10),vertices=Array.from(b.vertices),triangles=Array.from(b.triangles);b.assemblyMatrix=new Matrix4().makeRotationZ(.1).toArray();neighborColors([a,b],palette);assert.deepEqual(Array.from(b.vertices),vertices);assert.deepEqual(Array.from(b.triangles),triangles);});
test('backtracking resolves a greedy DSATUR dead end with available colors',()=>{const graph=[[4,5,10,13,14,16],[6,8,9,11,14,15],[7,12,16],[4,8,11],[0,3,11,12],[0,15,16],[1],[2,12,14],[1,3,12,13,15,16],[1,13,14],[0,11],[1,3,4,10,15,16],[2,4,7,8,13],[0,8,9,12],[0,1,7,9,15],[1,5,8,11,14,17],[0,2,5,8,11,17],[15,16]];const colors=colorGraph(graph,palette);proper(graph,colors);assert.equal(new Set(colors).size,3);});
test('a clique larger than the distinct palette is rejected',()=>{const graph=Array.from({length:4},(_,i)=>[0,1,2,3].filter(j=>j!==i));assert.throws(()=>colorGraph(graph,palette),/Palette reicht/);});
test('case variations are one color and asymmetric contact entries are normalized',()=>{assert.throws(()=>colorGraph([[1],[]],['#ABCDEF','#abcdef']),/Palette reicht/);assert.notEqual(...colorGraph([[1],[]],palette));});
test('empty models and invalid inputs are handled explicitly',()=>{assert.deepEqual(neighborColors([],palette),{neighbors:[],edges:0,colors:[]});assert.throws(()=>colorGraph([[]],['red']),/gültige Farbe/);assert.throws(()=>colorGraph([[0]],palette),/nachbarschaft/);assert.throws(()=>neighborGraph([],{tolerance:NaN}),/Kontakttoleranz/);});

