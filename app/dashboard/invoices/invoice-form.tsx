'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { lookupInvoiceableSpaces, registerInvoice } from '@/lib/actions'
import { INVOICE_TYPES, type ParkingSpace } from '@/lib/types'

export default function InvoiceForm({ operator }: { operator: string }) {
  const router = useRouter()

  const [keyword, setKeyword] = useState('')
  const [spaces, setSpaces] = useState<ParkingSpace[]>([])
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState<ParkingSpace | null>(null)

  const [invoiceNo, setInvoiceNo] = useState('')
  const [noError, setNoError] = useState('')
  const [ownerName, setOwnerName] = useState('')
  const [phone, setPhone] = useState('')
  const [amount, setAmount] = useState('')
  const [invoiceType, setInvoiceType] = useState<string>('普票')
  const [invoiceCode, setInvoiceCode] = useState('')
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [invoiceDate, setInvoiceDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [remarks, setRemarks] = useState('')
  const [msg, setMsg] = useState('')
  const [result, setResult] = useState<any>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    fetch('/api/next-invoice-order')
      .then(r => r.json())
      .then(d => { if (d.ok) setInvoiceNo(d.invoice_no) })
      .catch(() => {})
  }, [])

  async function handleSearch() {
    setSearching(true)
    setSpaces([])
    setMsg('')
    try {
      const res = await lookupInvoiceableSpaces(keyword.trim())
      const list = (res as any)?.spaces || []
      setSpaces(list)
      if (list.length === 0) setMsg('未找到待开票车位（仅「已售 / 已核销」且未开票的车位可登记）')
    } catch (e: any) {
      setMsg(e?.message || '查询失败')
    } finally {
      setSearching(false)
    }
  }

  function choose(s: ParkingSpace) {
    setSelected(s)
    setOwnerName(s.owner_name || '')
    setPhone(s.phone || '')
    setAmount(s.price ? String(s.price) : '')
    setMsg('')
    setResult(null)
  }

  async function checkNo() {
    const no = invoiceNo.trim()
    if (!no) return
    try {
      const r = await fetch(`/api/check-invoice-order?no=${encodeURIComponent(no)}`)
      const d = await r.json()
      setNoError(d.exists ? '该单号已存在，请更换' : '')
    } catch {
      setNoError('')
    }
  }

  async function handleSubmit() {
    if (!selected) { setMsg('请先选择车位'); return }
    if (!invoiceNo.trim()) { setMsg('请填写发票登记单号'); return }
    if (noError) { setMsg(noError); return }
    if (!Number(amount)) { setMsg('请填写有效的开票金额'); return }

    setSubmitting(true)
    setMsg('')
    setResult(null)
    try {
      const res = await registerInvoice({
        invoice_no: invoiceNo.trim(),
        space_id: selected.space_id,
        house_key: selected.house_key || '',
        owner_name: ownerName.trim(),
        phone: phone.trim(),
        amount: Number(amount),
        invoice_type: invoiceType,
        invoice_code: invoiceCode.trim(),
        invoice_number: invoiceNumber.trim(),
        invoice_date: invoiceDate,
        remarks: remarks.trim(),
        operator,
      })
      if (res?.ok) {
        setResult(res)
        setSelected(null)
        setSpaces([])
        setInvoiceNumber('')
        setRemarks('')
        fetch('/api/next-invoice-order')
          .then(r => r.json())
          .then(d => { if (d.ok) setInvoiceNo(d.invoice_no) })
          .catch(() => {})
        router.refresh()
      } else {
        setMsg('登记失败')
      }
    } catch (e: any) {
      setMsg(e?.message || '登记失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div>
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>📝 发票登记</h2>

      {/* 1. 搜索车位 */}
      <div className="flex" style={{ gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <label style={{ fontSize: 14, color: '#555', flex: '1 1 280px' }}>
          车位号 / 房号 / 业主（待开票车位）
          <div style={{ marginTop: 4 }}>
            <input
              className="input"
              value={keyword}
              onChange={e => setKeyword(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSearch() }}
              placeholder="如 A-001 / 1-1-101 / 张三（留空列出全部）"
            />
          </div>
        </label>
        <button type="button" className="btn-primary" onClick={handleSearch} disabled={searching}>
          {searching ? '查询中...' : '🔍 查询待开票车位'}
        </button>
      </div>

      {spaces.length > 0 && (
        <div style={{ overflowX: 'auto', marginTop: 12 }}>
          <table>
            <thead>
              <tr>
                <th>车位号</th><th>区域</th><th>房号</th><th>业主</th><th>价格(元)</th><th>操作</th>
              </tr>
            </thead>
            <tbody>
              {spaces.map(s => (
                <tr key={s.space_id}>
                  <td style={{ fontWeight: 600 }}>{s.space_id}</td>
                  <td>{s.garage_zone || '-'}</td>
                  <td>{s.house_key || '-'}</td>
                  <td>{s.owner_name || '-'}</td>
                  <td>¥{Number(s.price || 0).toLocaleString()}</td>
                  <td>
                    <button type="button" className="btn-primary" style={{ padding: '4px 10px', fontSize: 13 }}
                      onClick={() => choose(s)}>选择</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 2. 登记表 */}
      {selected && (
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid #eee' }}>
          <div style={{ marginBottom: 12, padding: '8px 12px', background: '#f6ffed', borderRadius: 6, border: '1px solid #b7eb8f', fontSize: 14 }}>
            已选车位：<b>{selected.space_id}</b>（{selected.status}）· 房号 {selected.house_key || '-'} · 业主 {selected.owner_name || '-'} · 金额 ¥{Number(selected.price || 0).toLocaleString()}
            <button type="button" className="btn-ghost" style={{ fontSize: 13, marginLeft: 8 }}
              onClick={() => { setSelected(null); setResult(null) }}>取消选择</button>
          </div>

          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            <label style={{ fontSize: 14, color: '#555' }}>
              发票登记单号
              <div style={{ marginTop: 4 }}>
                <input className="input" value={invoiceNo} onChange={e => { setInvoiceNo(e.target.value); setNoError('') }} onBlur={checkNo} />
              </div>
              {noError && <span className="text-red" style={{ fontSize: 12 }}>{noError}</span>}
            </label>
            <label style={{ fontSize: 14, color: '#555' }}>
              开票日期
              <div style={{ marginTop: 4 }}>
                <input type="date" className="input" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} />
              </div>
            </label>
            <label style={{ fontSize: 14, color: '#555' }}>
              业主姓名
              <div style={{ marginTop: 4 }}><input className="input" value={ownerName} onChange={e => setOwnerName(e.target.value)} /></div>
            </label>
            <label style={{ fontSize: 14, color: '#555' }}>
              联系电话
              <div style={{ marginTop: 4 }}><input className="input" value={phone} onChange={e => setPhone(e.target.value)} /></div>
            </label>
            <label style={{ fontSize: 14, color: '#555' }}>
              开票金额（元）
              <div style={{ marginTop: 4 }}>
                <input type="number" step="0.01" className="input" value={amount} onChange={e => setAmount(e.target.value)} />
              </div>
            </label>
            <label style={{ fontSize: 14, color: '#555' }}>
              发票类型
              <div style={{ marginTop: 4 }}>
                <select className="input" value={invoiceType} onChange={e => setInvoiceType(e.target.value)}>
                  {INVOICE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </label>
            <label style={{ fontSize: 14, color: '#555' }}>
              发票代码（选填）
              <div style={{ marginTop: 4 }}><input className="input" value={invoiceCode} onChange={e => setInvoiceCode(e.target.value)} /></div>
            </label>
            <label style={{ fontSize: 14, color: '#555' }}>
              发票号码（选填）
              <div style={{ marginTop: 4 }}><input className="input" value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} /></div>
            </label>
            <label style={{ fontSize: 14, color: '#555', flex: '1 1 100%' }}>
              备注
              <div style={{ marginTop: 4 }}><input className="input" value={remarks} onChange={e => setRemarks(e.target.value)} placeholder="选填" /></div>
            </label>
          </div>

          <div className="flex" style={{ gap: 8, marginTop: 14, alignItems: 'center' }}>
            <button type="button" className="btn-primary" onClick={handleSubmit} disabled={submitting}>
              {submitting ? '提交中...' : '✅ 确认开票登记'}
            </button>
            {!!msg && <span className="text-red" style={{ fontSize: 14, fontWeight: 500 }}>⚠️ {msg}</span>}
          </div>
        </div>
      )}

      {!selected && !!msg && <div className="text-red" style={{ marginTop: 10, fontSize: 14 }}>⚠️ {msg}</div>}

      {/* 3. 登记成功回执（可打印） */}
      {result && (
        <div className="print-area no-print-card" style={{ marginTop: 16, padding: 16, borderRadius: 8, background: '#f0fdf4', border: '1px solid #86efac' }}>
          <div className="flex" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: '#15803d' }}>✅ 开票登记成功</h3>
            <button type="button" className="btn-ghost" style={{ fontSize: 13 }} onClick={() => window.print()}>🖨️ 打印回执</button>
          </div>
          <div style={{ marginTop: 8, fontSize: 14, lineHeight: 1.9 }}>
            <div>登记单号：<b>{result.invoice_no}</b>　车位：<b>{result.space_id}</b></div>
            <div>房号：{result.house_key || '-'}　业主：{result.owner_name}　电话：{result.phone || '-'}</div>
            <div>开票金额：<b>¥{Number(result.amount || 0).toLocaleString()}</b>　发票类型：{result.invoice_type}</div>
            <div>发票代码：{result.invoice_code || '-'}　发票号码：{result.invoice_number || '-'}　开票日期：{result.invoice_date}</div>
            <div>操作人：{result.operator || operator || '-'}　备注：{result.remarks || '-'}</div>
          </div>
        </div>
      )}
    </div>
  )
}
