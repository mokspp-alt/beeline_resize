import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.mjs',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  // Внешние npm-зависимости ставятся в контейнер; @beeline-resize/shared (исходники TS) бандлится.
  external: ['fastify', 'zod', '@anthropic-ai/sdk'],
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});
