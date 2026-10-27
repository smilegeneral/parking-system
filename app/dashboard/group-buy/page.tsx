import {
  getAllGroupCompanies,
  getSpacesByStatus,
  getGroupBuyPurchases,
  getGroupBuyStats,
  getUnsoldSpacesForGroupBuy,
  getGroupBuyVerifyDetails,
} from '@/lib/queries'
import GroupBuyPanel from './group-buy-panel'
import VerifyPanel from './verify-panel'
import PurchasePanel from './purchase-panel'
import StatsPanel from './stats-panel'
import { PurchaseSlipButton, VerifySlipButton } from './group-buy-print'
import Link from 'next/link'

// ============================================================
//  团购管理 - 团购下单 + 公司购买 + 核销转业主 + 调换
// ============================================================

export const dynamic = 'force-dynamic'

export default async function GroupBuyPage() {
  // 任一查询失败只影响对应分区，不让整页白屏；真实错误打印在服务端日志便于排查
  const q = async <T,>(p: Promise<T>, fallback: T): Promise<T> => {
    try {
      return await p
    } catch (e) {
      console.error('[group-buy] query failed:', e)
      return fallback
    }
  }
  const [companies, unsold, purchases, statsByDept, statsByCompany, locked, verifyDetails] =
    await Promise.all([
      q(getAllGroupCompanies(), []),
      q(getUnsoldSpacesForGroupBuy(), []),
      q(getGroupBuyPurchases(), []),
      q(getGroupBuyStats('department'), []),
      q(getGroupBuyStats('company'), []),
      q(getSpacesByStatus('团购锁定'), []),
      q(getGroupBuyVerifyDetails(), []),
    ])

  return (
    <main style={{ maxWidth: 1100, margin: '0 auto', padding: '24px' }}>
      <header className="flex mb-4" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700 }}>🏢 团购管理</h1>
          <p className="text-sm text-gray">团购公司批量购车位 → 车位调换 → 逐个核销转给业主</p>
        </div>
        <Link href="/dashboard" style={{ fontSize: 14 }}>← 返回</Link>
      </header>

      {/* 概览 */}
      <section className="grid mb-4" style={{ gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
        <div className="card text-center">
          <div className="text-sm text-gray">团购公司</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{companies.length}</div>
        </div>
        <div className="card text-center">
          <div className="text-sm text-gray">团购锁定中</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: '#fa8c16' }}>{locked.length}</div>
        </div>
        <div className="card text-center">
          <div className="text-sm text-gray">可购未售</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: '#52c41a' }}>{unsold.length}</div>
        </div>
      </section>

      {/* 团购统计（下拉筛选 + 明细） */}
      <section className="card mb-4">
        <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>团购统计</h2>
        <StatsPanel
          byDept={statsByDept}
          byCompany={statsByCompany}
        />
      </section>

      {/* 团购公司购买登记 */}
      <section className="card mb-4">
        <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>团购公司购买登记</h2>
        <PurchasePanel companies={companies} unsold={unsold} />
      </section>

      {/* 团购车位调换 */}
      <section className="card mb-4">
        <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>团购车位调换</h2>
        <GroupBuyPanel companies={companies} />
      </section>

      {/* 团购核销 */}
      <section className="card mb-4">
        <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>团购核销（公司→业主）</h2>
        {locked.length === 0 ? (
          <p className="text-gray text-sm">暂无团购锁定车位可核销。</p>
        ) : (
          <VerifyPanel lockedSpaces={locked} companies={companies} />
        )}
      </section>

      {/* 团购公司购买记录 */}
      <section className="card mb-4">
        <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>团购公司购买记录</h2>
        {purchases.length === 0 ? (
          <p className="text-gray text-sm">暂无购买记录。</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ fontSize: 12 }}>
              <thead>
                <tr>
                  <th>公司名称</th><th>部门</th><th>联系人</th><th>电话</th>
                  <th>数量</th><th>车位号</th><th>团购车位金额（实际卖价）</th><th>付款</th><th>发票</th><th>登记时间</th><th>操作</th>
                </tr>
              </thead>
              <tbody>
                {purchases.map((p) => (
                  <tr key={p.purchase_id}>
                    <td>{p.company_name}</td>
                    <td>{p.department || '-'}</td>
                    <td>{p.contact_person || '-'}</td>
                    <td>{p.contact_phone || '-'}</td>
                    <td>{p.space_count}</td>
                    <td style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.space_list}>
                      {p.space_list || '-'}
                    </td>
                    <td>¥{Number(p.amount).toLocaleString()}</td>
                    <td>{p.is_paid ? '✅已付' : '⏳未付'}</td>
                    <td>{p.invoice_type}</td>
                    <td>{fmtTime(p.created_at)}</td>
                    <td>
                      <PurchaseSlipButton p={p} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 团购核销明细 */}
      <section className="card">
        <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>团购核销明细</h2>
        {verifyDetails.length === 0 ? (
          <p className="text-gray text-sm">暂无核销明细记录。</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ fontSize: 12 }}>
              <thead>
                <tr>
                  <th>团购公司</th><th>车位号</th><th>业主</th><th>房号</th><th>核销金额（对外出售价·参考）</th>
                  <th>确认单号</th><th>核销日期</th><th>经办人</th><th>操作</th>
                </tr>
              </thead>
              <tbody>
                {verifyDetails.map((v) => (
                  <tr key={v.verify_id}>
                    <td>{v.company_name || '-'}</td>
                    <td>{v.space_id || '-'}</td>
                    <td>{v.owner_name || '-'}</td>
                    <td>{v.house_key || '-'}</td>
                    <td>¥{Number(v.sale_amount).toLocaleString()}</td>
                    <td>{v.receipt_no || '-'}</td>
                    <td>{v.verify_date ? fmtDate(v.verify_date) : fmtTime(v.created_at).slice(0, 10)}</td>
                    <td>{v.operator || '-'}</td>
                    <td>
                      <VerifySlipButton v={v} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  )
}

function fmtTime(v: any): string {
  if (!v) return '-'
  if (v instanceof Date) return v.toLocaleString('zh-CN')
  if (typeof v === 'string') {
    const d = new Date(v)
    if (!isNaN(d.getTime())) return d.toLocaleString('zh-CN')
    return v
  }
  return String(v)
}

function fmtDate(v: any): string {
  if (!v) return '-'
  const d = v instanceof Date ? v : new Date(v)
  if (isNaN(d.getTime())) {
    const s = String(v)
    return s.slice(0, 10)
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
