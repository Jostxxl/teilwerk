import {defineConfig} from 'vite';
import {studioPublicAssets} from './build-public-assets.mjs';

// Relative assets support dedicated domains and GitHub project Pages.
// Browser-only is unconditional: customer geometry never reaches an API.
export default defineConfig({base:'./',publicDir:false,plugins:[studioPublicAssets()],define:{__STUDIO_BROWSER_ONLY__:'true'},worker:{format:'es'}});
