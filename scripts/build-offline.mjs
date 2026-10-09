import { build } from 'esbuild';
await build({ entryPoints: ['lib/offline.mjs'], bundle: true, format: 'iife', globalName: 'POSOfflineModule', outfile: 'public/offline-runtime.js', target: 'es2022' });
