// FanDuel NFL daily fantasy: player-list CSV parsing and lineup optimization.
// Runs in the browser (optimizer) and on the server (parsing), so it has no platform imports.

import type { DfsPlayer } from './types.ts';
import { parseCsv } from './providers/fantasypros.ts';
import { normalizeName } from './names.ts';

/** FanDuel NFL classic ("full roster") rules. */
export const FANDUEL = {
  salaryCap: 60000,
  maxPerTeam: 4,
  /** Slots in FanDuel's order; FLEX takes an RB, WR or TE. */
  slots: ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX', 'DEF'] as const,
};
const FLEX_POS = ['RB', 'WR', 'TE'] as const;
const BASE_COUNTS: Record<string, number> = { QB: 1, RB: 2, WR: 3, TE: 1, DEF: 1 };
const SALARY_UNIT = 100; // FanDuel salaries are in $100 steps.

type Parsed = Omit<DfsPlayer, 'projection' | 'projectionSource'>;

/**
 * FanDuel's "Download players list" CSV: Id, Position, First Name, Nickname, Last Name, FPPG,
 * Played, Salary, Game, Team, Opponent, Injury Indicator, Injury Details, ...
 */
export function parseFanDuelCsv(csv: string): Parsed[] {
  const rows = parseCsv(csv.replace(/^﻿/, ''));
  const header = (rows[0] ?? []).map((h) => h.trim().toLowerCase());
  const col = (...names: string[]) => header.findIndex((h) => names.includes(h));
  const c = {
    id: col('id', 'player id + name'),
    pos: col('position'),
    first: col('first name'),
    nick: col('nickname', 'name'),
    last: col('last name'),
    fppg: col('fppg'),
    salary: col('salary'),
    game: col('game'),
    team: col('team'),
    opp: col('opponent'),
    injury: col('injury indicator'),
  };
  if (c.id < 0 || c.pos < 0 || c.salary < 0) {
    throw new Error('This does not look like a FanDuel players list (needs Id, Position and Salary columns). Use "Download players list" on the FanDuel contest page.');
  }
  const out: Parsed[] = [];
  for (const r of rows.slice(1)) {
    const salary = Number(String(r[c.salary] ?? '').replace(/[$,]/g, ''));
    const rawPos = String(r[c.pos] ?? '').trim().toUpperCase();
    const pos = rawPos === 'D' || rawPos === 'DST' || rawPos === 'DEF' ? 'DEF' : rawPos;
    if (!r[c.id] || !salary || !['QB', 'RB', 'WR', 'TE', 'DEF'].includes(pos)) continue;
    const name =
      (c.nick >= 0 && r[c.nick]?.trim()) || [r[c.first], r[c.last]].filter(Boolean).join(' ').trim();
    out.push({
      id: String(r[c.id]).trim(),
      name,
      key: normalizeName(name),
      pos,
      team: (r[c.team] ?? '').trim(),
      opp: (r[c.opp] ?? '').trim(),
      game: (r[c.game] ?? '').trim(),
      salary,
      fppg: Number(r[c.fppg]) || 0,
      injury: (r[c.injury] ?? '').trim(),
    });
  }
  if (!out.length) throw new Error('No QB/RB/WR/TE/DEF players found in the file');
  return out;
}

/** Injury tags that mean the player won't play. */
export const OUT_TAGS = new Set(['O', 'IR', 'NA', 'D', 'OUT', 'SUS']);

export interface LineupPlayer extends DfsPlayer {
  slot: string;
}

export interface Lineup {
  players: LineupPlayer[];
  salary: number;
  projection: number;
}

export interface OptimizeOptions {
  locked?: Set<string>;
  excluded?: Set<string>;
  /** Leave out players tagged Out/IR (default true). */
  skipInjured?: boolean;
  /** Players considered per position, best by value and by projection (keeps it fast). */
  poolPerPosition?: number;
}

/**
 * Exact best lineup for FanDuel classic: for each FLEX choice, pick the best set of k players per
 * position for every salary (knapsack), then combine positions under the cap. Team limits are
 * checked afterwards and resolved by excluding the weakest player from an over-stacked team.
 */
