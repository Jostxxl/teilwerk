import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import {BoxGeometry,Matrix4,Vector3} from 'three';
import {prepareManualFinPath} from '../src/manual-fin-path.mjs';
import {drawnLine,drawnWall} from '../src/vendor/support-fins/draw.js';
import {PROP} from '../src/vendor/support-fins/prop.js';

function tiltedBox(degrees=35){
 const angle=degrees*Math.PI/180,T=new Matrix4().makeTranslation(0,0,20*Math.sin(angle)).multiply(new Matrix4().makeRotationY(angle));
 const g=new BoxGeometry(40,20,20);g.translate(0,0,10);g.applyMatrix4(T);const soup=Float64Array.from(Array.from(g.index.array).flatMap(i=>Array.from(g.attributes.position.array.slice(i*3,i*3+3))));
 const a=new Vector3(20,0,0).applyMatrix4(T).toArray(),b=new Vector3(-19,0,0).applyMatrix4(T).toArray();g.dispose();return {a,b,soup};
}
function surface(xs,zs){const soup=[];for(let i=0;i<xs.length-1;i++){const a=[xs[i],-5,zs[i]],b=[xs[i+1],-5,zs[i+1]],c=[xs[i+1],5,zs[i+1]],d=[xs[i],5,zs[i]];soup.push(...a,...c,...b,...a,...d,...c);}return new Float64Array(soup);}

test('inclined body: bed-edge click used to reject entire high wall; low end is shortened',()=>{
 const f=tiltedBox(),before=structuredClone(f),old=drawnWall(f.a,f.b,f.soup,0,{tines:false});assert.equal(old.ok,false);assert.match(old.reason,/line sits at the plate/);
 const p=prepareManualFinPath(f.a,f.b,f.soup);assert.equal(p.trimmed,true);assert(p.startFraction>0);assert.equal(p.endFraction,1);assert(p.minimumHeight>=PROP.minHeight);assert.deepStrictEqual(p.b,f.b);assert.match(p.notice,/gekürzt/);
 const current=drawnWall(p.a,p.b,f.soup,0,{tines:false});assert.equal(current.ok,true);assert.equal(current.partAttached,undefined);assert.deepStrictEqual(f,before);assert.equal(p.checkedGeometry,false);
 assert.deepStrictEqual(p,prepareManualFinPath(f.a,f.b,f.soup));
});
test('reversed line trims its low trailing end and never changes high endpoint',()=>{
 const f=tiltedBox(45),p=prepareManualFinPath(f.b,f.a,f.soup);assert.equal(p.startFraction,0);assert(p.endFraction<1);assert.deepStrictEqual(p.a,f.b);assert.equal(drawnWall(p.a,p.b,f.soup).ok,true);
});
test('valid existing high line keeps literal endpoints and upstream output unchanged',()=>{
 const soup=surface([0,30],[20,20]),a=[0,0,20],b=[30,0,20],p=prepareManualFinPath(a,b,soup);
 assert.equal(p.trimmed,false);assert.deepStrictEqual(p.a,a);assert.deepStrictEqual(p.b,b);assert.deepStrictEqual(drawnWall(a,b,soup),drawnWall(p.a,p.b,soup));
 assert.equal(crypto.createHash('sha256').update(fs.readFileSync(new URL('../src/vendor/support-fins/draw.js',import.meta.url))).digest('hex'),'82281f4c88f39d9b5391f0a51b8bba8fdc00919119649a64eea34482e764e8ad');
});
test('genuinely low or too short remaining line has concrete German message',()=>{
 assert.throws(()=>prepareManualFinPath([0,0,0],[30,0,0],surface([0,30],[0,0])),e=>e.reason==='near_bed'&&/höher/.test(e.message));
 assert.throws(()=>prepareManualFinPath([0,0,0],[10,0,2],surface([0,10],[0,2])),e=>e.reason==='short_remainder');
});
test('interior low gap is rejected rather than silently crossing or selecting another region',()=>{
 const soup=surface([0,10,15,20,30],[10,10,0,10,10]);assert.throws(()=>prepareManualFinPath([0,0,10],[30,0,10],soup),e=>e.reason==='interior_low_section');
});
test('high endpoints cannot produce vendor at-plate reason even when a lower floor blocks sampling',()=>{
 const soup=surface([0,30],[0,0]),a=[0,0,20],b=[30,0,20],old=drawnWall(a,b,soup);assert.equal(old.ok,false);assert.doesNotMatch(old.reason,/line sits at the plate/);assert.throws(()=>prepareManualFinPath(a,b,soup),e=>e.reason==='blocked_surface');
});
test('invalid inputs and bounded work fail before unbounded surface sampling',()=>{
 assert.throws(()=>prepareManualFinPath([0,0,0],[8,0,10],new Float64Array([1,2,3])),e=>e.reason==='invalid_surface');
 assert.throws(()=>prepareManualFinPath([0,0,0],[301,0,10],surface([0,301],[0,10])),e=>e.reason==='invalid_span');
 const soup=new Float64Array(90_000*9);assert.throws(()=>prepareManualFinPath([0,0,0],[300,0,10],soup),e=>e.reason==='work_limit');
});
test('preview centering worldToLocal retains high print coordinates before and after committed rotations',()=>{
 // The actual controller nests mesh(-center) beneath pivot(center). Fin picking
 // is allowed only with no uncommitted rotation, so their transforms cancel.
 const samples=[[0,0,80],[512,-300,127]];
 for(const p of samples){const center=new Vector3(100,-200,65),meshMatrix=new Matrix4().makeTranslation(...center.toArray()).multiply(new Matrix4().makeTranslation(...center.clone().negate().toArray()));const local=new Vector3(...p).applyMatrix4(meshMatrix.clone().invert()).toArray();assert.deepStrictEqual(local,p);assert(local[2]>50);}
 const f=tiltedBox(),T=new Matrix4().makeRotationY(Math.PI/2),clicked=new Vector3(...f.b).applyMatrix4(T);const min=-100;clicked.z-=min;const newCenter=new Vector3(-20,12,70),M=new Matrix4().makeTranslation(...newCenter.toArray()).multiply(new Matrix4().makeTranslation(...newCenter.clone().negate().toArray()));assert.deepStrictEqual(clicked.clone().applyMatrix4(M.clone().invert()).toArray(),clicked.toArray());
});
