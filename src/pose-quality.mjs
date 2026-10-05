import {overhangMetrics} from './overhang-metrics.mjs';
import {printStability} from './print-stability.mjs';
import {supportBedContact} from './support-orientation.mjs';
import {rebindNativePose} from './native-geometry-binding.mjs';
import {Matrix4} from 'three';

// Wrap a worker pose result before the UI transfers annotations and commits its
// local transform. Physical checks belong to the new pose; cut provenance stays.
export function refreshPoseQuality(source,posed){
 const out={...source,...posed,supports:undefined,supportOrientation:undefined};
 out.overhang=overhangMetrics(out);
 out.printStability=printStability(out);
 out.cutOrientation=posed.cutOrientation;
 out.bedContactArea=supportBedContact(out,{requireCut:false});
 const cutArea=out.cutPlanes?.length?supportBedContact(out,{requireCut:true}):0;
 out.bedFace=cutArea>=1?'cut':'surface';
 out.requiresCutFace=out.bedContactArea<1;
 if(!posed.largestFace)delete out.largestFace;
 out.supportNotice=source.supports?'Die Drucklage wurde geändert. Support Fins für diese Lage neu berechnen.':undefined;
 if(source.nativeGeometry!==undefined){out.assemblyMatrix=new Matrix4().fromArray(source.assemblyMatrix||new Matrix4().toArray()).multiply(new Matrix4().fromArray(source.transform||new Matrix4().toArray())).multiply(new Matrix4().fromArray(posed.transform||new Matrix4().toArray()).invert()).toArray();out.nativeGeometry=rebindNativePose(source,out);}
 return out;
}
