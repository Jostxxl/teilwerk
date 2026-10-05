import {renderAssemblyGuide} from './guide-layout.mjs';
import {printGeometry} from './supports.mjs';
import * as THREE from 'three';
import {zipSync,strToU8} from 'fflate';
import {ground,transformData} from './engine.mjs';
import {validateExactBinding,deriveExactDisplay} from './exact-geometry-binding.mjs';
export const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function assemblyData(p){return transformData(p,new THREE.Matrix4().fromArray(p.assemblyMatrix||new THREE.Matrix4().toArray()));}
export function threeMF(parts){
  const resources=['<basematerials id="1">'+parts.map(p=>`<base name="${escape(p.id)}" displaycolor="${p.color||'#bde780'}FF"/>`).join('')+'</basematerials>'],items=[];
  parts.forEach((p,i)=>{const d=p.exactPrintMesh===true?p:ground(printGeometry(p));let vertices='',triangles='';for(let j=0;j<d.vertices.length;j+=3)vertices+=`<vertex x="${d.vertices[j]}" y="${d.vertices[j+1]}" z="${d.vertices[j+2]}"/>`;for(let j=0;j<d.triangles.length;j+=3)triangles+=`<triangle v1="${d.triangles[j]}" v2="${d.triangles[j+1]}" v3="${d.triangles[j+2]}"/>`;resources.push(`<object id="${i+2}" type="model" name="${escape(p.id)}" pid="1" pindex="${i}"><mesh><vertices>${vertices}</vertices><triangles>${triangles}</triangles></mesh></object>`);items.push(`<item objectid="${i+2}" transform="1 0 0 0 1 0 0 0 1 ${i*500} 0 0"/>`);});
  const model=`<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xml:lang="de-DE" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><metadata name="Title">Teilwerk – Druckteile</metadata><resources>${resources.join('')}</resources><build>${items.join('')}</build></model>`;
  return zipSync({'[Content_Types].xml':strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>'),'_rels/.rels':strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>'),'3D/3dmodel.model':strToU8(model)},{level:1});
}
/** connectorPlan is optional; when present its native-verified order and loose
 * pin files are carried through unchanged to the printable assembly guide. */
export function exactGuideDisplayPart(part){
 if(part.exactGeometry===undefined)return part;
 const binding=validateExactBinding(part),view=deriveExactDisplay(binding.authority,{assemblyMatrix:part.assemblyMatrix,precision:'float64'});
 // This explicit derived copy is for illustration and contact ordering only.
 // It is never returned to model editing or used to construct a print mesh.
 const fields=['id','name','color','note','mark','plannedMark','plannedMarkIssue','printStability','overhang','cutQuality','cutOrientation','bedContactArea','bedFace','requiresCutFace'];
 return {...Object.fromEntries(fields.filter(k=>part[k]!==undefined).map(k=>[k,part[k]])),vertices:view.vertices,triangles:view.triangles,assemblyMatrix:view.assemblyMatrix,displayOnly:true};
}
export function assemblyHTML(parts,opts={}){return renderAssemblyGuide(parts.map(exactGuideDisplayPart),opts);}
