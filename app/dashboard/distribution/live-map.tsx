'use client'

import { useEffect, useRef, useState } from 'react'
import type { ParkingSpace } from '@/lib/types'
import { getMappedSpacesClient, saveSpacePosition } from './actions'

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
  zone, imageUrl, spaces, showLabels, showPrice, zoom, width, onSelect, selected, onClose,
  editMode, onMove, onMoveEnd,
}: {
  zone: string
  imageUrl: string | null
  spaces: ParkingSpace[]
  showLabels: boolean
  showPrice: boolean
  zoom: number
  width: string
  onSelect: (s: ParkingSpace) => void
  selected: ParkingSpace | null
  onClose: () => void
  editMode: boolean
  onMove: (spaceId: string, x: number, y: number) => void
  onMoveEnd: (spaceId: string) => void
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const dragId = useRef<string | null>(null)
  const movedRef = useRef(false)

  function posFromEvent(clientX: number, clientY: number) {
    const el = boxRef.current
    if (!el) return null
    const r = el.getBoundingClientRect()
    const x = Math.min(100, Math.max(0, +(((clientX - r.left) / r.width) * 100).toFixed(2)))
    const y = Math.min(100, Math.max(0, +(((clientY - r.top) / r.height) * 100).toFixed(2)))
    return { x, y }
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!dragId.current) return
    const p = posFromEvent(e.clientX, e.clientY)
    if (p) { movedRef.current = true; onMove(dragId.current, p.x, p.y) }
  }
  function endDrag(e: React.PointerEvent) {
    if (!dragId.current) return
    const id = dragId.current
    dragId.current = null
    try { (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId) } catch { /* noop */ }
    if (movedRef.current) onMoveEnd(id)
    movedRef.current = false
  }

  // 悬浮卡定位：跟随被点车位，靠边时收敛百分比，避免溢出容器
  const sx = selected ? Number(selected.pos_x) : 0
  const sy = selected ? Number(selected.pos_y) : 0
  const cardLeft = Math.min(72, Math.max(1, sx + 1.5))
  const cardTop = sy > 70 ? Math.max(1, sy - 30) : sy + 1.5
  return (
    <div style={{ zoom }}>
      <div
        ref={boxRef}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        style={{
          position: 'relative', width,
          background: '#f5f5f5', border: '1px solid #d9d9d9', borderRadius: 8, overflow: 'hidden',
        }}
      >
        {imageUrl ? (
          <img src={imageUrl} alt={`${zone}车位分布底图`} style={{ display: 'block', width: '100%', height: 'auto', userSelect: 'none', pointerEvents: 'none' }} draggable={false} />
        ) : (
          <div style={{ height: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999' }}>
            暂无底图（管理员上传后车位将叠加在图上）
          </div>
        )}
        {spaces.map(s => (
          <button
            key={s.space_id}
            type="button"
            title={editMode ? `拖动调整：${s.space_id} (${Number(s.pos_x).toFixed(1)}%, ${Number(s.pos_y).toFixed(1)}%)` : `${s.space_id} · ${s.status} · ${s.space_type || '-'}${s.price != null ? ' · ¥' + Number(s.price).toLocaleString() : ''}`}
            onPointerDown={editMode ? (e) => { e.stopPropagation(); dragId.current = s.space_id; movedRef.current = false; try { (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId) } catch { /* noop */ } } : undefined}
            onClick={(e) => { e.stopPropagation(); if (!movedRef.current) onSelect(s) }}
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
              cursor: editMode ? 'move' : 'pointer', touchAction: 'none', userSelect: 'none',
              boxShadow: '0 1px 2px rgba(0,0,0,.3)', opacity: 0.92,
              outline: selected?.space_id === s.space_id ? '2px solid #111' : 'none',
              zIndex: selected?.space_id === s.space_id ? 5 : 1,
            }}
          >
            {showPrice
              ? (s.price != null ? (Number(s.price) / 10000).toFixed(1) + '万' : '-')
              : (showLabels ? s.space_num.replace(/^0+/, '') : '')}
          </button>
        ))}
        {selected && (
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'absolute',
              left: `${cardLeft}%`,
              top: `${cardTop}%`,
              zIndex: 20,
              width: 210,
              padding: 12,
              border: '1px solid #ddd',
              borderRadius: 8,
              background: 'rgba(255,255,255,.98)',
              boxShadow: '0 6px 20px rgba(0,0,0,.28)',
              fontSize: 13,
            }}
          >
            <div className="flex" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <strong style={{ fontSize: 15 }}>{selected.space_id}</strong>
              <button type="button" className="btn-ghost" style={{ fontSize: 12, padding: '0 6px' }} onClick={onClose}>✕</button>
            </div>
            <div style={{ marginTop: 8, display: 'grid', gap: 5 }}>
              <div>状态：<span style={{ color: STATUS_STYLE[selected.status]?.bg, fontWeight: 600 }}>{selected.status}</span></div>
              <div>类型：{selected.space_type || '-'}</div>
              <div>房号(housekey)：{selected.house_key || '-'}</div>
              <div>业主：{selected.owner_name || '-'}</div>
              <div>价格：{selected.price != null ? '¥' + Number(selected.price).toLocaleString() : '-'}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default function LiveMap({
  zone,
  imageUrl,
  initialSpaces,
  forceUnsoldOnly = false,
  canEdit = false,
}: {
  zone: string
  imageUrl: string | null
  initialSpaces: ParkingSpace[]
  forceUnsoldOnly?: boolean
  canEdit?: boolean
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
  const [editMode, setEditMode] = useState(false)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')

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

  // 拖拽中：仅更新本地位置，不写库
  function handleMove(spaceId: string, x: number, y: number) {
    setSpaces(prev => prev.map(s => s.space_id === spaceId ? { ...s, pos_x: x, pos_y: y } : s))
  }

  // 松手：保存该车位坐标到数据库
  async function handleMoveEnd(spaceId: string) {
    const s = spaces.find(v => v.space_id === spaceId)
    if (!s) return
    setSaving(true)
    try {
      const res = await saveSpacePosition(spaceId, Number(s.pos_x), Number(s.pos_y))
      if (res.ok) {
        setToast(`已保存 ${s.space_id} 坐标 (${Number(s.pos_x).toFixed(1)}%, ${Number(s.pos_y).toFixed(1)}%)`)
        setLastSync(new Date())
      } else {
        setToast(`保存失败：${res.error || '未知错误'}`)
        await refreshSpaces()
      }
    } catch {
      setToast('保存失败：网络错误')
      await refreshSpaces()
    } finally {
      setSaving(false)
      setTimeout(() => setToast(''), 3500)
    }
  }

  // ESC 关闭放大 / 退出编辑
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') { setFullscreen(false); setSelected(null); setEditMode(false) } }
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
      <button type="button" className="btn-primary" style={{ padding: '2px 10px' }} onClick={refreshSpaces} disabled={refreshing || saving}>{refreshing ? '刷新中...' : '🔄 刷新车位'}</button>
      {canEdit && (
        <label style={{ display: 'flex', gap: 4, alignItems: 'center', color: editMode ? '#c2410c' : undefined, fontWeight: editMode ? 600 : undefined }}>
          <input type="checkbox" checked={editMode} onChange={e => { setEditMode(e.target.checked); setSelected(null) }} /> 编辑坐标{editMode ? '（拖动车位）' : ''}
        </label>
      )}
      {saving && <span className="text-gray">保存中...</span>}
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

      {toast && <div style={{ margin: '8px 0', padding: '8px 12px', borderRadius: 6, background: toast.startsWith('保存失败') ? '#fee2e2' : '#dcfce7', color: toast.startsWith('保存失败') ? '#991b1b' : '#166534', fontSize: 13 }}>{toast}</div>}
      <div style={{ overflow: 'auto', maxWidth: '100%', border: '1px solid #e5e5e5', borderRadius: 8 }} onClick={() => setSelected(null)}>
        <MapCanvas zone={zone} imageUrl={imageUrl} spaces={visibleSpaces} showLabels={showLabels} showPrice={showPrice} zoom={zoom} width="100%" onSelect={setSelected} selected={selected} onClose={() => setSelected(null)} editMode={editMode} onMove={handleMove} onMoveEnd={handleMoveEnd} />
      </div>

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
          <div style={{ flex: 1, overflow: 'auto', background: '#fff', borderRadius: 8, padding: 8 }} onClick={() => setSelected(null)}>
            <MapCanvas zone={zone} imageUrl={imageUrl} spaces={visibleSpaces} showLabels={showLabels} showPrice={showPrice} zoom={zoom} width="94vw" onSelect={setSelected} selected={selected} onClose={() => setSelected(null)} editMode={editMode} onMove={handleMove} onMoveEnd={handleMoveEnd} />
          </div>
        </div>
      )}
    </div>
  )
}
