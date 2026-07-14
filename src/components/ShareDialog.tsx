import { useCallback, useEffect, useState } from 'react';
import { Loader2, Trash2, UserPlus, Users, X } from 'lucide-react';
import { listMembers, removeMember, shareDocument, type DocumentMember } from '../lib/sharing';

interface Props {
  docId: string;
  docTitle: string;
  /** Signed-in user's id, to label "you" and gate remove buttons. */
  selfId: string;
  onClose: () => void;
}

export function ShareDialog({ docId, docTitle, selfId, onClose }: Props) {
  const [members, setMembers] = useState<DocumentMember[] | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'editor' | 'viewer'>('editor');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    listMembers(docId)
      .then(setMembers)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load members'));
  }, [docId]);

  useEffect(refresh, [refresh]);

  const isOwner = members?.some((m) => m.role === 'owner' && m.user_id === selfId) ?? false;

  const invite = async () => {
    const target = email.trim();
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      await shareDocument(docId, target, role);
      setEmail('');
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not share document');
    } finally {
      setBusy(false);
    }
  };

  const changeRole = async (member: DocumentMember, next: 'editor' | 'viewer') => {
    setError(null);
    try {
      await shareDocument(docId, member.email, next);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change role');
    }
  };

  const remove = async (userId: string) => {
    setError(null);
    try {
      await removeMember(docId, userId);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove member');
    }
  };

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal share-modal">
        <div className="modal-header">
          <h3>
            <Users size={15} style={{ verticalAlign: '-2px', marginRight: 6 }} />
            Share “{docTitle || 'Untitled document'}”
          </h3>
          <button className="icon-btn" onClick={onClose} title="Close">
            <X size={16} />
          </button>
        </div>

        {isOwner && (
          <div className="share-invite-row">
            <input
              className="auth-input"
              type="email"
              placeholder="colleague@university.edu"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && invite()}
            />
            <select
              className="share-role-select"
              value={role}
              onChange={(e) => setRole(e.target.value as 'editor' | 'viewer')}
              title="Access level"
            >
              <option value="editor">Can edit</option>
              <option value="viewer">View only</option>
            </select>
            <button className="btn btn-primary" disabled={busy || !email.trim()} onClick={invite}>
              {busy ? <Loader2 size={15} className="spin" /> : <UserPlus size={15} />} Invite
            </button>
          </div>
        )}

        {error && <div className="cit-error">{error}</div>}

        {members === null ? (
          <div className="share-loading">
            <Loader2 size={16} className="spin" /> Loading members…
          </div>
        ) : (
          <ul className="share-member-list">
            {members.map((m) => (
              <li key={m.user_id}>
                <span className="share-member-email">
                  {m.email}
                  {m.user_id === selfId && ' (you)'}
                </span>
                {m.role !== 'owner' && isOwner ? (
                  <select
                    className="share-role-select"
                    value={m.role}
                    onChange={(e) => changeRole(m, e.target.value as 'editor' | 'viewer')}
                  >
                    <option value="editor">Can edit</option>
                    <option value="viewer">View only</option>
                  </select>
                ) : (
                  <span className={`share-role share-role-${m.role}`}>
                    {m.role === 'owner' ? 'owner' : m.role === 'viewer' ? 'view only' : 'can edit'}
                  </span>
                )}
                {m.role !== 'owner' && (isOwner || m.user_id === selfId) && (
                  <button
                    className="icon-btn danger"
                    title={m.user_id === selfId ? 'Leave document' : 'Remove'}
                    onClick={() => remove(m.user_id)}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        <p className="share-hint">
          Invitees need a SciDoc account with cloud sync. Editors' changes merge automatically —
          live when you're online together, on next sync otherwise. Viewers can read and follow
          along but not change anything.
        </p>
      </div>
    </div>
  );
}
