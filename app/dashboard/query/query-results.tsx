'use client'

import { useMemo, useState } from 'react'
import type { ParkingSpace } from '@/lib/types'

type PageSize = number | 'all'

const PAGE_SIZES: { label: string; value: PageSize }[] = [
  { label: '全部', value: 'all' },
  { label: '10', value: 10 },
  { label: '20', value: 20 },
  { label: '50', value: 50 },
  { label: '100', value: 100 },
]

function statusBadge(status: string) {
  const cls =
    status === '已售' ? 'badge-blue' :
    status === '预订' ? 'badge-yellow' :
    status === '团购锁定' ? 'badge-orange' :
    status === '已核销' ? 'badge-red' : 'badge-gray'
  return <span className={`badge ${cls}`}>{status}</span>
}

export default function QueryResults({ rows }: { rows: ParkingSpace[] }) {
  const [pageSize, setPageSize] = useState<PageSize>('all')
  const [page, setPage] = useState(1)

  const total = rows.length
  const size = pageSize === 'all' ? total : pageSize
  const totalPages = pageSize === 'all' ? 1 : Math.max(1, Math.ceil(total / size))
  const currentPage = Math.min(page, totalPages)
  const start = pageSize === 'all' ? 0 : (currentPage - 1) * size
  const pageRows = pageSize === 'all' ? rows : rows.slice(start, start + size)
  const totalAmount = useMemo(
    () => rows.reduce((s, r) => s + Number(r.price || 0), 0),
    [rows]
  )

  function changePageSize(v: PageSize) {
    setPageSize(v)
    setPage(1)
  }

  return (
    <>
      {/* 分页控制条 */}
      <div className="query-no-print flex mb-2" style={{ gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <label className="text-sm" style={{ color: '#555' }}>
          每页显示
          <select
            className="select"
            style={{ marginLeft: 6 }}
            value={String(pageSize)}
            onChange={e => changePageSize(e.target.value === 'all' ? 'all' : Number(e.target.value))}
          >
            {PAGE_SIZES.map(o => (
              <option key={String(o.value)} value={String(o.value)}>{o.label}</option>
            ))}
          </select>
          条
        </label>

        {pageSize !== 'all' && (
          <div className="flex" style={{ gap: 8, alignItems: 'center' }}>
            <button
              type="button"
              className="btn-ghost"
              style={{ fontSize: 13, padding: '4px 10px' }}
              disabled={currentPage <= 1}
              onClick={() => setPage(p => Math.max(1, p - 1))}
            >上一页</button>
            <span className="text-sm text-gray">第 {currentPage} / {totalPages} 页</span>
            <button
              type="button"
              className="btn-ghost"
              style={{ fontSize: 13, padding: '4px 10px' }}
              disabled={currentPage >= totalPages}
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            >下一页</button>
          </div>
        )}

        <span className="text-sm text-gray">共 {total} 条（导出为全部符合条件的记录）</span>
      </div>

      <section className="card print-area" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>车位号</th><th>区域</th><th>楼栋</th><th>类型</th>
                <th>状态</th><th>业主</th><th>电话</th><th>房屋</th><th>价格</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.length === 0 && (
                <tr><td colSpan={9} className="text-center text-gray">无匹配结果</td></tr>
              )}
              {pageRows.map(s => (
                <tr key={s.space_id}>
                  <td style={{ fontWeight: 600 }}>{s.space_id}</td>
                  <td>{s.garage_zone}</td>
                  <td>{s.building_no}</td>
                  <td>{s.space_type}</td>
                  <td>{statusBadge(s.status)}</td>
                  <td>{s.owner_name || '-'}</td>
                  <td>{s.phone || '-'}</td>
                  <td>{s.house_key || '-'}</td>
                  <td>{s.price ? '¥' + Number(s.price).toLocaleString() : '-'}</td>
                </tr>
              ))}
            </tbody>
            {total > 0 && (
              <tfoot>
                <tr style={{ fontWeight: 700, background: '#fafafa' }}>
                  <td colSpan={8}>合计（{total} 个车位）</td>
                  <td style={{ color: '#fa8c16' }}>¥{totalAmount.toLocaleString()}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </section>
    </>
  )
}
