import test from 'node:test';
import assert from 'node:assert/strict';
import {requireExactOperationSupport} from '../src/exact-operation-guard.mjs';

const part=()=>({id:'7',vertices:new Float32Array([1,2,3]),triangles:new Uint32Array([0,0,0]),exactGeometry:{kind:'exactGeometryBinding',authority:{meshText:'unchanged rational source'}}});
const rejected=op=>e=>e.code==='EXACT_OPERATION_UNSUPPORTED'&&e.operation===op;

test('all material, pose, permission and export entry points reject exact operands before any legacy work',()=>{
 const operations=['import','cut','auto','autoContours','contourPlan','autoPlanPreview','fit','mergeFit','orient','printOrient','flat','largestFace','scale','interiorSelect','autoMarkLocations','uniformMarkSize','mark','engravePlanned','planDowels','restoreDowels','restoreConnectorBase','printMeshes','supportFins','supportFinsAll','addManualFin','removeManualFin','restoreManualFins','seams','seamCut','seamsAuto','suggest','closeCandidates','adoptDrawn','drawPreview','drawCut','patchPreview','patchCut','loopPreview','futureKernelOperation'];
 for(const op of operations){let entered=false;assert.throws(()=>{requireExactOperationSupport({op,data:part()});entered=true;},rejected(op));assert.equal(entered,false);}
});

test('all operand containers protect mixed projects and connector pins rather than checking only active data',()=>{
 const p=part(),legacy={id:'1',vertices:[1,2,3],triangles:[0,0,0]};
 for(const field of ['data','part','parts','baseParts','currentParts','connectorBaseParts','connectorPins','pins']){
  const value=['data','part'].includes(field)?p:[legacy,p];assert.throws(()=>requireExactOperationSupport({op:'mergeFit',[field]:value}),e=>rejected('mergeFit')(e)&&e.partIds.includes('7'));
 }
 for(const container of ['project','plan','connectorPlan'])assert.throws(()=>requireExactOperationSupport({op:'printMeshes',[container]:{parts:[legacy],pins:[p]}}),rejected('printMeshes'));
});

test('display-only selection/coloring and explicit exact save/restore dispatch remain available',()=>{
 for(const op of ['smart','neighborColors','readProject','serializeProject','restoreExactProjectParts'])assert.doesNotThrow(()=>requireExactOperationSupport({op,data:part(),project:{parts:[part()]}}));
 // These are dispatcher capabilities, not validation of a forged authority.
 assert.doesNotThrow(()=>requireExactOperationSupport({op:'restoreExactProjectParts',parts:[{exactGeometry:null}]}));
});

test('malformed/null exact discriminators and raw authorities cannot silently fall back to rounded operands',()=>{
 for(const p of [{exactGeometry:null},{exactGeometry:{}},{kind:'exactGeometry'},{kind:'exactGeometryBinding'},{...part(),nativeGeometry:{}}])assert.throws(()=>requireExactOperationSupport({op:'cut',data:p}),rejected('cut'));
 assert.doesNotThrow(()=>requireExactOperationSupport({op:'cut',data:{vertices:[],triangles:[],exactGeometry:undefined}}));
});

test('the guard does not walk numerical geometry or change input and legacy projects keep their previous path',()=>{
 const p=part(),original=structuredClone(p);Object.defineProperty(p,'unrelated',{get(){assert.fail('unrelated property must not be inspected');}});
 assert.throws(()=>requireExactOperationSupport({op:'mark',parts:[p]}),rejected('mark'));assert.deepEqual(p.vertices,original.vertices);assert.deepEqual(p.triangles,original.triangles);assert.deepEqual(p.exactGeometry,original.exactGeometry);
 for(const op of ['import','cut','printMeshes','futureKernelOperation'])assert.doesNotThrow(()=>requireExactOperationSupport({op,data:{id:'1',nativeGeometry:{},vertices:new Float32Array(1000)}}));
 const message={op:'cut'};message.project=message;assert.doesNotThrow(()=>requireExactOperationSupport(message));
});

test('unsupported-operation messages identify the user action without invoking source serializers',()=>{
 const p=part();p.exactGeometry.toJSON=()=>assert.fail('must not serialize authority');assert.throws(()=>requireExactOperationSupport({op:'interiorSelect',data:p}),e=>e.message.includes('Innenflächenfreigabe')&&e.message.includes('Speichern, Farben, Notizen'));
 assert.throws(()=>requireExactOperationSupport(null),e=>e.code==='EXACT_OPERATION_INPUT');
});
