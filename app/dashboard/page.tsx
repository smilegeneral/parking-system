import Link from 'next/link'
import { auth } from '@/lib/auth'
import { getSpaceStats, getZones } from '@/lib/queries'
import SignOutButton from './sign-out-button'

// ============================================================
//  仪表盘 - 纯 Server Component，服务端直查 Aiven
// ============================================================

export default async function DashboardPage() {
  const session = await auth()
  if (!session) throw new Error('未登录')

  const user = session.user as any
  const role = user?.role ?? 1
  // 权限判定：role>=2 视为全权限；role=1 以 permissions 数组为准
  const perms: string[] = role >= 2 ? [] : (user?.permissions || [])
  const can = (p: string) => role >= 2 || perms.includes(p)

  const [stats, zones] = await Promise.all([
    getSpaceStats(),
    getZones(),
  ])

  // 访客（role=0）仅可访问车位分布图
  const isGuest = role === 0

  const navItems = isGuest
    ? [{ href: '/dashboard/distribution', label: '🅿️ 车位分布图', desc: '查看各车库车位分布与未售车位', perm: 'public' }]
    : [
        { href: '/dashboard/spaces', label: '🗺️ 销控图', desc: '查看全部车位状态，预订/销售', perm: 'spaces' },
        { href: '/dashboard/spaces/manage', label: '➕ 车位管理', desc: '新增车位 / 取消车位（未售→取消）', perm: 'spaces' },
        { href: '/dashboard/spaces/edit', label: '✏️ 车位修改', desc: '修改未售车位价格、类型（单个/按类型批量）', perm: 'spaces' },
        { href: '/dashboard/spaces/logs', label: '📋 台账变更日志', desc: '查询车位新增/取消时间与原因', perm: 'spaces' },
        { href: '/dashboard/query', label: '🔍 车位查询', desc: '多条件模糊查询车位', perm: 'spaces' },
        { href: '/dashboard/sale', label: '💰 车位销售', desc: '预订/直接销售车位给业主', perm: 'sale' },
        { href: '/dashboard/swap', label: '🔄 车位调换', desc: '业主间互换或换回开发商池', perm: 'swap' },
        { href: '/dashboard/group-buy', label: '🏢 团购管理', desc: '公司团购下单 + 核销转业主', perm: 'group' },
        { href: '/dashboard/records', label: '📋 销售记录', desc: '查看历史销售与凭证', perm: 'sale' },
        { href: '/dashboard/owners', label: '👤 业主信息变更', desc: '查看业主档案、变更联系方式，变更留痕', perm: 'owners' },
        { href: '/dashboard/distribution', label: '🅿️ 车位分布图', desc: '查看各车库车位分布与未售车位', perm: 'public' },
        { href: '/dashboard/print', label: '🖨️ 表单打印', desc: '查询表单打印与业务表单模板', perm: 'print' },
        { href: '/dashboard/logs', label: '📜 调换记录', desc: '车位调换/业主变更全留痕', perm: 'spaces' },
        { href: '/dashboard/users', label: '👥 用户与角色', desc: '账号、角色与权限管理', perm: 'users' },
      ].filter(item => can(item.perm))

  return (
    <main style={{ maxWidth: 1100, margin: '0 auto', padding: '24px' }}>
      {/* 顶部 */}
      <header className="flex" style={{ justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>车位管理系统</h1>
          <p className="text-sm text-gray">
            欢迎，{user?.display_name || user?.name} · 角色：{role === 3 ? '超级管理员' : role === 2 ? '管理员' : role === 1 ? '销售员' : '访客'}
          </p>
        </div>
        <div className="flex" style={{ gap: 8 }}>
          {!isGuest && <Link href="/dashboard/change-password" className="btn-ghost" style={{ fontSize: 13 }}>修改密码</Link>}
          <SignOutButton />
        </div>
      </header>

      {isGuest ? (
        // 访客：仅展示车位分布图入口
        <section className="grid" style={{
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px,1fr))',
        }}>
          {navItems.map(item => (
            <Link
              key={item.href}
              href={item.href}
              style={{
                display: 'block', padding: 24, background: '#fff',
                borderRadius: 8, boxShadow: '0 1px 4px rgba(0,0,0,.06)',
                border: '1px solid #f0f0f0', transition: 'all .2s',
              }}
            >
              <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>{item.label}</div>
              <div className="text-sm text-gray">{item.desc}</div>
            </Link>
          ))}
        </section>
      ) : (
      <>
      {/* 统计卡片 */}
      <section className="grid" style={{
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px,1fr))',
        marginBottom: 24,
      }}>
        <StatCard label="总车位" value={stats.total} color="#333" />
        <StatCard label="未售" value={stats.unsold} color="#52c41a" dotClass="dot-unsold" />
        <StatCard label="预订" value={stats.retail_locked} color="#faad14" dotClass="dot-locked" />
        <StatCard label="已售" value={stats.sold} color="#1677ff" dotClass="dot-sold" />
        <StatCard label="团购锁定" value={stats.group_locked} color="#fa8c16" dotClass="dot-group-locked" />
        <StatCard label="团购已售" value={stats.group_verified} color="#722ed1" dotClass="dot-verified" />
        <StatCard label="取消车位" value={stats.cancelled} color="#ff4d4f" dotClass="dot-cancelled" />
      </section>

      {/* 区域快捷入口 */}
      <section className="card mb-4">
        <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>按区域查看销控图</h2>
        <div className="flex" style={{ flexWrap: 'wrap', gap: 8 }}>
          {zones.map(z => (
            <Link
              key={z}
              href={`/dashboard/spaces?zone=${encodeURIComponent(z)}`}
              style={{
                padding: '6px 14px', background: '#e6f7ff',
                color: '#1677ff', borderRadius: 4, fontSize: 13,
                border: '1px solid #91d5ff',
              }}
            >
              {z}
            </Link>
          ))}
        </div>
      </section>

      {/* 功能导航 */}
      <section className="grid" style={{
        gridTemplateColumns: 'repeat(auto-fit, minmax(280px,1fr))',
      }}>
        {navItems.map(item => (
          <Link
            key={item.href}
            href={item.href}
            style={{
              display: 'block', padding: 20, background: '#fff',
              borderRadius: 8, boxShadow: '0 1px 4px rgba(0,0,0,.06)',
              border: '1px solid #f0f0f0', transition: 'all .2s',
            }}
          >
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
              {item.label}
            </div>
            <div className="text-sm text-gray">{item.desc}</div>
          </Link>
        ))}
      </section>
      </>
      )}
    </main>
  )
}

function StatCard({
  label, value, color, dotClass,
}: {
  label: string; value: number; color: string; dotClass?: string
}) {
  return (
    <div className="card" style={{ textAlign: 'center' }}>
      <div className="text-sm text-gray mb-2">
        {dotClass && <span className={`status-dot ${dotClass}`} />}
        {label}
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, color }}>{value}</div>
    </div>
  )
}
