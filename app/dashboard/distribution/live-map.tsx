'use client'

import { useEffect, useState } from 'react'
import type { ParkingSpace } from '@/lib/types'
import { getMappedSpacesClient } from './actions'

// 状态 -> 颜色 / 图例顺序
const STATUS_STYLE: Record<string, { bg: string; label: string }> = {
  '未售':     { bg: '#22c55e', label: '未售' },
  '预订':     { bg: '#eab308', label: '预订' },
  '已售':     { bg: '#9ca3af', label: '已售' },
  '团购锁定': { bg: '#8b5cf6', label: '团购锁定' },
  '已核销':   { bg: '#3b82f6', label: '已核销' },
  '零售锁定': { bg: '#f97316', label: '零售锁定' },
  '取消':     { bg: '#ef4444', label: '取消' },
}
const LEGEND_ORDER = ['未售', '预订', '已售', '团购锁定', '已核销', '零售锁定', '取消']

function MapCanvas({
  zone, imageUrl, spaces, showLabels, showPrice, zoom, width, onSelect,
}: {
  zone: string
  imageUrl: string | null
  spaces: ParkingSpace[]
  showLabels: boolean
  showPrice: boolean
  zoom: number
  width: string
  onSelect: (s: ParkingSpace) => void
}) {
  return (
    <div style={{ zoom }}>
      <div style={{
        position: 'relative', width,
        background: '#f5f5f5', border: '1px solid #d9d9d9', borderRadius: 8, overflow: 'hidden',
      }}>
        {imageUrl ? (
          <img src={imageUrl} alt={`${zone}车位分布底图`} style={{ display: 'block', width: '100%', height: 'auto' }} />
        ) : (
          <div style={{ height: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999' }}>
            暂无底图（管理员上传后车位将叠加在图上）
          </div>
        )}
        {spaces.map(s => (
          <button
            key={s.space_id}
            type="button"
            title={`${s.space_id} · ${s.status} · ${s.space_type || '-'}${s.price != null ? ' · ¥' + Number(s.price).toLocaleString() : ''}`}
            onClick={() => onSelect(s)}
            style={{
              position: 'absolute',
              left: `${Number(s.pos_x)}%`,
              top: `${Number(s.pos_y)}%`,
              transform: 'translate(-50%, -50%)',
              width: showPrice ? 30 : 20, height: 20, padding: 0,
              border: '1px solid rgba(255,255,255,.85)',
              borderRadius: 4,
              background: STATUS_STYLE[s.status]?.bg || '#666',
              color: '#fff', fontSize: 8, lineHeight: '18px', textAlign: 'center',
              cursor: 'pointer', boxShadow: '0 1px 2px rgba(0,0,0,.3)', opacity: 0.92,
            }}
          >
            {showPrice
              ? (s.price != null ? (Number(s.price) / 10000).toFixed(1) + '万' : '-')
              : (showLabels ? s.space_num.replace(/^0+/, '') : '')}
          </button>
        ))}
      </div>
    </div>
  )
}

function DetailCard({ space, onClose }: { space: ParkingSpace | null; onClose: () => void }) {
  if (!space) return null
  return (
    <div style={{ marginTop: 10, padding: 12, border: '1px solid #ddd', borderRadius: 8, background: '#fff' }}>
      <div className="flex" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <strong style={{ fontSize: 15 }}>{space.space_id}</strong>
        <button type="button" className="btn-ghost" style={{ fontSize: 13 }} onClick={onClose}>关闭</button>
      </div>
      <div style={{ marginTop: 8, display: 'flex', gap: 24, fontSize: 14, flexWrap: 'wrap' }}>
        <div>状态：<span style={{ color: STATUS_STYLE[space.status]?.bg, fontWeight: 600 }}>{space.status}</span></div>
        <div>类型：{space.space_type || '-'}</div>
        <div>价格：{space.price != null ? '¥' + Number(space.price).toLocaleString() : '-'}</div>
      </div>
    </div>
  )
}

export default function LiveMap({
  zone,
  imageUrl,
  initialSpaces,
  forceUnsoldOnly = false,
}: {
  zone: string
  imageUrl: string | null
  initialSpaces: ParkingSpace[]
  forceUnsoldOnly?: boolean
}) {
  const [spaces, setSpaces] = useState<ParkingSpace[]>(initialSpaces)
  const [selected, setSelected] = useState<ParkingSpace | null>(null)
  const [showLabels, setShowLabels] = useState(true)
  const [showPrice, setShowPrice] = useState(false)
  const [showUnsoldOnly, setShowUnsoldOnly] = useState(forceUnsoldOnly)
  const [zoom, setZoom] = useState(1)
  const [fullscreen, setFullscreen] = useState(false)
  const [lastSync, setLastSync] = useState<Date>(new Date())
  const [refreshing, setRefreshing] = useState(false)

  // 手动刷新车位状态（出售/调换后点此同步，避免高频自动轮询）
  async function refreshSpaces() {
    setRefreshing(true)
    try {
      const data = await getMappedSpacesClient(zone)
      if (Array.isArray(data)) {
        setSpaces(data)
        setLastSync(new Date())
      }
    } catch { /* 刷新失败保留上次数据 */ }
    finally { setRefreshing(false) }
  }

  // ESC 关闭放大
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setFullscreen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const unsoldOnly = forceUnsoldOnly || showUnsoldOnly
  const visibleSpaces = unsoldOnly ? spaces.filter(s => s.status === '未售') : spaces
  const counts: Record<string, number> = {}
  for (const s of visibleSpaces) counts[s.status] = (counts[s.status] || 0) + 1

  const zoomBar = (withFull: boolean) => (
    <div className="flex" style={{ gap: 8, alignItems: 'center', fontSize: 13, flexWrap: 'wrap' }}>
      <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <input type="checkbox" checked={showLabels} onChange={e => setShowLabels(e.target.checked)} /> 编号
      </label>
      <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <input type="checkbox" checked={showPrice} onChange={e => setShowPrice(e.target.checked)} /> 价格
      </label>
      {!forceUnsoldOnly && (
        <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <input type="checkbox" checked={showUnsoldOnly} onChange={e => { setShowUnsoldOnly(e.target.checked); setSelected(null) }} /> 仅未售
        </label>
      )}
      <button type="button" className="btn-ghost" style={{ padding: '2px 9px' }} onClick={() => setZoom(z => Math.max(0.6, +(z - 0.2).toFixed(1)))}>－</button>
      <span style={{ minWidth: 42, textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>
      <button type="button" className="btn-ghost" style={{ padding: '2px 9px' }} onClick={() => setZoom(z => Math.min(3, +(z + 0.2).toFixed(1)))}>＋</button>
      <button type="button" className="btn-ghost" style={{ padding: '2px 9px' }} onClick={() => setZoom(1)}>复位</button>
      <button type="button" className="btn-primary" style={{ padding: '2px 10px' }} onClick={refreshSpaces} disabled={refreshing}>{refreshing ? '刷新中...' : '🔄 刷新车位'}</button>
      {withFull && <button type="button" className="btn-primary" style={{ padding: '2px 10px' }} onClick={() => setFullscreen(true)}>⛶ 放大查看</button>}
      <span className="text-gray">上次同步 {lastSync.toLocaleTimeString('zh-CN')}</span>
    </div>
  )

  const legend = (
    <div className="flex" style={{ gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
      {LEGEND_ORDER.filter(k => counts[k]).map(k => (
        <span key={k} style={{ display: 'flex', gap: 5, alignItems: 'center', fontSize: 13 }}>
          <span style={{ width: 13, height: 13, borderRadius: 3, background: STATUS_STYLE[k]?.bg || '#ccc', display: 'inline-block' }} />
          {STATUS_STYLE[k]?.label || k} <strong>{counts[k]}</strong>
        </span>
      ))}
    </div>
  )

  return (
    <div style={{ marginTop: 16 }}>
      <div className="flex" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
        <h3 style={{ fontSize: 15, fontWeight: 600 }}>
          🗺️ 动态分布图 <span className="text-sm text-gray">（{visibleSpaces.length} 个已定位车位{unsoldOnly ? ' · 仅未售' : ''}）</span>
        </h3>
      </div>
      {legend}
      <div style={{ marginBottom: 8 }}>{zoomBar(true)}</div>

      <div style={{ overflow: 'auto', maxWidth: '100%', border: '1px solid #e5e5e5', borderRadius: 8 }}>
        <MapCanvas zone={zone} imageUrl={imageUrl} spaces={visibleSpaces} showLabels={showLabels} showPrice={showPrice} zoom={zoom} width="100%" onSelect={setSelected} />
      </div>
      <DetailCard space={selected} onClose={() => setSelected(null)} />

      {fullscreen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', zIndex: 1000, display: 'flex', flexDirection: 'column', padding: 16 }}>
          <div style={{ background: '#fff', padding: '10px 14px', borderRadius: 8, marginBottom: 10 }}>
            <div className="flex" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <strong style={{ fontSize: 16 }}>{zone} 动态分布图（放大查看）</strong>
              <button type="button" className="btn-ghost" onClick={() => setFullscreen(false)}>关闭 ✕</button>
            </div>
            {legend}
            {zoomBar(false)}
          </div>
          <div style={{ flex: 1, overflow: 'auto', background: '#fff', borderRadius: 8, padding: 8 }}>
            <MapCanvas zone={zone} imageUrl={imageUrl} spaces={visibleSpaces} showLabels={showLabels} showPrice={showPrice} zoom={zoom} width="94vw" onSelect={setSelected} />
            <DetailCard space={selected} onClose={() => setSelected(null)} />
          </div>
        </div>
      )}
    </div>
  )
}
