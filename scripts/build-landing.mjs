#!/usr/bin/env node
// scripts/build-landing.mjs
// Precompile the landing-page JSX so we can drop 'unsafe-eval' from CSP.
//
// Strategy: concatenate the existing 8 .jsx files in the order they were
// loaded via <script type="text/babel"> (hooks first, components, app last),
// prepend an `import React, ...` shim, then bundle with esbuild into a
// single IIFE at landing/dist/app.js.
//
// No source changes needed in landing/*.jsx -- the global React.* references
// resolve cleanly because the bundled module has React in scope, and the
// classic JSX transform (jsxFactory: React.createElement) keeps the
// generated calls identical to what Babel-standalone was producing in the
// browser before.

import { build } from 'esbuild';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const LANDING = resolve(REPO_ROOT, 'landing');
const DIST = resolve(LANDING, 'dist');

// Concatenation order matches the original <script type="text/babel"> tags.
// hooks first, then components in their previous load order, then app last
// (since app.jsx calls ReactDOM.createRoot on the App component).
const SOURCE_ORDER = [
  'hooks.jsx',
  'components/HeroReceipt.jsx',
  'components/HeroTerminal.jsx',
  'components/LiveDemo.jsx',
  'components/HowItWorks.jsx',
  'components/UseCases.jsx',
  'components/MorganBlock.jsx',
  'app.jsx',
];

const BANNER = `// AUTO-GENERATED. Do not edit landing/dist/*. Run \`pnpm build:landing\`.
// Source: concatenated from landing/*.jsx and landing/components/*.jsx.

import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';

// The original Babel-standalone build expected React and ReactDOM as
// globals. We satisfy that surface without changing the source files.
const ReactDOM = { createRoot };

`;

function makeVirtualEntry() {
  const parts = [BANNER];
  for (const rel of SOURCE_ORDER) {
    const full = resolve(LANDING, rel);
    const body = readFileSync(full, 'utf-8');
    parts.push(`// ===== FILE: ${rel} =====\n`);
    parts.push(body);
    parts.push('\n');
  }
  return parts.join('\n');
}

async function main() {
  mkdirSync(DIST, { recursive: true });

  const virtual = makeVirtualEntry();
  const entryPath = resolve(DIST, '.entry.jsx');
  writeFileSync(entryPath, virtual);

  try {
    const result = await build({
      entryPoints: [entryPath],
      outfile: resolve(DIST, 'app.js'),
      bundle: true,
      format: 'iife',
      loader: { '.jsx': 'jsx' },
      jsxFactory: 'React.createElement',
      jsxFragment: 'React.Fragment',
      define: {
        'process.env.NODE_ENV': '"production"',
      },
      minify: true,
      sourcemap: true,
      target: 'es2020',
      logLevel: 'info',
      metafile: true,
    });

    // Report bundle size for visibility
    const out = result.metafile.outputs[Object.keys(result.metafile.outputs).find((k) =>
      k.endsWith('app.js')
    )];
    const kb = (out.bytes / 1024).toFixed(1);
    console.log(`\nLanding bundle: landing/dist/app.js (${kb} KiB)`);
  } finally {
    // Clean up the virtual entry so the dist dir only contains the compiled output
    rmSync(entryPath, { force: true });
  }
}

main().catch((err) => {
  console.error('build-landing failed:', err);
  process.exit(1);
});
