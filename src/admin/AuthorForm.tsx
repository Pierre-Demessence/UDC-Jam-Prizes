import { useState } from 'react';

import { api } from '@/api';

import type { AdminAuthor } from '../../server/payloads.ts';
import type { AuthorInput } from '../../server/validate.ts';

/**
 * Enter belongs to the prize form around this one: a keypress here must not save
 * the prize instead of the author.
 */
function blockEnter(event: React.KeyboardEvent<HTMLInputElement>): void {
  if (event.key === 'Enter')
    event.preventDefault();
}

interface AuthorFormProps {
  /** The author being edited, or `null` when a new one is being created. */
  editing: AdminAuthor | null;
  onSaved: (author: AdminAuthor) => void;
  /**
   * Prefills a new author from the prize in hand: the store publisher is the key
   * prizes match on, so carrying it over is what makes the next prize find them.
   */
  publisher?: string | null;
}

/**
 * The fields of an author, shared by the prize form (which creates one on the
 * spot) and the author panel (which edits one). It is a div rather than a form
 * because it is rendered inside the prize form, and a form cannot nest.
 */
export function AuthorForm({ editing, onSaved, publisher = null }: AuthorFormProps) {
  const [publisherName, setPublisherName] = useState(() => editing?.publisher ?? publisher ?? '');
  const [handle, setHandle] = useState(() => editing?.discordHandle ?? '');
  const [discordId, setDiscordId] = useState(() => editing?.discordId ?? '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // A record with none of the three could not be found again or told apart, so
  // the server refuses it and the button will not offer it.
  const identified = publisherName.trim() !== '' || handle.trim() !== '' || discordId.trim() !== '';

  async function save(): Promise<void> {
    setBusy(true);
    setMessage(null);

    const input: AuthorInput = {
      discordHandle: handle.trim() === '' ? null : handle.trim(),
      discordId: discordId.trim() === '' ? null : discordId.trim(),
      publisher: publisherName.trim() === '' ? null : publisherName.trim(),
    };

    try {
      const saved = editing === null ? await api.createAuthor(input) : await api.updateAuthor(editing.id, input);
      onSaved(saved.author);
    }
    catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause));
    }
    finally {
      setBusy(false);
    }
  }

  return (
    <div className="form-grid">
      <label className="field">
        <span>Store publisher</span>
        <input
          onChange={event => setPublisherName(event.target.value)}
          onKeyDown={blockEnter}
          placeholder="the name on the Asset Store page"
          value={publisherName}
        />
      </label>

      <label className="field">
        <span>Discord handle</span>
        <input onChange={event => setHandle(event.target.value)} onKeyDown={blockEnter} placeholder="priya" value={handle} />
      </label>

      <label className="field">
        <span>Discord id</span>
        <input
          inputMode="numeric"
          onChange={event => setDiscordId(event.target.value)}
          onKeyDown={blockEnter}
          placeholder="123456789012345678"
          title="The 17 to 20 digit number, which does not change when the handle does."
          value={discordId}
        />
      </label>

      <div className="form-actions">
        <button
          className="button"
          disabled={busy || !identified}
          onClick={() => void save()}
          type="button"
        >
          {editing === null ? 'Add the author' : 'Save the author'}
        </button>
      </div>

      <p className="hint field-wide">
        The handle names this author on screen; the publisher is what every prize
        published under it matches on. Give at least one.
      </p>

      {message === null ? null : <p className="hint" role="alert">{message}</p>}
    </div>
  );
}
