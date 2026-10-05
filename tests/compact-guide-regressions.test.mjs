import test from 'node:test';
import assert from 'node:assert/strict';
import {BoxGeometry} from 'three';
import {guideAssemblyPlan,compactGuidePages} from '../src/guide-layout.mjs';
const pixel='data:image/png;base64,test';
function fixture(){const parts=['7','42','43'].map((id,i)=>{const g=new BoxGeometry(10,10,10);g.translate([0,10,100][i],0,0);return {id,vertices:g.attributes.position.array,triangles:g.index.array,color:'#66cccc',mark:{text:id,emboss:false}};});return parts;}
function pages(parts){const plan=guideAssemblyPlan(parts),art={steps:plan.steps.map(step=>({...step,main:pixel,detail:pixel,isolated:pixel})),connectors:{}};return compactGuidePages(parts,plan,art).map(p=>({...p,body:p.body.replace(/<img[^>]*>/g,'')}));}
test('ordinary contact assembly without a dowel plan distinguishes follow-up contact from separate root',()=>{
 const parts=fixture(),plan=guideAssemblyPlan(parts),rendered=pages(parts);assert.equal(plan.components.length,2);
 for(const step of plan.steps){const page=rendered.find(p=>p.partId===parts[step.index].id);if(!step.isStart){assert.ok(step.contacts.length);assert.doesNotMatch(page.body,/Neue Baugruppe beginnen|Das erste Teil bereitlegen/);assert.ok(step.contacts.some(i=>page.body.includes('Teil '+parts[i].id)));}}
});
test('unresolved print stability and overhang remain apparent at the affected compact part',()=>{
 const parts=fixture();parts[0].printStability={valid:true,classification:'unstable',stableUnderGravity:false,minimumMargin:-4};parts[0].overhang={needsFurtherSplit:true,severeArea:100};
 const first=pages(parts).find(p=>p.partId==='7');assert.match(first.body,/Kipp|Druck.*prüfen|Druckprüfung offen|Druckhinweis/);
});
test('manual assembly note remains present and escaped without source mutation',()=>{
 const parts=fixture();parts[1].note='Hier <b>trocken</b> anpassen & nicht verkleben.';const before=structuredClone(parts),second=pages(parts).find(p=>p.partId==='42');assert.match(second.body,/Hier &lt;b&gt;trocken&lt;\/b&gt; anpassen &amp; nicht verkleben\./);assert.doesNotMatch(second.body,/<b>trocken<\/b>/);assert.deepEqual(parts,before);
});
test('physical mark mismatch gives the real engraved text needed to identify the part',()=>{
 const parts=fixture();parts[1].mark.text='88';const second=pages(parts).find(p=>p.partId==='42');assert.match(second.body,/88/);assert.match(second.body,/42/);assert.doesNotMatch(second.body,/class="part-number">42<\/span>/);
});
test('numeric gaps and actual geometric order are preserved without renumbering',()=>{
 const parts=fixture(),plan=guideAssemblyPlan(parts);assert.deepEqual(pages(parts).map(p=>p.partId),plan.order.map(i=>parts[i].id));assert.equal(pages(parts).length,3);
});
