// Build for the Palpitei design system.
//
// The components are plain JSX whose only import is React, and the hand-written
// .d.ts files next to them are the real API contract — so the build bundles the
// barrel and ships those .d.ts as the package types rather than inferring types
// from untyped JSX.
import { build } from 'esbuild';
import { readdir, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

const root = import.meta.dirname;
const dist = path.join(root, 'dist');
const srcComponents = path.join(root, 'components', 'core');

await rm(dist, { recursive: true, force: true });
await mkdir(path.join(dist, 'types'), { recursive: true });

// 1. Bundle the barrel. React stays external — it's a peer dep.
await build({
  entryPoints: [path.join(root, 'src', 'index.js')],
  bundle: true,
  format: 'esm',
  target: 'es2020',
  jsx: 'transform',
  external: ['react', 'react-dom'],
  outfile: path.join(dist, 'index.js'),
  logLevel: 'info',
});

// 2. Ship the hand-written .d.ts as package types. They reference the React
//    namespace without importing it, which only resolves as a UMD global in a
//    non-module file; these are modules, so the import has to be explicit.
const dtsFiles = (await readdir(srcComponents)).filter((f) => f.endsWith('.d.ts'));
const names = [];
for (const file of dtsFiles) {
  const name = file.replace(/\.d\.ts$/, '');
  names.push(name);
  const body = await readFile(path.join(srcComponents, file), 'utf8');
  const needsReact = /\bReact\./.test(body);
  const header = needsReact ? "import type * as React from 'react';\n\n" : '';
  await writeFile(path.join(dist, 'types', file), header + body.trimEnd() + '\n');
}

// 3. Compiled stylesheet. The components are inline-styled against var(--*),
//    so the tokens ARE this system's shipped CSS. They must be concatenated
//    into one real stylesheet rather than left as an @import barrel: consumers
//    resolve this file from its own location, where tokens/ doesn't exist.
const tokenOrder = ['colors.css', 'typography.css', 'spacing.css', 'effects.css'];
const tokensDir = path.join(root, 'tokens');
const tokenNames = (await readdir(tokensDir)).filter((f) => f.endsWith('.css'));
const tokenSorted = [
  ...tokenOrder.filter((f) => tokenNames.includes(f)),
  ...tokenNames.filter((f) => !tokenOrder.includes(f)).sort(),
];
const css = [];
for (const f of tokenSorted) {
  css.push(`/* tokens/${f} */\n${(await readFile(path.join(tokensDir, f), 'utf8')).trim()}`);
}
await writeFile(path.join(dist, 'palpitei.css'), css.join('\n\n') + '\n');
console.log(`[build] stylesheet: dist/palpitei.css from ${tokenSorted.join(', ')}`);

// 4. Barrel of types, mirroring src/index.js.
const order = ['AppFrame', 'Button', 'Badge', 'Chip', 'SegTabs', 'Card', 'Toggle', 'ProgressBar', 'ListRow', 'MatchCard'];
const sorted = [...order.filter((n) => names.includes(n)), ...names.filter((n) => !order.includes(n)).sort()];
await writeFile(
  path.join(dist, 'index.d.ts'),
  sorted.map((n) => `export * from './types/${n}';`).join('\n') + '\n',
);

console.log(`[build] bundled ${sorted.length} components: ${sorted.join(', ')}`);
