export function browserOnlyMode({hostname = globalThis.location?.hostname, forced = typeof __STUDIO_BROWSER_ONLY__ !== 'undefined' && __STUDIO_BROWSER_ONLY__} = {}) {
  return Boolean(forced || (hostname && !['127.0.0.1', 'localhost', '[::1]'].includes(hostname)));
}

export function requireLocalExactRuntime() {
  if (browserOnlyMode()) throw new Error('Dieses Projekt benötigt für diese Bearbeitung die lokale Desktop-Erweiterung. Die Browser-Version überträgt keine Modelldaten an einen Rechendienst.');
}
