import { useMemo, useState } from 'react';
import { POSITIONS, type Snapshot } from '@shared/types.ts';
import { api } from '../api';
import { dfsRankings } from '@shared/dfs.ts';
import type { Update } from '../App';
import { Chips, PageHead, POS_FILTER, PosBadge, Section, Table } from '../ui';
import { ValueBar } from './Overview';

export function TeamValuesPage({ snap }: { snap: Snapshot }) {
  return (
    <>
      <PageHead title="📊 Power Rankings" sub="Total FantasyPros value by team and position, using each league's own rankings. Your team is highlighted." />
      {snap.teamValues.map((tv) => {
        const max = Math.max(...tv.rows.map((r) => r.total), 1);
        return (
          <Section key={tv.configId} title={tv.league} aside={<span className="muted small">{tv.rankingLabel}</span>}>
            <Table
              rows={tv.rows}
              rowKey={(r) => r.teamId}
              highlight={(r) => r.mine}
              columns={[
                { key: 'rank', label: 'Rank', align: 'right' },
                { key: 'team', label: 'Team' },
                { key: 'record', label: 'Record' },
                {
                  key: 'total',
                  label: 'Total Value',
                  render: (r) => (
                    <span className="valuebar wide">
                      <span className="valuebar-fill" style={{ width: `${(r.total / max) * 100}%` }} />
                      <span className="valuebar-num">{r.total.toLocaleString()}</span>
                    </span>
                  ),
                },
                ...POSITIONS.map((pos) => ({
                  key: pos,
                  label: pos,
                  align: 'right' as const,
                  sort: (r: (typeof tv.rows)[number]) => r.byPos[pos],
                  render: (r: (typeof tv.rows)[number]) => r.byPos[pos].toLocaleString(),
                })),
                { key: 'top100', label: 'Top-100', align: 'right' },
                { key: 'avgAge', label: 'Avg age', align: 'right' },
              ]}
            />
          </Section>
        );
      })}
    </>
  );
}

export function TradeFinderPage({ snap }: { snap: Snapshot }) {
  const list = (xs: { name: string; rank: number }[]) => xs.map((x) => `${x.name} (#${x.rank})`).join(', ');
  return (
    <>
      <PageHead
        title="🤝 Trade Finder"
        sub="Teams whose positional surplus lines up with your need, and vice versa. A starting point for offers, not a verdict."
      />
      {snap.tradeFinder.map((tf) => (
        <Section
          key={tf.configId}
          title={tf.league}
          aside={
            tf.myStrength && (
              <span className="muted">
                You're strongest at <PosBadge pos={tf.myStrength} />, thinnest at <PosBadge pos={tf.myNeed!} />
              </span>
            )
          }
        >
          <Table
            rows={tf.rows}
            rowKey={(r) => r.team}
            empty={tf.myStrength ? 'No complementary partners found.' : 'Pick your team in Settings first.'}
            columns={[
              { key: 'fit', label: 'Fit', render: (r) => (r.fit === 'Strong' ? '🔥 Strong' : '👍 Partial') },
              { key: 'team', label: 'Team' },
              { key: 'theirSurplus', label: 'Their surplus', render: (r) => <PosBadge pos={r.theirSurplus} /> },
              { key: 'theirNeed', label: 'Their need', render: (r) => <PosBadge pos={r.theirNeed} /> },
              { key: 'targets', label: `Targets${tf.myNeed ? ` at ${tf.myNeed}` : ''}`, wrap: true, render: (r) => list(r.targets), sort: (r) => r.targets[0]?.rank },
              { key: 'offers', label: 'You could offer', wrap: true, render: (r) => list(r.offers), sort: (r) => r.offers[0]?.rank },
            ]}
          />
        </Section>
      ))}
    </>
  );
}

export function DraftPicksPage({ snap }: { snap: Snapshot }) {
  return (
    <>
      <PageHead title="🎯 Future Draft Picks" sub="Picks you own, and your own picks that other teams now hold." />
      <div className="grid-3">
        {snap.picks.map((p) => (
          <Section key={p.configId} title={p.league}>
            {p.format === 'redraft' ? (
              <p className="empty">Redraft league: rosters reset every year, so there are no future picks to track.</p>
            ) : !p.supported ? (
              <p className="empty">ESPN does not expose future rookie picks. Track these manually if needed.</p>
            ) : (
              <Table
                rows={p.picks}
                rowKey={(r, i) => `${r.season}-${r.round}-${i}`}
                empty="Pick your team in Settings first."
                columns={[
                  { key: 'season', label: 'Season', render: (r) => r.season },
                  { key: 'round', label: 'Round', align: 'right' },
                  {
                    key: 'source',
                    label: 'Source',
                    render: (r) => <span className={r.source.startsWith('Owned by') ? 'neg' : r.source.startsWith('via') ? 'pos-num' : undefined}>{r.source}</span>,
                  },
                ]}
              />
            )}
          </Section>
        ))}
      </div>
    </>
  );
}

