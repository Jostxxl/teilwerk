import {Vector3,Matrix4,Quaternion} from 'three';

const vector=value=>Array.isArray(value)&&value.length===3&&value.every(Number.isFinite)&&Math.hypot(...value)>1e-8;
/** Directions are expressed in the unsplit source/model frame; transform maps
 * that frame to this part's print pose. The returned roll uses textMesh's basis. */
export function referenceTextFrame(normal,{referenceDirection=[1,0,0],fallbackDirection=[0,1,0],transform,rotation=0}={}){
 if(!vector(referenceDirection)||!vector(fallbackDirection)||!Number.isFinite(rotation))throw Error('Ungültige gemeinsame Schriftrichtung.');
 const n=normal.isVector3?normal.clone().normalize():new Vector3(...normal).normalize(),matrix=transform?.isMatrix4?transform:new Matrix4().fromArray(transform||new Matrix4().toArray()),project=direction=>new Vector3(...direction).transformDirection(matrix).projectOnPlane(n);let tangent=project(referenceDirection),usedFallback=false;
 if(tangent.lengthSq()<1e-10){tangent=project(fallbackDirection);usedFallback=true;}
 if(tangent.lengthSq()<1e-10)throw Error('Gemeinsame Schriftrichtung und Ersatzrichtung dürfen nicht beide senkrecht auf der Beschriftungsfläche stehen.');
 tangent.normalize().applyAxisAngle(n,rotation*Math.PI/180);const glyphFrame=new Quaternion().setFromUnitVectors(new Vector3(0,0,1),n),local=tangent.clone().applyQuaternion(glyphFrame.clone().invert()),roll=Math.atan2(local.y,local.x)*180/Math.PI;
 return {rotation:roll,u:tangent,v:n.clone().cross(tangent).normalize(),usedFallback};
}
