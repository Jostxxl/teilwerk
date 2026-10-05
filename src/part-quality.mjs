// Keep unresolved cut results visible after accepting, saving and reopening a plan.
const codes=new Set(['disconnected_group','signed_components','small_component','no_fitting_cut_face','outside_bed','severe_overhang','unallocated_material','calculation_failed','metrics_unavailable','unstable_print_pose']);

export function stabilityDescription(stability){
 if(!stability)return 'Standfestigkeit noch nicht geprüft – Drucklage prüfen';
 if(!stability.valid)return 'Standfestigkeit noch nicht verlässlich berechnet';
 if(!stability.stableUnderGravity)return Number.isFinite(stability.minimumMargin)?`Kippgefahr: Schwerpunkt ${Math.abs(stability.minimumMargin).toFixed(1)} mm ${stability.minimumMargin<0?'außerhalb':'am Rand'} der Auflage – andere Drucklage oder Schnittführung nötig`:'Keine ebene Auflage für die Kippprüfung gefunden';
 return `${stability.classification==='marginal'?'Geringe Kippreserve':'Schwerpunkt innerhalb der Auflage'} · Randabstand ${stability.minimumMargin.toFixed(1)} mm · Kippwinkel ${stability.gravityMargin.criticalTiltDegrees.toFixed(1)}°`;
}

// A successful bed-fit check does not imply a useful tipping reserve. Summarize
// the actual body checks when reviewing a whole cut plan, including missing data.
export function planStabilityDescription(parts){
 if(!parts.length)return '';
 const counts={stable:0,marginal:0,unsafe:0,unchecked:0};
 for(const part of parts){const s=part.printStability;
  if(!s?.valid||typeof s.stableUnderGravity!=='boolean')counts.unchecked++;
  else if(!s.stableUnderGravity)counts.unsafe++;
  else if(s.classification==='stable')counts.stable++;
  else counts.marginal++;
 }
 return 'Kippprüfung: '+[
  counts.stable?`${counts.stable} mit geometrischer Reserve`:null,
  counts.marginal?`${counts.marginal} mit geringer Kippreserve`:null,
  counts.unsafe?`${counts.unsafe} mit Kippgefahr oder fehlender Auflage`:null,
  counts.unchecked?`${counts.unchecked} noch nicht verlässlich geprüft`:null
 ].filter(Boolean).join(' · ')+'.';
}

