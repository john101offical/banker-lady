import { useEffect, useRef, useState } from 'react';
import type { CircleDraft, DraftMember, LanguageCode, SetupReading, Snapshot } from '../../../shared/types';
import { getJson, tryPost } from '../api';
import { money } from '../util';

const EXAMPLE =
  "I'm Pauline Grant, everybody calls me Miss P, and I run our partner, the Ward 4 Partner. Six of us throw $50 a week. Joyce Reid needs a new fridge by November 20, and she always pays cash. Andre Williams wants to send a barrel home for Christmas, so he needs it by December 8. Kezia Brown has January school fees due January 4. Devon Campbell is new to us and needs a car repair by November 23. Marcia Clarke is saving for family, no fixed date; it's for her aunt's surgery, but keep that between her and the banker. I'm saving for a land payment by January 15. Joyce, Devon and Marcia like Patois.";

const LANGUAGES: { code: LanguageCode; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'jm', label: 'Patois' },
  { code: 'es', label: 'Spanish' },
  { code: 'ht', label: 'Haitian Creole' },
];

const blankMember = (): DraftMember => ({
  name: '',
  callName: '',
  savingFor: '',
  privateDetail: '',
  needBy: null,
  isNew: false,
  paysCash: false,
  isHost: false,
  language: 'en',
});

function draftFromSnapshot({ circle, members }: Snapshot): CircleDraft {
  return {
    name: circle.name,
    handAmount: circle.handAmount,
    startDate: circle.startDate,
    members: members.map((m) => ({
      name: m.name,
      callName: m.callName,
      savingFor: m.goal.label,
      privateDetail: '',
      needBy: m.goal.needBy,
      isNew: m.isNew,
      paysCash: m.paysCash,
      isHost: m.isHost === true,
      language: m.language,
    })),
  };
}

interface Props {
  /** "new" starts from the host's own words; "edit" reopens the draft on screen. */
  mode: 'new' | 'edit';
  snap: Snapshot;
  onClose: () => void;
}

