// Which FantasyPros rankings value a league's players, based on its format.

import { RANKING_LABELS, type LeagueConfig, type LeagueFormat, type NflState, type RankingType, type Scoring, type Settings } from './types.ts';

export interface RankingChoice {
  type: RankingType;
  scoring: Scoring;
}

/** Before week 1 (or in the offseason) season-long leagues use draft rankings, then rest-of-season. */
export function isPreseason(state: NflState | null): boolean {
  return !!state && (state.seasonType === 'pre' || state.seasonType === 'off');
}

export function rankingFor(cfg: Pick<LeagueConfig, 'format' | 'rankings' | 'scoring'>, settings: Settings, state: NflState | null): RankingChoice {
  const format: LeagueFormat = cfg.format ?? 'dynasty';
  const scoring = (cfg.scoring && cfg.scoring !== 'default' ? cfg.scoring : settings.fpScoring) as Scoring;
  if (cfg.rankings && cfg.rankings !== 'auto') return { type: cfg.rankings, scoring };
  if (format === 'dynasty') return { type: 'dynasty', scoring };
  return { type: isPreseason(state) ? 'draft' : 'ros', scoring };
}

export const rankingKey = (c: RankingChoice) => `${c.type}:${c.scoring}`;
export const rankingLabel = (c: RankingChoice) => `${RANKING_LABELS[c.type]} · ${c.scoring === 'HALF' ? 'Half PPR' : c.scoring}`;

export const FORMAT_LABELS: Record<LeagueFormat, string> = { redraft: 'Redraft', keeper: 'Keeper', dynasty: 'Dynasty' };
