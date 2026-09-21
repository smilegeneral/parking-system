'use client'
import { signIn } from 'next-auth/react'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const router = useRouter()
  const [step, setStep] = useState<'password' | 'code'>('password')
  const [username, setUsername] = useState('guest')
  const [password, setPassword] = useState('111111')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [resendIn, setResendIn] = useState(0)

  function startCountdown() {
    setResendIn(60)
    const t = setInterval(() => {
      setResendIn((s) => {
        if (s <= 1) { clearInterval(t); return 0 }
        return s - 1
      })
    }, 1000)
  }

  async function requestCode() {
    setLoading(true)
    setError('')
    try {
      const r = await fetch('/api/auth/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      // 先取原始文本，避免后端返回非 JSON（如 404/崩溃页）时 r.json() 抛错被误判为“网络错误”
      const text = await r.text()
      let data: any = {}
      try {
        data = JSON.parse(text)
      } catch {
        setError('服务异常（HTTP ' + r.status + '）：' + text.slice(0, 200))
        return false
      }
      if (!data.ok) {
        setError(data.error || '请求失败（HTTP ' + r.status + '），请重试')
        return false
      }
      if (data.twoFactor) {
        setStep('code')
        startCountdown()
      } else {
        // 未绑定邮箱：直接密码登录
        await doSignIn('')
      }
      return true
    } catch {
      setError('网络错误，请重试')
      return false
    } finally {
      setLoading(false)
    }
  }

  async function doSignIn(otp: string) {
    setLoading(true)
    setError('')
    try {
      const res = await signIn('credentials', {
        username,
        password,
        code: otp || undefined,
        redirect: false,
      })
      if (res?.error) {
        setError(otp ? '验证码错误或已过期，请重新获取' : '账号或密码错误')
        return
      }
      // 登录成功：标记本标签页为活跃，避免 SessionGuard 立即把刚登录的会话踢出
      sessionStorage.setItem('parking_active_session', '1')
      if (username.trim() === 'guest') {
        router.push('/dashboard/distribution')
      } else {
        router.push('/dashboard')
      }
      router.refresh()
    } catch (e: any) {
      setError('登录服务异常：' + (e?.message || e))
    } finally {
      setLoading(false)
    }
  }

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!username.trim() || !password) {
      setError('请输入账号和密码')
      return
    }
    await requestCode()
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!code.trim()) {
      setError('请输入验证码')
      return
    }
    await doSignIn(code.trim())
  }

  async function resend() {
    if (resendIn > 0) return
    setError('')
    setLoading(true)
    try {
      const r = await fetch('/api/auth/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      const data = await r.json()
      if (data.ok && data.twoFactor) {
        startCountdown()
        setError('验证码已重新发送，请查收邮箱')
      } else if (!data.ok) {
        setError(data.error || '发送失败')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center',
      justifyContent: 'center', background: 'linear-gradient(135deg,#1677ff22,#52c41a22)',
    }}>
      <div className="card" style={{ width: 380 }}>
        <div className="text-center mb-4">
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>🅿️ 车位管理系统</h1>
          <p className="text-sm text-gray mt-2">开发商内部管理平台</p>
        </div>

        {step === 'password' ? (
          <form onSubmit={submitPassword}>
            <div className="mb-4">
              <label className="text-sm">账号</label>
              <input className="input mt-2" value={username} onChange={e => setUsername(e.target.value)} placeholder="请输入账号" autoComplete="off" required />
            </div>
            <div className="mb-4">
              <label className="text-sm">密码</label>
              <input className="input mt-2" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="请输入密码" autoComplete="current-password" required />
            </div>
            {error && <div className="text-red text-sm mb-2">{error}</div>}
            <button type="submit" className="btn-primary" style={{ width: '100%', padding: '10px', fontSize: 15 }} disabled={loading}>
              {loading ? '验证中...' : '下一步'}
            </button>
          </form>
        ) : (
          <form onSubmit={submitCode}>
            <div className="mb-2 text-sm text-gray">已向绑定邮箱发送 6 位验证码，请查收。</div>
            <div className="mb-4">
              <label className="text-sm">邮箱验证码</label>
              <input className="input mt-2" value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="请输入 6 位验证码" inputMode="numeric" autoFocus required />
            </div>
            {error && <div className="text-red text-sm mb-2">{error}</div>}
            <button type="submit" className="btn-primary" style={{ width: '100%', padding: '10px', fontSize: 15 }} disabled={loading}>
              {loading ? '登录中...' : '登 录'}
            </button>
            <div className="flex mt-3" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <button type="button" className="btn-ghost text-sm" onClick={() => { setStep('password'); setCode(''); setError('') }}>← 返回</button>
              <button type="button" className="btn-ghost text-sm" onClick={resend} disabled={resendIn > 0}>
                {resendIn > 0 ? `${resendIn}s 后可重发` : '重新发送验证码'}
              </button>
            </div>
          </form>
        )}

        <p className="text-xs text-gray text-center mt-4">
          访客账号可直接登录查看车位分布图（guest / 111111）<br />
          已绑定邮箱的账号需通过邮箱验证码二次验证
        </p>
      </div>
    </div>
  )
}
