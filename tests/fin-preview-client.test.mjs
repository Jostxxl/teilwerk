import test from 'node:test';import assert from 'node:assert/strict';
import {createFinPreviewClient} from '../src/fin-preview-client.mjs';
const tick=()=>new Promise(r=>setTimeout(r,5));
class PreviewWorker{static instances=[];constructor(){this.sent=[];PreviewWorker.instances.push(this);}postMessage(message,...transfer){this.sent.push({message,transfer});}terminate(){this.stopped=true;}reply(token,result,extra={}){const request=this.sent.map(x=>x.message).findLast(x=>x.token?.sequence===token.sequence);this.onmessage({data:{requestId:request?.requestId,token,result,...extra}});}}
test('hover worker coalesces while busy, retains originals and rejects replies from a replaced model worker',async()=>{
 const results=[],client=createFinPreviewClient({workerFactory:()=>new PreviewWorker(),delay:0,onResult:r=>results.push(r)}),part={vertices:new Float32Array([0,0,0]),triangles:new Uint32Array([0,0,0])};
 const token=n=>({id:'1',revision:1,generation:1,sequence:n});
 client.request(part,token(1),{a:[0,0,1]});await tick();const first=PreviewWorker.instances.at(-1);
 assert.equal(first.sent.length,2);assert.equal(first.sent[0].message.op,'model');assert.deepEqual(first.sent[0].transfer,[]);assert.equal(part.vertices.byteLength,12);
 client.request(part,token(2),{});client.request(part,token(3),{});assert.equal(first.sent.length,2);
 first.reply(token(1),{valid:true});await tick();assert.equal(first.sent.at(-1).message.token.sequence,3);
 client.request({...part},{...token(4),revision:2},{});await tick();assert.equal(first.stopped,true);first.reply(token(3),{valid:true});assert.equal(results.length,1);
 const second=PreviewWorker.instances.at(-1);assert.equal(second.sent.at(-1).message.token.revision,2);client.dispose();assert.equal(second.stopped,true);
});
test('leaving the model clears a queued preview without sending a calculation',async()=>{let clears=0;const client=createFinPreviewClient({workerFactory:()=>new PreviewWorker(),delay:200,onResult:()=>{},onClear:()=>clears++});client.request({vertices:[],triangles:[]},{id:'1',revision:1},{});client.clear();await tick();assert.equal(PreviewWorker.instances.at(-1).sent.length,1);assert.equal(clears,1);client.dispose();});

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),token=sequence=>({id:'7',revision:1,generation:1,sequence}),settings={tool:'draw',a:[0,0,20],b:[10,0,25],tines:true,tineDensity:1,layerHeight:.2,material:'pla'},bed=[250,250,250];
test('full authority is posted once; idle validation upgrades the same hover only after its coarse result',async()=>{
 const part={vertices:new Float32Array([1,2,3]),triangles:new Uint32Array([0,0,0]),nativeGeometry:{frame:'assembly',binding:'literal'},assemblyMatrix:[1,2],supports:{fins:[{id:'m1'}]}},before=structuredClone(part),results=[];
 const client=createFinPreviewClient({workerFactory:()=>new PreviewWorker(),delay:0,validationDelay:20,onResult:r=>results.push(r)});
 try{client.request(part,token(1),settings,bed);await tick();const w=PreviewWorker.instances.at(-1);assert.equal(w.sent[0].message.data,part);assert.deepEqual(w.sent[0].message.bed,bed);assert.deepEqual(w.sent[0].transfer,[]);assert.equal(w.sent.at(-1).message.op,'preview');w.reply(token(1),{valid:false});await sleep(25);assert.equal(w.sent.at(-1).message.op,'validate');w.reply(token(1),{valid:true,contactChecked:true});assert.deepEqual(results.map(x=>x.previewStage),[0,1]);assert.equal(results[1].contactChecked,true);assert.deepEqual(part,before);
 client.request(part,token(2),settings,bed);await tick();assert.equal(w.sent.filter(x=>x.message.op==='model').length,1);
 }finally{client.dispose();}
});
test('new hover suppresses obsolete native validation and latest quiet point alone is checked',async()=>{
 const results=[],part={},client=createFinPreviewClient({workerFactory:()=>new PreviewWorker(),delay:0,validationDelay:15,onResult:r=>results.push(r)});
 try{client.request(part,token(1),settings,bed);await tick();const w=PreviewWorker.instances.at(-1);w.reply(token(1),{valid:false});await sleep(20);assert.equal(w.sent.at(-1).message.op,'validate');client.request(part,token(2),{...settings,b:[12,0,25]},bed);client.request(part,token(3),{...settings,b:[14,0,25]},bed);w.reply(token(1),{valid:true,contactChecked:true});await tick();assert.deepEqual(results.map(x=>x.sequence),[1]);assert.equal(w.sent.at(-1).message.token.sequence,3);w.reply(token(3),{valid:false});await sleep(20);assert.equal(w.sent.at(-1).message.op,'validate');assert.equal(w.sent.at(-1).message.token.sequence,3);w.reply(token(3),{valid:true});assert.deepEqual(results.map(x=>[x.sequence,x.previewStage]),[[1,0],[3,0],[3,1]]);
 }finally{client.dispose();}
});
test('option changes suppress old coarse results; explicit invalidation retains no approved ghost',async()=>{
 const results=[],part={},client=createFinPreviewClient({workerFactory:()=>new PreviewWorker(),delay:0,validationDelay:100,onResult:r=>results.push(r)});
 try{client.request(part,token(1),settings,bed);await tick();const w=PreviewWorker.instances.at(-1);client.request(part,token(2),{...settings,layerHeight:.3},bed);w.reply(token(1),{valid:true});assert.equal(results.length,0);await tick();w.reply(token(2),{valid:false});assert.equal(results.length,1);client.clear();await sleep(110);assert.equal(w.sent.some(x=>x.message.op==='validate'),false);
 }finally{client.dispose();}
});
test('cancelling isolated native preview discards its worker; next gesture owns a fresh worker',async()=>{
 const results=[],part={},client=createFinPreviewClient({workerFactory:()=>new PreviewWorker(),delay:0,validationDelay:10,onResult:r=>results.push(r)});
 try{client.request(part,token(1),settings,bed);await tick();const first=PreviewWorker.instances.at(-1);first.reply(token(1),{valid:false});await sleep(15);client.clear();assert.equal(first.stopped,true);first.reply(token(1),{valid:true});assert.equal(results.length,1);client.request(part,{...token(2),generation:2},settings,bed);await tick();const second=PreviewWorker.instances.at(-1);assert.notEqual(second,first);assert.equal(second.sent[0].message.op,'model');
 }finally{client.dispose();}
});
test('fatal validation retires poisoned worker, never repeats the job, then permits a fresh kernel on new hover',async()=>{
 const results=[],part={},client=createFinPreviewClient({workerFactory:()=>new PreviewWorker(),delay:0,validationDelay:10,onResult:r=>results.push(r)});
 try{client.request(part,token(1),settings,bed);await tick();const w=PreviewWorker.instances.at(-1);w.reply(token(1),{valid:false});await sleep(15);w.reply(token(1),{valid:false,message:'RuntimeError'},{fatal:true});assert.equal(w.stopped,true);await sleep(15);assert.equal(w.sent.filter(x=>x.message.op==='validate').length,1);client.request(part,token(2),settings,bed);await tick();assert.notEqual(PreviewWorker.instances.at(-1),w);
 }finally{client.dispose();}
});
test('native preview timeout is bounded and cannot release a late approval',async()=>{
 const results=[],client=createFinPreviewClient({workerFactory:()=>new PreviewWorker(),delay:0,validationDelay:10,validationTimeout:15,onResult:r=>results.push(r)});
 try{client.request({},token(1),settings,bed);await tick();const w=PreviewWorker.instances.at(-1);w.reply(token(1),{valid:false});await sleep(40);assert.equal(w.stopped,true);assert.equal(results.at(-1).valid,false);assert.match(results.at(-1).message,/zu lange/);w.reply(token(1),{valid:true});assert.equal(results.at(-1).valid,false);assert.equal(w.sent.filter(x=>x.message.op==='validate').length,1);
 }finally{client.dispose();}
});