export function AlertsPage({ snap, update }: { snap: Snapshot; update: Update }) {
  return (
    <>
      <PageHead
        title="🔔 Drop Alerts"
        sub="Top-ranked and watchlist players released since the previous refresh. Checked automatically on the auto-refresh interval set in Settings."
      />
      <Section
        title={`${snap.alerts.length} alerts`}
        aside={
          snap.alerts.length > 0 && (
            <button className="link" onClick={async () => confirm('Clear all alerts?') && update(await api.clearAlerts())}>
              Clear all
            </button>
          )
        }
      >
        <Table
          rows={snap.alerts}
          rowKey={(r, i) => `${r.when}-${i}`}
          empty="No drops yet."
          columns={[
            { key: 'when', label: 'When', render: (r) => new Date(r.when).toLocaleString() },
            { key: 'league', label: 'League' },
            { key: 'player', label: 'Player' },
            { key: 'pos', label: 'Pos', render: (r) => (r.pos ? <PosBadge pos={r.pos} /> : null) },
            { key: 'rank', label: 'Rank', align: 'right' },
            { key: 'droppedBy', label: 'Dropped by' },
            { key: 'watchlist', label: 'Watchlist', align: 'center', render: (r) => (r.watchlist ? '👀' : '') },
          ]}
        />
      </Section>
    </>
  );
}

type FpView = { kind: 'set'; key: string } | { kind: 'projections' } | { kind: 'dfs' } | { kind: 'news' };

