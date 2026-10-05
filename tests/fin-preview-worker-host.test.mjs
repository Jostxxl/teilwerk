import test from 'node:test';
import assert from 'node:assert/strict';
import {createFinPreviewWorkerHost} from '../src/fin-preview-worker-host.mjs';
const mesh=()=>({vertices:new Float32Array([0,0,0,10,0,0,0,0,10]),triangles:new Uint32Array([0,1,2])});
const supports=()=>({...mesh(),fins:[{id:'m1',triangleStart:0,triangleCount:1,spec:{mode:'draw'}}]});
const settings={tool:'draw',a:[0,0,20],b:[10,0,25],material:'pla',layerHeight:.2},token={id:'7',revision:2,generation:1,sequence:1};
const request=(op='validate',extra={})=>({op,requestId:4,token,settings,...extra});
test('coarse wall is explicitly pending, does not initialize native code or expose source authority',async()=>{
 let calls=0;const out=[],host=createFinPreviewWorkerHost({getNativeApi:()=>{calls++;},emit:m=>out.push(m),coarse:()=>({...mesh(),valid:true,nativeGeometry:{private:true}})});
 await host.handle({op:'model',data:{nativeGeometry:{original:true}},bed:[250,250,250]});await host.handle(request('preview'));assert.equal(calls,0);assert.equal(out[0].requestId,4);assert.equal(out[0].result.valid,false);assert.equal(out[0].result.contactChecked,false);assert.equal(out[0].result.displayOnly,true);assert.equal(out[0].result.nativeGeometry,undefined);
});
test('native preview calls commit core on full original source and same settings, exports only detached newest fin',async()=>{
 const original={...mesh(),nativeGeometry:{assembly:true},assemblyMatrix:[1,2],supports:{fins:[{id:'old'}]}},before=structuredClone(original),bed=[250,250,250],api={native:true},out=[];
 const result={vertices:new Float32Array([0,0,0,10,0,0,0,0,10,1,1,0,11,1,0,1,1,10]),triangles:new Uint32Array([0,1,2,3,4,5]),fins:[{id:'old',triangleStart:0,triangleCount:1},{id:'new',triangleStart:1,triangleCount:1,spec:{mode:'draw'}}],nativeGeometry:{mustNotEscape:true}};
 const host=createFinPreviewWorkerHost({getNativeApi:()=>api,emit:m=>out.push(m),draw:(a,p,b,s)=>{assert.equal(a,api);assert.equal(p,original);assert.equal(b,bed);assert.equal(s,settings);return result;}});
 await host.handle({op:'model',data:original,bed});await host.handle(request());assert.deepEqual(original,before);assert.deepEqual([...out[0].result.vertices],[1,1,0,11,1,0,1,1,10]);assert.deepEqual([...out[0].result.triangles],[0,1,2]);assert.equal(out[0].result.valid,true);assert.equal(out[0].result.contactChecked,true);assert.equal(out[0].result.nativeGeometry,undefined);assert.equal(out[0].result.fins,undefined);result.vertices[9]=99;assert.equal(out[0].result.vertices[0],1);
});
test('ordinary core rejection remains visible and a later corrected point may succeed',async()=>{
 let calls=0;const out=[],host=createFinPreviewWorkerHost({getNativeApi:()=>({}),emit:m=>out.push(m),draw:()=>{if(++calls===1)throw Error('Kontaktzahn reicht nicht');return supports();}});
 await host.handle({op:'model',data:{},bed:[250,250,250]});await host.handle(request());assert.equal(out[0].result.valid,false);assert.match(out[0].result.message,/Kontaktzahn/);assert.equal(out[0].result.vertices,undefined);await host.handle(request());assert.equal(out[1].result.valid,true);assert.equal(host.poisoned,false);
});
test('fatal core failure poisons worker and permits no further native calls or cleanup',async()=>{
 let calls=0,apis=0;const out=[],host=createFinPreviewWorkerHost({getNativeApi:()=>{apis++;return{};},emit:m=>out.push(m),draw:()=>{calls++;throw new WebAssembly.RuntimeError('controlled fatal');}});
 await host.handle({op:'model',data:{},bed:[250,250,250]});await host.handle(request());assert.equal(host.poisoned,true);assert.equal(out[0].fatal,true);await host.handle({op:'model',data:{},bed:[250,250,250]});await host.handle(request());await host.handle(request('preview'));assert.equal(apis,1);assert.equal(calls,1);assert.equal(out.length,1);
});
test('malformed bed and unknown tool reject before native initialization',async()=>{
 let calls=0;const out=[],host=createFinPreviewWorkerHost({getNativeApi:()=>{calls++;},emit:m=>out.push(m)});
 for(const bed of [Array(3),[250,NaN,250],[250,0,250],undefined]){await host.handle({op:'model',data:{},bed});await host.handle(request());assert.equal(out.at(-1).result.valid,false);}
 await host.handle({op:'model',data:{},bed:[250,250,250]});await host.handle(request('validate',{settings:{tool:'automatic'}}));assert.equal(calls,0);
});
test('sway uses the same validated fallback as commit and missing new fin is never approval',async()=>{
 let called=0;const out=[],host=createFinPreviewWorkerHost({getNativeApi:()=>({}),emit:m=>out.push(m),sway:()=>{called++;return supports();}});
 await host.handle({op:'model',data:{},bed:[250,250,250]});await host.handle(request('validate',{settings:{tool:'sway'}}));assert.equal(called,1);assert.equal(out[0].result.valid,true);
 await host.handle({op:'model',data:{supports:{fins:[{id:'m1'}]}},bed:[250,250,250]});await host.handle(request('validate',{settings:{tool:'sway'}}));assert.equal(out[1].result.valid,false);assert.match(out[1].result.message,/unvollständig/);
});
