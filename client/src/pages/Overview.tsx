import { useMemo, useState } from 'react';
import type { EnrichedPlayer, FreeAgentRow, Snapshot } from '@shared/types.ts';
import { api } from '../api';
import type { Update } from '../App';
import { Chips, fmt, money, PageHead, PlatformBadge, POS_FILTER, PosBadge, Section, Table, type Column } from '../ui';

type Pos = (typeof POS_FILTER)[number]['value'];

async function toggleWatch(snap: Snapshot, name: string, update: Update) {
  const names = snap.watchlist.map((w) => w.name);
  const has = names.some((n) => n.toLowerCase() === name.toLowerCase());
  update(await api.saveWatchlist(has ? names.filter((n) => n.toLowerCase() !== name.toLowerCase()) : [...names, name]));
}

export function DashboardPage({ snap }: { snap: Snapshot }) {
  const cap = snap.mflCap[0];
  const topAvailable = snap.leagues.flatMap((l) => snap.freeAgents.filter((f) => f.configId === l.configId).slice(0, 3));
  return (
    <>
      <PageHead title="🏈 Dynasty Command Center" sub={snap.sources.map((s) => `${s.ok ? '✅' : '❌'} ${s.source}: ${s.message}`).join('   ·   ')} />
      <div className="kpis">
        {snap.leagues.map((l) => (
          <div className="kpi" key={l.configId}>
            <div className="kpi-top">
              <PlatformBadge platform={l.platform} />
              <span className="muted small">{l.record ?? ''}</span>
            </div>
            <div className="kpi-name">{l.name}</div>
            <div className="kpi-value">
              {l.valueRank ? (
                <>
                  #{l.valueRank}
                  <span className="muted small"> of {l.teamCount} in dynasty value</span>
                </>
              ) : (
                <span className="small">{l.status}</span>
              )}
            </div>
            <div className="muted small">
              {l.myTeam ?? '–'} · {l.top100} top-100 · avg age {l.avgAge ?? '–'}
            </div>
          </div>
        ))}
      </div>

      <Section title="Leagues">
        <Table
          rows={snap.leagues}
          rowKey={(r) => r.configId}
          columns={[
            { key: 'platform', label: 'League', render: (r) => <PlatformBadge platform={r.platform} /> },
            { key: 'name', label: 'Name' },
            { key: 'myTeam', label: 'My team' },
            { key: 'record', label: 'Record' },
            { key: 'valueRank', label: 'Value rank', render: (r) => (r.valueRank ? `${r.valueRank} of ${r.teamCount}` : '–'), align: 'right' },
            { key: 'status', label: 'Status' },
          ]}
        />
      </Section>

      <div className="grid-2">
        <Section title="Top available right now" aside={<a href="#free-agents">All free agents →</a>}>
          <Table
            rows={topAvailable}
            rowKey={(r) => `${r.configId}-${r.name}`}
            columns={[
              { key: 'league', label: 'League' },
              { key: 'rank', label: 'FP Rank', align: 'right' },
              { key: 'name', label: 'Player' },
              { key: 'pos', label: 'Pos', render: (r) => <PosBadge pos={r.pos} /> },
              { key: 'nfl', label: 'NFL' },
              { key: 'age', label: 'Age', align: 'right' },
            ]}
          />
        </Section>
        <div>
          {cap && (
            <Section title={`MFL cap snapshot · ${cap.league}`} aside={<a href="#mfl-cap">Details →</a>}>
              <Table
                rows={cap.years.slice(0, 2)}
                rowKey={(r) => String(r.season)}
                columns={[
                  { key: 'season', label: 'Season', render: (r) => r.season },
                  { key: 'committed', label: 'Committed', render: (r) => money(r.committed), align: 'right' },
                  { key: 'remaining', label: 'Cap room', render: (r) => <span className={r.remaining < 0 ? 'neg' : 'pos-num'}>{money(r.remaining)}</span>, align: 'right' },
                  { key: 'yearsRemaining', label: 'Contract yrs left', align: 'right' },
                ]}
              />
            </Section>
          )}
          <Section title="Recent drop alerts" aside={<a href="#alerts">All alerts →</a>}>
            <Table
              rows={snap.alerts.slice(0, 8)}
              rowKey={(r, i) => `${r.when}-${i}`}
              empty="None yet. Alerts appear when a top-ranked or watchlist player is dropped between refreshes."
              columns={[
                { key: 'when', label: 'When', render: (r) => new Date(r.when).toLocaleString() },
                { key: 'league', label: 'League' },
                { key: 'player', label: 'Player' },
                { key: 'rank', label: 'Rank', align: 'right' },
                { key: 'droppedBy', label: 'Dropped by' },
              ]}
            />
          </Section>
        </div>
      </div>
    </>
  );
}