export function SetupDialog({ mode, snap, onClose }: Props) {
  const box = useRef<HTMLDialogElement>(null);
  const [template, setTemplate] = useState<CircleDraft | null>(null);
  const [step, setStep] = useState<'loading' | 'describe' | 'form'>(mode === 'edit' ? 'form' : 'loading');
  const [text, setText] = useState('');
  const [draft, setDraft] = useState<CircleDraft | null>(mode === 'edit' ? draftFromSnapshot(snap) : null);
  const [notes, setNotes] = useState<string[]>([]);
  const [lead, setLead] = useState(mode === 'edit' ? 'Change anything, and I will work the order out again.' : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    box.current?.showModal();
  }, []);

  useEffect(() => {
    if (mode !== 'new') return;
    void getJson<{ draft: CircleDraft; canRead: boolean }>('/api/setup/template').then((res) => {
      if (!res) {
        setError("Couldn't reach the app. Close this and try again.");
        return;
      }
      setTemplate(res.draft);
      if (res.canRead) {
        setStep('describe');
      } else {
        setDraft(res.draft);
        setLead('No AI key is set here, so this form starts with the demo circle. Change anything you like.');
        setStep('form');
      }
    });
  }, [mode]);

  const read = async () => {
    setBusy(true);
    setError(null);
    const res = await tryPost<SetupReading>('/api/setup/read', { description: text });
    setBusy(false);
    if ('error' in res) {
      setError(`${res.error} You can try again, or fill in the form yourself.`);
      return;
    }
    setDraft(res.data.draft);
    setNotes(res.data.notes);
    setLead('Here is what I understood. Fix anything I got wrong.');
    setStep('form');
  };

  const useForm = () => {
    setDraft(template);
    setError(null);
    setLead('This form starts with the demo circle. Change anything you like.');
    setStep('form');
  };

  const plan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    setBusy(true);
    setError(null);
    const res = await tryPost('/api/setup/plan', { draft, editing: mode === 'edit' });
    setBusy(false);
    if ('error' in res) {
      setError(res.error);
      return;
    }
    onClose();
  };

  const change = (patch: Partial<CircleDraft>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const changeMember = (at: number, patch: Partial<DraftMember>) =>
    setDraft((d) => (d ? { ...d, members: d.members.map((m, i) => (i === at ? { ...m, ...patch } : m)) } : d));

  const people = draft?.members.length ?? 0;
  return (
    <dialog ref={box} className="setup" aria-labelledby="setup-title" onCancel={onClose} onClose={onClose}>
      <div className="setup-head">
        <h2 id="setup-title">{mode === 'edit' ? 'Change the circle' : 'Start a new circle'}</h2>
        <button type="button" className="link" onClick={onClose}>
          Close
        </button>
      </div>

      {error && (
        <p className="setup-error" role="alert">
          {error}
        </p>
      )}
      {step === 'loading' && !error && <p className="panel-lead">Opening the form…</p>}

      {step === 'describe' && (
        <form
          className="setup-describe"
          onSubmit={(e) => {
            e.preventDefault();
            void read();
          }}
        >
          <label htmlFor="setup-words">
            Tell me about your circle in your own words: who is in it, the hand, what each person is saving for and by when, who is
            new, and who pays cash.
          </label>
          <textarea
            id="setup-words"
            rows={9}
            maxLength={4000}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={EXAMPLE}
          />
          <p className="setup-small">This replaces the circle on screen. Nothing goes to PayPal until you have checked the order.</p>
          <div className="setup-actions">
            <button type="submit" className="primary" disabled={busy || !text.trim()}>
              {busy ? 'Reading…' : 'Read it'}
            </button>
            <button type="button" className="link" disabled={busy} onClick={() => setText(EXAMPLE)}>
              Use the example
            </button>
            <button type="button" className="link" disabled={busy} onClick={useForm}>
              Fill in a form instead
            </button>
          </div>
        </form>
      )}

      {step === 'form' && draft && (
        <form className="setup-form" onSubmit={plan}>
          {lead && <p className="panel-lead">{lead}</p>}
          {notes.length > 0 && (
            <div className="setup-notes">
              <p>Please check:</p>
              <ul>
                {notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="setup-circle">
            <label>
              <span>Circle name</span>
              <input required maxLength={60} value={draft.name} onChange={(e) => change({ name: e.target.value })} />
            </label>
            <label>
              <span>Hand each week ($)</span>
              <input
                required
                type="number"
                min="1"
                max="10000"
                step="0.01"
                value={draft.handAmount || ''}
                onChange={(e) => change({ handAmount: Number(e.target.value) })}
              />
            </label>
            <label>
              <span>First draw</span>
              <input required type="date" value={draft.startDate} onChange={(e) => change({ startDate: e.target.value })} />
            </label>
          </div>
          <div className="setup-people">
            {draft.members.map((m, i) => (
              <fieldset key={i} className="setup-row">
                <legend className="sr-only">Person {i + 1}</legend>
                <label>
                  <span className="cap">Name</span>
                  <input required maxLength={60} value={m.name} onChange={(e) => changeMember(i, { name: e.target.value })} />
                </label>
                <label>
                  <span className="cap">Called</span>
                  <input maxLength={40} value={m.callName} onChange={(e) => changeMember(i, { callName: e.target.value })} />
                </label>
                <label>
                  <span className="cap">Saving for</span>
                  <input maxLength={120} value={m.savingFor} onChange={(e) => changeMember(i, { savingFor: e.target.value })} />
                </label>
                <label>
                  <span className="cap">Private detail</span>
                  <input
                    maxLength={200}
                    value={m.privateDetail}
                    placeholder={mode === 'edit' ? 'Blank keeps it' : 'Optional'}
                    onChange={(e) => changeMember(i, { privateDetail: e.target.value })}
                  />
                </label>
                <label>
                  <span className="cap">Needed by</span>
                  <input type="date" value={m.needBy ?? ''} onChange={(e) => changeMember(i, { needBy: e.target.value || null })} />
                </label>
                <label>
                  <span className="cap">Language</span>
                  <select value={m.language} onChange={(e) => changeMember(i, { language: e.target.value as LanguageCode })}>
                    {LANGUAGES.map((l) => (
                      <option key={l.code} value={l.code}>
                        {l.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="tick-box">
                  <span className="cap">New</span>
                  <input type="checkbox" checked={m.isNew} onChange={(e) => changeMember(i, { isNew: e.target.checked })} />
                </label>
                <label className="tick-box">
                  <span className="cap">Cash</span>
                  <input type="checkbox" checked={m.paysCash} onChange={(e) => changeMember(i, { paysCash: e.target.checked })} />
                </label>
                <label className="tick-box">
                  <span className="cap">Host</span>
                  <input
                    type="radio"
                    name="setup-host"
                    checked={m.isHost}
                    onChange={() => change({ members: draft.members.map((x, at) => ({ ...x, isHost: at === i })) })}
                  />
                </label>
                <button
                  type="button"
                  className="link remove"
                  aria-label={`Remove ${m.name || `person ${i + 1}`}`}
                  onClick={() => change({ members: draft.members.filter((_, at) => at !== i) })}
                >
                  Remove
                </button>
              </fieldset>
            ))}
          </div>
          <button
            type="button"
            className="link add-person"
            disabled={people >= 12}
            onClick={() => change({ members: [...draft.members, blankMember()] })}
          >
            Add a person
          </button>
          <p className="setup-small">
            The whole circle sees what each person is saving for, so keep it general. A private detail stays between that person and
            the banker.
          </p>
          <p className="setup-small">
            {people} {people === 1 ? 'person' : 'people'} at {money(draft.handAmount || 0)} a week: each draw is{' '}
            {money((draft.handAmount || 0) * people)}, over {people} weeks. Nothing goes to PayPal until you have checked the order.
          </p>
          <div className="setup-actions">
            <button type="submit" className="primary" disabled={busy}>
              {busy ? 'Working it out…' : 'Show the draw order'}
            </button>
            {mode === 'new' && template && text && (
              <button type="button" className="link" disabled={busy} onClick={() => setStep('describe')}>
                Back to my words
              </button>
            )}
          </div>
        </form>
      )}
    </dialog>
  );
}
