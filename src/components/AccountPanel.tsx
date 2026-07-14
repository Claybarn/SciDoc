import { useState } from 'react';
import { Cloud, CloudOff, Loader2, LogIn, LogOut, RefreshCw, X } from 'lucide-react';

export type SyncState = 'idle' | 'syncing' | 'synced' | 'error';

interface Props {
  email: string | null;
  syncState: SyncState;
  syncError: string | null;
  onSignIn: (email: string, password: string) => Promise<string | null>;
  onSignUp: (email: string, password: string) => Promise<string | null>;
  onSignOut: () => void;
  onSyncNow: () => void;
}

function AuthModal({
  onSignIn,
  onSignUp,
  onClose,
}: {
  onSignIn: Props['onSignIn'];
  onSignUp: Props['onSignUp'];
  onClose: () => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async (mode: 'in' | 'up') => {
    if (!email.trim() || !password) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const err = mode === 'in' ? await onSignIn(email.trim(), password) : await onSignUp(email.trim(), password);
    setBusy(false);
    if (err === 'confirm-email') {
      setNotice('Account created. Check your inbox for a confirmation link, then sign in.');
    } else if (err) {
      setError(err);
    } else {
      onClose();
    }
  };

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal auth-modal">
        <div className="modal-header">
          <h3>Cloud sync</h3>
          <button className="icon-btn" onClick={onClose} title="Close">
            <X size={16} />
          </button>
        </div>
        <p className="auth-blurb">
          Sign in to back up your documents — each one stays a self-contained bundle, synced to
          your private space.
        </p>
        <input
          className="auth-input"
          type="email"
          placeholder="you@university.edu"
          value={email}
          autoComplete="email"
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          className="auth-input"
          type="password"
          placeholder="Password"
          value={password}
          autoComplete="current-password"
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit('in')}
        />
        {error && <div className="cit-error">{error}</div>}
        {notice && <div className="auth-notice">{notice}</div>}
        <div className="auth-actions">
          <button className="btn btn-secondary" disabled={busy} onClick={() => submit('up')}>
            Create account
          </button>
          <button className="btn btn-primary" disabled={busy} onClick={() => submit('in')}>
            {busy ? <Loader2 size={15} className="spin" /> : <LogIn size={15} />} Sign in
          </button>
        </div>
      </div>
    </div>
  );
}

export function AccountPanel({
  email,
  syncState,
  syncError,
  onSignIn,
  onSignUp,
  onSignOut,
  onSyncNow,
}: Props) {
  const [modalOpen, setModalOpen] = useState(false);

  if (!email) {
    return (
      <>
        <div className="account-cta">
          <button className="btn btn-primary account-cta-btn" onClick={() => setModalOpen(true)}>
            <LogIn size={15} /> Sign in / Sign up
          </button>
          <span className="account-cta-hint">
            <CloudOff size={12} /> Documents are on this device only
          </span>
        </div>
        {modalOpen && (
          <AuthModal onSignIn={onSignIn} onSignUp={onSignUp} onClose={() => setModalOpen(false)} />
        )}
      </>
    );
  }

  return (
    <div className="account-widget">
      <div className="account-row">
        <Cloud size={14} className={syncState === 'error' ? 'sync-error-icon' : undefined} />
        <span className="account-email" title={email}>
          {email}
        </span>
        <button className="icon-btn account-btn" title="Sync now" onClick={onSyncNow}>
          <RefreshCw size={13} className={syncState === 'syncing' ? 'spin' : undefined} />
        </button>
        <button className="icon-btn account-btn" title="Sign out" onClick={onSignOut}>
          <LogOut size={13} />
        </button>
      </div>
      <div className={`account-status${syncState === 'error' ? ' error' : ''}`}>
        {syncState === 'syncing' && 'Syncing…'}
        {syncState === 'synced' && 'All changes backed up'}
        {syncState === 'idle' && 'Cloud sync on'}
        {syncState === 'error' && (syncError ?? 'Sync failed')}
      </div>
    </div>
  );
}
