'use client'

import { useState } from 'react'
import { swapGroupBuySpace } from '@/lib/actions'

// ============================================================
//  团购车位调换
//  - 选择一个团购公司
//  - 选择该公司名下某个「团购锁定」车位（换出）
//  - 选择一个「未售」车位（换入）
//  提交后：换出车位恢复未售，换入车位变更为团购锁定并继承团购公司
// ============================================================

export default function GroupBuyPanel({
  companies,
  company, // 卡片内嵌时可预选
}: {
  companies: any[]
  company?: any
}) {
  const [companyId, setCompanyId] = useState<string>(company ? String(company.company_id) : '')
  const [lockedSpaces, setLockedSpaces] = useState<any[]>([])
  const [fromSpace, setFromSpace] = useState('')
  const [unsold, setUnsold] = useState<any[]>([])
  const [toSpace, setToSpace] = useState('')
  const [toMsg, setToMsg] = useState('') // 换入车位校验提示
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [saving, setSaving] = useState(false)

  async function onCompanyChange(v: string) {
    setCompanyId(v)
    setFromSpace('')
    setToSpace('')
    setLockedSpaces([])
    setUnsold([])
    if (!v) return
    const c = companies.find((x) => String(x.company_id) === v)
    if (!c) return
    try {
      const [lr, ur] = await Promise.all([
        fetch(`/api/group-buy/spaces?company=${encodeURIComponent(c.company_name)}`),
        fetch(`/api/group-buy/spaces`),
      ])
      // 会话过期 / 未登录：后端返回 401，跳转登录页
      if (lr.status === 401 || ur.status === 401) {
        setMsg({ type: 'err', text: '会话已过期，正在跳转登录…' })
        setTimeout(() => { window.location.href = '/login' }, 1000)
        return
      }
      const ld = await lr.json()
      const ud = await ur.json()
      const ls = (ld.spaces || []) as any[]
      const us = (ud.spaces || []) as any[]
      setLockedSpaces(ls.filter((s: any) => s.status === '团购锁定'))
      setUnsold(us)
    } catch (e: any) {
      setMsg({ type: 'err', text: '加载车位失败：' + (e?.message || '请重试') })
    }
  }

  // 换入车位手动输入：实时校验是否为未售车位
  function handleToSpaceChange(v: string) {
    setToSpace(v)
    const key = v.trim()
    if (!key) {
      setToMsg('')
      return
    }
    const sp = unsold.find((s) => s.space_id === key)
    setToMsg(sp ? '' : `车位 ${key} 不是未售车位，无法换入`)
  }

  async function submit() {
    setMsg(null)
    if (!companyId) { setMsg({ type: 'err', text: '请选择团购公司' }); return }
    if (!fromSpace) { setMsg({ type: 'err', text: '请选择要换出的团购锁定车位' }); return }
    if (!toSpace.trim()) { setMsg({ type: 'err', text: '请输入换入的未售车位' }); return }
    if (!unsold.find((s) => s.space_id === toSpace.trim())) {
      setMsg({ type: 'err', text: `车位 ${toSpace.trim()} 不是未售车位，无法换入` }); return
    }
    if (fromSpace === toSpace.trim()) { setMsg({ type: 'err', text: '换出与换入车位不能相同' }); return }
    setSaving(true)
    try {
      await swapGroupBuySpace({ from_space_id: fromSpace, to_space_id: toSpace.trim(), operator: 'admin' })
      setMsg({ type: 'ok', text: `调换成功：${fromSpace} ⇄ ${toSpace}` })
      setTimeout(() => window.location.reload(), 900)
    } catch (e: any) {
      const m = e?.message || ''
      // 网络/会话问题（如会话过期被中间件拦截）前端常表现为 “Failed to fetch”
      if (/Failed to fetch|networkerror|network error|网络/i.test(m)) {
        setMsg({ type: 'err', text: '网络或会话异常，正在跳转登录…' })
        setTimeout(() => { window.location.href = '/login' }, 1200)
      } else {
        setMsg({ type: 'err', text: '❌ ' + m })
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ marginTop: 10, padding: 12, background: '#fafafa', borderRadius: 6 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <label className="text-sm" style={{ display: 'block', marginBottom: 4 }}>团购公司</label>
          <select value={companyId} onChange={(e) => onCompanyChange(e.target.value)} style={sel}>
            <option value="">— 选择团购公司 —</option>
            {companies.map((c) => (
              <option key={c.company_id} value={String(c.company_id)}>{c.company_name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-sm" style={{ display: 'block', marginBottom: 4 }}>换出车位（团购锁定）</label>
          <select value={fromSpace} onChange={(e) => setFromSpace(e.target.value)} style={sel} disabled={!companyId}>
            <option value="">— 选择团购锁定车位 —</option>
            {lockedSpaces.map((s) => (
              <option key={s.space_id} value={s.space_id}>{s.space_id}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-sm" style={{ display: 'block', marginBottom: 4 }}>换入车位（未售，手动输入）</label>
          <input
            value={toSpace}
            onChange={(e) => handleToSpaceChange(e.target.value)}
            list="gb-unsold-spaces"
            style={sel}
            disabled={!companyId}
            placeholder="输入或选择未售车位号"
          />
          <datalist id="gb-unsold-spaces">
            {unsold.map((s) => (
              <option key={s.space_id} value={s.space_id}>{s.space_type || ''}</option>
            ))}
          </datalist>
          {toMsg && (
            <div style={{ marginTop: 4, color: '#ff4d4f', fontSize: 12 }}>{toMsg}</div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end' }}>
          <button className="btn btn-primary" onClick={submit} disabled={saving || !companyId}>
            {saving ? '调换中…' : '执行调换'}
          </button>
        </div>
      </div>
      {msg && (
        <div style={{ marginTop: 8, color: msg.type === 'ok' ? '#52c41a' : '#ff4d4f', fontSize: 13 }}>
          {msg.text}
        </div>
      )}
    </div>
  )
}

const sel: React.CSSProperties = {
  padding: '6px 10px',
  borderRadius: 6,
  border: '1px solid #d9d9d9',
  fontSize: 13,
  background: '#fff',
  width: '100%',
}
