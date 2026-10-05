import {prepareLocalContours} from './local-contours.mjs';
import {requireExactOperationSupport} from './exact-operation-guard.mjs';
import {straightPlanProposals} from './straight-plan.mjs';
import {groupPreviewWalls} from './group-preview-walls.mjs';
import {consolidateDraft} from './consolidate-draft.mjs';
import {closeGroupedPlan} from './close-grouped-plan.mjs';
import {captureClosedNativePart,validateNativeBinding} from './native-geometry-binding.mjs';
import {restoreNativeProjectGeometry} from './native-project-geometry.mjs';
import {serializeProjectDocument,parseProjectDocument,PROJECT_FILE_LIMIT} from './project-codec.mjs';
import {previewCutWalls} from './preview-walls.mjs';
import {selectInterior,autoMarkLocations,findUniformMarkSize} from './interior-marking.mjs';
import {throughSurfacePlan} from './through-plan.mjs';
import {cutterFromDefinition} from './features.mjs';
import {neighborColors} from './neighbor-colors.mjs';
import {openSurfacePlan} from './open-plan.mjs';
import {supportFins,supportFinsAll} from './supports.mjs';
import {addManualFin,removeManualFin,rebuildManualFins} from './manual-fins.mjs';
import {addManualDrawnFin} from './manual-drawn-fins.mjs';
import {addManualFinWithFallback} from './manual-fin-fallback.mjs';
import {prepareManualPrintPose} from './manual-print-pose.mjs';
import {preparePrintMesh} from './print-mesh.mjs';
import {planDowelConnections,restoreDowelPlan} from './automatic-dowels.mjs';
import {connectorPartDecorations} from './connector-project.mjs';
import {preparePartForSupports} from './support-orientation.mjs';
import {refreshPoseQuality} from './pose-quality.mjs';
import {overhangMetrics} from './overhang-metrics.mjs';
import {printStability} from './print-stability.mjs';
import {refreshMarkedSupports} from './mark-supports.mjs';
import {orientOnCutFace} from './cut-orientation.mjs';
import {orientOnLargestFace} from './largest-face.mjs';
import {automaticContours} from './automatic-contours.mjs';
import {contourPlanAsync} from './contour-plan.mjs';
import {drawnPreview,drawnCut,adoptDrawn} from './drawn.mjs';
import Module from 'manifold-3d';
import wasmURL from 'manifold-3d/manifold.wasm?url';
import {validate,splitPlane,automaticSplit,bestOrientation,layFlat,ground,usableBed,smartRegion,transformData} from './engine.mjs';
import {Matrix4} from 'three';
import {detectSeams,cutSeam,autoSeams,markPart,closeCandidates,surfacePatch,cutSurfacePatch,loopSurfaceFaces,surfaceCutPreview} from './features.mjs';
import {fitParts,mergePrintable} from './planner.mjs';
import {suggestRegions} from './suggestions.mjs';
const ready=Module({locateFile:()=>wasmURL}).then(api=>{api.setup();return api;});
let runningContour=null;
self.onmessage=async({data:m})=>{
  if(m.op==='finishContourPlan'){if(runningContour)runningContour.stop=true;return;}
  try {requireExactOperationSupport(m);const api=await ready;let result;
    if(m.op==='restoreExactProjectParts'){
      const {createExactProjectContext,restoreExactProjectPart}=await import('./exact-project.mjs'),context=createExactProjectContext({permissionSources:m.permissionSources});
      if(!Array.isArray(m.parts)||!m.parts.length||m.parts.length>2048)throw Error('Ungültige exakte Projektteile.');
      result=m.parts.map((part,i)=>{self.postMessage({id:m.id,progress:`Genaue Projektteile und Innenflächen ${i+1}/${m.parts.length} prüfen …`});return restoreExactProjectPart(part,{context});});
    }
    if(m.op==='exactAutoMarks'){
      const {planExactAutomaticMarks}=await import('./exact-auto-marks.mjs');
      result=planExactAutomaticMarks(api,{...m,onProgress:progress=>self.postMessage({id:m.id,progress})});
    }
    if(m.op==='exactPrintMeshes'){
      const {createExactProjectContext}=await import('./exact-project.mjs'),{prepareExactPrintMesh}=await import('./exact-print-mesh.mjs'),context=createExactProjectContext({permissionSources:m.permissionSources}),bed=usableBed(m.bed,m.margin);
      if(!Array.isArray(m.parts)||!m.parts.length||m.parts.length>2048)throw Error('Ungültige Teile für den Druckexport.');
      result=m.parts.map((part,i)=>{self.postMessage({id:m.id,progress:`Drucknetz ${i+1}/${m.parts.length} und tatsächliche STL-Koordinaten prüfen …`});try{return part.exactGeometry!==undefined?prepareExactPrintMesh(part,{usableBed:bed,context}):preparePrintMesh(api,part,bed);}catch(error){throw Error(`Druckexport für Teil ${part.id||i+1} angehalten: ${error.message}`);}});
    }
    if(m.op==='readProject'){
      if(!m.file||m.file.size>PROJECT_FILE_LIMIT||typeof m.file.text!=='function')throw Error('Projektdatei zu groß oder ungültig (maximal 200 MB).');
      self.postMessage({id:m.id,progress:'Projektdatei lesen und Geometriedaten prüfen …'});result=parseProjectDocument(await m.file.text());
    }
    if(m.op==='serializeProject'){
      if(m.project?.parts?.some(p=>p.exactGeometry!==undefined)){
        if(m.project.connectorPlan)throw Error('Exakte Projektteile können noch keinen Passstiftplan wiederherstellen.');
        const {createExactProjectContext,serializeExactProjectPart}=await import('./exact-project.mjs'),context=createExactProjectContext({permissionSources:m.project.exactPermissionSources});
        m.project={...m.project,parts:m.project.parts.map(p=>p.exactGeometry===undefined?p:serializeExactProjectPart(p,{context}))};
      }
      const all=[...(m.project?.parts||[]),...(m.project?.connectorBaseParts||[]),...(m.project?.connectorPlan?.pins||[])];
      for(let i=0;i<all.length;i++){if(i%10===0)self.postMessage({id:m.id,progress:`Projektgeometrie ${i+1}/${all.length} prüfen …`});if(all[i].nativeGeometry!==undefined)validateNativeBinding(all[i]);}
      self.postMessage({id:m.id,progress:'Geometrie und Innenflächen vollständig speichern …'});
      const {contents,...metadata}=serializeProjectDocument(m.project);result={...metadata,blob:new Blob([contents],{type:'application/json'})};
    }
    if(m.op==='import'){
      let data;
      if(m.data.nativeGeometry!==undefined){
        if(!m.preservePosition)throw Error('Native Projektgeometrie benötigt ihre gespeicherte Drucklage.');
        data=restoreNativeProjectGeometry(api,m.data);
      }else data=validate(api,m.data);
      const posed=m.preservePosition?data:ground(data);result=[{...posed,overhang:overhangMetrics(posed),printStability:printStability(posed)}];
    }
    if(m.op==='manualPrintPose')result=prepareManualPrintPose({part:m.data,connectorBasePart:m.connectorBasePart,localTransform:m.localTransform,usableBed:usableBed(m.bed,m.margin),permissionSources:m.permissionSources});
    if(m.op==='addManualDrawnFin'){const supports=addManualDrawnFin(api,m.data,usableBed(m.bed,m.margin),m.options);result={...m.data,supports,supportNotice:supports.warnings?.join(' ')||undefined};}
    if(m.op==='addManualFin'){const supports=addManualFinWithFallback(api,m.data,usableBed(m.bed,m.margin),m.options);result={...m.data,supports,supportNotice:supports.warnings?.join(' ')||undefined};}
    if(m.op==='removeManualFin'){const remaining=removeManualFin(m.supports,m.finId);result=remaining?rebuildManualFins(api,m.data,usableBed(m.bed,m.margin),remaining):undefined;}
    if(m.op==='restoreManualFins'){const supports=rebuildManualFins(api,m.data,usableBed(m.bed,m.margin),m.supports);result={...m.data,supports,supportNotice:supports?.warnings?.join(' ')||undefined};}
    if(m.op==='planDowels')result=await planDowelConnections(api,m.parts,usableBed(m.bed,m.margin),{...m.options,progress:message=>self.postMessage({id:m.id,progress:message})});
    if(m.op==='restoreDowels'){const bed=usableBed(m.bed,m.margin);result=await restoreDowelPlan(api,m.baseParts,m.plan,bed,{progress:message=>self.postMessage({id:m.id,progress:message})});result.parts=connectorPartDecorations(result.parts,m.currentParts).map(part=>{if(!part.supports)return part;const supports=rebuildManualFins(api,part,bed,part.supports);return {...part,supports,supportNotice:supports?.warnings?.join(' ')||undefined};});}
    if(m.op==='restoreConnectorBase'){const bed=usableBed(m.bed,m.margin);result=m.parts.map(part=>{if(!part.supports)return part;const supports=rebuildManualFins(api,part,bed,part.supports);return {...part,supports,supportNotice:supports?.warnings?.join(' ')||undefined};});}
    if(m.op==='printMeshes'){result=[];const bed=usableBed(m.bed,m.margin);for(let i=0;i<m.parts.length;i++){const part=m.parts[i];self.postMessage({id:m.id,progress:`Druckgeometrie ${i+1}/${m.parts.length} mit manuellen Finnen verbinden …`});try{if(part.nativeGeometry!==undefined)validateNativeBinding(part);result.push(preparePrintMesh(api,part,bed));}catch(error){if(error?.name==='RuntimeError'||/Aborted|memory access out of bounds|unreachable|RuntimeError/i.test(error?.message||''))throw error;throw Error(`Druckexport für Teil ${part.id||i+1} angehalten: ${error.message}`);}}}
    if(m.op==='supportFins')result=supportFins(m.data,usableBed(m.bed,m.margin),{...m.options,nativeApi:api});
    if(m.op==='supportFinsAll')result=await supportFinsAll(m.parts,usableBed(m.bed,m.margin),{options:m.options,nativeApi:api,preparePart:preparePartForSupports,progress:message=>self.postMessage({id:m.id,progress:message})});
    if(m.op==='interiorSelect')result=selectInterior(m.data,m.seed,m.angle,m.seeds||[]);
    if(m.op==='autoMarkLocations')result=autoMarkLocations(m.parts,m.interior,m);
    if(m.op==='uniformMarkSize')result=findUniformMarkSize(api,m.parts,m.interior||null,{...m,progress:message=>self.postMessage({id:m.id,progress:message})});
    if(m.op==='engravePlanned'){const parts=[],failed=[];let engraved=0;for(let i=0;i<m.parts.length;i++){const p=m.parts[i];if(!p.plannedMark||p.mark){parts.push(p);continue;}self.postMessage({id:m.id,progress:`Kennzeichnung ${i+1}/${m.parts.length} gravieren …`});try{const data=markPart(api,p,p.plannedMark);parts.push(refreshMarkedSupports({...p,...data,mark:p.plannedMark,plannedMark:undefined,plannedMarkIssue:undefined},m.bed?usableBed(m.bed,m.margin):null,{nativeApi:api}));engraved++;}catch(e){if(e.name==='RuntimeError'||/Aborted|memory access out of bounds|unreachable|RuntimeError/i.test(e.message))throw e;parts.push({...p,plannedMarkIssue:e.message});failed.push({part:i,id:p.id,reason:e.message});}}result={parts,engraved,failed};}
    if(m.op==='smart')result=smartRegion(m.data,m.seed,m.angle,m.radius);
    if(m.op==='neighborColors')result=neighborColors(m.parts,m.palette,{preview:m.preview});
    if(m.op==='autoPlanPreview'){
      const progress=message=>self.postMessage({id:m.id,progress:message}),straight=m.cutPreference==='straight',bed=usableBed(m.bed,m.margin),raw=straight?straightPlanProposals(m.data,bed):suggestRegions(m.data,bed,progress,512);
      const local=straight?null:prepareLocalContours(api,m.data,raw,bed,{depth:m.depth,lineTolerance:m.lineTolerance||0,maxMillis:Math.min(600000,Math.max(120000,m.data.triangles.length/3*.3)),progress}),proposals=local?.proposals||raw,rejected=(local?.rejected||[]).map(({faces,...item})=>({...item,faceCount:faces.length}));
      const usable=proposals.filter(p=>p.cutDefinition);
      const open=throughSurfacePlan(m.data,usable,progress),grouping=consolidateDraft(open,usable,usableBed(m.bed,m.margin),{progress});
      const grouped=new Set(grouping.groups.flat());let internalCells=0;for(let i=0;i<usable.length;i++)if(!grouped.has(i)){grouping.groups.push([i]);internalCells++;}
      progress("Schnittwände für die offene Darstellung abtasten …");
      const visibleProposals=[...new Set(grouping.surfaces.filter(s=>!s.unassigned).flatMap(s=>s.members||[s.proposal]))].sort((a,b)=>a-b);
      const sampledWalls=previewCutWalls(m.data,visibleProposals.map(i=>usable[i])).map(w=>({...w,proposal:visibleProposals[w.proposal]})),warnings=[...new Set(sampledWalls.flatMap(w=>w.statistics?.warnings||[]))];
      result={proposals:usable,rejected,localPreparation:local?{...local.diagnostics,interiorMask:raw.coverage?.interiorMask}:undefined,proposalCoverage:raw.coverage,internalCells,surfaces:grouping.surfaces,groups:grouping.groups,grouping:{merges:grouping.merges,before:grouping.assignedBefore,after:grouping.assignedAfter,complete:grouping.complete,stopReason:grouping.stopReason},walls:groupPreviewWalls(sampledWalls,usable,grouping.groups),wallWarning:warnings.join(' ')};
    }
    if(m.op==='autoContours'){const job={stop:false};runningContour=job;try{if(m.groups){
      const bed=usableBed(m.bed,m.margin);
      // Review the complete plan in one run. The cap is a search budget, not a
      // target part count: each additional split still has to improve the pose
      // after comparing print poses. If a body tips, positive gravity reserve
      // comes first; any necessary overhang tradeoff is reported explicitly.
      const refinementOptions={policy:'stability-first',maxMassComplementCandidates:8,maxExtraParts:Math.min(96,Math.max(2,m.groups.length*2)),maxCandidatesPerOwner:8,maxMillis:180000};
      result=await closeGroupedPlan(api,m.data,m.proposals,m.groups,bed,{absorbFragments:m.cutPreference==='straight'||m.localContours===true,refineOverhangs:m.cutPreference==='straight',refinementOptions,repartitionFragments:m.cutPreference==='straight',captureNativePart:input=>captureClosedNativePart(api,input),stop:()=>job.stop,progress:message=>self.postMessage({id:m.id,progress:message})});
      for(const part of result.parts)if(part.nativeGeometry!==undefined)part.assemblyMatrix=new Matrix4().fromArray(m.data.assemblyMatrix||new Matrix4().toArray()).multiply(new Matrix4().fromArray(part.transform||new Matrix4().toArray()).invert()).toArray();
    }else result=await automaticContours(api,m.data,usableBed(m.bed,m.margin),{initialProposals:m.proposals,depth:m.depth,lineTolerance:m.lineTolerance,supports:false,finOptions:m.finOptions,stop:()=>job.stop,progress:message=>self.postMessage({id:m.id,progress:message}),restartKernel:async()=>{const fresh=await Module({locateFile:()=>wasmURL});fresh.setup();return fresh;}});
      if(m.supports&&!result.kernelFailure){const fins=await supportFinsAll(result.parts,usableBed(m.bed,m.margin),{options:m.finOptions,nativeApi:api,preparePart:preparePartForSupports,stop:()=>job.stop,progress:message=>self.postMessage({id:m.id,progress:message})});result.parts=fins.parts;const{parts,...summary}=fins;result.supportSummary=summary;}
    }finally{if(runningContour===job)runningContour=null;}}
    if(m.op==='contourPlan'){const job={stop:false};runningContour=job;try{result=await contourPlanAsync([api,m.data,m.proposals,usableBed(m.bed,m.margin),m.depth,m.maxCuts,message=>self.postMessage({id:m.id,progress:message}),m.lineTolerance||0],()=>job.stop);}finally{if(runningContour===job)runningContour=null;}}
    if(m.op==='suggest')result=suggestRegions(m.data,usableBed(m.bed,m.margin),message=>self.postMessage({id:m.id,progress:message}));
    if(m.op==='seams')result=detectSeams(m.data,m.angle,m.minPerimeter);
    if(m.op==='seamCut')result=cutSeam(api,m.data,m.seam);
    if(m.op==='closeCandidates')result=closeCandidates(api,m.data,m.seams,message=>self.postMessage({id:m.id,progress:message}));
    if(m.op==='adoptDrawn')result=adoptDrawn(api,m.data,m.faces,m.depth,m.lineTolerance||0);
    if(m.op==='drawPreview')result=drawnPreview(api,m.data,m.points,m.normals,m.style,m.depth);
    if(m.op==='drawCut')result=m.cutDefinition?cutSurfacePatch(api,m.data,[],m.depth,cutterFromDefinition(api,m.cutDefinition)):drawnCut(api,m.data,m.points,m.normals,m.style,m.depth);
    if(m.op==='patchPreview')result=surfaceCutPreview(api,m.data,m.faces,m.depth,null,m.lineTolerance||0);
    if(m.op==='patchCut')result=cutSurfacePatch(api,m.data,m.faces,m.depth,m.cutDefinition?cutterFromDefinition(api,m.cutDefinition):null,m.lineTolerance||0);
    if(m.op==='loopPreview'){const faces=loopSurfaceFaces(m.data,m.seam);result={...surfaceCutPreview(api,m.data,faces,m.depth,null,m.lineTolerance||0),faces};}
    if(m.op==='seamsAuto')result=autoSeams(api,m.data,m.options,message=>self.postMessage({id:m.id,progress:message}));
    if(m.op==='mark')result=[refreshMarkedSupports({...m.data,...markPart(api,m.data,m.settings)},m.bed?usableBed(m.bed,m.margin):null,{nativeApi:api})];
    if(m.op==='fit')result=fitParts(api,m.data,usableBed(m.bed,m.margin),message=>self.postMessage({id:m.id,progress:message}));
    if(m.op==='mergeFit')result=mergePrintable(api,m.parts,usableBed(m.bed,m.margin),message=>self.postMessage({id:m.id,progress:message}));
    if(m.op==='cut')result=splitPlane(api,m.data,m.normal,m.offset);
    if(m.op==='orient')result=[refreshPoseQuality(m.data,orientOnCutFace(m.data,usableBed(m.bed,m.margin)))];
    if(m.op==='printOrient')result=preparePartForSupports(m.data,usableBed(m.bed,m.margin),{requireStable:true});
    if(m.op==='flat')result=[refreshPoseQuality(m.data,layFlat(m.data,m.normal))];
    if(m.op==='largestFace')result=[refreshPoseQuality(m.data,orientOnLargestFace(m.data))];
    if(m.op==='scale'){if(!Number.isFinite(m.factor)||m.factor<=0||m.factor>1000)throw Error('Skalierungsfaktor muss größer 0 und höchstens 1000 sein.');result=[ground(transformData(m.data,new Matrix4().makeScale(m.factor,m.factor,m.factor)))];}
    if(m.op==='auto'){const bed=usableBed(m.bed,m.margin),data=m.orient?bestOrientation(m.data,bed):m.data;result=automaticSplit(api,data,bed,message=>self.postMessage({id:m.id,progress:message}));}
    self.postMessage({id:m.id,result});
  }catch(e){self.postMessage({id:m.id,error:e.message||String(e),kernelFailure:/Aborted|memory access out of bounds|unreachable|RuntimeError/i.test(e.message)||e.name==='RuntimeError'});}
};
