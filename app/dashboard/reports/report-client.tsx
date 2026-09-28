'use client'

import { useState } from 'react'
import * as XLSX from 'xlsx'
import type {
  ReportSummary,
  SalesComposition,
  ZoneSalesStat,
  GroupCompanyStat,
  SalesTrendPoint,
  ZoneStat,
  ZoneUnsoldStat,
  TopOwnerStat,
  NotBoughtOwnerStat,
  HouseSpaceStat,
} from '@/lib/types'

// 金额格式化：按数据库返回的原始数值原样显示，不做任何四舍五入。
// postgres 的 numeric 以字符串返回（如 "123456.78"）；若先转 Number 再
// toLocaleString，会被限制为最多 3 位小数并四舍五入，还会引入浮点误差。
// 这里直接按字符串处理：整数部分加千分位，小数部分原样保留。
function fmtMoney(v: any): string {
  const raw = (v === null || v === undefined ? '' : String(v)).trim()
  if (!raw || /^0*(\.0*)?$/.test(raw)) return '¥0'
  const neg = raw.startsWith('-')
  const body = neg ? raw.slice(1) : raw
  const [intPart, fracPart] = body.split('.')
  const withSep = (intPart || '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `¥${neg ? '-' : ''}${withSep}${fracPart ? '.' + fracPart : ''}`
}

function Card({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="card" style={{ padding: 16 }}>
      <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>{title}</h3>
      {children}
    </section>
  )
}

function StatTile({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="card" style={{ padding: '14px 16px', minWidth: 160 }}>
      <div className="text-sm text-gray" style={{ marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: accent || '#1f1f1f' }}>{value}</div>
    </div>
  )
}

export default function ReportClient({
  summary,
  sales,
  zoneSales,
  groupCompanies,
  trend,
  zones,
  unsoldByZone,
  topOwners,
  notBought,
  houseSpaces,
}: {
  summary: ReportSummary
  sales: SalesComposition
  zoneSales: ZoneSalesStat[]
  groupCompanies: GroupCompanyStat[]
  trend: SalesTrendPoint[]
  zones: ZoneStat[]
  unsoldByZone: ZoneUnsoldStat[]
  topOwners: TopOwnerStat[]
  notBought: NotBoughtOwnerStat[]
  houseSpaces: HouseSpaceStat[]
}) {
  const [tab, setTab] = useState<'zoneSales' | 'group' | 'trend' | 'zone' | 'top' | 'notbought' | 'house'>(
    'zoneSales'
  )

  const tabs: { key: typeof tab; label: string }[] = [
    { key: 'zoneSales', label: '按区域销售构成' },
    { key: 'group', label: '团购公司专项' },
    { key: 'trend', label: '销售趋势' },
    { key: 'zone', label: '按车库未售' },
    { key: 'top', label: '购买最多业主' },
    { key: 'house', label: '按户车位统计' },
    { key: 'notbought', label: '未购车位业主' },
  ]

  // 导出 Excel：销售构成 / 按区域销售构成 / 团购公司 / 销售趋势 /
  //             汇总 / 按车库 / 购买最多业主 / 未购业主 共八个工作表
  function handleExport() {
    const wb = XLSX.utils.book_new()

    // 1) 销售构成（已售拆分零售与团购 + 团购预定）
    const sRows: any[] = [['分类', '车位数', '金额']]
    sRows.push(['已售合计', sales.sold_count, Number(sales.sold_amount)])
    sRows.push(['├ 零售已售', sales.retail_count, Number(sales.retail_amount)])
    sRows.push(['└ 团购已核销', sales.group_verified_count, Number(sales.group_verified_amount)])
    sRows.push(['团购预定（公司已买，待核销）', sales.group_locked_count, Number(sales.group_locked_amount)])
    sRows.push(['合计（已售 + 团购预定）', sales.total_count, Number(sales.total_amount)])
    sRows.push(['未售库存', sales.unsold_count, ''])
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sRows), '销售构成')

    // 2) 按区域销售构成
    const zsRows: any[] = [[
      '车库区域', '车位总数', '已售数', '已售金额',
      '零售数', '零售金额', '团购已核销数', '团购已核销金额',
      '团购锁定数', '团购锁定金额', '未售数',
    ]]
    zoneSales.forEach(z =>
      zsRows.push([
        z.garage_zone, z.total, z.sold_count, Number(z.sold_amount),
        z.retail_count, Number(z.retail_amount),
        z.group_verified_count, Number(z.group_verified_amount),
        z.group_locked_count, Number(z.group_locked_amount),
        z.unsold_count,
      ])
    )
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(zsRows), '按区域销售构成')

    // 3) 团购公司专项
    const gRows: any[] = [[
      '团购公司', '部门', '联系人', '锁定数', '锁定金额',
      '已核销数', '已核销金额', '合计车位数', '合计金额', '核销率', '收款', '发票',
    ]]
    groupCompanies.forEach(c =>
      gRows.push([
        c.company_name, c.department || '—', c.contact_person || '—',
        c.locked_count, Number(c.locked_amount),
        c.verified_count, Number(c.verified_amount),
        c.total_count, Number(c.total_amount),
        `${(c.verify_rate * 100).toFixed(1)}%`,
        c.is_paid ? '已付' : '未付',
        c.invoice_type || '—',
      ])
    )
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(gRows), '团购公司专项')

    // 4) 销售趋势
    const trRows: any[] = [['年月', '已售车位数', '已售金额', '零售数', '零售金额', '团购数', '团购金额']]
    trend.forEach(t =>
      trRows.push([
        t.ym, t.sold_count, Number(t.sold_amount),
        t.retail_count, Number(t.retail_amount),
        t.group_count, Number(t.group_amount),
      ])
    )
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(trRows), '销售趋势')

    // 5) 汇总指标
    const sumRows = [
      ['指标', '数值'],
      ['已售总金额（含团购已核销/团购锁定）', Number(summary.total_sold_amount)],
      ['已售车位数（含团购）', summary.total_sold_count],
      ['其中团购已核销', summary.group_verified_count],
      ['未售车位数', summary.total_unsold],
    ]
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sumRows), '汇总指标')

    // 6) 按车库统计
    const zRows: any[] = [['车库区域', '车位总数', '已售车位数', '金额', '未售车位数', '子母车位', '单体车位', '普通车位', '其他类型']]
    zones.forEach(z =>
      zRows.push([
        z.garage_zone, z.total, z.sold_count, Number(z.sold_amount),
        z.unsold_count, z.unsold_sub, z.unsold_single, z.unsold_normal, z.unsold_other,
      ])
    )
    zRows.push([
      '合计',
      zones.reduce((s, z) => s + Number(z.total), 0),
      zones.reduce((s, z) => s + Number(z.sold_count), 0),
      Number(summary.total_sold_amount),
      zones.reduce((s, z) => s + Number(z.unsold_count), 0),
      zones.reduce((s, z) => s + Number(z.unsold_sub), 0),
      zones.reduce((s, z) => s + Number(z.unsold_single), 0),
      zones.reduce((s, z) => s + Number(z.unsold_normal), 0),
      zones.reduce((s, z) => s + Number(z.unsold_other), 0),
    ])
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(zRows), '按车库统计')

    // 7) 购买最多业主
    const tRows: any[] = [['排名', '业主', '房号', '车位数', '金额']]
    topOwners.forEach((r, i) =>
      tRows.push([i + 1, r.owner_name, r.house_key || '—', r.space_count, Number(r.total_amount)])
    )
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(tRows), '购买最多业主')

    // 8) 未购车位业主
    const nRows: any[] = [['房号', '楼栋', '单元', '房间', '业主', '电话']]
    notBought.forEach(r =>
      nRows.push([r.house_key || '—', r.building_no || '—', r.unit_no || '—', r.room_no || '—', r.owner_name, r.phone || '—'])
    )
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(nRows), '未购车位业主')

    // 9) 按户车位统计
    const hRows: any[] = [['楼号', '单元', '房号', '房号(完整)', '业主', '车位数', '车位号', '金额']]
    houseSpaces.forEach(r =>
      hRows.push([
        r.building_no || '—', r.unit_no || '—', r.room_no || '—', r.house_key || '—',
        r.owner_name || '—', r.space_count, r.space_ids || '—', Number(r.total_amount),
      ])
    )
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(hRows), '按户车位统计')

    const fileName = `统计报表_${new Date().toISOString().slice(0, 10)}.xlsx`
    XLSX.writeFile(wb, fileName)
  }

  return (
    <div>
      {/* 汇总指标 + 导出 */}
      <div
        className="flex"
        style={{ gap: 12, marginBottom: 16, flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-start' }}
      >
        <div className="flex" style={{ gap: 12, flexWrap: 'wrap' }}>
          <StatTile label="已售总金额（含团购锁定）" value={fmtMoney(summary.total_sold_amount)} accent="#fa8c16" />
          <StatTile label="已售车位数" value={`${summary.total_sold_count}`} />
          <StatTile label="其中团购已核销" value={`${summary.group_verified_count}`} />
          <StatTile label="未售车位数" value={`${summary.total_unsold}`} accent="#1677ff" />
        </div>
        <button type="button" className="btn-primary" style={{ fontSize: 14 }} onClick={handleExport}>
          ⬇ 导出 Excel
        </button>
      </div>

      {/* 销售构成：已售（零售 / 团购已核销）+ 团购预定 */}
      <div style={{ marginBottom: 16 }}>
        <Card title="销售构成：已售（零售 / 团购已核销）+ 团购预定">
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>分类</th>
                  <th>车位数</th>
                  <th>金额</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>已售合计</td>
                  <td>{sales.sold_count}</td>
                  <td style={{ color: '#fa8c16', fontWeight: 600 }}>{fmtMoney(sales.sold_amount)}</td>
                </tr>
                <tr style={{ color: '#555' }}>
                  <td style={{ paddingLeft: 24 }}>├ 零售已售</td>
                  <td>{sales.retail_count}</td>
                  <td>{fmtMoney(sales.retail_amount)}</td>
                </tr>
                <tr style={{ color: '#555' }}>
                  <td style={{ paddingLeft: 24 }}>└ 团购已核销</td>
                  <td>{sales.group_verified_count}</td>
                  <td>{fmtMoney(sales.group_verified_amount)}</td>
                </tr>
                <tr>
                  <td>团购预定（公司已买，待核销）</td>
                  <td>{sales.group_locked_count}</td>
                  <td style={{ color: '#fa8c16' }}>{fmtMoney(sales.group_locked_amount)}</td>
                </tr>
                <tr style={{ fontWeight: 700, background: '#fafafa' }}>
                  <td>合计（已售 + 团购预定）</td>
                  <td>{sales.total_count}</td>
                  <td style={{ color: '#fa8c16' }}>{fmtMoney(sales.total_amount)}</td>
                </tr>
                <tr style={{ color: '#888' }}>
                  <td>未售库存</td>
                  <td>{sales.unsold_count}</td>
                  <td>—</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray" style={{ marginTop: 8 }}>
            口径说明：金额统一取车位 price（不区分团购价与业主实付价差价）；
            「团购已核销」同时包含 status='已售' 且 is_group_buy=TRUE 与 status='已核销' 两种数据。
          </p>
        </Card>
      </div>

      {/* 按车库（区域）统计 */}
      <Card title="按车库（区域）统计：车位总数 / 已售 / 金额 / 未售（按类型细分）">
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>车库区域</th>
                <th>车位总数</th>
                <th>已售车位数</th>
                <th>金额</th>
                <th>未售车位数</th>
                <th>子母车位</th>
                <th>单体车位</th>
                <th>普通车位</th>
                <th>其他</th>
              </tr>
            </thead>
            <tbody>
              {zones.length === 0 && (
                <tr><td colSpan={9} className="text-center text-gray">暂无数据</td></tr>
              )}
              {zones.map(z => (
                <tr key={z.garage_zone}>
                  <td style={{ fontWeight: 600 }}>{z.garage_zone}</td>
                  <td>{z.total}</td>
                  <td>{z.sold_count}</td>
                  <td style={{ color: '#fa8c16', fontWeight: 600 }}>{fmtMoney(z.sold_amount)}</td>
                  <td>{z.unsold_count}</td>
                  <td>{z.unsold_sub}</td>
                  <td>{z.unsold_single}</td>
                  <td>{z.unsold_normal}</td>
                  <td>{z.unsold_other}</td>
                </tr>
              ))}
            </tbody>
            {zones.length > 0 && (
              <tfoot>
                <tr style={{ fontWeight: 700 }}>
                  <td>合计</td>
                  <td>{zones.reduce((s, z) => s + Number(z.total), 0)}</td>
                  <td>{zones.reduce((s, z) => s + Number(z.sold_count), 0)}</td>
                  {/* 合计金额直接用 SQL 精确求和结果，避免 Number 浮点累加产生脏小数 */}
                  <td>{fmtMoney(summary.total_sold_amount)}</td>
                  <td>{zones.reduce((s, z) => s + Number(z.unsold_count), 0)}</td>
                  <td>{zones.reduce((s, z) => s + Number(z.unsold_sub), 0)}</td>
                  <td>{zones.reduce((s, z) => s + Number(z.unsold_single), 0)}</td>
                  <td>{zones.reduce((s, z) => s + Number(z.unsold_normal), 0)}</td>
                  <td>{zones.reduce((s, z) => s + Number(z.unsold_other), 0)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </Card>

      {/* 标签页 */}
      <div className="flex" style={{ gap: 8, margin: '16px 0', flexWrap: 'wrap' }}>
        {tabs.map(t => (
          <button
            key={t.key}
            type="button"
            className={`btn-${tab === t.key ? 'primary' : 'secondary'}`}
            style={{ fontSize: 13 }}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* 按区域销售构成（零售 / 团购拆分） */}
      {tab === 'zoneSales' && (
        <Card title="按车库（区域）销售构成：已售拆分零售与团购">
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>车库区域</th>
                  <th>车位总数</th>
                  <th>已售数</th>
                  <th>已售金额</th>
                  <th>零售数</th>
                  <th>零售金额</th>
                  <th>团购已核销数</th>
                  <th>团购已核销金额</th>
                  <th>团购锁定数</th>
                  <th>团购锁定金额</th>
                  <th>未售数</th>
                </tr>
              </thead>
              <tbody>
                {zoneSales.length === 0 && (
                  <tr><td colSpan={11} className="text-center text-gray">暂无数据</td></tr>
                )}
                {zoneSales.map(z => (
                  <tr key={z.garage_zone}>
                    <td style={{ fontWeight: 600 }}>{z.garage_zone}</td>
                    <td>{z.total}</td>
                    <td>{z.sold_count}</td>
                    <td style={{ color: '#fa8c16', fontWeight: 600 }}>{fmtMoney(z.sold_amount)}</td>
                    <td>{z.retail_count}</td>
                    <td>{fmtMoney(z.retail_amount)}</td>
                    <td>{z.group_verified_count}</td>
                    <td>{fmtMoney(z.group_verified_amount)}</td>
                    <td>{z.group_locked_count}</td>
                    <td>{fmtMoney(z.group_locked_amount)}</td>
                    <td>{z.unsold_count}</td>
                  </tr>
                ))}
              </tbody>
              {zoneSales.length > 0 && (
                <tfoot>
                  <tr style={{ fontWeight: 700, background: '#fafafa' }}>
                    <td>合计</td>
                    <td>{zoneSales.reduce((s, z) => s + Number(z.total), 0)}</td>
                    <td>{zoneSales.reduce((s, z) => s + Number(z.sold_count), 0)}</td>
                    <td style={{ color: '#fa8c16' }}>
                      {fmtMoney(zoneSales.reduce((s, z) => s + Number(z.sold_amount), 0))}
                    </td>
                    <td>{zoneSales.reduce((s, z) => s + Number(z.retail_count), 0)}</td>
                    <td>{fmtMoney(zoneSales.reduce((s, z) => s + Number(z.retail_amount), 0))}</td>
                    <td>{zoneSales.reduce((s, z) => s + Number(z.group_verified_count), 0)}</td>
                    <td>{fmtMoney(zoneSales.reduce((s, z) => s + Number(z.group_verified_amount), 0))}</td>
                    <td>{zoneSales.reduce((s, z) => s + Number(z.group_locked_count), 0)}</td>
                    <td>{fmtMoney(zoneSales.reduce((s, z) => s + Number(z.group_locked_amount), 0))}</td>
                    <td>{zoneSales.reduce((s, z) => s + Number(z.unsold_count), 0)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </Card>
      )}

      {/* 团购公司专项 */}
      {tab === 'group' && (
        <Card title="团购公司专项：锁定 / 已核销 / 金额 / 收款 / 核销率">
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>团购公司</th>
                  <th>部门</th>
                  <th>联系人</th>
                  <th>锁定数</th>
                  <th>锁定金额</th>
                  <th>已核销数</th>
                  <th>已核销金额</th>
                  <th>合计车位数</th>
                  <th>合计金额</th>
                  <th>核销率</th>
                  <th>收款</th>
                  <th>发票</th>
                </tr>
              </thead>
              <tbody>
                {groupCompanies.length === 0 && (
                  <tr><td colSpan={12} className="text-center text-gray">暂无团购公司</td></tr>
                )}
                {groupCompanies.map(c => (
                  <tr key={c.company_name}>
                    <td style={{ fontWeight: 600 }}>{c.company_name}</td>
                    <td>{c.department || '—'}</td>
                    <td>{c.contact_person || '—'}</td>
                    <td>{c.locked_count}</td>
                    <td>{fmtMoney(c.locked_amount)}</td>
                    <td>{c.verified_count}</td>
                    <td style={{ color: '#fa8c16' }}>{fmtMoney(c.verified_amount)}</td>
                    <td style={{ fontWeight: 600 }}>{c.total_count}</td>
                    <td style={{ color: '#fa8c16', fontWeight: 600 }}>{fmtMoney(c.total_amount)}</td>
                    <td>{(c.verify_rate * 100).toFixed(1)}%</td>
                    <td>{c.is_paid ? '✅已付' : '⏳未付'}</td>
                    <td>{c.invoice_type || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray" style={{ marginTop: 8 }}>
            锁定 = 团购公司已买下但尚未核销给业主（status='团购锁定'）；
            已核销 = 已转让给业主；核销率 = 已核销 /（锁定 + 已核销）。
          </p>
        </Card>
      )}

      {/* 销售趋势 */}
      {tab === 'trend' && (
        <Card title="销售趋势：按销售日期（sale_date）年月汇总">
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>年月</th>
                  <th>已售车位数</th>
                  <th>已售金额</th>
                  <th>其中零售数</th>
                  <th>零售金额</th>
                  <th>其中团购数</th>
                  <th>团购金额</th>
                </tr>
              </thead>
              <tbody>
                {trend.length === 0 && (
                  <tr><td colSpan={7} className="text-center text-gray">暂无销售日期数据</td></tr>
                )}
                {trend.map(t => (
                  <tr key={t.ym}>
                    <td style={{ fontWeight: 600 }}>{t.ym}</td>
                    <td>{t.sold_count}</td>
                    <td style={{ color: '#fa8c16', fontWeight: 600 }}>{fmtMoney(t.sold_amount)}</td>
                    <td>{t.retail_count}</td>
                    <td>{fmtMoney(t.retail_amount)}</td>
                    <td>{t.group_count}</td>
                    <td>{fmtMoney(t.group_amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray" style={{ marginTop: 8 }}>
            仅统计 sale_date 非空且状态为已售 / 已核销的车位；团购核销不写入销售记录表，故以车位台账的 sale_date 为准。
          </p>
        </Card>
      )}

      {/* 按车库未售 */}
      {tab === 'zone' && (
        <Card title="按车库（区域）统计未售车位个数">
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>车库区域</th>
                  <th>未售个数</th>
                </tr>
              </thead>
              <tbody>
                {unsoldByZone.length === 0 && (
                  <tr><td colSpan={2} className="text-center text-gray">暂无未售车位</td></tr>
                )}
                {unsoldByZone.map(r => (
                  <tr key={r.garage_zone}>
                    <td style={{ fontWeight: 600 }}>{r.garage_zone}</td>
                    <td>{r.unsold_count}</td>
                  </tr>
                ))}
              </tbody>
              {unsoldByZone.length > 0 && (
                <tfoot>
                  <tr style={{ fontWeight: 700 }}>
                    <td>合计</td>
                    <td>{unsoldByZone.reduce((s, r) => s + Number(r.unsold_count || 0), 0)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </Card>
      )}

      {/* 购买最多业主 */}
      {tab === 'top' && (
        <Card title="购买车位最多的业主（按已售车位计数）">
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>排名</th>
                  <th>业主</th>
                  <th>房号</th>
                  <th>车位数</th>
                  <th>金额</th>
                </tr>
              </thead>
              <tbody>
                {topOwners.length === 0 && (
                  <tr><td colSpan={5} className="text-center text-gray">暂无已售记录</td></tr>
                )}
                {topOwners.map((r, i) => (
                  <tr key={r.house_key + r.owner_name + i}>
                    <td style={{ fontFamily: 'monospace' }}>{i + 1}</td>
                    <td style={{ fontWeight: 600 }}>{r.owner_name}</td>
                    <td>{r.house_key || '—'}</td>
                    <td>{r.space_count}</td>
                    <td style={{ color: '#fa8c16', fontWeight: 600 }}>{fmtMoney(r.total_amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* 未购买车位业主 */}
      {tab === 'notbought' && (
        <Card title="未购买车位的业主（在业主档案中但名下无已售/已核销车位）">
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>房号</th>
                  <th>楼栋</th>
                  <th>单元</th>
                  <th>房间</th>
                  <th>业主</th>
                  <th>电话</th>
                </tr>
              </thead>
              <tbody>
                {notBought.length === 0 && (
                  <tr><td colSpan={6} className="text-center text-gray">所有业主均已购买车位</td></tr>
                )}
                {notBought.map(r => (
                  <tr key={r.house_key}>
                    <td style={{ fontWeight: 600 }}>{r.house_key || '—'}</td>
                    <td>{r.building_no || '—'}</td>
                    <td>{r.unit_no || '—'}</td>
                    <td>{r.room_no || '—'}</td>
                    <td>{r.owner_name}</td>
                    <td style={{ fontFamily: 'monospace' }}>{r.phone || '—'}</td>
                  </tr>
                ))}
              </tbody>
              {notBought.length > 0 && (
                <tfoot>
                  <tr style={{ fontWeight: 700 }}>
                    <td colSpan={3}>共 {notBought.length} 位业主未购买</td>
                    <td colSpan={3}></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </Card>
      )}

      {/* 按户车位统计 */}
      {tab === 'house' && (
        <Card title="按户（楼号-单元号-房号）统计车位：一户几个车位 / 车位号 / 金额">
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>楼号</th>
                  <th>单元</th>
                  <th>房号</th>
                  <th>房号(完整)</th>
                  <th>业主</th>
                  <th>车位数</th>
                  <th>车位号</th>
                  <th>金额</th>
                </tr>
              </thead>
              <tbody>
                {houseSpaces.length === 0 && (
                  <tr><td colSpan={8} className="text-center text-gray">暂无已售/已核销车位</td></tr>
                )}
                {houseSpaces.map((r, i) => (
                  <tr key={(r.house_key || '') + i}>
                    <td style={{ fontWeight: 600 }}>{r.building_no || '—'}</td>
                    <td>{r.unit_no || '—'}</td>
                    <td>{r.room_no || '—'}</td>
                    <td>{r.house_key || '—'}</td>
                    <td>{r.owner_name || '—'}</td>
                    <td>{r.space_count}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: 12, maxWidth: 360, wordBreak: 'break-all' }}>{r.space_ids || '—'}</td>
                    <td style={{ color: '#fa8c16', fontWeight: 600 }}>{fmtMoney(r.total_amount)}</td>
                  </tr>
                ))}
              </tbody>
              {houseSpaces.length > 0 && (
                <tfoot>
                  <tr style={{ fontWeight: 700, background: '#fafafa' }}>
                    <td colSpan={5}>合计（{houseSpaces.length} 户）</td>
                    <td>{houseSpaces.reduce((s, r) => s + Number(r.space_count), 0)}</td>
                    <td></td>
                    <td style={{ color: '#fa8c16' }}>
                      {fmtMoney(houseSpaces.reduce((s, r) => s + Number(r.total_amount), 0))}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          <p className="text-xs text-gray" style={{ marginTop: 8 }}>
            按「楼号-单元号-房号」聚合；仅统计 status='已售'/'已核销' 的车位（与「购买最多业主」口径一致）；车位号为该户所有车位逗号分隔。
          </p>
        </Card>
      )}

      {/* AI 智能问数 */}
    </div>
  )
}
