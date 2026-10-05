const fatal = error => error?.name === 'RuntimeError' || /Aborted|memory access out of bounds|unreachable|RuntimeError/i.test(error?.message || '');
const sum = values => {
  let total = 0, correction = 0;
  for (const value of values) { const adjusted = value - correction, next = total + adjusted; correction = (next - total) - adjusted; total = next; }
  return total;
};
const finiteBox = box => box && ['min', 'max'].every(key => box[key]?.length === 3 && Array.from(box[key]).every(Number.isFinite)) && box.min.every((value, axis) => value <= box.max[axis]);
// Touching faces have no material intersection. Do not expand boxes by a
// model-scale epsilon: that would also erase the distinction for tiny sources.
const overlaps = (a, b) => a.min.every((value, axis) => Math.min(a.max[axis], b.max[axis]) > Math.max(value, b.min[axis]));

/** Measure the source material in a final native partition. All solids are
 * borrowed, share assembly coordinates, and remain untouched. Contributions
 * are exact native intersections, never inferred from a previous merge tree.
 * Negative cavity shells remain with their whole positive owner. A stopped
 * result is incomplete and must not replace a previously proven partition.
 * Fatal native errors are rethrown without any subsequent kernel call. */
export async function traceNativeProvenance(api, parts, owners, {
  relativeTolerance = 1e-9, smallSourceFraction = 1e-5,
  stop = () => false, progress = () => {},
} = {}) {
  if (!api || !Array.isArray(parts) || !Array.isArray(owners) || !Number.isFinite(relativeTolerance) || relativeTolerance < 0 || relativeTolerance > 1e-9 || !Number.isFinite(smallSourceFraction) || smallSourceFraction < 0 || smallSourceFraction > 1e-5 || typeof stop !== 'function' || typeof progress !== 'function') throw Error('Ungültige Einstellungen für den nativen Herkunftsnachweis.');
  const seen = new Set();
  for (const owner of owners) {
    if (!owner?.solid || !['number', 'string'].includes(typeof owner.ownerId) || typeof owner.ownerId === 'number' && !Number.isFinite(owner.ownerId) || seen.has(JSON.stringify(owner.ownerId))) throw Error('Der Herkunftsnachweis benötigt eindeutige ursprüngliche ownerIds.');
    seen.add(JSON.stringify(owner.ownerId));
  }
  if (parts.some(part => !(part?.solid || part)?.status)) throw Error('Der Herkunftsnachweis benötigt native Volumenkörper.');
  let poisoned = false, attempted = 0, skipped = 0, stopped = false;
  const diagnostics = [], perPart = parts.map(() => []), ownerContributions = owners.map(() => []), completed = parts.map(() => false);
  const tolerance = (volume, smallest = volume) => Math.min(Math.max(1e-9, Math.abs(volume) * relativeTolerance), Math.abs(volume) * smallSourceFraction, Math.abs(smallest) * smallSourceFraction);
  const check = solid => { const status = solid.status(); if (status !== 'NoError') throw Error(`Herkunftsnachweis: ungültiger Volumenkörper (${status}).`); };
  const release = solid => { if (solid && !poisoned) try { solid.delete(); } catch (error) { if (fatal(error)) poisoned = true; throw error; } };
  function inspect(solid, identity) {
    check(solid);
    const volume = solid.volume();
    if (!Number.isFinite(volume) || volume <= 0) {
      diagnostics.push({ ...identity, reason: 'nonpositive_or_invalid_volume', volume, accepted: false });
      return { solid, volume, box: null, valid: false };
    }
    const box = solid.boundingBox();
    if (!finiteBox(box)) throw Error('Herkunftsnachweis: ungültige native Begrenzung.');
    return { solid, volume, box, valid: true };
  }
  function signedOwner(source, metadata, explicit) {
    if (metadata?.signedGroup === true || explicit === true) return true;
    let components = [];
    try {
      components = source.solid.decompose();
      const volumes = components.map(component => { check(component); return component.volume(); });
      if (volumes.some(volume => !Number.isFinite(volume))) throw Error('Herkunftsnachweis: ungültiges natives Shell-Volumen.');
      // Merely inspect the signs; do not split ownership, drop zero shells, or
      // add cavity volumes as though they were independent physical material.
      return volumes.some(volume => volume <= 0);
    } catch (error) { if (fatal(error)) poisoned = true; throw error; }
    finally { for (const component of components) release(component); }
  }
  const sources = owners.map(owner => ({ ...inspect(owner.solid, { ownerId: owner.ownerId }), ownerId: owner.ownerId, component: owner.metadata?.component ?? 0, signedGroup: false }));
  const targets = parts.map((part, index) => inspect(part?.solid || part, { part: index }));
  for (let index = 0; index < sources.length; index++) if (sources[index].valid) sources[index].signedGroup = signedOwner(sources[index], owners[index].metadata, owners[index].signedGroup);
  async function pause(index) {
    await progress(`Materialherkunft prüfen: ${index}/${parts.length} Teile · ${attempted} Überschneidungen`);
    await new Promise(resolve => setTimeout(resolve, 0));
    if (await stop()) { stopped = true; return true; }
    return false;
  }
  for (let index = 0; index < targets.length; index++) {
    if (await pause(index)) break;
    const part = targets[index];
    for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex++) {
      const source = sources[sourceIndex];
      if (!part.valid || !source.valid || !overlaps(part.box, source.box)) { skipped++; continue; }
      if (attempted > 0 && attempted % 32 === 0 && await pause(index)) break;
      let intersection = null;
      try {
        attempted++;
        intersection = part.solid.intersect(source.solid);
        check(intersection);
        const volume = intersection.volume(), pairTolerance = tolerance(Math.min(part.volume, source.volume));
        if (!Number.isFinite(volume)) {
          diagnostics.push({ part: index, ownerId: source.ownerId, reason: 'invalid_intersection_volume', volume, accepted: false });
        } else if (volume < 0) {
          diagnostics.push({ part: index, ownerId: source.ownerId, reason: 'negative_intersection_volume', volume, tolerance: pairTolerance, accepted: -volume <= pairTolerance });
        } else if (volume > 0) {
          if (volume > Math.min(part.volume, source.volume) + pairTolerance) diagnostics.push({ part: index, ownerId: source.ownerId, reason: 'intersection_exceeds_input', volume, tolerance: pairTolerance, accepted: false });
          perPart[index].push({ ownerId: source.ownerId, component: source.component, volume, ...(source.signedGroup ? { signedGroup: true } : {}) });
          ownerContributions[sourceIndex].push(volume);
        }
      } catch (error) { if (fatal(error)) poisoned = true; throw error; }
      finally { release(intersection); }
    }
    if (stopped) break;
    completed[index] = true;
  }
  const partChecks = targets.map((part, index) => {
    const contributionVolume = sum(perPart[index].map(entry => entry.volume));
    const contributingOwners = perPart[index].map(entry => sources.find(source => source.ownerId === entry.ownerId).volume);
    const allowed = part.valid ? tolerance(part.volume, Math.min(part.volume, ...contributingOwners)) : 0, delta = contributionVolume - part.volume;
    return { index, volume: part.volume, contributionVolume, delta, tolerance: allowed, complete: completed[index], ok: completed[index] && part.valid && Math.abs(delta) <= allowed };
  });
  const complete = !stopped && completed.every(Boolean);
  const ownerChecks = sources.map((source, index) => {
    const contributionVolume = sum(ownerContributions[index]), allowed = source.valid ? tolerance(source.volume) : 0, delta = contributionVolume - source.volume;
    return { ownerId: source.ownerId, component: source.component, volume: source.volume, contributionVolume, delta, tolerance: allowed, complete, ok: complete && source.valid && Math.abs(delta) <= allowed };
  });
  const partsValid = partChecks.every(check => check.ok), ownersValid = ownerChecks.every(check => check.ok), diagnosticValid = diagnostics.every(diagnostic => diagnostic.accepted);
  return { perPart, partChecks, ownerChecks, invariant: { ok: complete && partsValid && ownersValid && diagnosticValid, parts: partsValid, owners: ownersValid, complete }, diagnostics, attempted, skipped, stopped };
}
