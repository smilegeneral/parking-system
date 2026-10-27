import {
  getReportSummary,
  getSalesComposition,
  getZoneSalesBreakdown,
  getGroupCompanyStats,
  getSalesTrend,
  getStatsByZone,
  getUnsoldByZone,
  getTopOwners,
  getOwnersNotBought,
  getHouseSpaceStats,
} from '@/lib/queries'
import ReportClient from './report-client'

// 该页需在请求时查库，禁止构建期静态预渲染
export const dynamic = 'force-dynamic'

export default async function ReportsPage() {
  // 任一查询失败只影响对应分区，不让整页白屏；真实错误打印在服务端日志便于排查
  const q = async <T,>(p: Promise<T>, fallback: T): Promise<T> => {
    try {
      return await p
    } catch (e) {
      console.error('[reports] query failed:', e)
      return fallback
    }
  }

  const [summary, sales, zoneSales, groupCompanies, trend, zones, unsoldByZone, topOwners, notBought, houseSpaces] =
    await Promise.all([
      q(getReportSummary(), { total_sold_amount: 0, total_sold_count: 0, group_verified_count: 0, total_unsold: 0 }),
      q(getSalesComposition(), { total_spaces: 0, sold_count: 0, sold_amount: 0, retail_count: 0, retail_amount: 0, group_verified_count: 0, group_verified_amount: 0, group_locked_count: 0, group_locked_amount: 0, total_count: 0, total_amount: 0, unsold_count: 0 }),
      q(getZoneSalesBreakdown(), []),
      q(getGroupCompanyStats(), []),
      q(getSalesTrend(), []),
      q(getStatsByZone(), []),
      q(getUnsoldByZone(), []),
      q(getTopOwners(20), []),
      q(getOwnersNotBought(), []),
      q(getHouseSpaceStats(), []),
    ])

  return (
    <main style={{ maxWidth: 1280, margin: '0 auto', padding: '24px' }}>
      <header className="flex mb-4" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700 }}>📊 统计报表</h1>
          <p className="text-sm text-gray">车位销售与业主维度常用统计</p>
        </div>
      </header>

      <ReportClient
        summary={summary}
        sales={sales}
        zoneSales={zoneSales}
        groupCompanies={groupCompanies}
        trend={trend}
        zones={zones}
        unsoldByZone={unsoldByZone}
        topOwners={topOwners}
        notBought={notBought}
        houseSpaces={houseSpaces}
      />
    </main>
  )
}
