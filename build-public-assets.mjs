import {readFile} from 'node:fs/promises';

// Only reviewed brand assets belong in the website. Customer files in public/
// must never enter a release, including files added by local geometry tests.
export const PUBLIC_BRAND_FILES = Object.freeze([
  'brand/favicon.png', 'brand/prinjekt-dark.png', 'brand/prinjekt-light.png',
  'brand/sarabun-bold.woff2', 'brand/sarabun-regular.woff2', 'brand/SOURCES.txt',
]);
export const PUBLIC_LICENSE_FILES = Object.freeze([
  'fflate-MIT.txt', 'Helvetiker-Font-LICENSE.txt', 'Manifold-Apache-2.0.txt',
  'noble-hashes-LICENSE.txt', 'Sarabun-OFL.txt', 'support-fins-MIT.txt',
  'Three-Mesh-BVH-MIT.txt', 'Three-MIT.txt',
].map(name => `licenses/${name}`).concat('licenses/Prinjekt-Studio-MIT.txt'));
const files = [...PUBLIC_BRAND_FILES, ...PUBLIC_LICENSE_FILES];
const sourceURL = name => new URL(name === 'licenses/Prinjekt-Studio-MIT.txt' ? './LICENSE' : PUBLIC_BRAND_FILES.includes(name) ? `./public/${name}` : `./${name}`, import.meta.url);

export function studioPublicAssets() {
  return {
    name: 'studio-public-assets',
    async generateBundle() {
      for (const fileName of files) {
        const source = await readFile(sourceURL(fileName));
        this.emitFile({type: 'asset', fileName, source});
      }
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const pathname = new URL(req.url, 'http://localhost').pathname.slice(1);
        if (!files.includes(pathname)) return next();
        try {
          const source = await readFile(sourceURL(pathname));
          res.setHeader('Content-Type', pathname.endsWith('.png') ? 'image/png' : pathname.endsWith('.woff2') ? 'font/woff2' : pathname.endsWith('.otf') ? 'font/otf' : pathname.endsWith('.json') ? 'application/json' : 'text/plain; charset=utf-8');
          res.setHeader('X-Content-Type-Options', 'nosniff');
          res.end(source);
        } catch (error) { next(error); }
      });
    },
  };
}
