'use client'

import { useState } from 'react'
import type { ParkingSpace } from '@/lib/types'
import { ZONE_BASEMAP } from '@/lib/types'
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

// 是否具备定位条件：有坐标且该区有底图
function canLocate(s: ParkingSpace): boolean {
  return s.pos_x != null && s.pos_y != null && !!ZONE_BASEMAP[s.garage_zone]
}

export default function SpaceQuery() {
  const [keyword, setKeyword] = useState('')
  const [rows, setRows] = useState<ParkingSpace[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [loc, setLoc] = useState<ParkingSpace | null>(null)
  const [zoom, setZoom] = useState(3)

  async function doSearch() {
    const kw = keyword.trim()
    if (!kw) return
    setLoading(true)
    setSearched(true)
    setLoc(null)
    try {
      const data = await querySpacesByNum(kw)
      setRows(Array.isArray(data) ? data : [])
      // 若只有一个结果且有坐标，自动展示其局部图
      const list = Array.isArray(data) ? data : []
      if (list.length === 1 && canLocate(list[0])) setLoc(list[0])
    } catch {
      setRows([])
    } finally {
      setLoading(false)
    }
  }

  const baseUrl = loc ? ZONE_BASEMAP[loc.garage_zone] : null
  const px = loc ? Number(loc.pos_x) : 0
  const py = loc ? Number(loc.pos_y) : 0

  return (
    <section className="card dist-query" style={{ padding: 16, marginBottom: 20 }}>
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
                    <th style={{ fontSize: 14, textAlign: 'left' }}>位置</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(s => (
                    <tr key={s.space_id} style={loc?.space_id === s.space_id ? { background: '#e6f4ff' } : undefined}>
                      <td style={{ fontSize: 14 }}>{s.space_id}</td>
                      <td style={{ fontSize: 14 }}>{s.garage_zone || '-'}</td>
                      <td style={{ fontSize: 14, color: STATUS_COLOR[s.status] || '#374151', fontWeight: 600 }}>{s.status}</td>
                      <td style={{ fontSize: 14 }}>{s.space_type || '-'}</td>
                      <td style={{ fontSize: 14 }}>{s.status === '未售' && s.price != null ? '¥' + Number(s.price).toLocaleString() : '-'}</td>
                      <td style={{ fontSize: 14 }}>
                        {canLocate(s) ? (
                          <button
                            type="button"
                            className="btn-ghost"
                            style={{ padding: '2px 8px', fontSize: 12 }}
                            onClick={() => setLoc(s)}
                          >
                            📍查看位置
                          </button>
                        ) : (
                          <span className="text-gray" style={{ fontSize: 12 }}>未标注</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* 局部车位图：以目标车位坐标为中心放大底图，红点标注位置 */}
          {loc && baseUrl && (
            <div style={{ marginTop: 14, padding: 12, border: '1px solid #d9d9d9', borderRadius: 8, background: '#fafafa' }}>
              <div className="flex" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                <strong style={{ fontSize: 14 }}>
                  📍 {loc.space_id} 局部位置（{loc.garage_zone}）
                </strong>
                <div className="flex" style={{ gap: 6, alignItems: 'center', fontSize: 13 }}>
                  <button type="button" className="btn-ghost" style={{ padding: '2px 9px' }} onClick={() => setZoom(z => Math.max(2, z - 1))}>－</button>
                  <span style={{ minWidth: 40, textAlign: 'center' }}>{zoom}x</span>
                  <button type="button" className="btn-ghost" style={{ padding: '2px 9px' }} onClick={() => setZoom(z => Math.min(6, z + 1))}>＋</button>
                  <button type="button" className="btn-ghost" style={{ padding: '2px 9px' }} onClick={() => setLoc(null)}>关闭 ✕</button>
                </div>
              </div>
              <div style={{
                position: 'relative', width: '100%', height: 260, overflow: 'hidden',
                background: '#f5f5f5', border: '1px solid #e5e5e5', borderRadius: 8,
              }}>
                <img
                  src={baseUrl}
                  alt={`${loc.space_id} 局部位置图`}
                  draggable={false}
                  style={{
                    position: 'absolute',
                    width: `${zoom * 100}%`,
                    height: `${zoom * 100}%`,
                    maxWidth: 'none',
                    objectFit: 'fill',
                    left: `${50 - px * zoom}%`,
                    top: `${50 - py * zoom}%`,
                    userSelect: 'none',
                    pointerEvents: 'none',
                  }}
                />
                {/* 中心红点：目标车位所在位置 */}
                <div style={{
                  position: 'absolute', left: '50%', top: '50%',
                  transform: 'translate(-50%, -50%)', pointerEvents: 'none',
                }}>
                  <div style={{
                    width: 18, height: 18, borderRadius: '50%',
                    border: '3px solid #fff', background: '#ef4444',
                    boxShadow: '0 0 0 2px rgba(239,68,68,.6), 0 2px 6px rgba(0,0,0,.4)',
                  }} />
                  <span style={{
                    position: 'absolute', left: 22, top: -2, whiteSpace: 'nowrap',
                    background: 'rgba(239,68,68,.92)', color: '#fff', fontSize: 12,
                    padding: '1px 6px', borderRadius: 4,
                  }}>{loc.space_id}</span>
                </div>
              </div>
              <p className="text-gray" style={{ fontSize: 12, marginTop: 6 }}>
                红点为车位位置（坐标 {px.toFixed(1)}%, {py.toFixed(1)}%），可用 －/＋ 调整放大倍数。
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
