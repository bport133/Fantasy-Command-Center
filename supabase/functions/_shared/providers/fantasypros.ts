// FantasyPros consensus rankings: the API (needs a key) or a CSV exported from the site.

import type { FPPlayer, NewsItem, ProjectedPlayer } from '../types.ts';
import { getJson } from '../http.ts';
import { basePosition, normalizeName } from '../names.ts';

const FANTASY_POS = new Set(['QB', 'RB', 'WR', 'TE']);

export async function fetchFantasyProsRankings(
  opts: { apiKey: string; season: number; type: string; scoring: string; week?: number },
  fetchJson = getJson,
): Promise<FPPlayer[]> {
  const q = new URLSearchParams({
    type: opts.type || 'dynasty',
    scoring: (opts.scoring || 'PPR').toUpperCase(),
    position: 'ALL',
    // Weekly rankings are for a specific week; the season-long sets use week 0.
    week: opts.type === 'weekly' && opts.week ? String(opts.week) : '0',
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

const PROJECTION_POS = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DST']);

/**
 * Weekly fantasy-point projections. FanDuel scores half-PPR, so DFS uses scoring=HALF.
 * The response has varied over API versions, so points are read from any of the usual fields.
 */
export async function fetchFantasyProsProjections(
  opts: { apiKey: string; season: number; week: number; scoring: string },
  fetchJson = getJson,
): Promise<ProjectedPlayer[]> {
  const q = new URLSearchParams({ position: 'ALL', week: String(opts.week), scoring: opts.scoring.toUpperCase() });
  const url = `https://api.fantasypros.com/public/v2/json/nfl/${opts.season}/projections?${q}`;
  const data = await fetchJson(url, { label: 'FantasyPros projections', headers: { 'x-api-key': opts.apiKey } });
  const players = parseFantasyProsProjections(data);
  if (!players.length) throw new Error('FantasyPros projections: no players in the response');
  return players;
}

export function parseFantasyProsProjections(data: any): ProjectedPlayer[] {
  const out: ProjectedPlayer[] = [];
  for (const p of data?.players ?? []) {
    const name = p.name ?? p.player_name;
    const rawPos = String(p.position_id ?? p.player_position_id ?? p.position ?? '').toUpperCase();
    const pos = rawPos === 'DEF' || rawPos === 'D' ? 'DST' : basePosition(rawPos);
    const stats = p.stats ?? {};
    const points = num(stats.points ?? stats.fpts ?? stats.FPTS ?? p.points ?? p.fpts ?? p.fantasy_points);
    if (!name || !PROJECTION_POS.has(pos) || points === undefined) continue;
    out.push({ name, key: normalizeName(name), pos, team: p.team_id ?? p.player_team_id ?? p.team ?? '', points: Math.round(points * 10) / 10 });
  }
  return out.sort((a, b) => b.points - a.points);
}

/** Latest NFL player news. */
export async function fetchFantasyProsNews(opts: { apiKey: string }, fetchJson = getJson): Promise<Omit<NewsItem, 'mine'>[]> {
  const url = 'https://api.fantasypros.com/public/v2/json/nfl/news?limit=100';
  const data = await fetchJson(url, { label: 'FantasyPros news', headers: { 'x-api-key': opts.apiKey } });
  return parseFantasyProsNews(data);
}

export function parseFantasyProsNews(data: any): Omit<NewsItem, 'mine'>[] {
  const items = data?.items ?? data?.news ?? data?.articles ?? [];
  const out: Omit<NewsItem, 'mine'>[] = [];
  for (const n of items) {
    const title = n.title ?? n.headline;
    if (!title) continue;
    const ts = n.updated ?? n.created ?? n.published ?? n.date;
    const time = ts ? new Date(typeof ts === 'number' && ts < 1e12 ? ts * 1000 : ts).toISOString() : undefined;
    out.push({
      title: String(title),
      description: n.desc ?? n.description ?? n.analysis ?? undefined,
      player: n.player_name ?? n.player?.name ?? undefined,
      team: n.team_id ?? n.team ?? undefined,
      time: time && !time.startsWith('Invalid') ? time : undefined,
      url: n.link ?? n.url ?? undefined,
      impact: n.impact ?? undefined,
    });
  }
  return out;
}