export function RostersPage({ snap }: { snap: Snapshot }) {
  const [pos, setPos] = useState<Pos>('ALL');
  return (
    <>
      <PageHead title="📋 My Rosters — All Leagues" sub="Sorted by dynasty value. Rank and tier come from FantasyPros." />
      <Chips options={[...POS_FILTER]} value={pos} onChange={setPos} />
      {snap.rosters.length === 0 && <p className="empty">No rosters yet. Pick your team for each league in Settings.</p>}
      {snap.rosters.map((g) => {
        const cols: Column<EnrichedPlayer>[] = [
          { key: 'name', label: 'Player' },
          { key: 'pos', label: 'Pos', render: (r) => <PosBadge pos={r.pos} /> },
          { key: 'nfl', label: 'NFL' },
          { key: 'age', label: 'Age', align: 'right' },
          { key: 'yearsExp', label: 'Yrs exp', align: 'right' },
          { key: 'rank', label: 'FP Rank', align: 'right' },
          { key: 'tier', label: 'Tier', align: 'right' },
          { key: 'value', label: 'Dyn Value', align: 'right', render: (r) => <ValueBar value={r.value} /> },
          { key: 'slot', label: 'Status' },
        ];
        if (g.hasContracts) {
          cols.push(
            { key: 'salary', label: 'Salary', align: 'right', render: (r) => money(r.salary) },
            { key: 'contractYears', label: 'Contract Yrs', align: 'right' },
            { key: 'ytdPoints', label: 'Pts YTD', align: 'right', render: (r) => (r.ytdPoints === undefined ? fmt(null) : r.ytdPoints.toFixed(1)) },
            { key: 'injury', label: 'Injury', render: (r) => (r.injury ? <span className="warn">{r.injury}</span> : '') },
          );
        }
        const rows = g.players.filter((p) => pos === 'ALL' || p.pos === pos);
        const total = rows.reduce((s, p) => s + p.value, 0);
        return (
          <Section
            key={g.configId}
            title={
              <>
                <PlatformBadge platform={g.platform} /> {g.league} — {g.team}
              </>
            }
            aside={<span className="muted">Total value {total.toLocaleString()}</span>}
          >
            <Table rows={rows} columns={cols} rowKey={(r) => r.key} />
          </Section>
        );
      })}
    </>
  );
}

export function ValueBar({ value }: { value: number }) {
  return (
    <span className="valuebar">
      <span className="valuebar-fill" style={{ width: `${Math.min(100, value / 100)}%` }} />
      <span className="valuebar-num">{value ? value.toLocaleString() : '–'}</span>
    </span>
  );
}

export function FreeAgentsPage({ snap, update }: { snap: Snapshot; update: Update }) {
  const [league, setLeague] = useState('ALL');
  const [pos, setPos] = useState<Pos>('ALL');
  const rows = snap.freeAgents.filter((f) => (league === 'ALL' || f.configId === league) && (pos === 'ALL' || f.pos === pos));
  const cols: Column<FreeAgentRow>[] = [
    { key: 'league', label: 'League' },
    { key: 'rank', label: 'FP Rank', align: 'right' },
    { key: 'tier', label: 'Tier', align: 'right' },
    { key: 'name', label: 'Player' },
    { key: 'pos', label: 'Pos', render: (r) => <PosBadge pos={r.pos} /> },
    { key: 'nfl', label: 'NFL' },
    { key: 'age', label: 'Age', align: 'right' },
    { key: 'yearsExp', label: 'Yrs exp', align: 'right' },
    {
      key: 'watched',
      label: 'Watch',
      align: 'center',
      render: (r) => (
        <button className={r.watched ? 'star on' : 'star'} title="Toggle watchlist" onClick={() => toggleWatch(snap, r.name, update)}>
          {r.watched ? '★' : '☆'}
        </button>
      ),
    },
  ];
  return (
    <>
      <PageHead title="🆓 Best Available — Dynasty Value" sub="Top-ranked players not on any roster in each league. Star a player to add them to your watchlist." />
      <div className="filters">
        <Chips
          options={[{ value: 'ALL', label: 'All leagues' }, ...snap.leagues.map((l) => ({ value: l.configId, label: l.name }))]}
          value={league}
          onChange={setLeague}
        />
        <Chips options={[...POS_FILTER]} value={pos} onChange={setPos} />
      </div>
      <Section title={`${rows.length} players`}>
        <Table rows={rows} columns={cols} rowKey={(r) => `${r.configId}-${r.name}`} />
      </Section>
    </>
  );
}

export function WatchlistPage({ snap, update }: { snap: Snapshot; update: Update }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const suggestions = useMemo(() => snap.rankings.slice(0, 600).map((p) => p.name), [snap.rankings]);
  const leagues = snap.leagues.filter((l) => l.valueRank !== null || l.teamCount > 0);

  const add = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      update(await api.saveWatchlist([...snap.watchlist.map((w) => w.name), name.trim()]));
      setName('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHead title="👀 Watchlist" sub="Players you want to track. You'll be alerted if any of them is dropped in any league, whatever their rank." />
      <Section title="Add a player">
        <div className="row">
          <input
            list="players"
            value={name}
            placeholder="Start typing a name…"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
          />
          <datalist id="players">
            {suggestions.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          <button className="primary" onClick={add} disabled={busy}>
            Add
          </button>
        </div>
      </Section>
      <Section title={`${snap.watchlist.length} watched`}>
        <Table
          rows={snap.watchlist}
          rowKey={(r) => r.name}
          empty="Your watchlist is empty."
          columns={[
            { key: 'name', label: 'Player' },
            { key: 'pos', label: 'Pos', render: (r) => (r.pos ? <PosBadge pos={r.pos} /> : fmt(null)) },
            { key: 'rank', label: 'Rank', align: 'right' },
            ...leagues.map((l) => ({
              key: l.configId,
              label: l.name,
              sort: (r: (typeof snap.watchlist)[number]) => r.status[l.configId],
              render: (r: (typeof snap.watchlist)[number]) => {
                const s = r.status[l.configId];
                return s === 'FA' ? <span className="tag-fa">FREE AGENT</span> : fmt(s);
              },
            })),
            {
              key: 'remove',
              label: '',
              render: (r) => (
                <button className="link" onClick={() => toggleWatch(snap, r.name, update)}>
                  Remove
                </button>
              ),
            },
          ]}
        />
      </Section>
    </>
  );
}
