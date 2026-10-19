import { useState, type FormEvent } from 'react';
import { useI18n } from '../i18n';
import { useStore } from '../store';
import { Button, LanguageSelect, TextInput, errorMessage } from '../components/ui';

const DEMO_USERS = ['jana', 'peter', 'eva'];

export function LoginScreen() {
  const { t } = useI18n();
  const { login, demo } = useStore();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e?: FormEvent, u = username, p = password) {
    e?.preventDefault();
    if (!u.trim() || !p) {
      setError(t('errors.required_credentials'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await login(u.trim(), p);
    } catch (err) {
      setError(errorMessage(t, err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <div className="login-card panel">
        <div className="login-lang"><LanguageSelect compact /></div>
        <div className="brand-mark brand-lg" aria-hidden="true">♥</div>
        <h1 className="login-title">{t('app.name')}</h1>
        <p className="muted">{t('app.tagline')}</p>
        <form onSubmit={submit} noValidate>
          <TextInput label={t('login.username')} autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />
          <TextInput label={t('login.password')} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          {error && <p className="form-error" role="alert">{error}</p>}
          <Button type="submit" variant="primary" block disabled={busy}>{t('login.submit')}</Button>
        </form>
        {demo && (
          <div className="demo-box">
            <p className="field-label">{t('login.demoTitle')}</p>
            <p className="muted small">{t('login.demoHint', { password: 'demo1234' })}</p>
            <div className="demo-users">
              {DEMO_USERS.map((u) => (
                <Button key={u} disabled={busy} onClick={() => submit(undefined, u, 'demo1234')}>
                  {t(`login.demo_${u}`)}
                </Button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
