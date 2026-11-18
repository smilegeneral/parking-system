'use client'
import { useState, useTransition } from 'react'
import { updateOwnerInfo } from '@/lib/actions'
import type { OwnerInfo, OwnerChangeLog } from '@/lib/types'

// 兼容 Date / string 的时间格式化
function fmtTime(v: any, len = 16): string {
  if (!v) return ''
  const s = v instanceof Date ? v.toISOString() : String(v)
  return s.slice(0, len)
}

// ============================================================
//  业主信息变更 - 客户端组件
//  搜索 → 选择业主 → 修改姓名/电话/二电话 → 提交（写变更日志）
// ============================================================

const FIELD_LABEL: Record<string, string> = {
  owner_name: '业主姓名',
  phone: '联系电话',
  phone2: '第二电话',
}

export default function OwnerList({
  owners,
  logs,
}: {
  owners: OwnerInfo[]
  logs: OwnerChangeLog[]
}) {
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [form, setForm] = useState({ owner_name: '', phone: '', phone2: '', change_reason: '' })
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [pending, startTransition] = useTransition()

  const q = query.trim().toLowerCase()
  const filtered = q
    ? owners.filter(o =>
        o.house_key.toLowerCase().includes(q) ||
        (o.owner_name || '').toLowerCase().includes(q) ||
        (o.phone || '').toLowerCase().includes(q)
      )
    : owners

  function startEdit(o: OwnerInfo) {
    setEditing(o.house_key)
    setMsg(null)
    setForm({
      owner_name: o.owner_name || '',
      phone: o.phone || '',
      phone2: o.phone2 || '',
      change_reason: '',
    })
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setMsg(null)
    if (!form.owner_name.trim()) return setMsg({ type: 'err', text: '请输入业主姓名' })
    if (!form.phone.trim()) return setMsg({ type: 'err', text: '请输入联系电话' })

    startTransition(async () => {
      try {
        const res = await updateOwnerInfo({
          house_key: editing!,
          owner_name: form.owner_name.trim(),
          phone: form.phone.trim(),
          phone2: form.phone2.trim(),
          change_reason: form.change_reason.trim(),
          operator: '当前用户',
        })
        setMsg({ type: 'ok', text: `✅ 已更新字段：${res.changed_fields.map(f => FIELD_LABEL[f] || f).join('、')}` })
        setEditing(null)
        setTimeout(() => location.reload(), 1200)
      } catch (err: any) {
        setMsg({ type: 'err', text: `❌ ${err.message}` })
      }
    })
  }

  return (
    <>
      <section className="card mb-4">
        <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>
          业主档案（{filtered.length} / {owners.length}）
        </h2>
        <input
          className="input"
          placeholder="🔍 搜索房屋编号 / 业主姓名 / 电话"
          value={query}
          onChange={e => setQuery(e.target.value)}
          style={{ marginBottom: 12, maxWidth: 420 }}
        />

        {msg && (
          <div className={msg.type === 'ok' ? 'text-green' : 'text-red'} style={{ marginBottom: 10, fontSize: 13, fontWeight: 500 }}>
            {msg.text}
          </div>
        )}

        {filtered.length === 0 ? (
          <p className="text-gray text-sm">未找到匹配的业主</p>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {filtered.slice(0, 50).map(o => (
              <div key={o.house_key} className="card" style={{ padding: 10, background: '#fafafa' }}>
                <div className="flex" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <div>
                    <span style={{ fontWeight: 700, fontSize: 14 }}>{o.house_key}</span>
                    <span style={{ marginLeft: 10, fontSize: 13 }}>{o.owner_name}</span>
                    <span className="text-sm text-gray" style={{ marginLeft: 10, fontFamily: 'monospace' }}>
                      {o.phone}
                      {o.phone2 ? ` / ${o.phone2}` : ''}
                    </span>
                    <span className="text-sm text-gray" style={{ marginLeft: 10 }}>
                      {o.parking_count} 车位
                      {o.parking_spaces ? `（${o.parking_spaces}）` : ''}
                    </span>
                    <span className="text-sm" style={{ marginLeft: 10, color: '#16a34a' }}>
                      已开票 {o.invoiced_count ?? 0}
                    </span>
                    <span className="text-sm" style={{ marginLeft: 6, color: '#d97706' }}>
                      未开票 {o.uninvoiced_count ?? 0}
                    </span>
                  </div>
                  {editing === o.house_key ? (
                    <button
                      className="btn btn-gray"
                      style={{ fontSize: 12, padding: '4px 10px' }}
                      onClick={() => setEditing(null)}
                    >
                      取消
                    </button>
                  ) : (
                    <button
                      className="btn"
                      style={{ fontSize: 12, padding: '4px 10px' }}
                      onClick={() => startEdit(o)}
                    >
                      变更
                    </button>
                  )}
                </div>

                {editing === o.house_key && (
                  <form onSubmit={handleSubmit} style={{ marginTop: 10, borderTop: '1px solid #eee', paddingTop: 10 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                      <EditField label="业主姓名">
                        <input className="input" value={form.owner_name}
                          onChange={e => setForm({ ...form, owner_name: e.target.value })} />
                      </EditField>
                      <EditField label="联系电话">
                        <input className="input" value={form.phone}
                          onChange={e => setForm({ ...form, phone: e.target.value })} />
                      </EditField>
                      <EditField label="第二电话">
                        <input className="input" value={form.phone2}
                          onChange={e => setForm({ ...form, phone2: e.target.value })} placeholder="选填" />
                      </EditField>
                    </div>
                    <div style={{ marginTop: 8 }}>
                      <EditField label="变更原因">
                        <input className="input" value={form.change_reason}
                          onChange={e => setForm({ ...form, change_reason: e.target.value })}
                          placeholder="如：业主换号 / 更名 / 补充联系方式" />
                      </EditField>
                    </div>
                    <div className="flex" style={{ marginTop: 10, gap: 8 }}>
                      <button type="submit" className="btn-success" disabled={pending} style={{ fontSize: 13 }}>
                        {pending ? '保存中...' : '💾 保存变更'}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            ))}
            {filtered.length > 50 && (
              <p className="text-sm text-gray">已显示前 50 条，请用搜索缩小范围</p>
            )}
          </div>
        )}
      </section>

      {/* 变更日志 */}
      <section className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, padding: 14, borderBottom: '1px solid #f0f0f0' }}>
          变更记录（最近 {logs.length} 条）
        </h2>
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>时间</th>
                <th>房屋</th>
                <th>业主</th>
                <th>变更字段</th>
                <th>原值 → 新值</th>
                <th>原因</th>
                <th>操作人</th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 && (
                <tr><td colSpan={7} className="text-center text-gray">暂无变更记录</td></tr>
              )}
              {logs.map(l => (
                <tr key={l.log_id}>
                  <td style={{ fontSize: 12 }}>{fmtTime(l.changed_at)}</td>
                  <td style={{ fontWeight: 600 }}>{l.house_key}</td>
                  <td>{l.owner_name}</td>
                  <td>
                    <span className="badge badge-blue">
                      {FIELD_LABEL[l.change_field] || l.change_field}
                    </span>
                  </td>
                  <td style={{ fontSize: 12 }}>
                    <span className="text-gray">{l.old_value || '—'}</span>
                    {' → '}
                    <span style={{ color: '#fa8c16', fontWeight: 600 }}>{l.new_value || '—'}</span>
                  </td>
                  <td style={{ fontSize: 12 }}>{l.change_reason || '—'}</td>
                  <td style={{ fontSize: 12 }}>{l.operator}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}

function EditField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ fontSize: 12, color: '#555', display: 'block' }}>
      {label}
      <div style={{ marginTop: 2 }}>{children}</div>
    </label>
  )
}
