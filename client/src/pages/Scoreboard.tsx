import { useMemo, useState } from 'react';
import { RECORD_FORMAT_LABELS, type ScoreboardLeague, type ScoreboardWeek, type Snapshot, type WLT } from '@shared/types.ts';
import { Chips, PageHead, PlatformBadge, Section, Table } from '../ui';

const rec = (r: WLT) => `${r.w}-${r.l}${r.t ? `-${r.t}` : ''}`;
const res = (r?: 'W' | 'L' | 'T') => (r ? <span className={r === 'W' ? 'pos-num' : r === 'L' ? 'neg' : 'muted'}>{r}</span> : <span className="muted">–</span>);

export function ScoreboardPage({ snap }: { snap: Snapshot }) {
  const boards = snap.scoreboard ?? [];
  const allWeeks = useMemo(() => [...new Set(boards.flatMap((b) => b.weeks.map((w) => w.week)))].sort((a, b) => a - b), [boards]);
  const latest = allWeeks[allWeeks.length - 1];
  const [week, setWeek] = useState<number | undefined>(undefined);
  const [view, setView] = useState<'week' | 'season'>('week');
  const shownWeek = week ?? latest;

  if (!boards.some((b) => b.weeks.length)) {
    return (
      <>
        <PageHead title="📺 Scoreboard" />
        <p className="empty">
          No scores yet. Scores appear once the regular season starts and your leagues refresh
          {snap.nflState?.seasonType === 'pre' ? ' (it’s still the preseason)' : ''}.
        </p>
      </>
    );
  }

  return (
    <>
      <PageHead
        title="📺 Scoreboard"
        sub="Every league's week at a glance. Each league's wins and losses follow its Weekly records setting (Settings → Leagues)."
      />
      <div className="filters">
        <Chips
          options={[
            { value: 'week', label: 'This week' },
            { value: 'season', label: 'Season standings' },
          ]}
          value={view}
          onChange={setView}
        />
        {view === 'week' && (
          <Chips
            options={allWeeks.map((w) => ({ value: String(w), label: `Wk ${w}${w === snap.nflState?.week ? ' (live)' : ''}` }))}
            value={String(shownWeek)}
            onChange={(v) => setWeek(Number(v))}
          />
        )}
      </div>
      {boards.map((b) =>
        view === 'week' ? <LeagueWeek key={b.configId} board={b} week={b.weeks.find((w) => w.week === shownWeek)} /> : <LeagueSeason key={b.configId} board={b} />,
      )}
    </>
  );
}

function Title({ board }: { board: ScoreboardLeague }) {
  return (
    <>
      <PlatformBadge platform={board.platform} /> {board.league}
      <span className="fmt">{RECORD_FORMAT_LABELS[board.format]}</span>
    </>
  );
}

function LeagueWeek({ board, week }: { board: ScoreboardLeague; week?: ScoreboardWeek }) {
  if (!week) {
    return (
      <Section title={<Title board={board} />}>
        <p className="empty">No scores for this week.</p>
      </Section>
    );
  }
  const me = week.teams.find((t) => t.mine);
  const hasH2h = week.teams.some((t) => t.h2h);
  return (
    <Section
      title={<Title board={board} />}
      aside={
        <span className="muted small">
          {week.final ? 'Final' : '🔴 Live'}
          {me && ` · you: ${me.score.toFixed(2)}, #${me.rank} of ${week.teams.length}, ${rec(me.record)} this week`}
        </span>
      }
    >
      {week.matchups.length > 0 && (
        <div className="matchups">
          {week.matchups.map((m, i) => {
            const aWin = m.b && m.a.score > m.b.score;
            const bWin = m.b && m.b.score > m.a.score;
            return (
              <div key={i} className={m.a.mine || m.b?.mine ? 'matchup-tile mine' : 'matchup-tile'}>
                <div className={aWin ? 'side win' : 'side'}>
                  <span>{m.a.team}</span>
                  <strong>{m.a.score.toFixed(2)}</strong>
                </div>
                {m.b ? (
                  <div className={bWin ? 'side win' : 'side'}>
                    <span>{m.b.team}</span>
                    <strong>{m.b.score.toFixed(2)}</strong>
                  </div>
                ) : (
                  <div className="side muted">
                    <span>Bye</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <Table
        rows={week.teams}
        rowKey={(r) => r.teamId}
        highlight={(r) => r.mine}
        columns={[
          { key: 'rank', label: '#', align: 'right' },
          { key: 'team', label: 'Team' },
          { key: 'score', label: 'Score', align: 'right', render: (r) => r.score.toFixed(2) },
          ...(hasH2h
            ? [{ key: 'h2h', label: 'H2H', align: 'center' as const, render: (r: (typeof week.teams)[number]) => <>{res(r.h2h)} <span className="muted small">{r.opponent ? `vs ${r.opponent}` : ''}</span></> }]
            : []),
          { key: 'allPlay', label: 'All-play', align: 'center', render: (r) => rec(r.allPlay), sort: (r) => r.allPlay.w },
          { key: 'topHalf', label: 'Top half', align: 'center', render: (r) => res(r.topHalf) },
          { key: 'record', label: 'Week record', align: 'center', render: (r) => <strong>{rec(r.record)}</strong>, sort: (r) => r.record.w - r.record.l },
        ]}
      />
    </Section>
  );
}

function LeagueSeason({ board }: { board: ScoreboardLeague }) {
  const finals = board.weeks.filter((w) => w.final).length;
  const hasH2h = board.season.some((r) => r.h2h.w + r.h2h.l + r.h2h.t > 0);
  return (
    <Section title={<Title board={board} />} aside={<span className="muted small">{finals} completed week{finals === 1 ? '' : 's'}</span>}>
      <Table
        rows={board.season}
        rowKey={(r) => r.teamId}
        highlight={(r) => r.mine}
        empty="No completed weeks yet."
        columns={[
          { key: 'rank', label: '#', align: 'right' },
          { key: 'team', label: 'Team' },
          { key: 'record', label: 'Record', align: 'center', render: (r) => <strong>{rec(r.record)}</strong>, sort: (r) => r.rank },
          ...(hasH2h ? [{ key: 'h2h', label: 'H2H', align: 'center' as const, render: (r: (typeof board.season)[number]) => rec(r.h2h), sort: (r: (typeof board.season)[number]) => r.h2h.w }] : []),
          { key: 'allPlay', label: 'All-play', align: 'center', render: (r) => rec(r.allPlay), sort: (r) => r.allPlay.w },
          { key: 'topHalf', label: 'Top half', align: 'center', render: (r) => rec(r.topHalf), sort: (r) => r.topHalf.w },
          { key: 'pf', label: 'Points for', align: 'right', render: (r) => r.pf.toFixed(2) },
        ]}
      />
    </Section>
  );
}
