// Visible part numbers are independent of native material-provenance IDs.
export function partNumber(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value);
  if (!/^\d+$/.test(text)) return null;
  const number = Number(text);
  return Number.isSafeInteger(number) && number > 0 ? String(number) : null;
}

function withNumber(part, id) {
  const out = {...part, id};
  if (part.plannedMark?.autoId) out.plannedMark = {...part.plannedMark, text: id};
  // mark.text describes already modified mesh geometry and is never rewritten.
  return out;
}

function allocator(used) {
  let next = 1;
  return () => { while (used.has(String(next))) next++; const id = String(next++); used.add(id); return id; };
}

/** Preserve existing unique numbers, migrate legacy/invalid/duplicate IDs in
 * list order, and refresh only automatic drafts. Input objects are untouched. */
export function normalizePartNumbers(parts) {
  const used = new Set(), retained = parts.map(part => {
    const id = partNumber(part.id);
    if (!id || used.has(id)) return null;
    used.add(id); return id;
  }), next = allocator(used);
  return parts.map((part, index) => withNumber(part, retained[index] || next()));
}

/** Preview and commit use the same deterministic allocation. The first child
 * inherits the parent number; every sibling keeps its existing number. */
export function numberReplacementParts(existing, active, replacement) {
  if (!Number.isInteger(active) || active < 0 || active >= existing.length || !Array.isArray(replacement) || !replacement.length) throw Error('Ungültige Teilersetzung.');
  const all = existing.map(part => partNumber(part.id));
  if (all.some(id => !id) || new Set(all).size !== all.length) throw Error('Teilnummern müssen vor dem Schneiden eindeutig sein.');
  const used = new Set(all), next = allocator(used);
  return replacement.map((part, index) => withNumber(part, index ? next() : all[active]));
}

/** A merged group retains its smallest original number. Other groups remain
 * stable; changing assembly order never renumbers an existing part. */
export function mergedPartNumbers(existing, groups) {
  const numbers = existing.map(part => partNumber(part.id)), claimed = new Set();
  if (numbers.some(id => !id) || new Set(numbers).size !== numbers.length) throw Error('Teilnummern müssen vor dem Verbinden eindeutig sein.');
  return groups.map(group => {
    if (!Array.isArray(group.members) || !group.members.length) throw Error('Ungültige Teilgruppe.');
    const ids = group.members.map(index => {
      if (!Number.isInteger(index) || index < 0 || index >= existing.length || claimed.has(index)) throw Error('Teile dürfen nur einer Gruppe angehören.');
      claimed.add(index); return Number(numbers[index]);
    });
    return String(Math.min(...ids));
  });
}

/** Explain physical text that differs from the current number, including
 * intentional custom text. This is a label notice, not a geometry failure. */
export function partMarkNotice(part) {
  return part.mark?.text && part.mark.text !== part.id ? `Text am Teil: „${part.mark.text}“. Zugeordnete Teilnummer: ${part.id}.` : '';
}
