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
body{margin:0;padding:0 12px 16px}
section{display:flex;flex-direction:column;gap:8px}
button{font:inherit;padding:6px 12px;border-radius:6px;border:1px solid transparent;background:var(--figma-color-bg-brand,#0d99ff);color:var(--figma-color-text-onbrand,#fff);cursor:pointer}
button.secondary{background:transparent;color:inherit;border-color:var(--figma-color-border,#ccc)}
button:disabled{opacity:.4;cursor:default}
button.chip{padding:3px 8px;border-radius:12px;background:var(--figma-color-bg-secondary,#f0f0f0);color:inherit}
button.chip.saved{border-color:var(--figma-color-border,#ccc)}
button.mini{padding:2px 6px;font-size:11px;margin-left:auto}
input,select,textarea{font:inherit;padding:5px 6px;border:1px solid var(--figma-color-border,#ccc);border-radius:4px;background:transparent;color:inherit}
input.num{width:56px}
textarea{width:100%;box-sizing:border-box;font-family:ui-monospace,monospace;font-size:11px}
label{display:flex;gap:6px;align-items:center}
.tabs{position:sticky;top:0;display:flex;gap:4px;padding:10px 0;background:var(--figma-color-bg,#fff);z-index:1}
.tabs button{background:transparent;color:inherit;border-color:transparent}
.tabs button.on{border-color:var(--figma-color-border,#ccc)}
.row{display:flex;gap:8px;align-items:center}
.row.wrap{flex-wrap:wrap;gap:4px}
details{border-top:1px solid var(--figma-color-border,#e5e5e5);padding:4px 0}
summary{cursor:pointer;display:flex;gap:6px;align-items:center}
label.size{padding:2px 0 2px 18px}
.muted{color:var(--figma-color-text-secondary,#777)}
.warn{color:var(--figma-color-text-warning,#b86200)}
.ok{color:var(--figma-color-text-success,#14ae5c)}
.ds p{cursor:pointer;margin:0}
.ds ul,.notes{margin:4px 0;padding-left:16px}
.confirm{padding:8px;border:1px solid var(--figma-color-border-warning,#f5a623);border-radius:6px}
.report{display:flex;flex-direction:column;gap:6px}
.target{padding:6px 8px;border-radius:6px;background:var(--figma-color-bg-secondary,#f5f5f5)}
.target.error{outline:1px solid var(--figma-color-border-danger,#f24822)}
.item{margin:2px 0}
.kind{font-weight:600}
.link{cursor:pointer;text-decoration:underline dotted}
.badge{font-size:10px;padding:1px 6px;border-radius:8px;background:var(--figma-color-bg-tertiary,#e5e5e5)}
.badge.ai{background:var(--figma-color-bg-brand-tertiary,#e5f4ff)}
a{cursor:pointer;text-decoration:underline}
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