export function RankingsPage({ snap }: { snap: Snapshot }) {
  const sets = snap.rankingSets ?? [];
  const setKey = (r: { type: string; scoring: string }) => `${r.type}:${r.scoring}`;
  const [view, setView] = useState<FpView>(sets[0] ? { kind: 'set', key: setKey(sets[0]) } : { kind: 'projections' });
  const [pos, setPos] = useState<string>('ALL');
  const [q, setQ] = useState('');
  const [mineOnly, setMineOnly] = useState(false);
  const match = (name: string, p: string) => (pos === 'ALL' || p === pos) && (!q || name.toLowerCase().includes(q.toLowerCase()));

  const tabs = [
    ...sets.map((r) => ({ value: `set:${setKey(r)}`, label: r.label })),
    { value: 'projections', label: `Projections${snap.projections ? ` (wk ${snap.projections.week})` : ''}` },
    { value: 'dfs', label: 'DFS (FanDuel)' },
    { value: 'news', label: 'News' },
  ];
  const current = view.kind === 'set' ? `set:${view.key}` : view.kind;
  const onTab = (v: string) => setView(v.startsWith('set:') ? { kind: 'set', key: v.slice(4) } : ({ kind: v } as FpView));
  const set = view.kind === 'set' ? sets.find((r) => setKey(r) === view.key) : undefined;
  const news = snap.news ?? [];
  const shownNews = news.filter((n) => !mineOnly || n.mine);

  return (
    <>
      <PageHead
        title="🏆 FantasyPros"
        sub={
          <>
            Consensus rankings, weekly projections and news. Each league uses the rankings for its format (Settings → Leagues).
            {snap.nflState && ` NFL ${snap.nflState.season}, week ${snap.nflState.week}${snap.nflState.seasonType === 'pre' ? ' (preseason)' : ''}.`}
          </>
        }
      />
      <Chips options={tabs} value={current} onChange={onTab} />
      {view.kind !== 'news' && (
        <div className="filters">
          <Chips
            options={[...POS_FILTER, ...(view.kind === 'dfs' || view.kind === 'projections' ? [{ value: 'DEF', label: 'DEF' }] : [])]}
            value={pos}
            onChange={setPos}
          />
          <input className="search" placeholder="Search players…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      )}

      {view.kind === 'set' && (
        <Section
          title={set ? `${set.label} · ${set.players.filter((p) => match(p.name, p.pos)).length} players` : 'Not loaded'}
          aside={set && <span className="muted small">{set.source} · updated {new Date(set.at).toLocaleString()}</span>}
        >
          <Table
            rows={(set?.players ?? []).filter((p) => match(p.name, p.pos))}
            rowKey={(r) => r.key}
            empty="No rankings loaded for this set. Add a FantasyPros API key or import a CSV in Settings."
            columns={[
              { key: 'rank', label: 'RK', align: 'right' },
              { key: 'tier', label: 'Tier', align: 'right' },
              { key: 'name', label: 'Player' },
              { key: 'nfl', label: 'Team' },
              { key: 'pos', label: 'Pos', render: (r) => <PosBadge pos={r.pos} /> },
              { key: 'age', label: 'Age', align: 'right' },
              { key: 'best', label: 'Best', align: 'right' },
              { key: 'worst', label: 'Worst', align: 'right' },
              { key: 'avg', label: 'Avg', align: 'right' },
              { key: 'value', label: 'Value', render: (r) => <ValueBar value={r.value} /> },
            ]}
          />
        </Section>
      )}

      {view.kind === 'projections' && (
        <Section
          title={snap.projections ? `Week ${snap.projections.week} projections · half PPR` : 'Projections'}
          aside={snap.projections && <span className="muted small">updated {new Date(snap.projections.at).toLocaleString()}</span>}
        >
          <Table
            rows={(snap.projections?.players ?? []).filter((p) => match(p.name, p.pos === 'DST' ? 'DEF' : p.pos))}
            rowKey={(r) => `${r.key}-${r.pos}`}
            empty="Weekly projections need a FantasyPros API key (Settings)."
            columns={[
              { key: 'name', label: 'Player' },
              { key: 'pos', label: 'Pos', render: (r) => <PosBadge pos={r.pos} /> },
              { key: 'team', label: 'Team' },
              { key: 'points', label: 'Proj pts', align: 'right', render: (r) => r.points.toFixed(1) },
            ]}
            initialSort={{ key: 'points', dir: -1 }}
          />
        </Section>
      )}

      {view.kind === 'dfs' && <DfsRankings snap={snap} pos={pos} q={q} />}

      {view.kind === 'news' && (
        <Section
          title="Player news"
          aside={
            <label className="toggle">
              <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} /> My players only
            </label>
          }
        >
          {shownNews.length === 0 ? (
            <p className="empty">{news.length ? 'No news about your players right now.' : 'News needs a FantasyPros API key (Settings).'}</p>
          ) : (
            <ul className="news">
              {shownNews.map((n, i) => (
                <li key={i} className={n.mine ? 'mine' : undefined}>
                  <div className="news-head">
                    <strong>
                      {n.url ? (
                        <a href={n.url} target="_blank" rel="noreferrer">
                          {n.title}
                        </a>
                      ) : (
                        n.title
                      )}
                    </strong>
                    {n.mine && <span className="tag-fa">YOUR PLAYER</span>}
                  </div>
                  <div className="muted small">{[n.player, n.team, n.time && new Date(n.time).toLocaleString()].filter(Boolean).join(' · ')}</div>
                  {n.description && <p className="small">{n.description}</p>}
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}
    </>
  );
}

function DfsRankings({ snap, pos, q }: { snap: Snapshot; pos: string; q: string }) {
  const weekly = (snap.rankingSets ?? []).find((r) => r.type === 'weekly');
  const rows = useMemo(() => (snap.dfs ? dfsRankings(snap.dfs.players, weekly?.players ?? []) : []), [snap.dfs, weekly]);
  if (!snap.dfs) {
    return (
      <Section title="DFS rankings">
        <p className="empty">
          DFS rankings need FanDuel salaries: load a FanDuel players list on the <a href="#dfs">FanDuel DFS</a> page first. Until then, the
          Projections tab has this week's FantasyPros projections.
        </p>
      </Section>
    );
  }
  const shown = rows
    .filter((r) => (pos === 'ALL' || r.pos === pos) && (!q || r.name.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => (pos === 'ALL' ? b.projection - a.projection : a.posRank - b.posRank));
  return (
    <Section
      title={`DFS rankings · FanDuel slate (${snap.dfs.games.length} games)`}
      aside={<a href="#dfs">Build lineups →</a>}
    >
      <p className="muted small">
        {snap.dfs.projectionNote} 💎 = value play (top-quarter points per $1k at the position with at least a median projection).
        {!weekly && ' Turn on Weekly rankings in Settings → FantasyPros to see FantasyPros weekly ranks here.'}
      </p>
      <Table
        rows={shown}
        rowKey={(r) => r.id}
        columns={[
          { key: 'posRank', label: 'Pos rk', align: 'right', render: (r) => `${r.pos}${r.posRank}`, sort: (r) => r.posRank },
          { key: 'name', label: 'Player', render: (r) => <>{r.name}{r.valuePlay && ' 💎'}</> },
          { key: 'pos', label: 'Pos', render: (r) => <PosBadge pos={r.pos} /> },
          { key: 'team', label: 'Team' },
          { key: 'opp', label: 'Opp' },
          { key: 'salary', label: 'Salary', align: 'right', render: (r) => `$${r.salary.toLocaleString()}` },
          { key: 'projection', label: 'Proj', align: 'right', render: (r) => `${r.projection.toFixed(1)}${r.projectionSource === 'FanDuel FPPG' ? '*' : ''}` },
          { key: 'valuePer1k', label: 'Pts/$1k', align: 'right', render: (r) => r.valuePer1k.toFixed(2) },
          { key: 'valueRank', label: 'Value rk', align: 'right' },
          { key: 'fpRank', label: 'FP weekly rk', align: 'right' },
          { key: 'fpTier', label: 'Tier', align: 'right' },
          { key: 'injury', label: 'Status', render: (r) => (r.injury ? <span className="warn">{r.injury}</span> : '') },
        ]}
      />
      <p className="muted small">* FanDuel season average (no FantasyPros projection matched).</p>
    </Section>
  );
}
