import Module from 'manifold-3d';
import {Matrix4} from 'three';
import {fromSolid} from '../src/engine.mjs';
import {planDowelConnections} from '../src/automatic-dowels.mjs';

/** Native geometry fixture: root 1 supports children 3 and 2. This intentionally
 * differs from a numeric-ID BFS and carries real socket and swept-path proofs. */
export async function connectorGuideFixture(){
 const api=await Module();api.setup();
 function box(size,id,color,x=0,z=0){const raw=api.Manifold.cube(size),body=raw.translate([-size[0]/2,-size[1]/2,0]);try{return {...fromSolid(body),id,color,assemblyMatrix:new Matrix4().makeTranslation(x,0,z).toArray()};}finally{body.delete();raw.delete();}}
 const source=[box([60,30,8],'1','#e8a54b'),box([30,30,8],'3','#7aaf60',-15,8),box([30,30,8],'2','#61a8bb',15,8)],result=await planDowelConnections(api,source,[250,250,250],{maxMillis:60000,maxPairsPerContact:1});
 return {parts:result.parts,connectorPlan:{version:1,connections:result.connections,pins:result.pins,order:result.order,unresolved:result.unresolved,completed:result.completed,settings:result.settings},source};
}
