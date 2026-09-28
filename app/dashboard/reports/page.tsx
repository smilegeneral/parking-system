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
  const [summary, sales, zoneSales, groupCompanies, trend, zones, unsoldByZone, topOwners, notBought, houseSpaces] =
    await Promise.all([
      getReportSummary(),
      getSalesComposition(),
      getZoneSalesBreakdown(),
      getGroupCompanyStats(),
      getSalesTrend(),
      getStatsByZone(),
      getUnsoldByZone(),
      getTopOwners(20),
      getOwnersNotBought(),
      getHouseSpaceStats(),
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
