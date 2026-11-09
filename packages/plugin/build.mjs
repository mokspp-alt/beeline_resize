import { build, context } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';

const watch = process.argv.includes('--watch');
// Адрес бэкенда зашивается при сборке; домен должен быть в manifest.json → networkAccess.
const backendUrl = process.env.BACKEND_URL ?? 'http://localhost:8787';

await mkdir('dist', { recursive: true });

const mainOpts = {
  entryPoints: ['src/main.ts'],
  outfile: 'dist/code.js',
  bundle: true,
  target: 'es2020',
  format: 'iife',
  logLevel: 'info',
};

const uiOpts = {
  entryPoints: ['src/ui/index.tsx'],
  bundle: true,
  write: false,
  target: 'es2020',
  format: 'iife',
  jsx: 'automatic',
  jsxImportSource: 'preact',
  define: { __BACKEND_URL__: JSON.stringify(backendUrl) },
  logLevel: 'info',
};

async function writeUi(result) {
  const js = result.outputFiles[0].text.replace(/<\/script>/g, '<\\/script>');
  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>${CSS}</style></head><body><div id="root"></div><script>${js}</script></body></html>`;
  await writeFile('dist/ui.html', html);
}

const CSS = `
:root{font-family:Inter,system-ui,sans-serif;font-size:12px;color:var(--figma-color-text,#222);background:var(--figma-color-bg,#fff)}
body{margin:0;padding:12px}
button{font:inherit;padding:6px 12px;border-radius:6px;border:1px solid var(--figma-color-border,#ccc);background:var(--figma-color-bg-brand,#0d99ff);color:var(--figma-color-text-onbrand,#fff);cursor:pointer}
button:disabled{opacity:.4;cursor:default}
.muted{color:var(--figma-color-text-secondary,#777)}
.warn{color:var(--figma-color-text-warning,#b86200)}
`;

if (watch) {
  const m = await context(mainOpts);
  const u = await context({
    ...uiOpts,
    plugins: [{ name: 'html', setup: (b) => b.onEnd((r) => r.outputFiles && writeUi(r)) }],
  });
  await Promise.all([m.watch(), u.watch()]);
} else {
  await build(mainOpts);
  await writeUi(await build(uiOpts));
}
