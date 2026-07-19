/**
 * Design tokens as literal values, for renderers that cannot resolve `var(--*)`.
 *
 * WHY THIS EXISTS. `CONVENTIONS.md` forbids hardcoding a hex, a radius or a
 * font, and every screen obeys that by writing `var(--lime)` inline. The Selo
 * images are rendered by Satori (inside `next/og`), which implements a SUBSET of
 * CSS and has no cascade and no custom properties: a `var(--lime)` reaches it as
 * an uninterpretable string and the element renders with no colour at all, in
 * silence. So the rule cannot be met by writing `var(--*)`, and the alternative
 * that a hurried author reaches for is pasting `#C8F13F` into the art file.
 *
 * This module is the third option: it READS the design system's own token files
 * at runtime and hands back the literal each token resolves to. The art still
 * names tokens and never a colour, and a token edited in `packages/ds` moves the
 * badge with it. No value is copied here.
 *
 * It fails loudly. A token file that cannot be found, or a name that does not
 * exist, throws — the art must never render with a silently missing colour on a
 * permanent, public artifact.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The token files, in cascade order. Later files may alias earlier ones. */
const TOKEN_FILES = ['colors.css', 'typography.css', 'spacing.css', 'effects.css'] as const;

/**
 * Directories to start the search from: this module, then the working directory.
 *
 * The module's own location is tried first because it survives being started
 * from anywhere; `process.cwd()` is the fallback for a bundle whose
 * `import.meta.url` no longer describes a real directory.
 *
 * NOT `require.resolve`, which would honour the package's `exports` map and be
 * the tidier answer: a `createRequire(...).resolve(variable)` makes webpack emit
 * "Critical dependency: the request of a dependency is an expression" on every
 * build. A walk costs a few `existsSync` calls once per process and keeps the
 * build output clean enough that a real warning still stands out.
 */
function searchRoots(): string[] {
  const roots = [resolve(process.cwd())];
  try {
    roots.unshift(dirname(fileURLToPath(import.meta.url)));
  } catch {
    // Bundled without a file URL; the working directory is enough.
  }
  return roots;
}

/** Locates one token file, either installed or in the monorepo's own packages. */
function resolveTokenFile(file: string): string {
  for (const root of searchRoots()) {
    let dir = root;
    for (let up = 0; up < 12; up++) {
      const installed = join(dir, 'node_modules', '@palpitei', 'ds', 'tokens', file);
      if (existsSync(installed)) return installed;
      const inRepo = join(dir, 'packages', 'ds', 'tokens', file);
      if (existsSync(inRepo)) return inRepo;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  throw new Error(
    `[selo] não achei ${file} nos tokens do design system (@palpitei/ds). ` +
      `Sem eles a arte sairia sem cor — recusando renderizar.`,
  );
}

/** `--name: value;` declarations, ignoring `@keyframes` bodies (they declare none). */
const DECLARATION = /(--[a-z0-9-]+)\s*:\s*([^;}]+)/gi;

function readAllTokens(): Map<string, string> {
  const raw = new Map<string, string>();
  for (const file of TOKEN_FILES) {
    const css = readFileSync(resolveTokenFile(file), 'utf8');
    for (const match of css.matchAll(DECLARATION)) {
      raw.set(match[1]!.trim(), match[2]!.trim());
    }
  }
  // The design system aliases some tokens to others (`--accent: var(--lime)`).
  // Two passes settle every alias currently declared; a third would only be
  // needed for an alias of an alias of an alias, which does not exist.
  for (let pass = 0; pass < 3; pass++) {
    for (const [name, value] of raw) {
      const alias = /^var\((--[a-z0-9-]+)\)$/i.exec(value);
      if (!alias) continue;
      const target = raw.get(alias[1]!);
      if (target) raw.set(name, target);
    }
  }
  return raw;
}

let cache: Map<string, string> | null = null;

/** The resolved token table. Read once per process; the files never change at runtime. */
function tokens(): Map<string, string> {
  if (!cache) cache = readAllTokens();
  return cache;
}

/**
 * The literal value of one design token.
 *
 * @param name Token name including the leading dashes, e.g. `--lime`.
 */
export function dsToken(name: string): string {
  const value = tokens().get(name);
  if (value === undefined) {
    throw new Error(`[selo] token ${name} não existe no design system — a arte não pode inventar um valor.`);
  }
  return value;
}

/**
 * A pixel token as a number, optionally scaled.
 *
 * The design system is authored for a 420px phone screen, so the Selo canvas
 * scales every spatial token by the same factor instead of inventing a second
 * spacing scale. `--gutter` stays `--gutter`, just bigger.
 */
export function dsPx(name: string, factor = 1): number {
  const value = dsToken(name);
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`[selo] token ${name} = ${JSON.stringify(value)} não é uma medida em px.`);
  }
  return parsed * factor;
}
