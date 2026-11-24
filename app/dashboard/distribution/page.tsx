import Link from 'next/link'
import { auth } from '@/lib/auth'
import { getUnsoldSpacesByZone, getMappedSpacesByZone } from '@/lib/queries'
import { GARAGE_ZONES, ZONE_BASEMAP } from '@/lib/types'
import SignOutButton from '../sign-out-button'
import LiveMap from './live-map'
import SpaceQuery from './space-query'

// ============================================================
//  车位分布图 - 动态图（底图随代码发布，不再依赖后台上传）
//  - guest(role=0) 只显示未售车位，且不可切换
//  - 其他角色默认显示全部，可勾选"仅未售"
// ============================================================

// 底图映射见 lib/types.ts 的 ZONE_BASEMAP（分布页与查询局部图共用）

export default async function DistributionPage() {
  const session = await auth()
  if (!session) throw new Error('未登录')

  const user = session.user as any
  const role = user?.role ?? 1
  const isGuest = role === 0
  const displayName = user?.display_name || user?.name

  const zonesData = await Promise.all(
    GARAGE_ZONES.map(async z => ({
      zone: z,
      unsold: await getUnsoldSpacesByZone(z),
      mapped: await getMappedSpacesByZone(z),
    }))
  )

  return (
    <main className="dist-page" style={{ maxWidth: 1200, margin: '0 auto', padding: '24px' }}>
      <header className="flex dist-header" style={{ justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700 }}>🅿️ 车位分布图</h1>
          <p className="text-sm text-gray">
            欢迎，{displayName} · 角色：{role === 3 ? '超级管理员' : role === 2 ? '管理员' : role === 1 ? '销售员' : '访客'}
            {isGuest && ' · 仅显示未售车位'}
          </p>
        </div>
        <div className="flex dist-actions" style={{ gap: 8 }}>
          {role !== 0 && <Link href="/dashboard" className="btn-ghost" style={{ fontSize: 14 }}>返回首页</Link>}
          <SignOutButton />
        </div>
      </header>

      {/* 区域快速导航：手机端横向滚动，点按跳到对应分区 */}
      <nav className="dist-zone-nav" style={{ display: 'none', gap: 8, marginBottom: 16 }}>
        {zonesData.map(({ zone, unsold }, i) => (
          <a key={zone} href={`#dist-zone-${i}`}>{zone} · 未售 {unsold.length}</a>
        ))}
      </nav>

      <SpaceQuery />

      <div className="grid dist-zones" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 20 }}>
        {zonesData.map(({ zone, unsold, mapped }, zi) => {
          const imageUrl = ZONE_BASEMAP[zone] || null
          return (
            <section key={zone} id={`dist-zone-${zi}`} className="card dist-zone-card" style={{ padding: 16, scrollMarginTop: 12 }}>
              <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 10 }}>
                {zone} <span className="text-sm text-gray">（未售 {unsold.length} 个）</span>
              </h2>

              {/* 未售车位列表 */}
              <div style={{ marginTop: 4, marginBottom: 14 }}>
                <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>未售车位</h3>
                {unsold.length === 0 ? (
                  <p className="text-sm text-gray">该区暂无未售车位</p>
                ) : (
                  <div className="dist-unsold-wrap" style={{ maxHeight: 220, overflowY: 'auto' }}>
                    <table className="dist-unsold-table">
                      <thead>
                        <tr>
                          <th style={{ fontSize: 14 }}>车位号</th>
                          <th className="dist-col-type" style={{ fontSize: 14 }}>车位类型</th>
                          <th style={{ fontSize: 14 }}>价格(元)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {unsold.map(s => (
                          <tr key={s.space_id}>
                            <td style={{ fontSize: 14 }}>{s.space_id}</td>
                            <td className="dist-col-type" style={{ fontSize: 14 }}>{s.space_type || '-'}</td>
                            <td style={{ fontSize: 14 }}>{s.price ?? '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {mapped.length > 0 && imageUrl ? (
                <LiveMap
                  zone={zone}
                  imageUrl={imageUrl}
                  initialSpaces={(isGuest ? unsold : mapped) as any}
                  forceUnsoldOnly={isGuest}
                  canEdit={role >= 2}
                />
              ) : (
                <div style={{
                  padding: 24, textAlign: 'center', color: '#999',
                  background: '#f5f5f5', border: '1px dashed #d9d9d9', borderRadius: 8,
                }}>
                  该区暂无分布数据
                </div>
              )}
            </section>
          )
        })}
      </div>
    </main>
  )
}
