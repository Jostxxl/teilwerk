import test from 'node:test';
import assert from 'node:assert/strict';
import {clipTriangleByPrism} from '../src/open-clip.mjs';
const square=[[-1,-1],[1,-1],[1,1],[-1,1]];
const definition=(contours=[square],extra={})=>({u:[1,0,0],v:[0,1,0],n:[0,0,1],min:-1,max:1,contours,...extra});
function area(tri){const [a,b,c]=tri,u=b.map((x,i)=>x-a[i]),v=c.map((x,i)=>x-a[i]);return Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])/2;}
const total=tris=>tris.reduce((s,t)=>s+area(t),0);
function approx(a,b,tolerance=1e-8){assert.ok(Math.abs(a-b)<=tolerance,`${a} ≈ ${b}`);}
function clip(triangle,def){const result=clipTriangleByPrism(triangle,def);approx(total(result.inside)+total(result.outside),area(triangle));const [a,b,c]=triangle,ab=b.map((x,i)=>x-a[i]),ac=c.map((x,i)=>x-a[i]),normal=[ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]];for(const t of [...result.inside,...result.outside]){for(const p of t)approx(p.reduce((s,x,i)=>s+(x-a[i])*normal[i],0),0,1e-7);const tb=t[1].map((x,i)=>x-t[0][i]),tc=t[2].map((x,i)=>x-t[0][i]),tn=[tb[1]*tc[2]-tb[2]*tc[1],tb[2]*tc[0]-tb[0]*tc[2],tb[0]*tc[1]-tb[1]*tc[0]];assert.ok(tn.reduce((s,x,i)=>s+x*normal[i],0)>0);}return result;}
test('surface entirely inside or outside is preserved without caps',()=>{const a=clip([[0,0,0],[.5,0,0],[0,.5,0]],definition());assert.equal(a.inside.length,1);assert.equal(a.outside.length,0);const b=clip([[4,0,0],[5,0,0],[4,1,0]],definition());assert.equal(b.inside.length,0);assert.equal(b.outside.length,1);});
test('prism crossing an existing triangle conserves area and winding',()=>{const result=clip([[-2,-2,0],[2,-2,0],[0,2,0]],definition());approx(total(result.inside),3.5);assert.ok(result.outside.length>0);});
test('slab limits clip the front and rear of a vertical surface',()=>{const result=clip([[0,0,-2],[.5,0,2],[-.5,0,2]],definition());approx(total(result.inside),1);approx(total(result.outside),1);});
test('concave contour cuts an L-shaped surface footprint',()=>{const contour=[[0,0],[2,0],[2,1],[1,1],[1,2],[0,2]],result=clip([[-10,-10,0],[20,-10,0],[-10,20,0]],definition([contour]));approx(total(result.inside),3);});
test('clockwise hole removes its footprint with nonzero winding',()=>{const hole=[[-.5,-.5],[-.5,.5],[.5,.5],[.5,-.5]],result=clip([[-10,-10,0],[20,-10,0],[-10,20,0]],definition([square,hole]));approx(total(result.inside),3);});
test('same-winding nested contour remains filled',()=>{const inner=[[-.5,-.5],[.5,-.5],[.5,.5],[-.5,.5]],result=clip([[-10,-10,0],[20,-10,0],[-10,20,0]],definition([square,inner]));approx(total(result.inside),4);});
test('disconnected contours and rotated prism axes are supported',()=>{const left=square.map(([x,y])=>[x-3,y]),right=square.map(([x,y])=>[x+3,y]),result=clip([[0,-10,-10],[0,20,-10],[0,-10,20]],definition([left,right],{u:[0,1,0],v:[0,0,1],n:[1,0,0]}));approx(total(result.inside),8);});
test('coplanar cut boundary and duplicate contour endpoint preserve material',()=>{const result=clip([[-1,-1,1],[1,-1,1],[-1,1,1]],definition([[...square,square[0]]]));approx(total(result.inside),2);assert.equal(result.outside.length,0);});
test('small and large coordinate triangles retain surface area',()=>{for(const offset of [0,1500]){const triangle=[[offset-.001,-.001,0],[offset+.001,-.001,0],[offset,.001,0]],contour=[[offset,-1],[offset+1,-1],[offset+1,1],[offset,1]],result=clip(triangle,definition([contour]));approx(total(result.inside),1e-6,1e-12);}});

test('random inclined triangles agree with independent Manifold polygon intersection',async()=>{
 const {default:Module}=await import('manifold-3d');const api=await Module();api.setup();
 const contours=[[[-2,-2],[2,-2],[2,-.5],[.5,-.5],[.5,2],[-2,2]],[[-1.5,-1.5],[-1.5,-1],[-1,-1],[-1,-1.5]]],def=definition(contours,{min:-10,max:10}),outline=api.CrossSection.ofPolygons(contours,'NonZero');
 let state=391742;const random=()=>{state=(Math.imul(1664525,state)+1013904223)>>>0;return state/4294967296;};
 try{for(let sample=0;sample<100;sample++){
  const polygon=Array.from({length:3},()=>[random()*8-4,random()*8-4]),triangle=polygon.map(([x,y])=>[x,y,x*.2+y*.3]),input=api.CrossSection.ofPolygons([polygon],'NonZero'),intersection=outline.intersect(input);
  try{const result=clip(triangle,def);approx(total(result.inside),intersection.area()*Math.sqrt(1+.2**2+.3**2),2e-7);}finally{input.delete();intersection.delete();}
 }}finally{outline.delete();}
});
