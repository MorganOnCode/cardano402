import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: './src/index.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  target: 'node20',
  splitting: false,
  external: ['zod'],
  tsconfig: './tsconfig.json',
});
