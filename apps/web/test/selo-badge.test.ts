import assert from 'node:assert/strict';
import test from 'node:test';

import { matchSlug } from '@palpitei/selo/metadata';

import {
  findMatchForSlug,
  formatMatchDate,
  parseSeloImageName,
  seloMatchView,
  teamNameFontSize,
} from '../src/server/selo-badge.ts';

/** France x England, 18/07/2026 21:00 UTC — the real match that generated the selos. */
const FRANCE_ENGLAND = { p1: 'France', p2: 'England', startTime: Date.UTC(2026, 6, 18, 21, 0, 0) };

test('it separates the slug from the date it carries', () => {
  assert.deepEqual(parseSeloImageName('france-england-2026-07-18.png'), {
    slug: 'france-england-2026-07-18',
    isoDate: '2026-07-18',
  });
});

test('it refuses a name with no .png, no date, or an impossible date', () => {
  assert.equal(parseSeloImageName('france-england-2026-07-18'), null);
  assert.equal(parseSeloImageName('france-england-2026-07-18.jpg'), null);
  assert.equal(parseSeloImageName('france-england.png'), null);
  assert.equal(parseSeloImageName('collection.png'), null);
  // Well-formed, but not a real day: it would reach the database as an empty query.
  assert.equal(parseSeloImageName('france-england-2026-13-40.png'), null);
});

test('it refuses path traversal and uppercase in the slug', () => {
  assert.equal(parseSeloImageName('../../etc/passwd-2026-07-18.png'), null);
  assert.equal(parseSeloImageName('France-England-2026-07-18.png'), null);
});

test('the accepted slug is exactly what the metadata generates', () => {
  const gerado = matchSlug(FRANCE_ENGLAND.p1, FRANCE_ENGLAND.p2, FRANCE_ENGLAND.startTime);
  assert.equal(gerado, 'france-england-2026-07-18');
  assert.deepEqual(parseSeloImageName(`${gerado}.png`), { slug: gerado, isoDate: '2026-07-18' });
});

test('it finds the day\'s match by regenerating the slug, not by a similar name', () => {
  const outra = { p1: 'Spain', p2: 'Argentina', startTime: Date.UTC(2026, 6, 18, 19, 0, 0) };
  const candidatas = [outra, FRANCE_ENGLAND];
  assert.equal(findMatchForSlug('france-england-2026-07-18', candidatas), FRANCE_ENGLAND);
  assert.equal(findMatchForSlug('spain-argentina-2026-07-18', candidatas), outra);
  // Right teams, wrong day: it is not the same match and must not answer for the URL.
  assert.equal(findMatchForSlug('france-england-2026-07-19', candidatas), null);
  // A team on one side alone is not enough.
  assert.equal(findMatchForSlug('france-2026-07-18', candidatas), null);
});

test('a match with no start time does not become a selo', () => {
  assert.equal(findMatchForSlug('france-england-2026-07-18', [{ p1: 'France', p2: 'England' }]), null);
  assert.equal(seloMatchView({ p1: 'France', p2: 'England' }), null);
});

test('the view brings uppercase teams, a pt-BR date and the source slug', () => {
  assert.deepEqual(seloMatchView(FRANCE_ENGLAND), {
    home: 'FRANCE',
    away: 'ENGLAND',
    dateLabel: '18/07/2026',
    slug: 'france-england-2026-07-18',
  });
});

test('the selo date is UTC, the same day as the slug and the anchor', () => {
  // 23:30 UTC on 18/07 is 20:30 on 18/07 in BRT; a local timezone would say 18 and the
  // slug 18, but at 01:00 UTC on 19/07 (22:00 BRT on the 18th) they would diverge. We pin UTC.
  const tarde = Date.UTC(2026, 6, 19, 1, 0, 0);
  assert.equal(formatMatchDate(tarde), '19/07/2026');
  assert.equal(seloMatchView({ p1: 'France', p2: 'England', startTime: tarde })?.dateLabel, '19/07/2026');
});

test('a long team name scales down so Satori does not clip it', () => {
  const base = 100;
  assert.equal(teamNameFontSize({ home: 'FRANCE', away: 'ENGLAND' }, base), base * 0.88);
  assert.equal(teamNameFontSize({ home: 'ARGENTINA', away: 'SPAIN' }, base), base * 0.8);
  assert.equal(teamNameFontSize({ home: 'BOSNIA AND HERZ', away: 'ITALY' }, base), base * 0.62);
  assert.ok(teamNameFontSize({ home: 'A'.repeat(24), away: 'ITALY' }, base) < base * 0.62);
});
