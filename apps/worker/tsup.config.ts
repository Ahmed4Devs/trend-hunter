import { defineConfig } from 'tsup';

/**
 * Production bundle for the background worker.
 *
 * Workspace packages are inlined (`noExternal`) so the runtime image does not
 * need the monorepo, its pnpm symlinks or a second install step to resolve
 * `@trendhunter/*`. Third-party dependencies stay external and are installed
 * normally in the image: bundling them would be slower to build and actively
 * wrong for a few — BullMQ loads its Lua command files from its own package
 * directory at runtime, which a bundle does not have.
 *
 * ESM only. The whole repository is `"type": "module"`, and a CJS build would
 * need a second set of interop assumptions for no benefit on a single target.
 */
export default defineConfig({
  entry: ['src/main.ts'],
  outDir: 'dist',
  format: ['esm'],
  platform: 'node',
  target: 'node24',
  // Deliberately unminified: the only reader of this output is a stack trace.
  minify: false,
  sourcemap: true,
  clean: true,
  dts: false,
  splitting: false,
  treeshake: true,
  noExternal: [/^@trendhunter\//],
});
