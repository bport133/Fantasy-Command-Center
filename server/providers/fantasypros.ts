// FantasyPros consensus rankings: the API (needs a key) or a CSV exported from the site.

import type { FPPlayer } from '../../shared/types.js';
import { getJson } from '../http.js';
import { basePosition, normalizeName } from '../names.js';

const FANTASY_POS = new Set(['QB', 'RB', 'WR', 'TE']);

export async function fetchFantasyProsRankings(
  opts: { apiKey: string; season: number; type: string; scoring: string },
  fetchJson = getJson,
): Promise<FPPlayer[]> {
  const q = new URLSearchParams({
    type: opts.type || 'dynasty',
    scoring: (opts.scoring || 'PPR').toUpperCase(),
    position: 'ALL',
    week: '0',
  });
  const url = `https://api.fantasypros.com/public/v2/json/nfl/${opts.season}/consensus-rankings?${q}`;
  const data = await fetchJson(url, { label: 'FantasyPros', headers: { 'x-api-key': opts.apiKey } });
  const players = parseFantasyProsApi(data);
  if (!players.length) throw new Error('FantasyPros: API returned no players (check ranking type and scoring)');
  return players;
}

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && v !== '' && v !== null ? n : undefined;
};

export function parseFantasyProsApi(data: any): FPPlayer[] {
  const out: FPPlayer[] = [];
  for (const p of data?.players ?? []) {
    const pos = basePosition(String(p.player_position_id ?? p.pos_rank ?? ''));
    const rank = num(p.rank_ecr);
    if (!FANTASY_POS.has(pos) || !rank || !p.player_name) continue;
    out.push({
      rank,
      tier: num(p.tier) ?? 0,
      name: p.player_name,
      key: normalizeName(p.player_name),
      nfl: p.player_team_id || 'FA',
      pos,
      age: num(p.player_age),
      best: num(p.rank_min),
      worst: num(p.rank_max),
      avg: num(p.rank_ave),
    });
  }
  return rerank(out);
}

/**
 * Parses the CSV FantasyPros offers for download (RK, TIERS, PLAYER NAME, TEAM, POS, AGE,
 * BEST, WORST, AVG. ...). Column names are matched loosely so older exports also work.
 */
export function parseFantasyProsCsv(csv: string): FPPlayer[] {
  const rows = parseCsv(csv.replace(/^﻿/, ''));
  const headerIdx = rows.findIndex((r) => r.some((c) => /player/i.test(c)) && r.some((c) => /^\s*(rk|rank)\s*$/i.test(c)));
  if (headerIdx < 0) throw new Error('CSV needs RK and PLAYER NAME columns (export it from FantasyPros rankings)');
  const header = rows[headerIdx].map((h) => h.trim().toUpperCase().replace(/[^A-Z]/g, ''));
  const col = (...names: string[]) => header.findIndex((h) => names.includes(h));
  const c = {
    rank: col('RK', 'RANK'),
    tier: col('TIERS', 'TIER'),
    name: col('PLAYERNAME', 'PLAYER', 'NAME'),
    team: col('TEAM'),
    pos: col('POS', 'POSITION'),
    age: col('AGE'),
    best: col('BEST'),
    worst: col('WORST'),
    avg: col('AVG', 'AVERAGE'),
  };
  const out: FPPlayer[] = [];
  for (const r of rows.slice(headerIdx + 1)) {
    const rank = num(r[c.rank]);
    const name = r[c.name]?.trim();
    const pos = basePosition(r[c.pos] ?? '');
    if (!rank || !name || !FANTASY_POS.has(pos)) continue;
    const at = (i: number) => (i >= 0 ? num(r[i]) : undefined);
    out.push({
      rank,
      tier: at(c.tier) ?? 0,
      name,
      key: normalizeName(name),
      nfl: (c.team >= 0 && r[c.team]?.trim()) || 'FA',
      pos,
      age: at(c.age),
      best: at(c.best),
      worst: at(c.worst),
      avg: at(c.avg),
    });
  }
  if (!out.length) throw new Error('No QB/RB/WR/TE rows found in the CSV');
  return rerank(out);
}

/** Sort by rank and drop duplicates (keep the best-ranked entry per name). */
function rerank(players: FPPlayer[]): FPPlayer[] {
  const seen = new Set<string>();
  return players
    .sort((a, b) => a.rank - b.rank)
    .filter((p) => (seen.has(p.key) ? false : (seen.add(p.key), true)));
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim()));
}
