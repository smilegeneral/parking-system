'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import * as XLSX from 'xlsx'
import { cancelInvoice } from '@/lib/actions'
import type { InvoiceRecord } from '@/lib/types'

function shortDate(v: any) {
  if (!v) return '-'
  return String(v).slice(0, 10)
}

const PAGE_SIZES = [20, 50, 100, 200]

// 导出的列：中文表头 + 取值函数
const EXPORT_COLUMNS: { header: string; get: (r: InvoiceRecord) => any }[] = [
  { header: '发票号码', get: r => r.invoice_number || r.invoice_no },
  { header: '车位号', get: r => r.space_no },
  { header: '房号(housekey)', get: r => r.house_key },
  { header: '业主', get: r => r.owner_name },
  { header: '电话', get: r => r.phone },
  { header: '价税合计额(元)', get: r => Number(r.amount || 0) },
  { header: '发票类型', get: r => r.invoice_type },
  { header: '发票代码', get: r => r.invoice_code },
  { header: '开票日期', get: r => shortDate(r.invoice_date) },
  { header: '状态', get: r => r.status },
  { header: '备注', get: r => r.remarks },
  { header: '操作人', get: r => r.operator },
  { header: '登记时间', get: r => r.created_at ? String(r.created_at).slice(0, 19).replace('T', ' ') : '' },
]

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
  const [pageSize, setPageSize] = useState(20)
  const [page, setPage] = useState(1)
  const [busy, setBusy] = useState<number | null>(null)
  const [msg, setMsg] = useState('')

  const filtered = useMemo(() => {
    return records.filter(r => {
      const kw = keyword.trim().toLowerCase()
      const kwOk = !kw || [r.invoice_no, r.space_no, r.house_key, r.owner_name, r.invoice_number, r.invoice_code]
        .some(v => String(v || '').toLowerCase().includes(kw))
      const stOk = status === '全部' || r.status === status
      return kwOk && stOk
    })
  }, [records, keyword, status])

  const total = filtered.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const safePage = Math.min(page, totalPages)
  const pageRows = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)

  function changePageSize(v: number) {
    setPageSize(v)
    setPage(1)
  }
  function changeKeyword(v: string) {
    setKeyword(v)
    setPage(1)
  }
  function changeStatus(v: string) {
    setStatus(v)
    setPage(1)
  }

  function exportExcel() {
    if (!filtered.length) {
      setMsg('没有可导出的数据')
      return
    }
    const aoa: any[][] = [EXPORT_COLUMNS.map(c => c.header)]
    for (const r of filtered) aoa.push(EXPORT_COLUMNS.map(c => c.get(r)))
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    ws['!cols'] = EXPORT_COLUMNS.map(c => ({ wch: Math.max(12, c.header.length * 2) }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '开票登记记录')
    const d = new Date()
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
    XLSX.writeFile(wb, `开票登记记录_${stamp}.xlsx`)
  }

  async function handleCancel(r: InvoiceRecord) {
    if (!window.confirm(`确认作废发票 ${r.invoice_number || r.invoice_no}？\n车位将恢复为「未开票」，业主开票统计同步更新。`)) return
    setBusy(r.invoice_id)
    setMsg('')
    try {
      const res = await cancelInvoice(r.invoice_id)
      if (res?.ok) {
        setMsg(`已作废 ${r.invoice_number || r.invoice_no}`)
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
        <h2 style={{ fontSize: 16, fontWeight: 600 }}>📋 开票登记记录（{total} 条）</h2>
        <div className="flex" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            className="input"
            value={keyword}
            onChange={e => changeKeyword(e.target.value)}
            placeholder="搜索单号/车位/房号/业主/发票号码"
            style={{ width: 260 }}
          />
          <select className="input" value={status} onChange={e => changeStatus(e.target.value)} style={{ width: 110 }}>
            <option value="全部">全部状态</option>
            <option value="已开票">已开票</option>
            <option value="已作废">已作废</option>
          </select>
          <select className="input" value={pageSize} onChange={e => changePageSize(Number(e.target.value))} style={{ width: 110 }}>
            {PAGE_SIZES.map(n => <option key={n} value={n}>每页 {n} 条</option>)}
          </select>
          <button type="button" className="btn-primary" onClick={exportExcel} style={{ padding: '6px 12px', fontSize: 14 }}>
            ⬇️ 导出 Excel
          </button>
        </div>
      </div>

      {!!msg && <div className="text-sm" style={{ color: msg.includes('已作废') ? '#16a34a' : '#dc2626', marginBottom: 8 }}>{msg}</div>}

      {total === 0 ? (
        <p className="text-sm text-gray">暂无开票登记记录</p>
      ) : (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>发票号码</th><th>车位号</th><th>房号</th><th>业主</th>
                  <th>金额(元)</th><th>发票类型</th><th>开票日期</th>
                  <th>状态</th><th>操作人</th><th>登记时间</th>
                  {canCancel && <th>操作</th>}
                </tr>
              </thead>
              <tbody>
                {pageRows.map(r => (
                  <tr key={r.invoice_id}>
                    <td style={{ fontWeight: 600 }}>{r.invoice_number || r.invoice_no || '-'}</td>
                    <td>{r.space_no || '-'}</td>
                    <td>{r.house_key || '-'}</td>
                    <td>{r.owner_name || '-'}</td>
                    <td>¥{Number(r.amount || 0).toLocaleString()}</td>
                    <td>{r.invoice_type || '-'}</td>
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

          <div className="flex" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
            <span className="text-sm text-gray">
              共 {total} 条，第 {safePage} / {totalPages} 页（本页 {pageRows.length} 条）
            </span>
            <div className="flex" style={{ gap: 6, alignItems: 'center' }}>
              <button type="button" className="btn-secondary" disabled={safePage <= 1} onClick={() => setPage(1)}>首页</button>
              <button type="button" className="btn-secondary" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>上一页</button>
              <span className="text-sm" style={{ minWidth: 56, textAlign: 'center' }}>{safePage} / {totalPages}</span>
              <button type="button" className="btn-secondary" disabled={safePage >= totalPages} onClick={() => setPage(safePage + 1)}>下一页</button>
              <button type="button" className="btn-secondary" disabled={safePage >= totalPages} onClick={() => setPage(totalPages)}>末页</button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
