import { useState } from 'react';
import type { MflLeagueView, Snapshot } from '@shared/types.ts';
import { Chips, fmt, money, PageHead, PosBadge, Section, Table } from '../ui';

const date = (iso?: string) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '');
const dateTime = (iso?: string) =>
  iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';

export function MflLeaguePage({ snap }: { snap: Snapshot }) {
  const views = snap.mflLeague ?? [];
  const [id, setId] = useState(views[0]?.configId);
  const v = views.find((x) => x.configId === id) ?? views[0];
  if (!v) {
    return (
      <p className="empty">
        No MFL league data yet. Add your MFL league in Settings and hit <strong>Refresh all</strong>.
      </p>
    );
  }
  return (
    <>
      <PageHead
        title="🏟️ MFL League"
        sub={`${v.league}${v.currentWeek ? ` · Week ${v.currentWeek}` : ''}${v.myTeam ? ` · ${v.myTeam}` : ''}`}
      />
      {views.length > 1 && <Chips options={views.map((x) => ({ value: x.configId, label: x.league }))} value={v.configId} onChange={setId} />}
      {v.unavailable.length > 0 && (
        <div className="banner note">
          Some MFL sections couldn't load:
          <ul>
            {v.unavailable.map((u) => (
              <li key={u}>{u}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid-2">
        <Matchup v={v} />
        <Section title="Standings">
          <Table
            rows={v.standings}
            rowKey={(r) => r.team}
            highlight={(r) => r.mine}
            empty="No standings yet."
            columns={[
              { key: 'rank', label: '#', align: 'right' },
              { key: 'team', label: 'Team' },
              ...(v.settings.divisions.length > 1 ? [{ key: 'division', label: 'Div' }] : []),
              { key: 'record', label: 'W-L', sort: (r) => r.rank },
              { key: 'pf', label: 'PF', align: 'right', render: (r) => r.pf.toFixed(1) },
              { key: 'pa', label: 'PA', align: 'right', render: (r) => r.pa.toFixed(1) },
            ]}
          />
        </Section>
      </div>

      <Transactions v={v} />

      <div className="grid-2">
        <Section title="Trade bait" aside={<a href="#trade-finder">Trade Finder →</a>}>
          {v.tradeBait === null ? (
            <p className="empty">Not available (see the note at the top).</p>
          ) : (
            <Table
              rows={v.tradeBait.filter((b) => b.offering.length || b.wants)}
              rowKey={(r) => r.team}
              highlight={(r) => r.mine}
              empty="Nobody has listed trade bait."
              columns={[
                { key: 'team', label: 'Team' },
                { key: 'offering', label: 'Shopping', wrap: true, render: (r) => r.offering.join(', ') || '–' },
                { key: 'wants', label: 'Looking for', wrap: true, render: (r) => r.wants || '–' },
              ]}
            />
          )}
        </Section>
        <Section title="Pending trades (yours)">
          {v.pendingTrades === null ? (
            <p className="empty">Sign in to MFL in Settings so MFL knows it's you.</p>
          ) : (
            <Table
              rows={v.pendingTrades}
              rowKey={(r, i) => `${r.from}-${r.to}-${i}`}
              empty="No pending offers."
              columns={[
                { key: 'from', label: 'From' },
                { key: 'to', label: 'To' },
                { key: 'gives', label: 'Gives', wrap: true, render: (r) => r.gives.join(', ') },
                { key: 'gets', label: 'Gets', wrap: true, render: (r) => r.gets.join(', ') },
                { key: 'expires', label: 'Expires', render: (r) => dateTime(r.expires) || '–' },
              ]}
            />
          )}
        </Section>
      </div>

      <div className="grid-2">
        <Section title="Trending across MFL: most added" aside={<span className="muted small">Available = free agent in your league</span>}>
          <TrendTable rows={v.trending.adds} />
        </Section>
        <Section title="Trending across MFL: most dropped">
          <TrendTable rows={v.trending.drops} showOwner />
        </Section>
      </div>

      <div className="grid-2">
        <Section title="Salary adjustments" aside={<a href="#mfl-cap">MFL Cap →</a>}>
          {v.salaryAdjustments === null ? (
            <p className="empty">Not available (see the note at the top).</p>
          ) : (
            <Table
              rows={v.salaryAdjustments}
              rowKey={(r, i) => `${r.team}-${i}`}
              highlight={(r) => r.mine}
              empty="No salary adjustments this season."
              columns={[
                { key: 'team', label: 'Team' },
                { key: 'amount', label: 'Amount', align: 'right', render: (r) => money(r.amount) },
                { key: 'description', label: 'Reason', wrap: true },
                { key: 'when', label: 'Date', render: (r) => date(r.when) || '–' },
              ]}
            />
          )}
        </Section>
        <Section title="League calendar">
          {v.calendar === null ? (
            <p className="empty">Sign in to MFL in Settings to see this.</p>
          ) : (
            <Table
              rows={v.calendar.filter((e) => !e.end || Date.parse(e.end) >= Date.now() - 86400000)}
              rowKey={(r, i) => `${r.title}-${i}`}
              empty="No upcoming events."
              columns={[
                { key: 'start', label: 'When', render: (r) => dateTime(r.start) || '–', sort: (r) => r.start },
                { key: 'title', label: 'Event', wrap: true },
              ]}
              initialSort={{ key: 'start', dir: 1 }}
            />
          )}
        </Section>
      </div>

      <Settings v={v} />
    </>
  );
}

function Matchup({ v }: { v: MflLeagueView }) {
  const m = v.matchup;
  return (
    <Section title={m ? `Week ${m.week} matchup` : 'This week'} aside={v.projectionWeek ? <span className="muted small">Projections: week {v.projectionWeek}</span> : undefined}>
      {m ? (
        <div className="matchup">
          <div>
            <span className="muted small">{v.myTeam}</span>
            <strong>{m.myScore !== undefined ? m.myScore.toFixed(1) : '–'}</strong>
          </div>
          <span className="muted">vs</span>
          <div>
            <span className="muted small">{m.opponent}</span>
            <strong>{m.oppScore !== undefined ? m.oppScore.toFixed(1) : '–'}</strong>
          </div>
          {m.result && <span className={m.result === 'W' ? 'pos-num' : m.result === 'L' ? 'neg' : undefined}>{m.result}</span>}
        </div>
      ) : (
        <p className="empty">{v.myTeam ? 'No matchup this week.' : 'Pick your MFL team in Settings.'}</p>
      )}
      <Table
        rows={v.projections.filter((p) => p.slot !== 'Taxi')}
        rowKey={(r) => r.name}
        empty=""
        columns={[
          { key: 'name', label: 'Player' },
          { key: 'pos', label: 'Pos', render: (r) => <PosBadge pos={r.pos} /> },
          { key: 'nfl', label: 'NFL' },
          { key: 'projected', label: 'Proj', align: 'right', render: (r) => (r.projected === undefined ? fmt(null) : r.projected.toFixed(1)) },
          { key: 'injury', label: 'Injury', render: (r) => (r.injury ? <span className="warn">{r.injury}</span> : '') },
        ]}
      />
      {v.mySchedule.length > 0 && (
        <details className="schedule">
          <summary>Full schedule</summary>
          <Table
            rows={v.mySchedule}
            rowKey={(r) => String(r.week)}
            columns={[
              { key: 'week', label: 'Wk', align: 'right' },
              { key: 'opponent', label: 'Opponent' },
              { key: 'result', label: '', render: (r) => r.result ?? '' },
              {
                key: 'score',
                label: 'Score',
                align: 'right',
                render: (r) => (r.myScore !== undefined && r.oppScore !== undefined ? `${r.myScore.toFixed(1)} – ${r.oppScore.toFixed(1)}` : '–'),
              },
            ]}
          />
        </details>
      )}
    </Section>
  );
}

function Transactions({ v }: { v: MflLeagueView }) {
  const [filter, setFilter] = useState<'all' | 'mine' | 'Trade' | 'adds'>('all');
  if (v.transactions === null) {
    return (
      <Section title="Transactions (last 30 days)">
        <p className="empty">Not available (see the note at the top).</p>
      </Section>
    );
  }
  const rows = v.transactions.filter((t) =>
    filter === 'all' ? true : filter === 'mine' ? t.mine : filter === 'Trade' ? t.type === 'Trade' : t.type !== 'Trade',
  );
  return (
    <Section
      title="Transactions (last 30 days)"
      aside={
        <Chips
          options={[
            { value: 'all', label: 'All' },
            { value: 'mine', label: 'Mine' },
            { value: 'Trade', label: 'Trades' },
            { value: 'adds', label: 'Adds & drops' },
          ]}
          value={filter}
          onChange={setFilter}
        />
      }
    >
      <Table
        rows={rows}
        rowKey={(r, i) => `${r.when}-${i}`}
        highlight={(r) => r.mine}
        empty="No transactions."
        columns={[
          { key: 'when', label: 'When', render: (r) => dateTime(r.when) },
          { key: 'type', label: 'Type' },
          { key: 'team', label: 'Team' },
          { key: 'summary', label: 'Details', wrap: true },
        ]}
      />
    </Section>
  );
}

function TrendTable({ rows, showOwner }: { rows: MflLeagueView['trending']['adds']; showOwner?: boolean }) {
  return (
    <Table
      rows={rows}
      rowKey={(r) => r.id}
      empty="No trend data."
      columns={[
        { key: 'name', label: 'Player' },
        { key: 'pos', label: 'Pos', render: (r) => <PosBadge pos={r.pos} /> },
        { key: 'nfl', label: 'NFL' },
        { key: 'percent', label: '% leagues', align: 'right', render: (r) => `${r.percent}%` },
        { key: 'rank', label: 'FP Rank', align: 'right' },
        {
          key: 'available',
          label: 'Your league',
          render: (r) =>
            r.available ? <span className="tag-fa">AVAILABLE</span> : <span className="muted">{showOwner && 'owner' in r ? String((r as any).owner ?? 'Rostered') : 'Rostered'}</span>,
        },
      ]}
    />
  );
}

function Settings({ v }: { v: MflLeagueView }) {
  const s = v.settings;
  const facts = [
    ['Roster size', s.rosterSize],
    ['IR slots', s.irSize],
    ['Taxi squad', s.taxiSize],
    ['Starters', s.startersCount],
    ['Season weeks', s.startWeek && s.endWeek ? `${s.startWeek}–${s.endWeek}` : undefined],
    ['Last regular-season week', s.lastRegularWeek],
  ].filter(([, val]) => val !== undefined && val !== '');
  return (
    <div className="grid-2">
      <Section title="League rules">
        <dl className="facts">
          {facts.map(([k, val]) => (
            <div key={String(k)}>
              <dt>{k}</dt>
              <dd>{String(val)}</dd>
            </div>
          ))}
        </dl>
        {s.starters.length > 0 && (
          <>
            <h3 className="subhead">Starting lineup</h3>
            <div className="chips">
              {s.starters.map((p) => (
                <span key={p.pos} className="chip static">
                  {p.pos} × {p.limit}
                </span>
              ))}
            </div>
          </>
        )}
        {s.divisions.length > 1 && (
          <>
            <h3 className="subhead">Divisions</h3>
            <p className="muted small">{s.divisions.map((d) => `${d.name} (${d.teamIds.length})`).join(' · ')}</p>
          </>
        )}
      </Section>
      <Section title="Scoring">
        <Table
          rows={v.scoring}
          rowKey={(r, i) => `${r.positions}-${r.rule}-${i}`}
          empty="Scoring rules not available."
          columns={[
            { key: 'positions', label: 'Positions' },
            { key: 'rule', label: 'Stat' },
            { key: 'points', label: 'Points', align: 'right' },
            { key: 'range', label: 'Range' },
          ]}
        />
      </Section>
    </div>
  );
}
