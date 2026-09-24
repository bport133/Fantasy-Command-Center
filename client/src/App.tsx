import { useCallback, useEffect, useState } from 'react';
import type { Snapshot } from '../../shared/types';
import { api } from './api';
import { AlertsPage, DraftPicksPage, RankingsPage, TeamValuesPage, TradeFinderPage } from './pages/League';
import { MflCapPage, MflExpiringPage } from './pages/Mfl';
import { DashboardPage, FreeAgentsPage, RostersPage, WatchlistPage } from './pages/Overview';
import { SettingsPage } from './pages/Settings';
import { ago } from './ui';

const TABS = [
  { id: 'dashboard', icon: '🏠', label: 'Dashboard' },
  { id: 'rosters', icon: '📋', label: 'My Rosters' },
  { id: 'free-agents', icon: '🆓', label: 'Free Agents' },
  { id: 'watchlist', icon: '👀', label: 'Watchlist' },
  { id: 'mfl-cap', icon: '💰', label: 'MFL Cap' },
  { id: 'mfl-expiring', icon: '📅', label: 'MFL Expiring' },
  { id: 'team-values', icon: '📊', label: 'Team Values' },
  { id: 'trade-finder', icon: '🤝', label: 'Trade Finder' },
  { id: 'draft-picks', icon: '🎯', label: 'Draft Picks' },
  { id: 'alerts', icon: '🔔', label: 'Alerts' },
  { id: 'rankings', icon: '🏆', label: 'FP Rankings' },
  { id: 'settings', icon: '⚙️', label: 'Settings' },
] as const;
type TabId = (typeof TABS)[number]['id'];

const tabFromHash = (): TabId => {
  const h = location.hash.slice(1);
  return (TABS.find((t) => t.id === h)?.id ?? 'dashboard') as TabId;
};

export type Update = (s: Snapshot) => void;

export function App() {
  const [tab, setTab] = useState<TabId>(tabFromHash);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    api.snapshot().then(setSnap, (e) => setError(e.message));
  }, []);

  const doRefresh = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setSnap(await api.refresh());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  const failed = snap?.sources.filter((s) => !s.ok) ?? [];

  return (
    <div className="shell">
      <aside className="nav">
        <div className="brand">
          <span className="brand-icon">🏈</span>
          <div>
            <strong>Dynasty</strong>
            <span>Command Center</span>
          </div>
        </div>
        <nav>
          {TABS.map((t) => (
            <a key={t.id} href={`#${t.id}`} className={tab === t.id ? 'active' : undefined}>
              <span className="nav-icon">{t.icon}</span>
              <span>{t.label}</span>
              {t.id === 'alerts' && snap && snap.alerts.length > 0 && <span className="count">{snap.alerts.length}</span>}
            </a>
          ))}
        </nav>
      </aside>
      <main>
        <div className="topbar">
          <div className="status">
            <span className="muted">Last refreshed {ago(snap?.refreshedAt ?? null)}</span>
            {snap && snap.fpCount > 0 && <span className="muted"> · {snap.fpCount} ranked players</span>}
            {failed.length > 0 && (
              <span className="warn" title={failed.map((f) => `${f.source}: ${f.message}`).join('\n')}>
                {' '}
                · ⚠️ {failed.length} source{failed.length > 1 ? 's' : ''} failed
              </span>
            )}
          </div>
          <button className="primary" onClick={doRefresh} disabled={busy}>
            {busy ? 'Refreshing…' : '↻ Refresh all'}
          </button>
        </div>
        {error && <div className="banner error">{error}</div>}
        {!snap ? (
          <p className="muted">Loading…</p>
        ) : (
          <Page tab={tab} snap={snap} update={setSnap} refresh={doRefresh} />
        )}
      </main>
    </div>
  );
}

function Page({ tab, snap, update, refresh }: { tab: TabId; snap: Snapshot; update: Update; refresh: () => void }) {
  const needsSetup = snap.leagues.length === 0 && snap.fpCount === 0 && tab !== 'settings';
  if (needsSetup) {
    return (
      <div className="card onboarding">
        <h2>Welcome 👋</h2>
        <p>
          Add your leagues and FantasyPros key in <a href="#settings">Settings</a>, then hit <strong>Refresh all</strong>.
        </p>
      </div>
    );
  }
  switch (tab) {
    case 'dashboard':
      return <DashboardPage snap={snap} />;
    case 'rosters':
      return <RostersPage snap={snap} />;
    case 'free-agents':
      return <FreeAgentsPage snap={snap} update={update} />;
    case 'watchlist':
      return <WatchlistPage snap={snap} update={update} />;
    case 'mfl-cap':
      return <MflCapPage snap={snap} />;
    case 'mfl-expiring':
      return <MflExpiringPage snap={snap} />;
    case 'team-values':
      return <TeamValuesPage snap={snap} />;
    case 'trade-finder':
      return <TradeFinderPage snap={snap} />;
    case 'draft-picks':
      return <DraftPicksPage snap={snap} />;
    case 'alerts':
      return <AlertsPage snap={snap} update={update} />;
    case 'rankings':
      return <RankingsPage snap={snap} />;
    case 'settings':
      return <SettingsPage snap={snap} update={update} refresh={refresh} />;
  }
}
