import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import Module from 'manifold-3d';
import {createTutorialGeometry} from '../src/tutorial-model.mjs';
import {bounds, toSolid, splitPlane} from '../src/engine.mjs';
import {browserOnlyMode, requireLocalExactRuntime} from '../src/runtime-mode.mjs';
import {studioPublicAssets, PUBLIC_BRAND_FILES, PUBLIC_LICENSE_FILES} from '../build-public-assets.mjs';

test('forced web mode remains browser-only even on localhost',()=>{
  assert.equal(browserOnlyMode({hostname:'studio.prinjekt.de'}),true);
  assert.equal(browserOnlyMode({hostname:'127.0.0.1',forced:true}),true);
  assert.equal(browserOnlyMode({hostname:'127.0.0.1',forced:false}),false);
  assert.equal(browserOnlyMode({hostname:'127.0.0.1.attacker.test',forced:false}),true);
});

test('public Vite configuration always forces browser-only mode and a relative deployment base',async()=>{
  const {default:config}=await import('../vite.config.mjs');
  const value=typeof config==='function'?await config({command:'build',mode:'production'}):await config;
  assert.equal(value.define.__STUDIO_BROWSER_ONLY__,'true');
  assert.equal(value.base,'./');
  assert.equal(value.publicDir,false);
  assert.equal(value.worker.format,'es');
});

test('exact client cannot start a remote job or send model data from a public origin',async()=>{
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'location');
  Object.defineProperty(globalThis,'location',{configurable:true,value:{hostname:'studio.prinjekt.de',origin:'https://studio.prinjekt.de'}});
  try {
    assert.throws(()=>requireLocalExactRuntime(),/überträgt keine Modelldaten/);
    const {createExactJobClient}=await import('../src/exact-job-client.mjs');
    let called=false;
    assert.throws(()=>createExactJobClient({fetchImpl:()=>{called=true;}}),/überträgt keine Modelldaten/);
    assert.equal(called,false);
  } finally { if(descriptor)Object.defineProperty(globalThis,'location',descriptor);else delete globalThis.location; }
});

test('only reviewed brand assets are published, no local models or saved masks',async()=>{
  const emitted=[];
  await studioPublicAssets().generateBundle.call({emitFile:value=>emitted.push(value)});
  assert.deepEqual(emitted.map(item=>item.fileName),[...PUBLIC_BRAND_FILES,...PUBLIC_LICENSE_FILES]);
  assert.ok(emitted.every(item=>item.source.byteLength>0 && /^(brand|licenses)\//.test(item.fileName)));
  const source=await readFile(new URL('../src/main.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(source,/Hexenhaus|model.*===.*roof|models\/.*\.stl/);
});

test('generic exercise plate is a closed solid and splits into two complete printable solids',async()=>{
  const api=await Module();api.setup();
  const geometry=createTutorialGeometry();
  const data={vertices:new Float32Array(geometry.attributes.position.array),triangles:Uint32Array.from({length:geometry.attributes.position.count},(_,i)=>i)};
  const solid=toSolid(api,data);
  try {
    assert.equal(solid.status(),'NoError');
    assert.deepEqual(bounds(data).size,[360,140,18]);
    const split=splitPlane(api,data,[1,0,0],0);
    assert.equal(split.length,2);
    let total=0;
    for(const part of split){const body=toSolid(api,part);try{assert.equal(body.status(),'NoError');total+=body.volume();assert.ok(bounds(part).size.every(v=>v<=250));}finally{body.delete();}}
    assert.ok(Math.abs(total-solid.volume())<1e-4);
  }finally{solid.delete();geometry.dispose();}
});
