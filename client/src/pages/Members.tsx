import { useEffect, useState } from 'react';
import type { Member } from '@shared/types.ts';
import { api } from '../api';
import { PageHead, Section, Table } from '../ui';

/** A readable starting password the owner can pass on; the member can change it in Settings. */
function suggestPassword(): string {
  const words = ['blitz', 'sleeper', 'handoff', 'redzone', 'waiver', 'dynasty', 'taxi', 'rookie', 'audible', 'fourth'];
  const pick = () => words[crypto.getRandomValues(new Uint32Array(1))[0] % words.length];
  const n = 100 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900);
  return `${pick()}-${pick()}-${n}`;
}

export function MembersPage() {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState(suggestPassword);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    api.members().then(setMembers, (e) => setMsg({ ok: false, text: e.message }));
  }, []);

  const add = async () => {
    setBusy(true);
    setMsg(null);
    try {
      setMembers(await api.addMember(email, password));
      setMsg({
        ok: true,
        text: `Added ${email.trim().toLowerCase()}. Send them the link to this site plus their email and starting password: ${password}`,
      });
      setEmail('');
      setPassword(suggestPassword());
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (m: Member) => {
    if (!confirm(`Remove ${m.email}? Their account and all their saved data will be deleted.`)) return;
    setBusy(true);
    try {
      setMembers(await api.removeMember(m.email));
      setMsg({ ok: true, text: `Removed ${m.email}.` });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHead
        title="👥 Members"
        sub="Invite people to use the app. Each person has their own leagues, settings, watchlist and alerts. Nobody can see anyone else's data or keys."
      />
      <div className="grid-2">
        <Section title="Invite someone">
          <label className="field">
            <span className="field-label">Their email</span>
            <input type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="friend@example.com" />
          </label>
          <label className="field">
            <span className="field-label">Starting password</span>
            <div className="row">
              <input autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
              <button onClick={() => setPassword(suggestPassword())} type="button">
                New
              </button>
            </div>
            <span className="field-help">At least 8 characters. They can change it in Settings after signing in.</span>
          </label>
          <button className="primary" onClick={add} disabled={busy || !email.trim()}>
            {busy ? 'Working…' : 'Add member'}
          </button>
          {msg && <p className={msg.ok ? 'ok' : 'warn'}>{msg.text}</p>}
        </Section>
        <Section title="How it works">
          <ol className="steps">
            <li>Add their email and a starting password here.</li>
            <li>
              Send them this site's link (<code>{location.origin + location.pathname}</code>), their email and the password.
            </li>
            <li>They sign in, go to Settings, add their own leagues and keys, and click Save &amp; refresh.</li>
            <li>They can change their password under Settings → Account.</li>
          </ol>
          <p className="muted small">
            Only people on this list (and you) can use the app, even if someone creates a Supabase account another way. FantasyPros
            API keys are personal, so each person should add their own key or import the free rankings CSV.
          </p>
        </Section>
      </div>
      <Section title={`${members?.length ?? 0} member${members?.length === 1 ? '' : 's'}`}>
        <Table
          rows={members ?? []}
          rowKey={(r) => r.email}
          empty={members ? 'No members yet.' : 'Loading…'}
          columns={[
            { key: 'email', label: 'Email' },
            { key: 'addedAt', label: 'Added', render: (r) => new Date(r.addedAt).toLocaleDateString() },
            {
              key: 'remove',
              label: '',
              render: (r) => (
                <button className="link danger" onClick={() => remove(r)} disabled={busy}>
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
