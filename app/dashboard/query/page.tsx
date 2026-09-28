import { searchSpaces, getSpaceHistory, getSpaceHistories, getZones, getSpaceTypes } from '@/lib/queries'
import Link from 'next/link'
import QueryForm from './query-form'
import QueryActions from './query-actions'
import QueryResults from './query-results'

function fmtTime(t?: string | Date): string {
  if (!t) return '-'
  const d = typeof t === 'string' ? new Date(t) : t
  if (isNaN(d.getTime())) return String(t)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export default async function QueryPage({
  searchParams,
}: {
  searchParams: Record<string, string | undefined>
}) {
  const params = {
    space_id: searchParams.space_id || '',
    garage_zone: searchParams.garage_zone || '',
    building_no: searchParams.building_no || '',
    unit_no: searchParams.unit_no || '',
    status: searchParams.status || '',
    owner_name: searchParams.owner_name || '',
    phone: searchParams.phone || '',
    house_key: searchParams.house_key || '',
    space_type: searchParams.space_type || '',
  }
  const hasFilter = Object.values(params).some(v => v)
  const results = hasFilter ? await searchSpaces(params) : []

  // 区域 / 车位类型 下拉选项（动态从数据库读取）
  const zones = await getZones()
  const spaceTypes = await getSpaceTypes()

  // 若以车位号查询，额外拉取该（多）车位按时间顺序的购买 + 调换记录
  // 支持逗号 / 空格 / 换行分隔多个车位号，且每个关键字模糊匹配（ILIKE）
  const spaceIdPatterns = params.space_id
    .split(/[\s,，、]+/)
    .map(s => s.trim())
    .filter(Boolean)
  const spaceHistory = spaceIdPatterns.length ? await getSpaceHistories(spaceIdPatterns) : []

  return (
    <main className="print-wrap" style={{ maxWidth: 1200, margin: '0 auto', padding: '24px' }}>
      <header className="flex query-no-print mb-4" style={{ justifyContent: 'space-between' }}>
        <div className="flex" style={{ gap: 10, alignItems: 'center' }}>
          <Link href="/dashboard" className="btn-ghost" style={{ fontSize: 13 }}>← 返回</Link>
          <h1 style={{ fontSize: 20, fontWeight: 700 }}>🔍 车位查询</h1>
        </div>
      </header>

      <section className="card mb-4 query-no-print">
        <QueryForm zones={zones} spaceTypes={spaceTypes} />
      </section>

      {hasFilter && (
        <p className="text-sm text-gray query-no-print mb-2">共找到 {results.length} 条结果</p>
      )}

      {hasFilter && (
        <>
          <QueryActions rows={results} />
          <QueryResults rows={results} />

          {spaceIdPatterns.length > 0 && (
          <section className="card print-area" style={{ marginTop: 16, padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #f0f0f0', fontWeight: 600 }}>
              车位「{spaceIdPatterns.join('、')}」历史记录（按时间顺序，共 {spaceHistory.length} 条）
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 120 }}>时间</th>
                    <th style={{ width: 70 }}>类型</th>
                    <th style={{ width: 130 }}>车位号</th>
                    <th>说明</th>
                    <th>明细</th>
                  </tr>
                </thead>
                <tbody>
                  {spaceHistory.length === 0 && (
                    <tr><td colSpan={5} className="text-center text-gray">该车位暂无购买 / 调换记录</td></tr>
                  )}
                  {spaceHistory.map((h, idx) => (
                    <tr key={idx}>
                      <td style={{ fontSize: 12, whiteSpace: 'nowrap', fontFamily: 'monospace' }}>{fmtTime(h.time as any)}</td>
                      <td>
                        <span className={`badge ${h.kind === '购买' ? 'badge-blue' : 'badge-orange'}`}>{h.kind}</span>
                      </td>
                      <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{h.space}</td>
                      <td style={{ fontSize: 13 }}>{h.title}</td>
                      <td style={{ fontSize: 12, color: '#555', maxWidth: 520, whiteSpace: 'normal', wordBreak: 'break-all' }}>{h.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
        </>
      )}
    </main>
  )
}
