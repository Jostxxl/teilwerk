import Module from 'manifold-3d';
import wasmURL from 'manifold-3d/manifold.wasm?url';
import {createFinPreviewWorkerHost} from './fin-preview-worker-host.mjs';
let ready;
const host=createFinPreviewWorkerHost({getNativeApi:()=>ready??=(Module({locateFile:()=>wasmURL}).then(api=>{api.setup();return api;})),emit:message=>self.postMessage(message)});
// Native setup can yield; serialized messages keep one owner of this kernel.
let queue=Promise.resolve();
self.onmessage=({data})=>{queue=queue.then(()=>host.handle(data));};
