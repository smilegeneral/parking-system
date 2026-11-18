import Link from 'next/link'
import { auth } from '@/lib/auth'
import { getInvoiceRecords, getInvoiceSummary } from '@/lib/queries'
import InvoiceForm from './invoice-form'
import InvoiceImport from './invoice-import'
import InvoiceRecordTable from './invoice-record-table'

export const dynamic = 'force-dynamic'

function fmtMoney(n: number) {
  return `¥${Number(n || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// ============================================================
//  发票开取登记
//  登记已售 / 已核销车位的开票信息，车位标记「已开票」，
//  业主信息同步统计已开票 / 未开票车位数量
// ============================================================
export default async function InvoicesPage() {
  const session = await auth()
  const user = (session?.user as any) || {}
  const role = user?.role ?? 1
  const canCancel = role >= 2   // 作废登记仅管理员
  const operator = user?.displayName || user?.name || ''

  const [summary, records] = await Promise.all([
    getInvoiceSummary(),
    getInvoiceRecords(200),
  ])

  return (
    <main style={{ maxWidth: 1180, margin: '0 auto', padding: '24px' }}>
      <header className="flex mb-4" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700 }}>🧾 发票开取登记</h1>
          <p className="text-sm text-gray">
            日常：先销售车位，再在上方逐车位登记（一车位一发票）；前期已售车位补开发票用下方批量导入（一票可含多车位）
          </p>
        </div>
        <Link href="/dashboard" style={{ fontSize: 14 }}>← 返回</Link>
      </header>

      {/* 统计卡片 */}
      <div className="grid mb-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <div className="card" style={{ padding: 14 }}>
          <div className="text-sm text-gray">已开票车位</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: '#16a34a' }}>{summary.invoiced_spaces}</div>
        </div>
        <div className="card" style={{ padding: 14 }}>
          <div className="text-sm text-gray">未开票车位</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: '#d97706' }}>{summary.uninvoiced_spaces}</div>
        </div>
        <div className="card" style={{ padding: 14 }}>
          <div className="text-sm text-gray">登记笔数（有效）</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{summary.invoice_count}</div>
        </div>
        <div className="card" style={{ padding: 14 }}>
          <div className="text-sm text-gray">开票金额合计</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#2563eb' }}>{fmtMoney(summary.invoice_amount)}</div>
        </div>
      </div>

      <section className="card mb-4" style={{ padding: 16 }}>
        <InvoiceForm operator={operator} />
        <InvoiceImport />
      </section>

      <section className="card" style={{ padding: 16 }}>
        <InvoiceRecordTable records={records as any} canCancel={canCancel} />
      </section>
    </main>
  )
}
