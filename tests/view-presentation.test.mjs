import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_VIEW_PRESENTATION,normalizeViewPresentation,restoreViewPresentation,resolveDisplayColor} from '../src/view-presentation.mjs';
test('default preserves ordinary part colors and is safely JSON-restorable',()=>{
 const a=normalizeViewPresentation(),b=restoreViewPresentation(JSON.parse(JSON.stringify(a)));assert.deepEqual(a,{mode:'parts',color:'#d5d9d9'});assert.deepEqual(a,b);assert.notEqual(a,b);assert.ok(Object.isFrozen(a)&&Object.isFrozen(DEFAULT_VIEW_PRESENTATION));assert.equal(resolveDisplayColor({color:'#AABBCC'},0,['#ffffff']), '#AABBCC');
});
test('single mode resolves every display part without mutating source colors, authority or buffers',()=>{
 const vertices=new Float64Array([0,0,0,1,0,0,0,1,0]),triangles=new Uint32Array([0,1,2]),authority=Object.freeze({payload:'native authority'}),p=Object.freeze({id:'7',color:'#ff0000',vertices,triangles,nativeGeometry:authority,note:'keep'}),palette=Object.freeze(['#00ff00','#0000ff']),before=structuredClone(p),state=normalizeViewPresentation({mode:'single',color:'#A0B1C2'});
 assert.equal(resolveDisplayColor(p,0,palette,state),'#a0b1c2');assert.equal(resolveDisplayColor({color:'#0000ff'},1,palette,state),'#a0b1c2');assert.deepEqual(p,before);assert.equal(p.vertices,vertices);assert.equal(p.triangles,triangles);assert.equal(p.nativeGeometry,authority);assert.deepEqual(palette,['#00ff00','#0000ff']);assert.equal(resolveDisplayColor(p,0,palette,{...state,mode:'parts'}),'#ff0000');
});
test('palette fallback is deterministic and never writes a generated color into a part',()=>{
 const part=Object.freeze({id:'11'}),palette=['#112233','#445566'];assert.equal(resolveDisplayColor(part,3,palette),'#445566');assert.equal(resolveDisplayColor(part,0,[]),'#bde780');assert.equal(resolveDisplayColor(part,0,['broken']),'#bde780');assert.equal(resolveDisplayColor(part,-3,palette),'#112233');assert.deepEqual(part,{id:'11'});
});
test('saved preferences detach from mutable input and reject malformed modes/colors and accessors',()=>{
 const raw={mode:'single',color:'#123ABC'},value=normalizeViewPresentation(raw);raw.color='#ffffff';assert.equal(value.color,'#123abc');let reads=0;const accessor={get mode(){reads++;return 'single';}};
 for(const bad of [null,[],{mode:'unknown'},{mode:null},{color:'red'},{color:'#fff'},{color:'#12345678'},{color:'url(example)'},{mode:'single',extra:true},Object.create({mode:'single'}),accessor])assert.throws(()=>normalizeViewPresentation(bad),/Ansichtsfarbe/);assert.equal(reads,0);
});
test('single mode does not inspect or modify backend authority or the actual saved part color',()=>{
 let reads=0;const part={get color(){reads++;throw Error('not needed');},get exactGeometry(){throw Error('not needed');}};assert.equal(resolveDisplayColor(part,0,[],{mode:'single',color:'#d5d9d9'}),'#d5d9d9');assert.equal(reads,0);
});
