import { auth } from '@/lib/auth'
import Sidebar, { type NavItem } from './components/sidebar'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await auth()
  const user = (session?.user as any) || {}
  const role = user?.role ?? 1
  const perms: string[] = role >= 2 ? [] : (user?.permissions || [])
  const can = (p: string) => role >= 2 || perms.includes(p)

  const allItems: NavItem[] = [
    { href: '/dashboard', label: '概览', icon: '🏠', perm: 'public', group: '工作台' },
    { href: '/dashboard/spaces', label: '销控图', icon: '🗺️', perm: 'spaces', group: '车位' },
    { href: '/dashboard/spaces/manage', label: '车位管理', icon: '➕', perm: 'spaces', group: '车位' },
    { href: '/dashboard/spaces/edit', label: '车位修改', icon: '✏️', perm: 'spaces', group: '车位' },
    { href: '/dashboard/spaces/logs', label: '台账变更日志', icon: '📋', perm: 'spaces', group: '报表' },
    { href: '/dashboard/query', label: '车位查询', icon: '🔍', perm: 'spaces', group: '车位' },
    { href: '/dashboard/sale', label: '车位销售', icon: '💰', perm: 'sale', group: '业务' },
    { href: '/dashboard/swap', label: '车位调换', icon: '🔄', perm: 'swap', group: '业务' },
    { href: '/dashboard/group-buy', label: '团购管理', icon: '🏢', perm: 'group', group: '业务' },
    { href: '/dashboard/invoices', label: '发票开取登记', icon: '🧾', perm: 'invoice', group: '业务' },
    { href: '/dashboard/records', label: '销售记录', icon: '📋', perm: 'sale', group: '报表' },
    { href: '/dashboard/reports', label: '统计报表', icon: '📊', perm: 'sale', group: '报表' },
    { href: '/dashboard/owners', label: '业主信息变更', icon: '👤', perm: 'owners', group: '业务' },
    { href: '/dashboard/distribution', label: '车位分布图', icon: '🅿️', perm: 'public', group: '报表' },
    { href: '/dashboard/print', label: '表单打印', icon: '🖨️', perm: 'print', group: '报表' },
    { href: '/dashboard/logs', label: '调换记录', icon: '📜', perm: 'spaces', group: '报表' },
    { href: '/dashboard/users', label: '用户与角色', icon: '👥', perm: 'users', group: '系统' },
  ]

  const items = allItems.filter(it => can(it.perm))

  return (
    <div className={`app-shell${role === 0 ? ' app-shell-guest' : ''}`}>
      <Sidebar
        items={items}
        user={{ displayName: user.displayName, name: user.name, role }}
      />
      <div className="app-content">{children}</div>
    </div>
  )
}
