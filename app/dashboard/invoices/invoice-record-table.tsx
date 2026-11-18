'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { cancelInvoice } from '@/lib/actions'
import type { InvoiceRecord } from '@/lib/types'

function shortDate(v: any) {
  if (!v) return '-'
  return String(v).slice(0, 10)
}

export default function InvoiceRecordTable({
  records,
  canCancel,
}: {
  records: InvoiceRecord[]
  canCancel: boolean
}) {
  const router = useRouter()
  const [keyword, setKeyword] = useState('')
  const [status, setStatus] = useState('全部')
  const [busy, setBusy] = useState<number | null>(null)
  const [msg, setMsg] = useState('')

  const filtered = records.filter(r => {
    const kw = keyword.trim().toLowerCase()
    const kwOk = !kw || [r.invoice_no, r.space_no, r.house_key, r.owner_name, r.invoice_number, r.invoice_code]
      .some(v => String(v || '').toLowerCase().includes(kw))
    const stOk = status === '全部' || r.status === status
    return kwOk && stOk
  })

  async function handleCancel(r: InvoiceRecord) {
    if (!window.confirm(`确认作废登记单 ${r.invoice_no}？\n车位将恢复为「未开票」，业主开票统计同步更新。`)) return
    setBusy(r.invoice_id)
    setMsg('')
    try {
      const res = await cancelInvoice(r.invoice_id)
      if (res?.ok) {
        setMsg(`已作废 ${r.invoice_no}`)
        router.refresh()
      } else {
        setMsg('作废失败')
      }
    } catch (e: any) {
      setMsg(e?.message || '作废失败')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div>
      <div className="flex mb-4" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600 }}>📋 开票登记记录（{filtered.length} 条）</h2>
        <div className="flex" style={{ gap: 8, flexWrap: 'wrap' }}>
          <input
            className="input"
            value={keyword}
            onChange={e => setKeyword(e.target.value)}
            placeholder="搜索单号/车位/房号/业主/发票号码"
            style={{ width: 260 }}
          />
          <select className="input" value={status} onChange={e => setStatus(e.target.value)} style={{ width: 110 }}>
            <option value="全部">全部状态</option>
            <option value="已开票">已开票</option>
            <option value="已作废">已作废</option>
          </select>
        </div>
      </div>

      {!!msg && <div className="text-sm" style={{ color: msg.includes('已作废') ? '#16a34a' : '#dc2626', marginBottom: 8 }}>{msg}</div>}

      {filtered.length === 0 ? (
        <p className="text-sm text-gray">暂无开票登记记录</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>登记单号</th><th>车位号</th><th>房号</th><th>业主</th>
                <th>金额(元)</th><th>发票类型</th><th>发票号码</th><th>开票日期</th>
                <th>状态</th><th>操作人</th><th>登记时间</th>
                {canCancel && <th>操作</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.invoice_id}>
                  <td style={{ fontWeight: 600 }}>{r.invoice_no}</td>
                  <td>{r.space_no || '-'}</td>
                  <td>{r.house_key || '-'}</td>
                  <td>{r.owner_name || '-'}</td>
                  <td>¥{Number(r.amount || 0).toLocaleString()}</td>
                  <td>{r.invoice_type || '-'}</td>
                  <td>{r.invoice_number || '-'}</td>
                  <td>{shortDate(r.invoice_date)}</td>
                  <td>
                    <span className={`badge ${r.status === '已开票' ? 'badge-green' : 'badge-red'}`}>
                      {r.status}
                    </span>
                  </td>
                  <td>{r.operator || '-'}</td>
                  <td>{shortDate(r.created_at)}</td>
                  {canCancel && (
                    <td>
                      {r.status === '已开票' ? (
                        <button
                          type="button"
                          className="btn-danger"
                          style={{ padding: '4px 10px', fontSize: 13 }}
                          disabled={busy === r.invoice_id}
                          onClick={() => handleCancel(r)}
                        >
                          {busy === r.invoice_id ? '处理中...' : '作废'}
                        </button>
                      ) : <span className="text-sm text-gray">—</span>}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
