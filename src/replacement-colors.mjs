import {partAssemblyMatrix} from './display-pose.mjs';

// Validate replacement children together with every untouched assembly sibling.
// The preview owns this plan; changing or cancelling a preview must not recolor
// committed siblings before the user accepts the replacement.
export function replacementColorContext(committed,active,replacement,{previewAssembly=false,openPreview=false}={}){
 if(!Number.isInteger(active)||active<0||active>=committed.length)throw Error('Kein gültiges Ursprungsteil für die Nachbarfarben.');
 const combined=[],replacementIndexes=[],siblingIndexes=[];
 committed.forEach((part,index)=>{
  if(index===active){for(const child of replacement){replacementIndexes.push(combined.length);combined.push({...child,assemblyMatrix:partAssemblyMatrix(child,{preview:true,parentAssembly:part.assemblyMatrix,previewAssembly,openPreview}).toArray()});}}
  else{siblingIndexes.push({sourceIndex:index,combinedIndex:combined.length});combined.push(part);}
 });
 return {parts:combined,replacementIndexes,siblingIndexes};
}

export function stageReplacementColors(replacement,context,colors){
 if(colors.length!==context.parts.length)throw Error('Unvollständige Nachbarfarbzuordnung.');
 replacement.forEach((part,index)=>{part.color=colors[context.replacementIndexes[index]];});
 replacement.siblingColors=context.siblingIndexes.map(({sourceIndex,combinedIndex})=>({index:sourceIndex,color:colors[combinedIndex]}));
}

export function commitSiblingColors(committed,replacement){
 for(const item of replacement.siblingColors||[])if(committed[item.index])committed[item.index]={...committed[item.index],color:item.color};
}