export function optimizeLineup(pool: DfsPlayer[], opts: OptimizeOptions = {}): Lineup | null {
  const excluded = new Set(opts.excluded ?? []);
  for (let attempt = 0; attempt < 6; attempt++) {
    const lineup = solve(pool, { ...opts, excluded });
    if (!lineup) return null;
    const byTeam = new Map<string, LineupPlayer[]>();
    for (const p of lineup.players) byTeam.set(p.team, [...(byTeam.get(p.team) ?? []), p]);
    const over = [...byTeam.values()].find((ps) => ps.length > FANDUEL.maxPerTeam);
    if (!over) return lineup;
    const weakest = over.filter((p) => !opts.locked?.has(p.id)).sort((a, b) => a.projection - b.projection)[0];
    if (!weakest) return null;
    excluded.add(weakest.id);
  }
  return null;
}

/** The best lineup plus up to `count - 1` alternatives, each differing by at least one player. */
export function optimizeLineups(pool: DfsPlayer[], count: number, opts: OptimizeOptions = {}): Lineup[] {
  const best = optimizeLineup(pool, opts);
  if (!best) return [];
  const seen = new Set([signature(best)]);
  const out = [best];
  const candidates: Lineup[] = [];
  for (const p of best.players) {
    if (opts.locked?.has(p.id)) continue;
    const alt = optimizeLineup(pool, { ...opts, excluded: new Set([...(opts.excluded ?? []), p.id]) });
    if (alt && !seen.has(signature(alt))) {
      seen.add(signature(alt));
      candidates.push(alt);
    }
  }
  candidates.sort((a, b) => b.projection - a.projection);
  return [...out, ...candidates].slice(0, count);
}

const signature = (l: Lineup) => l.players.map((p) => p.id).sort().join('|');

function solve(pool: DfsPlayer[], opts: OptimizeOptions): Lineup | null {
  const skipInjured = opts.skipInjured ?? true;
  const locked = opts.locked ?? new Set<string>();
  const keep = (p: DfsPlayer) =>
    locked.has(p.id) || (!opts.excluded?.has(p.id) && !(skipInjured && OUT_TAGS.has(p.injury.toUpperCase())) && p.projection > 0);
  const byPos: Record<string, DfsPlayer[]> = { QB: [], RB: [], WR: [], TE: [], DEF: [] };
  for (const p of pool) if (byPos[p.pos] && keep(p)) byPos[p.pos].push(p);

  // Trim each position to the strongest candidates (by points and by points per dollar), keeping locks.
  const n = opts.poolPerPosition ?? 40;
  for (const pos of Object.keys(byPos)) {
    const list = byPos[pos];
    const top = new Set([
      ...[...list].sort((a, b) => b.projection - a.projection).slice(0, n),
      ...[...list].sort((a, b) => b.projection / b.salary - a.projection / a.salary).slice(0, n),
      ...list.filter((p) => locked.has(p.id)),
    ]);
    byPos[pos] = [...top];
  }

  const cap = Math.floor(FANDUEL.salaryCap / SALARY_UNIT);
  let best: Lineup | null = null;
  for (const flex of FLEX_POS) {
    const counts = { ...BASE_COUNTS, [flex]: BASE_COUNTS[flex] + 1 };
    const tables: PositionTable[] = [];
    let feasible = true;
    for (const pos of Object.keys(counts)) {
      const t = positionTable(byPos[pos], counts[pos], cap, locked);
      if (!t) {
        feasible = false;
        break;
      }
      tables.push(t);
    }
    if (!feasible) continue;
    const lineup = combine(tables, cap, flex);
    if (lineup && (!best || lineup.projection > best.projection)) best = lineup;
  }
  return best;
}

interface PositionTable {
  pos: string;
  /** best[s] = max points using exactly `need` players costing exactly s units (-Infinity if none). */
  best: Float64Array;
  pick: (s: number) => DfsPlayer[];
}

