import { useState } from 'react';
import type { CapYear, ContractRow, Snapshot } from '../../../shared/types';
import { Chips, fmt, money, PageHead, pct, PosBadge, Section, Table, type Column } from '../ui';

function NoMfl() {
  return <p className="empty">No MFL league configured, or your team isn't picked yet. Set it up in Settings.</p>;
}

export function MflCapPage({ snap }: { snap: Snapshot }) {
  const [id, setId] = useState(snap.mflCap[0]?.configId);
  const view = snap.mflCap.find((v) => v.configId === id) ?? snap.mflCap[0];
  if (!view) return <NoMfl />;

  const metric = (label: string, get: (y: CapYear) => React.ReactNode) => ({
    metric: label,
    cells: view.years.map(get),
  });
  const capRows = [
    metric('Total Salary Cap', (y) => money(y.cap)),
    metric('Total Committed', (y) => money(y.committed)),
    metric('Cap Remaining', (y) => <span className={y.remaining < 0 ? 'neg' : 'pos-num'}>{money(y.remaining)}</span>),
    metric('# Contracts Active', (y) => y.contracts),
    metric('Cap % Used', (y) => <Meter value={y.pctUsed} />),
    metric('Average Salary', (y) => money(y.avgSalary)),
  ];
  const yearRows = [
    metric('Total Years Cap', (y) => y.yearsCap),
    metric('Years Committed', (y) => y.yearsCommitted),
    metric('Years Remaining', (y) => <span className={y.yearsRemaining < 0 ? 'neg' : undefined}>{y.yearsRemaining}</span>),
    metric('% Years Used', (y) => <Meter value={y.pctYearsUsed} />),
  ];
  const summaryCols: Column<(typeof capRows)[number]>[] = [
    { key: 'metric', label: 'Metric' },
    ...view.seasons.map((s, i) => ({ key: String(s), label: String(s), align: 'right' as const, render: (r: (typeof capRows)[number]) => r.cells[i] })),
  ];

  const contractCols: Column<ContractRow>[] = [
    { key: 'name', label: 'Player' },
    { key: 'pos', label: 'Pos', render: (r) => <PosBadge pos={r.pos} /> },
    { key: 'nfl', label: 'NFL' },
    { key: 'slot', label: 'Status' },
    { key: 'rank', label: 'FP Rank', align: 'right' },
    { key: 'salary', label: 'Salary', align: 'right', render: (r) => money(r.salary) },
    { key: 'contractYears', label: 'Yrs', align: 'right' },
    { key: 'finalSeason', label: 'Final', align: 'right', render: (r) => r.finalSeason },
    ...view.seasons.map((s, i) => ({
      key: `s${s}`,
      label: String(s),
      align: 'right' as const,
      sort: (r: ContractRow) => r.bySeason[i] ?? 0,
      render: (r: ContractRow) => (r.bySeason[i] === null ? <span className="muted">–</span> : money(r.bySeason[i])),
    })),
  ];

  return (
    <>
      <PageHead title="💰 MFL Salary Cap & Contract Projection" sub="Salary counts against a season while contract years remain." />
      {snap.mflCap.length > 1 && (
        <Chips options={snap.mflCap.map((v) => ({ value: v.configId, label: v.league }))} value={view.configId} onChange={setId} />
      )}
      <Section title={`${view.seasons.length}-Year Cap Summary`}>
        <Table rows={capRows} columns={summaryCols} rowKey={(r) => r.metric} />
      </Section>
      <Section title={`${view.seasons.length}-Year Contract-Year Summary`}>
        <Table rows={yearRows} columns={summaryCols} rowKey={(r) => r.metric} />
      </Section>
      <Section title="Cap allocation by position (this season)">
        <Table
          rows={view.positions}
          rowKey={(r) => r.pos}
          columns={[
            { key: 'pos', label: 'Position', render: (r) => <PosBadge pos={r.pos} /> },
            { key: 'players', label: 'Players', align: 'right' },
            { key: 'total', label: 'Total Salary', align: 'right', render: (r) => money(r.total) },
            { key: 'avg', label: 'Avg Salary', align: 'right', render: (r) => money(r.avg) },
            { key: 'pct', label: 'Cap %', render: (r) => <Meter value={r.pct} /> },
            { key: 'capRank', label: 'Cap Rank', align: 'right' },
          ]}
        />
      </Section>
      <Section title="Roster contracts">
        <Table rows={view.contracts} columns={contractCols} rowKey={(r) => r.name} />
      </Section>
    </>
  );
}

function Meter({ value }: { value: number }) {
  const cls = value > 0.95 ? 'meter hot' : value > 0.8 ? 'meter warm' : 'meter';
  return (
    <span className={cls}>
      <span style={{ width: `${Math.min(100, value * 100)}%` }} />
      <em>{pct(value)}</em>
    </span>
  );
}

export function MflExpiringPage({ snap }: { snap: Snapshot }) {
  const [id, setId] = useState(snap.mflExpiring[0]?.configId);
  const [mineOnly, setMineOnly] = useState(false);
  const view = snap.mflExpiring.find((v) => v.configId === id) ?? snap.mflExpiring[0];
  if (!view) return <NoMfl />;
  const rows = view.expiring.filter((r) => !mineOnly || r.mine);
  return (
    <>
      <PageHead title="📅 MFL — Upcoming Free Agents & Cap Room" sub="League-wide. Know who is about to hit the market and who will have money to bid." />
      {snap.mflExpiring.length > 1 && (
        <Chips options={snap.mflExpiring.map((v) => ({ value: v.configId, label: v.league }))} value={view.configId} onChange={setId} />
      )}
      <Section
        title={`Projected cap room for ${view.nextSeason}`}
        aside={<span className="muted small">Most room first = your biggest bidding rivals</span>}
      >
        <Table
          rows={view.capRoom}
          rowKey={(r) => r.team}
          highlight={(r) => r.mine}
          columns={[
            { key: 'team', label: 'Team' },
            { key: 'committed', label: `Committed ${view.nextSeason}`, align: 'right', render: (r) => money(r.committed) },
            { key: 'room', label: `Cap room ${view.nextSeason}`, align: 'right', render: (r) => <span className={r.room < 0 ? 'neg' : 'pos-num'}>{money(r.room)}</span> },
            { key: 'yearsCommitted', label: 'Contract yrs committed', align: 'right' },
            { key: 'expiringValue', label: 'Value of expiring players', align: 'right' },
          ]}
        />
      </Section>
      <Section
        title="Contracts ending after this season or next"
        aside={
          <label className="toggle">
            <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} /> Mine only
          </label>
        }
      >
        <Table
          rows={rows}
          rowKey={(r) => `${r.team}-${r.name}`}
          highlight={(r) => r.mine}
          columns={[
            { key: 'endsAfter', label: 'Contract ends', render: (r) => `After ${r.endsAfter}` },
            { key: 'rank', label: 'FP Rank', align: 'right' },
            { key: 'name', label: 'Player', render: (r) => <>{r.name}{r.mine && ' ⭐'}</> },
            { key: 'pos', label: 'Pos', render: (r) => <PosBadge pos={r.pos} /> },
            { key: 'age', label: 'Age', align: 'right' },
            { key: 'team', label: 'Current team' },
            { key: 'salary', label: 'Salary', align: 'right', render: (r) => money(r.salary) },
            { key: 'contractYears', label: 'Contract Yrs', align: 'right', render: (r) => fmt(r.contractYears) },
          ]}
        />
      </Section>
    </>
  );
}
