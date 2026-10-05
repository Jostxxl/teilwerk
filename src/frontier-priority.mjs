// Scheduling only: this never certifies a connection or removes a candidate.
// Body revisions advance only alongside a successful native connection commit.
export function createFrontierPriority(count) {
  const revisions = Array(count).fill(0), failed = new Map();
  const state = (child, neighbors, built) => ({
    childRevision: revisions[child],
    contacts: neighbors[child].filter(index => built.has(index))
      .sort((a, b) => a - b).map(index => [index, revisions[index]]),
  });
  function tier(current, previous) {
    if (!previous) return 0;
    const old = new Map(previous.contacts);
    if (current.contacts.some(([index]) => !old.has(index))) return 1;
    if (current.childRevision !== previous.childRevision ||
        current.contacts.some(([index, revision]) => old.get(index) !== revision)) return 2;
    return 3;
  }
  return {
    // Input frontier is already in preferredOrder. All members occur once.
    rank(frontier, neighbors, builtIndices) {
      const built = new Set(builtIndices);
      return frontier.map((child, preferredRank) => ({
        child, preferredRank, tier: tier(state(child, neighbors, built), failed.get(child)),
      })).sort((a, b) => a.tier - b.tier || a.preferredRank - b.preferredRank);
    },
    // Called only after a fully attempted child returned accepted:false.
    rejected(child, neighbors, builtIndices) {
      failed.set(child, state(child, neighbors, new Set(builtIndices)));
    },
    committed(parent, child) {
      revisions[parent]++;
      revisions[child]++;
      failed.delete(child);
    },
  };
}
