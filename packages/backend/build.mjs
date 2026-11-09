import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.mjs',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  // Fastify и его зависимости ставятся в контейнер через npm, не бандлим их.
  packages: 'external',
  // shared — исходники TypeScript внутри монорепо, их бандлим.
  plugins: [
    {
      name: 'bundle-workspace',
      setup(b) {
        b.onResolve({ filter: /^@beeline-resize\// }, async (args) => {
          if (args.pluginData?.inner) return;
          const r = await b.resolve(args.path, {
            kind: args.kind,
            resolveDir: args.resolveDir,
            pluginData: { inner: true },
          });
          return { ...r, external: false };
        });
      },
    },
  ],
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});
