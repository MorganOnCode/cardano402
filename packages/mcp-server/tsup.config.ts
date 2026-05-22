import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: './src/index.ts',
    cli: './src/cli.ts',
  },
  format: ['esm'],
  dts: { entry: { index: './src/index.ts' } },
  clean: true,
  sourcemap: true,
  treeshake: true,
  target: 'node20',
  splitting: false,
  external: [
    'zod',
    '@cardano402/core',
    '@modelcontextprotocol/sdk',
    '@lucid-evolution/lucid',
    '@lucid-evolution/provider',
  ],
  tsconfig: './tsconfig.json',
});
