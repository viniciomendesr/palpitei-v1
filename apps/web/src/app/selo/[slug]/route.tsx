/**
 * The Selo TxLINE match seal, rendered on demand.
 *
 * `/selo/<match-slug>.png` — the exact URL `buildSeloMetadata` writes into every
 * minted document's `image`. Nothing is pre-generated and nothing is committed:
 * the URL answers 200 the moment the app is deployed.
 *
 * WHY A DYNAMIC SEGMENT DOES NOT SHADOW THE METADATA. The documents themselves
 * are static files in `public/selo/*.json`, and Next resolves filesystem routes
 * BEFORE dynamic routes, so `/selo/…-rafy.json` still serves the JSON and only
 * the `.png` requests, which have no file, reach this handler. Verified against
 * the production build, not assumed.
 *
 * FAILING HONESTLY. A slug with no matching match returns 404. The alternative
 * is drawing a seal for a match that does not exist, and this artwork ends up
 * inside a permanent, public, non-burnable asset: a blank or an invented badge
 * would be exactly the fabricated-provenance failure the project forbids. The
 * 404 is not cached, because a slug can become real once the match is ingested.
 */

import { createMatchRepo } from '@palpitei/db';

import { createDb } from '@/server/db';
import { renderSeloMatchImage, SELO_MISS_CACHE_CONTROL } from '@/server/selo-art.tsx';
import { findMatchForSlug, parseSeloImageName, seloMatchView } from '@/server/selo-badge.ts';

export const runtime = 'nodejs';
// The seal is derived from a database row, so it cannot be prerendered at build
// time; the response itself is cached for a year by its own header.
export const dynamic = 'force-dynamic';

function notFound(reason: string): Response {
  return new Response(reason, {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': SELO_MISS_CACHE_CONTROL },
  });
}

export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }): Promise<Response> {
  const { slug: name } = await ctx.params;

  const parsed = parseSeloImageName(name);
  if (!parsed) return notFound('selo: nome de imagem inválido');

  const matches = createMatchRepo(createDb());
  // Narrowed by the kickoff day the slug carries, then confirmed by regenerating
  // the slug from the row. The day alone is never enough: two matches can share it.
  const candidates = await matches.listByUtcDate(parsed.isoDate);
  const row = findMatchForSlug(parsed.slug, candidates);
  if (!row) return notFound('selo: nenhuma partida corresponde a esse slug');

  const view = seloMatchView(row);
  if (!view) return notFound('selo: partida sem horário de início');

  return renderSeloMatchImage(view);
}
