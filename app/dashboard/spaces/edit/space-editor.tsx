'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { fetchUnsoldSpaces, updateUnsoldSpace, batchUpdateUnsoldSpaces } from '@/lib/actions'
import type { ParkingSpace } from '@/lib/types'

const DEFAULT_TYPES = ['普通车位', '标准车位', '子母车位', '微型车位']

export default function SpaceEditor({ operator }: { operator: string }) {
  const router = useRouter()
  const [tab, setTab] = useState<'single' | 'batch'>('single')
  const [spaces, setSpaces] = useState<ParkingSpace[]>([])
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')
  const [msgOk, setMsgOk] = useState(false)

  // 单个修改
  const [keyword, setKeyword] = useState('')
  const [selSpace, setSelSpace] = useState('')
  const [newPrice, setNewPrice] = useState('')
  const [newType, setNewType] = useState('')

  // 批量修改
  const [sourceType, setSourceType] = useState('')
  const [batchPrice, setBatchPrice] = useState('')
  const [batchType, setBatchType] = useState('')

  async function loadSpaces() {
    setLoading(true)
    try {
      const data = await fetchUnsoldSpaces()
      setSpaces(Array.isArray(data) ? data : [])
    } catch (e: any) { setMsg(e?.message || '加载失败'); setMsgOk(false) }
    finally { setLoading(false) }
  }
  useEffect(() => { loadSpaces() }, [])

  const typeOptions = useMemo(() => {
    const set = new Set<string>(DEFAULT_TYPES)
    spaces.forEach(s => { if (s.space_type) set.add(s.space_type) })
    return Array.from(set)
  }, [spaces])

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    if (!kw) return spaces
    return spaces.filter(s => [s.space_id, s.space_num, s.garage_zone, s.space_type]
      .some(v => String(v || '').toLowerCase().includes(kw)))
  }, [spaces, keyword])

  const current = spaces.find(s => s.space_id === selSpace)

  function pickSpace(s: ParkingSpace) {
    setSelSpace(s.space_id)
    setNewPrice(s.price != null ? String(s.price) : '')
    setNewType(s.space_type || '')
    setMsg('')
  }

  async function handleSingle() {
    if (!selSpace) { setMsg('请选择一个车位'); setMsgOk(false); return }
    if (newPrice.trim() === '' && newType.trim() === '') { setMsg('请填写新价格或新类型'); setMsgOk(false); return }
    const price = newPrice.trim() === '' ? null : Number(newPrice)
    if (price != null && (!Number.isFinite(price) || price < 0)) { setMsg('价格无效'); setMsgOk(false); return }
    setLoading(true); setMsg('')
    try {
      const res = await updateUnsoldSpace({ space_id: selSpace, price, space_type: newType.trim(), operator })
      if (res?.ok) {
        setMsg(`已修改 ${selSpace}`); setMsgOk(true)
        await loadSpaces(); router.refresh()
      } else { setMsg('修改失败'); setMsgOk(false) }
    } catch (e: any) { setMsg(e?.message || '修改失败'); setMsgOk(false) }
    finally { setLoading(false) }
  }

  async function handleBatch() {
    if (!sourceType) { setMsg('请选择来源车位类型'); setMsgOk(false); return }
    if (batchPrice.trim() === '' && batchType.trim() === '') { setMsg('请填写新价格或新类型'); setMsgOk(false); return }
    const price = batchPrice.trim() === '' ? null : Number(batchPrice)
    if (price != null && (!Number.isFinite(price) || price < 0)) { setMsg('价格无效'); setMsgOk(false); return }
    if (!window.confirm(`确认将类型为「${sourceType}」的所有未售车位${
      batchPrice.trim() !== '' ? `价格改为 ${batchPrice}` : ''
    }${batchType.trim() ? `、类型改为「${batchType.trim()}」` : ''}？`)) return
    setLoading(true); setMsg('')
    try {
      const res = await batchUpdateUnsoldSpaces({ sourceType, newPrice: price, newType: batchType.trim(), operator })
      if (res?.ok) {
        setMsg(`批量修改完成，共 ${res.updated} 个车位${res.message ? '（' + res.message + '）' : ''}`); setMsgOk(true)
        await loadSpaces(); router.refresh()
      } else { setMsg('批量修改失败'); setMsgOk(false) }
    } catch (e: any) { setMsg(e?.message || '批量修改失败'); setMsgOk(false) }
    finally { setLoading(false) }
  }

  const input: React.CSSProperties = { padding: '6px 8px', border: '1px solid #d9d9d9', borderRadius: 6, fontSize: 14 }
  const label: React.CSSProperties = { fontSize: 14, color: '#555', display: 'flex', flexDirection: 'column', gap: 4 }

  return (
    <main style={{ maxWidth: 1000, margin: '0 auto', padding: '24px' }}>
      <header style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>✏️ 未售车位修改</h1>
        <p className="text-sm text-gray" style={{ marginTop: 6 }}>
          仅可修改「未售」车位的价格与类型；所有变更自动记入台账变更日志。已售/预订/取消车位不可修改。
        </p>
      </header>

      <div className="flex" style={{ gap: 8, marginBottom: 16 }}>
        <button className={tab === 'single' ? 'btn-primary' : 'btn-ghost'} onClick={() => { setTab('single'); setMsg('') }}>单个修改</button>
        <button className={tab === 'batch' ? 'btn-primary' : 'btn-ghost'} onClick={() => { setTab('batch'); setMsg('') }}>按类型批量修改</button>
        <button className="btn-ghost" onClick={loadSpaces} disabled={loading}>🔄 重新加载</button>
        <span className="text-sm text-gray" style={{ alignSelf: 'center' }}>未售车位 {spaces.length} 个</span>
      </div>

      {!!msg && <div style={{ marginBottom: 12, fontSize: 14, color: msgOk ? '#16a34a' : '#dc2626' }}>{msg}</div>}

      {tab === 'single' ? (
        <section className="card" style={{ padding: 16 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>选择车位</h2>
          <input className="input" value={keyword} onChange={e => setKeyword(e.target.value)}
            placeholder="搜索车位号 / 数字编号 / 分区 / 类型" style={{ width: 320, marginBottom: 10 }} />
          <div style={{ maxHeight: 180, overflowY: 'auto', border: '1px solid #eee', borderRadius: 6, marginBottom: 14 }}>
            {loading && <p className="text-sm text-gray" style={{ padding: 8 }}>加载中...</p>}
            {!loading && filtered.length === 0 && <p className="text-sm text-gray" style={{ padding: 8 }}>无匹配车位</p>}
            {filtered.slice(0, 200).map(s => (
              <button key={s.space_id} type="button" onClick={() => pickSpace(s)}
                style={{
                  display: 'inline-block', margin: 4, padding: '4px 9px', fontSize: 13, cursor: 'pointer',
                  border: '1px solid ' + (selSpace === s.space_id ? '#2563eb' : '#d9d9d9'),
                  borderRadius: 5, background: selSpace === s.space_id ? '#eff6ff' : '#fff',
                }}>
                {s.space_id} <span className="text-gray">¥{s.price ?? '-'} · {s.space_type || '-'}</span>
              </button>
            ))}
          </div>

          {current && (
            <div style={{ borderTop: '1px solid #eee', paddingTop: 14 }}>
              <p style={{ fontSize: 14, marginBottom: 10 }}>
                当前：<strong>{current.space_id}</strong>（{current.garage_zone}） · 原价 ¥{current.price ?? '-'} · 类型 {current.space_type || '-'}
              </p>
              <div className="flex" style={{ gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <label style={label}>新价格（留空不改）
                  <input style={{ ...input, width: 160 }} type="number" min="0" step="0.01" value={newPrice}
                    onChange={e => setNewPrice(e.target.value)} placeholder="如 128000" />
                </label>
                <label style={label}>新类型（留空不改）
                  <select style={{ ...input, width: 160 }} value={newType} onChange={e => setNewType(e.target.value)}>
                    <option value="">— 不改 —</option>
                    {typeOptions.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </label>
                <button className="btn-primary" onClick={handleSingle} disabled={loading} style={{ height: 34 }}>
                  {loading ? '处理中...' : '保存修改'}
                </button>
              </div>
              <p className="text-sm text-gray" style={{ marginTop: 8 }}>
                提示：新类型也可直接选择已有类型；如需全新类型，请先在下拉中选择最接近的类型。
              </p>
            </div>
          )}
        </section>
      ) : (
        <section className="card" style={{ padding: 16 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>按当前车位类型批量修改</h2>
          <div className="flex" style={{ gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label style={label}>来源类型（未售）
              <select style={{ ...input, width: 180 }} value={sourceType} onChange={e => setSourceType(e.target.value)}>
                <option value="">— 请选择 —</option>
                {typeOptions.map(t => <option key={t} value={t}>{t}（{spaces.filter(s => s.space_type === t).length} 个）</option>)}
              </select>
            </label>
            <label style={label}>统一改为新价格（留空不改）
              <input style={{ ...input, width: 160 }} type="number" min="0" step="0.01" value={batchPrice}
                onChange={e => setBatchPrice(e.target.value)} placeholder="如 128000" />
            </label>
            <label style={label}>统一改为新类型（留空不改）
              <select style={{ ...input, width: 160 }} value={batchType} onChange={e => setBatchType(e.target.value)}>
                <option value="">— 不改 —</option>
                {typeOptions.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <button className="btn-primary" onClick={handleBatch} disabled={loading} style={{ height: 34 }}>
              {loading ? '处理中...' : '批量修改'}
            </button>
          </div>
          <p className="text-sm text-gray" style={{ marginTop: 12 }}>
            将把「来源类型」的全部未售车位统一改价 / 改类型；每项变更都会单独记入台账日志，可追溯。
          </p>
        </section>
      )}
    </main>
  )
}
