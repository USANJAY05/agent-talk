// pages/AuthPage.jsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, EyeOff } from 'lucide-react'
import { useStore } from '../store'
import { api } from '../lib/api'

export default function AuthPage() {
  const [mode, setMode] = useState('login')
  const [form, setForm] = useState({ username: '', name: '', email: '', password: '', confirmPassword: '', bio: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const setAuth = useStore(s => s.setAuth)
  const navigate = useNavigate()

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function submit(e) {
    e.preventDefault()
    setError('')

    if (mode === 'register' && form.password !== form.confirmPassword) {
      setError('Passwords do not match')
      return
    }

    setLoading(true)
    try {
      if (mode === 'register') {
        await api.auth.register({
          username: form.username,
          name: form.name || undefined,
          email: form.email,
          password: form.password,
          bio: form.bio || undefined
        })
      }
      const tokenRes = await api.auth.login(form.username, form.password)
      localStorage.setItem('at_token', tokenRes.access_token)
      const [account, participant] = await Promise.all([api.auth.me(), api.participants.me()])
      setAuth(tokenRes.access_token, account, participant)
      navigate('/')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={styles.root}>
      {/* Background grid */}
      <div style={styles.grid} />

      <div style={styles.card}>
        {/* Logo */}
        <div style={styles.logo}>
          <div style={styles.logoMark}>AT</div>
          <span style={styles.logoText}>AgentTalk</span>
        </div>

        <p style={styles.tagline}>
          {mode === 'login' ? 'Welcome back.' : 'Create your account.'}
        </p>

        {error && (
          <div style={styles.errorBox}>
            <span style={{ color: 'var(--red)', fontFamily: 'var(--font-mono)', fontSize: 13 }}>
              ⚠ {error}
            </span>
          </div>
        )}

        <form onSubmit={submit} style={styles.form}>
          <label style={styles.label}>
            Username
            <input
              style={styles.input}
              value={form.username}
              onChange={e => set('username', e.target.value)}
              placeholder="Username"
              required
              autoFocus
            />
          </label>

          {mode === 'register' && (
            <label style={styles.label}>
              Display Name
              <input
                style={styles.input}
                value={form.name}
                onChange={e => set('name', e.target.value)}
                placeholder="What others see"
              />
            </label>
          )}

          {mode === 'register' && (
            <label style={styles.label}>
              Email
              <input
                style={styles.input}
                type="email"
                value={form.email}
                onChange={e => set('email', e.target.value)}
                placeholder="you@example.com"
                required
              />
            </label>
          )}

          <label style={styles.label}>
            Password
            <div style={styles.passwordWrap}>
              <input
                style={{ ...styles.input, ...styles.passwordInput }}
                type={showPassword ? 'text' : 'password'}
                value={form.password}
                onChange={e => set('password', e.target.value)}
                placeholder="••••••••"
                required
                minLength={8}
              />
              <button
                type="button"
                style={styles.eyeBtn}
                onClick={() => setShowPassword(v => !v)}
                title={showPassword ? 'Hide password' : 'Show password'}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </label>

          {mode === 'register' && (
            <label style={styles.label}>
              Confirm Password
              <div style={styles.passwordWrap}>
                <input
                  style={{ ...styles.input, ...styles.passwordInput }}
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={form.confirmPassword}
                  onChange={e => set('confirmPassword', e.target.value)}
                  placeholder="••••••••"
                  required
                  minLength={8}
                />
                <button
                  type="button"
                  style={styles.eyeBtn}
                  onClick={() => setShowConfirmPassword(v => !v)}
                  title={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
                  aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
                >
                  {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </label>
          )}

          {mode === 'register' && (
            <label style={styles.label}>
              Bio <span style={{ color: 'var(--text-2)', fontSize: 12 }}>(optional)</span>
              <input
                style={styles.input}
                value={form.bio}
                onChange={e => set('bio', e.target.value)}
                placeholder="Tell us about yourself"
              />
            </label>
          )}

          <button style={{ ...styles.btn, opacity: loading ? 0.6 : 1 }} disabled={loading}>
            {loading ? 'Please wait…' : mode === 'login' ? 'Sign in →' : 'Create account →'}
          </button>
        </form>

        <button
          style={styles.switchBtn}
          onClick={() => {
            setMode(m => m === 'login' ? 'register' : 'login')
            setError('')
            setShowPassword(false)
            setShowConfirmPassword(false)
            set('confirmPassword', '')
          }}
        >
          {mode === 'login' ? "Don't have an account? Register" : 'Already have an account? Sign in'}
        </button>
      </div>
    </div>
  )
}

const styles = {
  root: {
    display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
    minHeight: '100vh', background: 'var(--bg-0)', position: 'relative', overflowX: 'hidden', overflowY: 'auto',
    padding: '24px 16px',
  },
  grid: {
    position: 'absolute', inset: 0, pointerEvents: 'none',
    backgroundImage: 'linear-gradient(var(--border) 1px, transparent 1px), linear-gradient(90deg, var(--border) 1px, transparent 1px)',
    backgroundSize: '48px 48px',
    maskImage: 'radial-gradient(ellipse 80% 80% at 50% 50%, black 40%, transparent 100%)',
  },
  card: {
    position: 'relative', zIndex: 1,
    background: 'var(--bg-1)', border: '1px solid var(--border-strong)',
    borderRadius: 'var(--radius-xl)', padding: '40px 44px',
    width: '100%', maxWidth: 420,
    boxShadow: 'var(--shadow-lg), var(--shadow-accent)',
    animation: 'fadeIn 300ms ease both',
    margin: 'auto 0',
  },
  logo: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 28 },
  logoMark: {
    width: 38, height: 38, borderRadius: 10,
    background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 14, color: '#fff',
    letterSpacing: '0.5px',
  },
  logoText: { fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 20, color: 'var(--text-0)', letterSpacing: '-0.5px' },
  tagline: { color: 'var(--text-1)', fontSize: 15, marginBottom: 24 },
  errorBox: {
    background: 'var(--red-dim)', border: '1px solid var(--red)', borderRadius: 'var(--radius-sm)',
    padding: '10px 14px', marginBottom: 16,
  },
  form: { display: 'flex', flexDirection: 'column', gap: 16 },
  label: {
    display: 'flex', flexDirection: 'column', gap: 6,
    fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-1)', letterSpacing: '0.3px',
  },
  input: {
    background: 'var(--bg-2)', border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)', padding: '10px 14px',
    color: 'var(--text-0)', fontSize: 14, outline: 'none', transition: 'border-color var(--transition)',
    fontFamily: 'var(--font-display)',
  },
  passwordWrap: { position: 'relative', display: 'flex', alignItems: 'center' },
  passwordInput: { width: '100%', paddingRight: 40 },
  eyeBtn: {
    position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
    background: 'none', border: 'none', color: 'var(--text-2)', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 2,
  },
  btn: {
    background: 'var(--accent)', color: '#fff',
    border: 'none', borderRadius: 'var(--radius-sm)',
    padding: '12px', fontFamily: 'var(--font-display)',
    fontWeight: 700, fontSize: 14, cursor: 'pointer', marginTop: 8,
    transition: 'background var(--transition), transform var(--transition)',
    letterSpacing: '0.2px',
  },
  switchBtn: {
    marginTop: 20, color: 'var(--text-2)', fontSize: 13,
    background: 'none', border: 'none', cursor: 'pointer',
    fontFamily: 'var(--font-display)', width: '100%', textAlign: 'center',
  },
}
