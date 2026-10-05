import test from 'node:test';import assert from 'node:assert/strict';import {sweepDirection,sweepPlaneSide} from '../src/robust-sweep-predicate.mjs';
test('exact fallback finds a leading face whose ordinary float calculation has the wrong sign',()=>{
 const a=[0,0,0],b=[1849176222.4584818,2412367432.843894,8261834210.716188],c=[1950272091.1987126,9013282265.514135,6023684644.605965],m=[1919943330.5766432,7033007815.713063,6695129514.439032],naive=(b[1]*c[2]-b[2]*c[1])*m[0]+(b[2]*c[0]-b[0]*c[2])*m[1]+(b[0]*c[1]-b[1]*c[0])*m[2];assert.ok(naive<0);const exact=sweepDirection(a,b,c,m);assert.equal(exact.sign,1);assert.equal(exact.exact,true);assert.ok(exact.value>6e12);assert.equal(sweepDirection(a,c,b,m).sign,-1);
});
test('true coplanarity, subnormal nonzero directions and translated subtraction are distinct',()=>{
 assert.equal(sweepDirection([0,0,0],[1,0,0],[0,1,0],[1,2,0]).sign,0);assert.equal(sweepDirection([0,0,0],[1,0,0],[0,1,0],[0,0,Number.MIN_VALUE]).sign,1);assert.equal(sweepDirection([1e15,1e15,1e15],[1e15+1,1e15,1e15],[1e15,1e15+1,1e15],[0,0,1e-30]).sign,1);
 const a=[-294.8555818292583,-213.9522867838542,213.37490802274442],b=[-294.8555818292583,-208.15228678385418,213.37490802274442],c=[-294.86280473925,-208.15228678385418,213.22788231225007],m=[0,-6,1.4791141972893976e-31];assert.equal(sweepDirection(a,b,c,m).sign,1);assert.equal(sweepPlaneSide(a,b,c,a.map((x,i)=>x+m[i])).sign,0);
});
test('well-separated directions use the inexpensive filter and invalid inputs reject',()=>{
 const r=sweepDirection([0,0,0],[2,0,0],[0,3,0],[0,0,4]);assert.equal(r.sign,1);assert.equal(r.value,24);assert.equal(r.exact,false);assert.throws(()=>sweepDirection([NaN,0,0],[1,0,0],[0,1,0],[0,0,1]));
});
