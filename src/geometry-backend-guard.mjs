// Until a material-changing operation has an exact implementation, refusing it
// preserves the rational operand. Dropping the attachment would silently feed
// the rounded display mesh back into the legacy geometry kernel.
export function requireLegacyGeometry(part){
 if(part?.exactGeometry!==undefined || part?.kind==='exactGeometry' || part?.kind==='exactGeometryBinding')throw Object.assign(Error('Diese Bearbeitung unterstützt die neue exakte Geometrie noch nicht. Das genaue Original bleibt erhalten.'),{code:'EXACT_OPERATION_UNSUPPORTED'});
}
