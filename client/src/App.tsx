import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { Snapshot } from '@shared/types.ts';
import { api } from './api';
import { AlertsPage, DraftPicksPage, RankingsPage, TeamValuesPage, TradeFinderPage } from './pages/League';
import { MflCapPage, MflExpiringPage } from './pages/Mfl';
import { MflLeaguePage } from './pages/MflLeague';
import { DashboardPage, FreeAgentsPage, RostersPage, WatchlistPage } from './pages/Overview';
import { SettingsPage } from './pages/Settings';
import { DfsPage } from './pages/Dfs';
import { MembersPage } from './pages/Members';
import { configured, supabase } from './supabase';
import { ago } from './ui';

const TABS = [
  { id: 'dashboard', icon: '🏠', label: 'Dashboard' },
  { id: 'rosters', icon: '📋', label: 'My Rosters' },
  { id: 'free-agents', icon: '🆓', label: 'Free Agents' },
  { id: 'watchlist', icon: '👀', label: 'Watchlist' },
  { id: 'mfl-cap', icon: '💰', label: 'MFL Cap' },
  { id: 'mfl-expiring', icon: '📅', label: 'MFL Expiring' },
  { id: 'mfl-league', icon: '🏟️', label: 'MFL League' },
  { id: 'team-values', icon: '📊', label: 'Team Values' },
  { id: 'trade-finder', icon: '🤝', label: 'Trade Finder' },
  { id: 'draft-picks', icon: '🎯', label: 'Draft Picks' },
  { id: 'alerts', icon: '🔔', label: 'Alerts' },
  { id: 'dfs', icon: '💵', label: 'FanDuel DFS' },
  { id: 'rankings', icon: '🏆', label: 'FantasyPros' },
  { id: 'settings', icon: '⚙️', label: 'Settings' },
  { id: 'members', icon: '👥', label: 'Members' },
] as const;
/** Tabs only the app owner sees. */
const OWNER_TABS = new Set<string>(['members']);
type TabId = (typeof TABS)[number]['id'];

const tabFromHash = (): TabId => {
  const h = location.hash.slice(1);
  return (TABS.find((t) => t.id === h)?.id ?? 'dashboard') as TabId;
};

export type Update = (s: Snapshot) => void;

export function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  if (!configured) {
    return (
      <Centered>
        <h2>Almost there</h2>
        <p>
          This build doesn't know which Supabase project to use. Check that the <code>SUPABASE_PROJECT_ID</code> and{' '}
          <code>SUPABASE_ACCESS_TOKEN</code> secrets are set in GitHub, then re-run the deploy workflow.
        </p>
      </Centered>
    );
  }
  if (session === undefined) return <Centered>Loading…</Centered>;
  if (!session) return <SignIn />;
  return <Main email={session.user.email ?? ''} />;
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="centered">
      <div className="card signin">{children}</div>
    </div>
  );
}

function SignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) setError(error.message);
    setBusy(false);
  };

  return (
    <Centered>
      <div className="brand">
        <span className="brand-icon">🏈</span>
        <div>
          <strong>Dynasty</strong>
          <span>Command Center</span>
        </div>
      </div>
      <form onSubmit={submit}>
        <label className="field">
          <span className="field-label">Email</span>
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="field">
          <span className="field-label">Password</span>
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && <p className="warn">{error}</p>}
        <button className="primary wide" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </Centered>
  );
}

function Main({ email }: { email: string }) {
  const [tab, setTab] = useState<TabId>(tabFromHash);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, []);

  const [isOwner, setIsOwner] = useState(false);

  useEffect(() => {
    api.snapshot().then(setSnap, (e) => setError(e.message));
    api.me().then((me) => setIsOwner(me.isOwner), () => {});
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
          {TABS.filter((t) => isOwner || !OWNER_TABS.has(t.id)).map((t) => (
            <a key={t.id} href={`#${t.id}`} className={tab === t.id ? 'active' : undefined}>
              <span className="nav-icon">{t.icon}</span>
              <span>{t.label}</span>
              {t.id === 'alerts' && snap && snap.alerts.length > 0 && <span className="count">{snap.alerts.length}</span>}
            </a>
          ))}
        </nav>
        <div className="signout">
          <span className="muted small">{email}</span>
          <button className="link" onClick={() => supabase.auth.signOut()}>
            Sign out
          </button>
        </div>
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
          !error && <p className="muted">Loading…</p>
        ) : (
          <Page tab={tab} snap={snap} update={setSnap} refresh={doRefresh} isOwner={isOwner} />
        )}
      </main>
    </div>
  );
}

function Page({
  tab,
  snap,
  update,
  refresh,
  isOwner,
}: {
  tab: TabId;
  snap: Snapshot;
  update: Update;
  refresh: () => void;
  isOwner: boolean;
}) {
  const needsSetup = snap.leagues.length === 0 && snap.fpCount === 0 && !['settings', 'members', 'dfs'].includes(tab);
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
    case 'mfl-league':
      return <MflLeaguePage snap={snap} />;
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
    case 'dfs':
      return <DfsPage snap={snap} update={update} />;
    case 'settings':
      return <SettingsPage snap={snap} update={update} refresh={refresh} />;
    case 'members':
      return isOwner ? <MembersPage /> : <p className="empty">Only the app owner can manage members.</p>;
  }
}
