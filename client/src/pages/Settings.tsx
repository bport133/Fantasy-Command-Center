import { useEffect, useState } from 'react';
import {
  LEAGUE_FORMATS,
  RANKING_LABELS,
  RANKING_TYPES,
  RECORD_FORMAT_LABELS,
  RECORD_FORMATS,
  SCORINGS,
  type LeagueConfig,
  type RecordFormat,
  type LeagueFormat,
  type Platform,
  type PublicSettings,
  type RankingType,
  type SecretKey,
  type Settings,
  type Snapshot,
} from '@shared/types.ts';
import { FORMAT_LABELS } from '@shared/formats.ts';
import { api } from '../api';
import { supabase } from '../supabase';
import type { Update } from '../App';
import { PageHead, Section } from '../ui';

type Draft = PublicSettings & Partial<Record<SecretKey, string>>;

const newId = () => Math.random().toString(36).slice(2, 10);

export function SettingsPage({ snap, update, refresh }: { snap: Snapshot; update: Update; refresh: () => void }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [clear, setClear] = useState<SecretKey[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [csvType, setCsvType] = useState<RankingType>('dynasty');

  useEffect(() => {
    api.settings().then(setDraft, (e) => setMsg({ ok: false, text: e.message }));
  }, []);

  if (!draft) return <p className="muted">Loading settings…</p>;

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft({ ...draft, [k]: v });
  const setLeague = (id: string, patch: Partial<LeagueConfig>) =>
    set('leagues', draft.leagues.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  const save = async (thenRefresh: boolean) => {
    setSaving(true);
    setMsg(null);
    try {
      const { secretsSet, ...rest } = draft;
      const saved = await api.saveSettings({ ...(rest as Partial<Settings>), clearSecrets: clear });
      setDraft(saved);
      setClear([]);
      setMsg({ ok: true, text: 'Saved.' });
      if (thenRefresh) refresh();
      else update(await api.snapshot());
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const secret = (key: SecretKey, label: string, help: React.ReactNode) => {
    const isSet = draft.secretsSet[key] && !clear.includes(key);
    return (
      <Field label={label} help={help}>
        <div className="row">
          <input
            type="password"
            autoComplete="off"
            placeholder={isSet ? '•••••••• saved (type to replace)' : 'Not set'}
            value={draft[key] ?? ''}
            onChange={(e) => set(key, e.target.value)}
          />
          {isSet && (
            <button className="link" onClick={() => setClear([...clear, key])}>
              Clear
            </button>
          )}
        </div>
      </Field>
    );
  };

  const onCsv = async (file: File | undefined) => {
    if (!file) return;
    try {
      update(await api.importCsv(await file.text(), csvType));
      setMsg({ ok: true, text: `Imported ${RANKING_LABELS[csvType]} rankings from ${file.name}.` });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  };

  return (
    <>
      <PageHead title="⚙️ Settings" sub="Stored in your private Supabase database. Keys and cookies are never sent back to the browser." />

      <Section
        title="Leagues"
        aside={
          <div className="row">
            {(['sleeper', 'espn', 'mfl'] as Platform[]).map((p) => (
              <button
                key={p}
                onClick={() =>
                  set('leagues', [...draft.leagues, { id: newId(), platform: p, leagueId: '', myTeam: '', ...(p === 'mfl' ? { host: '' } : {}) }])
                }
              >
                + {p === 'mfl' ? 'MFL' : p === 'espn' ? 'ESPN' : 'Sleeper'}
              </button>
            ))}
          </div>
        }
      >
        {draft.leagues.length === 0 && <p className="empty">Add a Sleeper, ESPN or MFL league to get started.</p>}
        <div className="leagues">
          {draft.leagues.map((l) => {
            const choices = snap.teamChoices[l.id];
            return (
              <div className="league-row" key={l.id}>
                <span className={`badge ${l.platform}`}>{l.platform.toUpperCase()}</span>
                <Field label="League ID" help={LEAGUE_HELP[l.platform]}>
                  <input value={l.leagueId} onChange={(e) => setLeague(l.id, { leagueId: e.target.value })} />
                </Field>
                {l.platform === 'mfl' && (
                  <Field label="Host" help="e.g. www42.myfantasyleague.com (from your league URL)">
                    <input value={l.host ?? ''} onChange={(e) => setLeague(l.id, { host: e.target.value })} />
                  </Field>
                )}
                <Field label="My team" help={choices ? 'Pick from the list' : 'Refresh once to get a dropdown, or type your team name/ID'}>
                  {choices ? (
                    <select value={choices.find((c) => c.id === l.myTeam) ? l.myTeam : matchChoice(choices, l.myTeam)} onChange={(e) => setLeague(l.id, { myTeam: e.target.value })}>
                      <option value="">— choose —</option>
                      {choices.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input value={l.myTeam} onChange={(e) => setLeague(l.id, { myTeam: e.target.value })} />
                  )}
                </Field>
                <button className="link danger" onClick={() => set('leagues', draft.leagues.filter((x) => x.id !== l.id))}>
                  Remove
                </button>
                <div className="league-format">
                  <Field label="Format" help={FORMAT_HELP[l.format ?? 'dynasty']}>
                    <select
                      value={l.format ?? 'dynasty'}
                      onChange={(e) => setLeague(l.id, { format: e.target.value as LeagueFormat, ...(e.target.value === 'keeper' && !l.keepers ? { keepers: 3 } : {}) })}
                    >
                      {LEAGUE_FORMATS.map((f) => (
                        <option key={f} value={f}>
                          {FORMAT_LABELS[f]}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {l.format === 'keeper' && (
                    <Field label="Keepers per team">
                      <input type="number" min={1} max={25} value={l.keepers ?? 3} onChange={(e) => setLeague(l.id, { keepers: Number(e.target.value) })} />
                    </Field>
                  )}
                  <Field label="Rankings" help="Auto: dynasty → Dynasty; redraft/keeper → Draft before the season, Rest of season during it">
                    <select value={l.rankings ?? 'auto'} onChange={(e) => setLeague(l.id, { rankings: e.target.value as LeagueConfig['rankings'] })}>
                      <option value="auto">Auto (by format)</option>
                      {RANKING_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {RANKING_LABELS[t]}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Weekly records" help="How the Scoreboard turns weekly scores into wins and losses">
                    <select value={l.recordFormat ?? (l.platform === 'mfl' ? 'allplay+median' : 'h2h')} onChange={(e) => setLeague(l.id, { recordFormat: e.target.value as RecordFormat })}>
                      {RECORD_FORMATS.map((f) => (
                        <option key={f} value={f}>
                          {RECORD_FORMAT_LABELS[f]}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Scoring">
                    <select value={l.scoring ?? 'default'} onChange={(e) => setLeague(l.id, { scoring: e.target.value as LeagueConfig['scoring'] })}>
                      <option value="default">Default ({draft.fpScoring})</option>
                      {SCORINGS.map((sc) => (
                        <option key={sc} value={sc}>
                          {SCORING_LABELS[sc]}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      <div className="grid-2">
        <Section title="FantasyPros">
          {secret('fpApiKey', 'API key', <>From <a href="https://secure.fantasypros.com/api-keys/request" target="_blank" rel="noreferrer">secure.fantasypros.com/api-keys/request</a>. Leave blank to use a CSV import instead.</>)}
          <Field label="Default scoring" help="Used by leagues set to Default scoring">
            <select value={draft.fpScoring} onChange={(e) => set('fpScoring', e.target.value)}>
              {SCORINGS.map((sc) => (
                <option key={sc} value={sc}>
                  {SCORING_LABELS[sc]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Rankings to load" help="Shown on the FantasyPros page. Rankings your leagues use are always loaded. Weekly projections and news load automatically with an API key.">
            <div className="checks">
              {RANKING_TYPES.map((t) => (
                <label key={t} className="toggle">
                  <input
                    type="checkbox"
                    checked={draft.fpTypes.includes(t)}
                    onChange={(e) => set('fpTypes', e.target.checked ? [...draft.fpTypes, t] : draft.fpTypes.filter((x) => x !== t))}
                  />
                  {RANKING_LABELS[t]}
                </label>
              ))}
            </div>
          </Field>
          <Field label="Import rankings CSV" help="No API key? On FantasyPros, open the rankings you want, click Download CSV, pick the matching type here, then choose the file.">
            <div className="row wrap">
              <select value={csvType} onChange={(e) => setCsvType(e.target.value as RankingType)} style={{ maxWidth: 200 }}>
                {RANKING_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {RANKING_LABELS[t]}
                  </option>
                ))}
              </select>
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => {
                  onCsv(e.target.files?.[0]);
                  e.target.value = ''; // so choosing the same file again (e.g. for another type) still imports
                }}
              />
            </div>
          </Field>
        </Section>

        <Section title="ESPN credentials">
          <p className="muted small">
            Only needed for private leagues. In a browser logged in to ESPN Fantasy, open DevTools → Application → Cookies → espn.com and copy
            the <code>espn_s2</code> and <code>SWID</code> values.
          </p>
          {secret('espnS2', 'espn_s2', 'Long URL-encoded string')}
          {secret('espnSwid', 'SWID', 'Looks like {XXXXXXXX-XXXX-…}. Braces optional.')}
        </Section>
      </div>

      <div className="grid-2">
        <Section title="MFL">
          <Field
            label="Registered API client name"
            help="The client name (User-Agent) from your MFL API client registration confirmation. Leave blank if you haven't registered. Click Save after changing it."
          >
            <input placeholder="F2-Command-Center" value={draft.mflUserAgent ?? ''} onChange={(e) => set('mflUserAgent', e.target.value)} />
          </Field>
          <MflSignIn
            settings={draft}
            onChange={(saved) => setDraft({ ...draft, mflUsername: saved.mflUsername, secretsSet: saved.secretsSet })}
          />
          {secret(
            'mflApiKey',
            'API key (optional, instead of signing in)',
            'Log in at myfantasyleague.com, open your league, then Help → Developer\'s API. The key is shown on that page.',
          )}
          <Field label="Salary cap" help="Read from your MFL league settings on every refresh.">
            <div>
              {snap.mflCap.length === 0 ? (
                <span className="muted">Shows here after your MFL league refreshes.</span>
              ) : (
                snap.mflCap.map((c) => (
                  <div key={c.configId}>
                    <strong>${(c.years[0]?.cap ?? 0).toLocaleString()}</strong>{' '}
                    <span className={c.capSource === 'MFL' ? 'ok small' : 'warn small'}>
                      {c.capSource === 'MFL' ? '✓ from MFL' : "MFL didn't report a cap; using the fallback below"}
                    </span>
                    {snap.mflCap.length > 1 && <span className="muted small"> · {c.league}</span>}
                  </div>
                ))
              )}
            </div>
          </Field>
          <NumField
            label="Contract-year cap"
            help="Your league's limit on total contract years across a roster. MFL doesn't share this rule, so enter it here (used on MFL Cap)."
            value={draft.mflContractYearCap}
            onChange={(v) => set('mflContractYearCap', v)}
          />
          <details className="advanced">
            <summary>Advanced</summary>
            <NumField
              label="Fallback salary cap"
              help="Only used if MFL doesn't report a cap for your league."
              value={draft.mflSalaryCap}
              onChange={(v) => set('mflSalaryCap', v)}
            />
            <NumField
              label="Projection years"
              help="How many seasons ahead the MFL Cap page projects contracts (a display choice, not league data)."
              value={draft.projectionYears}
              onChange={(v) => set('projectionYears', v)}
            />
          </details>
        </Section>

        <Section title="General & alerts">
          <NumField label="Season" help="NFL season to pull" value={draft.season} onChange={(v) => set('season', v)} />
          <NumField label="Free agents shown per league" value={draft.freeAgentsPerLeague} onChange={(v) => set('freeAgentsPerLeague', v)} />
          <NumField label="Alert on drops of top-N ranked players" help="Watchlist players are always tracked" value={draft.alertTopN} onChange={(v) => set('alertTopN', v)} />
          <NumField label="Auto-refresh every (minutes)" help="Runs in the cloud around the clock (checked every 15 minutes). 0 turns it off." value={draft.autoRefreshMinutes} onChange={(v) => set('autoRefreshMinutes', v)} />
          {secret('alertWebhookUrl', 'Alert webhook URL', 'Optional Discord or Slack incoming-webhook URL to get drop alerts on your phone.')}
        </Section>
      </div>

      <AccountSection />

      <div className="savebar">
        {msg && <span className={msg.ok ? 'ok' : 'warn'}>{msg.text}</span>}
        <button onClick={() => save(false)} disabled={saving}>
          Save
        </button>
        <button className="primary" onClick={() => save(true)} disabled={saving}>
          Save & refresh
        </button>
      </div>
    </>
  );
}

/**
 * Signs in to MFL through the server. The password is sent once and never stored; the server
 * keeps only MFL's login cookie so it can read owner-only data (pending trades, calendar...).
 */
function MflSignIn({ settings, onChange }: { settings: Draft; onChange: (s: PublicSettings) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const signIn = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const saved = await api.mflLogin(username, password);
      onChange(saved);
      setPassword('');
      setMsg({ ok: true, text: 'Signed in. Hit Refresh all to load your owner-only MFL data.' });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const signOut = async () => {
    setBusy(true);
    try {
      onChange(await api.saveSettings({ clearSecrets: ['mflCookie'] }));
      setMsg(null);
    } finally {
      setBusy(false);
    }
  };

  if (settings.secretsSet.mflCookie) {
    return (
      <Field label="MFL sign-in" help="The app uses this to see owner-only data like your pending trades and the league calendar.">
        <div className="row">
          <span className="ok">✓ Signed in{settings.mflUsername ? ` as ${settings.mflUsername}` : ''}</span>
          <button className="link" onClick={signOut} disabled={busy}>
            Sign out of MFL
          </button>
        </div>
        {msg && <span className={msg.ok ? 'ok small' : 'warn small'}>{msg.text}</span>}
      </Field>
    );
  }
  return (
    <Field
      label="MFL sign-in (recommended)"
      help="Your MFL username and password. They go to MFL once to sign you in; the password is not saved."
    >
      <div className="stack">
        <input placeholder="MFL username or email" autoComplete="off" value={username} onChange={(e) => setUsername(e.target.value)} />
        <input
          type="password"
          placeholder="MFL password"
          autoComplete="off"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && signIn()}
        />
        <button className="primary" onClick={signIn} disabled={busy || !username || !password}>
          {busy ? 'Signing in…' : 'Sign in to MFL'}
        </button>
        {msg && <span className={msg.ok ? 'ok small' : 'warn small'}>{msg.text}</span>}
      </div>
    </Field>
  );
}

/** Changes this app's sign-in password (the Supabase account), not any league site's. */
function AccountSection() {
  const [password, setPassword] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const change = async () => {
    setMsg(null);
    if (password.length < 8) return setMsg({ ok: false, text: 'Use at least 8 characters.' });
    if (password !== confirmPw) return setMsg({ ok: false, text: "The two passwords don't match." });
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) return setMsg({ ok: false, text: error.message });
    setPassword('');
    setConfirmPw('');
    setMsg({ ok: true, text: 'Password changed.' });
  };

  return (
    <Section title="Account">
      <div className="row wrap">
        <input type="password" autoComplete="new-password" placeholder="New password for this app" value={password} onChange={(e) => setPassword(e.target.value)} />
        <input type="password" autoComplete="new-password" placeholder="Type it again" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} />
        <button onClick={change} disabled={busy || !password}>
          {busy ? 'Saving…' : 'Change password'}
        </button>
      </div>
      {msg && <p className={msg.ok ? 'ok small' : 'warn small'}>{msg.text}</p>}
    </Section>
  );
}

const SCORING_LABELS: Record<string, string> = { PPR: 'PPR', HALF: 'Half PPR', STD: 'Standard' };

const FORMAT_HELP: Record<LeagueFormat, string> = {
  redraft: 'New team every year: values players for this season only',
  keeper: 'Keep a few players each year: this season plus a keeper planner',
  dynasty: 'Keep your whole roster: long-term dynasty values',
};

const LEAGUE_HELP: Record<Platform, string> = {
  sleeper: 'The long number in sleeper.com/leagues/<id>',
  espn: 'leagueId=… in your ESPN league URL',
  mfl: 'L=… or the number after /home/ in your MFL URL',
};

/** Older configs store the team by name; map that onto the dropdown's team id. */
function matchChoice(choices: { id: string; name: string }[], myTeam: string): string {
  const want = myTeam.toLowerCase();
  if (!want) return '';
  return choices.find((c) => c.name.toLowerCase() === want || c.name.toLowerCase().startsWith(`${want} (`) || c.name.toLowerCase().includes(`(${want})`))?.id ?? '';
}

function Field({ label, help, children }: { label: string; help?: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {help && <span className="field-help">{help}</span>}
    </label>
  );
}

function NumField({ label, help, value, onChange }: { label: string; help?: string; value: number; onChange: (v: number) => void }) {
  return (
    <Field label={label} help={help}>
      <input type="number" value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </Field>
  );
}
