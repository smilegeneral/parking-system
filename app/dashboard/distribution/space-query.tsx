'use client'

import { useState } from 'react'
import type { ParkingSpace } from '@/lib/types'
import { querySpacesByNum } from './actions'

const STATUS_COLOR: Record<string, string> = {
  '未售': '#16a34a',
  '预订': '#ca8a04',
  '已售': '#6b7280',
  '团购锁定': '#7c3aed',
  '已核销': '#2563eb',
  '零售锁定': '#ea580c',
  '取消': '#dc2626',
}

export default function SpaceQuery() {
  const [keyword, setKeyword] = useState('')
  const [rows, setRows] = useState<ParkingSpace[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)

  async function doSearch() {
    const kw = keyword.trim()
    if (!kw) return
    setLoading(true)
    setSearched(true)
    try {
      const data = await querySpacesByNum(kw)
      setRows(Array.isArray(data) ? data : [])
    } catch {
      setRows([])
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="card" style={{ padding: 16, marginBottom: 20 }}>
      <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 10 }}>🔍 车位查询</h2>
      <div className="flex" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          type="text"
          value={keyword}
          onChange={e => setKeyword(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') doSearch() }}
          placeholder="输入车位号，如 1028 或 D1-1028"
          style={{ flex: '1 1 260px', minWidth: 220, padding: '6px 10px', border: '1px solid #d9d9d9', borderRadius: 6, fontSize: 14 }}
        />
        <button type="button" className="btn-primary" style={{ padding: '6px 16px' }} onClick={doSearch} disabled={loading || !keyword.trim()}>
          {loading ? '查询中...' : '查询'}
        </button>
        {searched && <span className="text-gray" style={{ fontSize: 13 }}>找到 {rows.length} 个车位</span>}
      </div>
      {searched && (
        <div style={{ marginTop: 12 }}>
          {rows.length === 0 ? (
            <p className="text-sm text-gray">{loading ? '正在查询...' : '未找到匹配的车位'}</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th style={{ fontSize: 14, textAlign: 'left' }}>车位号</th>
                    <th style={{ fontSize: 14, textAlign: 'left' }}>区域</th>
                    <th style={{ fontSize: 14, textAlign: 'left' }}>状态</th>
                    <th style={{ fontSize: 14, textAlign: 'left' }}>车位类型</th>
                    <th style={{ fontSize: 14, textAlign: 'left' }}>价格(元)</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(s => (
                    <tr key={s.space_id}>
                      <td style={{ fontSize: 14 }}>{s.space_id}</td>
                      <td style={{ fontSize: 14 }}>{s.garage_zone || '-'}</td>
                      <td style={{ fontSize: 14, color: STATUS_COLOR[s.status] || '#374151', fontWeight: 600 }}>{s.status}</td>
                      <td style={{ fontSize: 14 }}>{s.space_type || '-'}</td>
                      <td style={{ fontSize: 14 }}>{s.status === '未售' && s.price != null ? '¥' + Number(s.price).toLocaleString() : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