function savedStability(s){
 if(!s||!['stable','marginal','unstable','no-contact','invalid'].includes(s.classification))return undefined;
 const out={valid:s.valid===true,classification:s.classification,stableUnderGravity:typeof s.stableUnderGravity==='boolean'?s.stableUnderGravity:null};
 for(const key of ['volume','height','comHeight','minimumMargin','contactSpanToHeight','closureResidual'])if(Number.isFinite(s[key]))out[key]=s[key];
 if(Array.isArray(s.centerOfMass)&&s.centerOfMass.length===3&&s.centerOfMass.every(Number.isFinite))out.centerOfMass=[...s.centerOfMass];
 if(s.gravityMargin){out.gravityMargin={};for(const key of ['marginMm','criticalTiltDegrees','criticalHorizontalAccelerationG'])if(Number.isFinite(s.gravityMargin[key]))out.gravityMargin[key]=s.gravityMargin[key];}
 if(s.contact){out.contact={};for(const key of ['triangleCount','area','hullArea','minimumSpan','maximumSpan'])if(Number.isFinite(s.contact[key])&&s.contact[key]>=0)out.contact[key]=s.contact[key];}
 if(out.stableUnderGravity&&(!Number.isFinite(out.minimumMargin)||!Number.isFinite(out.gravityMargin?.criticalTiltDegrees)))return undefined;
 return out;
}
export function normalizeCutQuality(value){
  if(value?.version!==1||!Array.isArray(value.issues))return undefined;
  const issues=[];
  for(const item of value.issues.slice(0,64)){
    if(!item||!codes.has(item.reason))continue;
    const issue={reason:item.reason};
    for(const key of ['components','volume','area'])if(Number.isFinite(item[key])&&item[key]>=0)issue[key]=item[key];
    if(!issues.some(old=>old.reason===issue.reason))issues.push(issue);
  }
  return {version:1,issues};
}
export function componentCutQuality(issues,component){
  return normalizeCutQuality({version:1,issues:issues.filter(issue=>issue.component===undefined||issue.component===component)});
}
export function savedPartQuality(part){
  const result={cutQuality:normalizeCutQuality(part.cutQuality)};
  const stability=savedStability(part.printStability);if(stability)result.printStability=stability;
  if(Number.isInteger(part.cutOrientation?.candidates)&&part.cutOrientation.candidates>0)result.cutOrientation={candidates:part.cutOrientation.candidates,objective:'stability-overhang-fit'};
  if(part.remaining===true)result.remaining=true;
  if(typeof part.requiresCutFace==='boolean')result.requiresCutFace=part.requiresCutFace;
  if(part.cutLineageMethod==='native-intersection')result.cutLineageMethod=part.cutLineageMethod;
  if(typeof part.supportNotice==='string')result.supportNotice=part.supportNotice.slice(0,8000);
  if(typeof part.plannedMarkIssue==='string')result.plannedMarkIssue=part.plannedMarkIssue.slice(0,2000);
  const orientation=part.supportOrientation;
  if(orientation&&['current','flat-face','printfins'].includes(orientation.method)){
    result.supportOrientation={method:orientation.method};
    for(const key of ['candidates','printFinsProposals','bedArea','severeArea','supportArea','height'])if(Number.isFinite(orientation[key])&&orientation[key]>=0)result.supportOrientation[key]=orientation[key];
    if(['none','low','medium','high'].includes(orientation.confidence))result.supportOrientation.confidence=orientation.confidence;
    if(orientation.objective==='stability-overhang-fit')result.supportOrientation.objective=orientation.objective;
  }
  const validOwner=id=>Number.isInteger(id)&&id>=0||id==='remainder';
  if(Array.isArray(part.cutLineage))result.cutLineage=part.cutLineage.filter(p=>p&&validOwner(p.ownerId)&&(p.component===null||Number.isInteger(p.component)&&p.component>=0)&&Number.isFinite(p.volume)&&p.volume>0).slice(0,8192).map(p=>({ownerId:p.ownerId,component:p.component,volume:p.volume,signedGroup:p.signedGroup===true,...(Array.isArray(p.sourceOwnerIds)&&p.sourceOwnerIds.length&&p.sourceOwnerIds.every(validOwner)?{sourceOwnerIds:[...new Set(p.sourceOwnerIds)].slice(0,8192),refinementBranch:Array.isArray(p.refinementBranch)&&p.refinementBranch.every(side=>side===0||side===1)?p.refinementBranch.slice(0,64):[]}: {})}));
  return result;
}
export function partQualityMessages(part,{fits}={}){
  const issues=[...(normalizeCutQuality(part.cutQuality)?.issues||[])].filter(issue=>!(issue.reason==='severe_overhang'&&part.overhang))
    .filter(issue=>!(issue.reason==='unstable_print_pose'&&part.printStability))
    .filter(issue=>!(issue.reason==='outside_bed'&&fits===true)&&!(issue.reason==='no_fitting_cut_face'&&part.requiresCutFace===false));
  const add=reason=>{if(!issues.some(issue=>issue.reason===reason))issues.push({reason});};
  if(part.remaining)add('unallocated_material');
  if(part.requiresCutFace)add('no_fitting_cut_face');
  if(part.overhang?.needsFurtherSplit&&!issues.some(issue=>issue.reason==='severe_overhang'))issues.push({reason:'severe_overhang',area:part.overhang.severeArea});
  const messages=issues.map(issue=>{
    switch(issue.reason){
      case 'disconnected_group':return `Schnittgruppe enthält ${Number.isFinite(issue.components)?Math.round(issue.components):'mehrere'} getrennte Körper – Aufteilung prüfen`;
      case 'signed_components':return 'Innere Hohlräume – Aufteilung prüfen';
      case 'small_component':return `Kleines Reststück${Number.isFinite(issue.volume)?` (${issue.volume.toLocaleString('de-DE',{maximumFractionDigits:3})} mm³)`:''} – mit Nachbarteil verbinden`;
      case 'no_fitting_cut_face':return 'Keine passende ebene Schnittfläche für die Druckplatte gefunden';
      case 'outside_bed':return 'Teil überschreitet den nutzbaren Bauraum';
      case 'severe_overhang':return `Überhänge über 60°${Number.isFinite(issue.area)?`: ${Math.round(issue.area)} mm²`:''} – Drucklage und Stützbedarf prüfen`;
      case 'unallocated_material':return 'Restbereich noch nicht vollständig aufgeteilt';
      case 'calculation_failed':return 'Schnittberechnung fehlgeschlagen – ursprüngliches Material erhalten';
      case 'metrics_unavailable':return 'Druckauflage und Überhänge konnten noch nicht vollständig geprüft werden';
      case 'unstable_print_pose':return 'Keine standfeste Drucklage gefunden – Schnittführung oder Auflage prüfen';
    }
  });
  if(part.printStability&&part.printStability.classification!=='stable')messages.push(stabilityDescription(part.printStability));
  return messages;
}
