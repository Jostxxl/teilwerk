import {boxExtrude} from './vendor/support-fins/solids.js';

/** The actual one-layer tooth and its terminal 0.05 mm contact cap share the
 * same frame and coordinates. A one-layer ramp is a geometric repair,
 * not permission to count a missed tooth as material. */
export function manualToothGeometry(c,{bite,width,overlap,gap,layerHeight,lift=0}){
 const top=Math.round((c.z+layerHeight/2)/layerHeight)*layerHeight,bottom=top-layerHeight,half=width/2;
 // Keep the tooth's wall end fixed. Raise only the material-facing end by at
 // most one layer. A whole-tooth translation could require a new wall step
 // through the model; this affine ramp avoids that unintended attachment.
 const frame=(u,v,z)=>[c.x+c.biteX*u-c.biteY*v,c.y+c.biteY*u+c.biteX*v,z+lift*layerHeight*(u+overlap)/(bite+overlap)],tooth=[],tip=[],step=[];
 boxExtrude([[-overlap,-half],[bite,-half],[bite,half],[-overlap,half]],bottom,top,frame,tooth);
 boxExtrude([[bite-.05,-half],[bite,-half],[bite,half],[bite-.05,half]],bottom,top,frame,tip);
 const wallTop=c.z+layerHeight/2-gap;
 if(bottom-wallTop>=layerHeight/2-1e-6){const e=.01,stepFrame=(u,v,z)=>[c.x+c.biteX*u-c.biteY*v,c.y+c.biteY*u+c.biteX*v,z];boxExtrude([[-overlap+e,-half+e],[-e,-half+e],[-e,half-e],[-overlap+e,half-e]],wallTop-layerHeight/2,bottom+layerHeight/2,stepFrame,step);}
 return {tooth,tip,step,top,bottom,lift};
}

/** Only a strictly positive, finite, minuscule residual can be classified as
 * numerical. Signed/zero nonempty residuals are unresolved, never empty.
 * The absolute ceiling is 1e-8 mm³ AND the lost cap fraction is at most 1e-5.
 * This does not claim exact containment or waive the independent contact,
 * connectedness, wall-clearance and whole-fin material checks. */
export function classifyManualTip({empty,outsideVolume,tipVolume}){
 if(empty)return {accepted:true,exact:true,minimumBiteFraction:1,outsideVolume:0,tipVolume};
 if(!(Number.isFinite(tipVolume)&&tipVolume>0&&Number.isFinite(outsideVolume)&&outsideVolume>0))return {accepted:false,reason:'unresolved_contact_residual',outsideVolume,tipVolume};
 const allowance=Math.min(1e-8,tipVolume*1e-5),accepted=outsideVolume<=allowance;
 return {accepted,exact:false,reason:accepted?'numerical_contact_residual':'incomplete_layer_contact',minimumBiteFraction:1-outsideVolume/tipVolume,outsideVolume,tipVolume,allowance};
}
