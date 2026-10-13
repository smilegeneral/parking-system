'use client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

const STATUSES = ['未售', '预订', '已售', '团购锁定', '已核销']

export default function QueryForm({ zones, spaceTypes }: { zones: string[]; spaceTypes: string[] }) {
  const router = useRouter()
  const [f, setF] = useState({
    space_id: '', garage_zone: '', building_no: '', unit_no: '', status: '',
    owner_name: '', phone: '', house_key: '', space_type: '',
  })

  function set(k: string, v: string) { setF(p => ({ ...p, [k]: v })) }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const qs = Object.entries(f).filter(([, v]) => v.trim())
      .map(([k, v]) => `${k}=${encodeURIComponent(v.trim())}`).join('&')
    router.push(`/dashboard/query${qs ? '?' + qs : ''}`)
  }

  function reset() {
    setF({ space_id: '', garage_zone: '', building_no: '', unit_no: '', status: '', owner_name: '', phone: '', house_key: '', space_type: '' })
    router.push('/dashboard/query')
  }

  return (
    <form onSubmit={submit}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px,1fr))', gap: 8 }}>
        <F label="车位号（模糊）"><input className="input" value={f.space_id} onChange={e => set('space_id', e.target.value)} placeholder="如 A-001" /></F>
        <F label="区域">
          <select className="select" value={f.garage_zone} onChange={e => set('garage_zone', e.target.value)}>
            <option value="">全部</option>
            {zones.map(z => <option key={z} value={z}>{z}</option>)}
          </select>
        </F>
        <F label="楼栋（精确）"><input className="input" value={f.building_no} onChange={e => set('building_no', e.target.value)} placeholder="如 1" /></F>
        <F label="单元号">
          <select className="select" value={f.unit_no} onChange={e => set('unit_no', e.target.value)}>
            <option value="">全部</option>
            <option value="1">1</option>
            <option value="2">2</option>
          </select>
        </F>
        <F label="状态">
          <select className="select" value={f.status} onChange={e => set('status', e.target.value)}>
            <option value="">全部</option>
            {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </F>
        <F label="业主名（模糊）"><input className="input" value={f.owner_name} onChange={e => set('owner_name', e.target.value)} placeholder="业主姓名" /></F>
        <F label="电话（模糊）"><input className="input" value={f.phone} onChange={e => set('phone', e.target.value)} placeholder="电话" /></F>
        <F label="房屋编号（模糊）"><input className="input" value={f.house_key} onChange={e => set('house_key', e.target.value)} placeholder="如 1-1" /></F>
        <F label="车位类型">
          <select className="select" value={f.space_type} onChange={e => set('space_type', e.target.value)}>
            <option value="">全部</option>
            {spaceTypes.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </F>
      </div>
      <div className="flex mt-4" style={{ gap: 8 }}>
        <button type="submit" className="btn-primary" style={{ fontSize: 13 }}>🔍 查询</button>
        <button type="button" className="btn-ghost" style={{ fontSize: 13 }} onClick={reset}>重置</button>
      </div>
    </form>
  )
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ fontSize: 12, color: '#555', display: 'block' }}>
      {label}
      <div style={{ marginTop: 2 }}>{children}</div>
    </label>
  )
}
