// A smaller overhang must never hide a worse geometric tipping class. Within
// a class, minimize severe overhangs and support area before the height/area
// score. This ranks a finite set of poses; it is not a global optimum proof.
export function stabilityRank(stability){
 if(!stability?.valid)return 4;
 if(stability.classification==='stable')return 0;
 if(stability.stableUnderGravity===true)return 1;
 if(Number.isFinite(stability.minimumMargin))return 2;
 return 3;
}

export function comparePrintPoses(a,b){
 const ar=stabilityRank(a.printStability),br=stabilityRank(b.printStability);
 if(ar!==br)return ar-br;
 // When every candidate can tip, retain the least precarious pose with an
 // explicit warning instead of calling it a printable result.
 if(ar===2){const delta=(b.printStability.gravityMargin?.criticalTiltDegrees??-90)-(a.printStability.gravityMargin?.criticalTiltDegrees??-90);if(Math.abs(delta)>1e-6)return delta;}
 return a.score-b.score;
}
