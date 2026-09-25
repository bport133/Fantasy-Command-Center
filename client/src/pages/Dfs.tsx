import { useMemo, useState } from 'react';
import type { DfsPlayer, Snapshot } from '@shared/types.ts';
import { FANDUEL, lineupsCsv, optimizeLineups, OUT_TAGS, type Lineup } from '@shared/dfs.ts';
import { api } from '../api';
import type { Update } from '../App';
import { Chips, money, PageHead, PosBadge, Section, Table } from '../ui';

const POS = [
  { value: 'ALL', label: 'All' },
  { value: 'QB', label: 'QB' },
  { value: 'RB', label: 'RB' },
  { value: 'WR', label: 'WR' },
  { value: 'TE', label: 'TE' },
  { value: 'DEF', label: 'DEF' },
] as const;

const valuePer1k = (p: DfsPlayer) => (p.salary ? (p.projection / p.salary) * 1000 : 0);

export function DfsPage({ snap, update }: { snap: Snapshot; update: Update }) {
  const slate = snap.dfs;
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [locked, setLocked] = useState<Set<string>>(new Set());
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [lineups, setLineups] = useState<Lineup[] | null>(null);
  const [count, setCount] = useState(5);
  const [pos, setPos] = useState<(typeof POS)[number]['value']>('ALL');
  const [q, setQ] = useState('');

  const upload = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    setMsg(null);
    try {
      update(await api.uploadDfsSlate(await file.text()));
      setLocked(new Set());
      setExcluded(new Set());
      setLineups(null);
      setMsg({ ok: true, text: `Loaded ${file.name}.` });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const build = () => {
    if (!slate) return;
    const result = optimizeLineups(slate.players, count, { locked, excluded });
    setLineups(result);
    setMsg(result.length ? null : { ok: false, text: 'No legal lineup fits under the cap with these locks and exclusions.' });
  };

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, id: string, other?: [Set<string>, (s: Set<string>) => void]) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else {
      next.add(id);
      if (other?.[0].has(id)) {
        const o = new Set(other[0]);
        o.delete(id);
        other[1](o);
      }
    }
    setter(next);
    setLineups(null);
  };

  const download = () => {
    if (!lineups?.length) return;
    const blob = new Blob([lineupsCsv(lineups)], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'fanduel-lineups.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const exposure = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of lineups ?? []) for (const p of l.players) m.set(p.id, (m.get(p.id) ?? 0) + 1);
    return m;
  }, [lineups]);

  const rows = (slate?.players ?? []).filter(
    (p) => (pos === 'ALL' || p.pos === pos) && (!q || p.name.toLowerCase().includes(q.toLowerCase())),
  );

  return (
    <>
      <PageHead
        title="💵 FanDuel DFS"
        sub="Build optimal FanDuel NFL lineups: 9 players (QB, 2 RB, 3 WR, TE, FLEX, DEF) under the $60,000 cap, at most 4 from one team."
      />
      <div className="grid-2">
        <Section title="1. Load the slate">
          <ol className="steps">
            <li>On FanDuel, open an NFL contest (full roster / classic).</li>
            <li>
              Click <strong>Download players list</strong> (on the lineup page, next to the player search). It saves a CSV.
            </li>
            <li>Choose that file here. Load a new file for each slate.</li>
          </ol>
          <div className="row wrap">
            <input
              type="file"
              accept=".csv,text/csv"
              disabled={busy}
              onChange={(e) => {
                upload(e.target.files?.[0]);
                e.target.value = ''; // re-selecting an updated file with the same name still uploads
              }}
            />
            {slate && (
              <button className="link danger" onClick={async () => update(await api.clearDfsSlate())}>
                Clear slate
              </button>
            )}
          </div>
          {msg && <p className={msg.ok ? 'ok small' : 'warn small'}>{msg.text}</p>}
          {slate && (
            <p className="muted small">
              {slate.players.length} players · {slate.games.length} games · loaded {new Date(slate.uploadedAt).toLocaleString()}
              <br />
              {slate.projectionNote}
            </p>
          )}
        </Section>
        <Section title="2. Build lineups">
          {!slate ? (
            <p className="empty">Load a slate first.</p>
          ) : (
            <>
              <p className="muted small">
                Lock (🔒) players you want in every lineup and exclude (✕) ones you don't. Injured players marked Out/IR are skipped.
              </p>
              <div className="row wrap">
                <label className="toggle">
                  Lineups
                  <select value={count} onChange={(e) => setCount(Number(e.target.value))} style={{ width: 70 }}>
                    {[1, 3, 5, 10].map((n) => (
                      <option key={n}>{n}</option>
                    ))}
                  </select>
                </label>
                <button className="primary" onClick={build}>
                  Build {count === 1 ? 'best lineup' : `${count} lineups`}
                </button>
                {lineups && lineups.length > 0 && <button onClick={download}>Download CSV for FanDuel upload</button>}
              </div>
              <p className="muted small">
                {locked.size} locked · {excluded.size} excluded. The CSV has one row per lineup with FanDuel player ids in slot order. If
                FanDuel asks for its own template, paste the ids into it.
              </p>
            </>
          )}
        </Section>
      </div>

      {lineups && lineups.length > 0 && (
        <div className="grid-3">
          {lineups.map((l, i) => (
            <Section
              key={i}
              title={`${i === 0 ? '⭐ Best' : `Lineup ${i + 1}`} · ${l.projection.toFixed(1)} pts`}
              aside={<span className="muted small">{money(l.salary)} · {money(FANDUEL.salaryCap - l.salary)} left</span>}
            >
              <Table
                rows={l.players}
                rowKey={(r) => `${r.slot}-${r.id}`}
                columns={[
                  { key: 'slot', label: 'Slot' },
                  {
                    key: 'name',
                    label: 'Player',
                    render: (r) => (
                      <>
                        {r.name}
                        {locked.has(r.id) && ' 🔒'} <span className="muted small">{r.team}</span>
                      </>
                    ),
                  },
                  { key: 'salary', label: 'Salary', align: 'right', render: (r) => money(r.salary) },
                  { key: 'projection', label: 'Proj', align: 'right', render: (r) => r.projection.toFixed(1) },
                ]}
              />
            </Section>
          ))}
        </div>
      )}

      {slate && (
        <>
          <div className="filters">
            <Chips options={[...POS]} value={pos} onChange={setPos} />
            <input className="search" placeholder="Search players…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Section title={`Player pool · ${rows.length}`}>
            <Table
              rows={rows}
              rowKey={(r) => r.id}
              highlight={(r) => locked.has(r.id)}
              initialSort={{ key: 'value', dir: -1 }}
              columns={[
                {
                  key: 'actions',
                  label: '',
                  render: (r) => (
                    <span className="row">
                      <button
                        className={locked.has(r.id) ? 'star on' : 'star'}
                        title="Lock into every lineup"
                        onClick={() => toggle(locked, setLocked, r.id, [excluded, setExcluded])}
                      >
                        🔒
                      </button>
                      <button
                        className={excluded.has(r.id) ? 'star on' : 'star'}
                        title="Exclude"
                        onClick={() => toggle(excluded, setExcluded, r.id, [locked, setLocked])}
                      >
                        ✕
                      </button>
                    </span>
                  ),
                },
                { key: 'name', label: 'Player', render: (r) => <span className={excluded.has(r.id) ? 'muted strike' : undefined}>{r.name}</span> },
                { key: 'pos', label: 'Pos', render: (r) => <PosBadge pos={r.pos} /> },
                { key: 'team', label: 'Team' },
                { key: 'opp', label: 'Opp' },
                { key: 'salary', label: 'Salary', align: 'right', render: (r) => money(r.salary) },
                {
                  key: 'projection',
                  label: 'Proj',
                  align: 'right',
                  render: (r) => <span title={r.projectionSource}>{r.projection.toFixed(1)}{r.projectionSource === 'FanDuel FPPG' ? '*' : ''}</span>,
                },
                { key: 'value', label: 'Pts/$1k', align: 'right', sort: valuePer1k, render: (r) => valuePer1k(r).toFixed(2) },
                { key: 'fppg', label: 'FPPG', align: 'right', render: (r) => r.fppg.toFixed(1) },
                {
                  key: 'injury',
                  label: 'Status',
                  render: (r) => (r.injury ? <span className={OUT_TAGS.has(r.injury.toUpperCase()) ? 'neg' : 'warn'}>{r.injury}</span> : ''),
                },
                ...(lineups && lineups.length > 1
                  ? [{ key: 'exposure', label: 'In lineups', align: 'right' as const, sort: (r: DfsPlayer) => exposure.get(r.id) ?? 0, render: (r: DfsPlayer) => (exposure.get(r.id) ? `${exposure.get(r.id)}/${lineups.length}` : '') }]
                  : []),
              ]}
            />
            <p className="muted small">* FanDuel season average (no FantasyPros projection matched).</p>
          </Section>
        </>
      )}
    </>
  );
}
