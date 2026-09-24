import { useEffect, useState } from 'react';
import type { LeagueConfig, Platform, PublicSettings, SecretKey, Settings, Snapshot } from '@shared/types.ts';
import { api } from '../api';
import type { Update } from '../App';
import { PageHead, Section } from '../ui';

type Draft = PublicSettings & Partial<Record<SecretKey, string>>;

const newId = () => Math.random().toString(36).slice(2, 10);

export function SettingsPage({ snap, update, refresh }: { snap: Snapshot; update: Update; refresh: () => void }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [clear, setClear] = useState<SecretKey[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

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
      update(await api.importCsv(await file.text()));
      setMsg({ ok: true, text: `Imported rankings from ${file.name}.` });
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
              </div>
            );
          })}
        </div>
      </Section>

      <div className="grid-2">
        <Section title="FantasyPros">
          {secret('fpApiKey', 'API key', <>From <a href="https://secure.fantasypros.com/api-keys/request" target="_blank" rel="noreferrer">secure.fantasypros.com/api-keys/request</a>. Leave blank to use a CSV import instead.</>)}
          <Field label="Ranking type" help="dynasty, rookies, or draft">
            <select value={draft.fpType} onChange={(e) => set('fpType', e.target.value)}>
              {['dynasty', 'rookies', 'draft'].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </Field>
          <Field label="Scoring">
            <select value={draft.fpScoring} onChange={(e) => set('fpScoring', e.target.value)}>
              {['PPR', 'HALF', 'STD'].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </Field>
          <Field label="Import rankings CSV" help="Download from the FantasyPros dynasty rankings page (Download CSV). Used when there's no API key.">
            <input type="file" accept=".csv,text/csv" onChange={(e) => onCsv(e.target.files?.[0])} />
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
          {secret('mflApiKey', 'API key', 'Only if MFL data comes back blank or errors. Find it under Help → Developer API on your league site.')}
          <NumField label="Salary cap" help="Used if MFL doesn't report one" value={draft.mflSalaryCap} onChange={(v) => set('mflSalaryCap', v)} />
          <NumField label="Contract-year cap" help="Total contract years allowed" value={draft.mflContractYearCap} onChange={(v) => set('mflContractYearCap', v)} />
          <NumField label="Projection years" value={draft.projectionYears} onChange={(v) => set('projectionYears', v)} />
        </Section>

        <Section title="General & alerts">
          <NumField label="Season" help="NFL season to pull" value={draft.season} onChange={(v) => set('season', v)} />
          <NumField label="Free agents shown per league" value={draft.freeAgentsPerLeague} onChange={(v) => set('freeAgentsPerLeague', v)} />
          <NumField label="Alert on drops of top-N ranked players" help="Watchlist players are always tracked" value={draft.alertTopN} onChange={(v) => set('alertTopN', v)} />
          <NumField label="Auto-refresh every (minutes)" help="Runs in the cloud around the clock (checked every 15 minutes). 0 turns it off." value={draft.autoRefreshMinutes} onChange={(v) => set('autoRefreshMinutes', v)} />
          {secret('alertWebhookUrl', 'Alert webhook URL', 'Optional Discord or Slack incoming-webhook URL to get drop alerts on your phone.')}
        </Section>
      </div>

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
