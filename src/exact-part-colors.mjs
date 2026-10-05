// The actual assembly contact graph is computed before this staging step.
// Keep valid existing user palette assignments; resolve actual conflicts only.
export function stageExactPartColors(parts,palette,proof){
 const fail=()=>{throw Error('Unvollständige Nachbarfarbprüfung für die lokale Teilübernahme.');};
 if(!Array.isArray(parts)||!Array.isArray(palette)||palette.length!==10||!Array.isArray(proof?.neighbors)||proof.neighbors.length!==parts.length||!Array.isArray(proof?.colors)||proof.colors.length!==parts.length)fail();
 const valid=c=>typeof c==='string'&&/^#[0-9a-f]{6}$/i.test(c),allowed=new Set(palette.map(c=>valid(c)?c.toLowerCase():null));
 if(allowed.size!==10||allowed.has(null))fail();
 for(const [i,links]of proof.neighbors.entries())if(!Array.isArray(links)||links.some(j=>!Number.isInteger(j)||j<0||j>=parts.length||j===i)||new Set(links).size!==links.length)fail();
 const okay=colors=>colors.every(c=>valid(c)&&allowed.has(c.toLowerCase()))&&proof.neighbors.every((links,i)=>links.every(j=>colors[i].toLowerCase()!==colors[j].toLowerCase()));
 if(!okay(proof.colors))fail();
 if(okay(parts.map(p=>p.color)))return parts;
 return parts.map((part,i)=>part.color===proof.colors[i]?part:{...part,color:proof.colors[i]});
}