function positionTable(players: DfsPlayer[], need: number, cap: number, locked: Set<string>): PositionTable | null {
  const forced = players.filter((p) => locked.has(p.id));
  if (forced.length > need) return null;
  const free = players.filter((p) => !locked.has(p.id));
  const k = need - forced.length;
  const forcedCost = forced.reduce((s, p) => s + Math.round(p.salary / SALARY_UNIT), 0);
  const forcedPts = forced.reduce((s, p) => s + p.projection, 0);
  if (free.length < k || forcedCost > cap) return null;

  // dp[j][s]: best points choosing j free players with cost exactly s; take[i][j][s] for backtracking.
  const width = cap + 1;
  let dp: Float64Array[] = Array.from({ length: k + 1 }, () => new Float64Array(width).fill(-Infinity));
  dp[0][0] = 0;
  const take: Uint8Array[][] = [];
  free.forEach((p, i) => {
    const cost = Math.round(p.salary / SALARY_UNIT);
    const next = dp.map((row) => row.slice());
    const t = Array.from({ length: k + 1 }, () => new Uint8Array(width));
    for (let j = 1; j <= k; j++) {
      for (let s = cost; s < width; s++) {
        const v = dp[j - 1][s - cost] + p.projection;
        if (v > next[j][s]) {
          next[j][s] = v;
          t[j][s] = 1;
        }
      }
    }
    take[i] = t;
    dp = next;
  });

  const best = new Float64Array(width).fill(-Infinity);
  for (let s = 0; s + forcedCost < width; s++) {
    if (dp[k][s] > -Infinity) best[s + forcedCost] = dp[k][s] + forcedPts;
  }
  const pick = (total: number): DfsPlayer[] => {
    const chosen: DfsPlayer[] = [...forced];
    let j = k;
    let s = total - forcedCost;
    for (let i = free.length - 1; i >= 0 && j > 0; i--) {
      if (take[i][j][s]) {
        chosen.push(free[i]);
        s -= Math.round(free[i].salary / SALARY_UNIT);
        j--;
      }
    }
    return chosen;
  };
  return { pos: players[0]?.pos ?? '', best, pick };
}

function combine(tables: PositionTable[], cap: number, flex: string): Lineup | null {
  const width = cap + 1;
  // acc[s]: best total for the positions so far at exact cost s; split[t][s]: cost given to table t.
  let acc = new Float64Array(width).fill(-Infinity);
  acc[0] = 0;
  const split: Int32Array[] = [];
  for (const t of tables) {
    const next = new Float64Array(width).fill(-Infinity);
    const sp = new Int32Array(width).fill(-1);
    for (let a = 0; a < width; a++) {
      if (acc[a] === -Infinity) continue;
      for (let b = 0; a + b < width; b++) {
        if (t.best[b] === -Infinity) continue;
        const v = acc[a] + t.best[b];
        if (v > next[a + b]) {
          next[a + b] = v;
          sp[a + b] = b;
        }
      }
    }
    split.push(sp);
    acc = next;
  }
  let bestS = -1;
  for (let s = 0; s < width; s++) if (acc[s] > -Infinity && (bestS < 0 || acc[s] > acc[bestS])) bestS = s;
  if (bestS < 0) return null;

  const chosen: DfsPlayer[][] = [];
  let s = bestS;
  for (let i = tables.length - 1; i >= 0; i--) {
    const b = split[i][s];
    chosen[i] = tables[i].pick(b);
    s -= b;
  }
  return toLineup(chosen.flat(), flex);
}

/** Assigns players to FanDuel's slots (the extra RB/WR/TE goes to FLEX). */
function toLineup(players: DfsPlayer[], flex: string): Lineup {
  const byPos = new Map<string, DfsPlayer[]>();
  for (const p of [...players].sort((a, b) => b.projection - a.projection)) byPos.set(p.pos, [...(byPos.get(p.pos) ?? []), p]);
  const slotted: LineupPlayer[] = [];
  for (const slot of FANDUEL.slots) {
    const pos = slot === 'FLEX' ? flex : slot;
    const p = byPos.get(pos)?.shift();
    if (p) slotted.push({ ...p, slot });
  }
  return {
    players: slotted,
    salary: slotted.reduce((s, p) => s + p.salary, 0),
    projection: Math.round(slotted.reduce((s, p) => s + p.projection, 0) * 10) / 10,
  };
}

/** CSV for FanDuel's "Upload lineups": one row per lineup, player ids in slot order. */
export function lineupsCsv(lineups: Lineup[]): string {
  const header = FANDUEL.slots.join(',');
  return [header, ...lineups.map((l) => FANDUEL.slots.map((_, i) => l.players[i]?.id ?? '').join(','))].join('\n') + '\n';
}
