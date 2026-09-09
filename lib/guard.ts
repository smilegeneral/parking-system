import { getServerSession } from 'next-auth'
import { authOptions } from './auth'
import pool from './db'

// 与 types/next-auth.d.ts 中 Session.user.role?: number 保持一致
type Role = number

export type SessionUser = {
  id: number
  username: string
  role: Role
  name: string
}

// 兼容旧版登录会话：老会话签发的 JWT 里没有 role 字段，此时若直接按 0（访客）处理，
// 会让超级管理员/管理员在执行写操作时被误判为「权限不足」。
// 这里回退到数据库按 id 查询真实角色；查询失败返回 null，仍按无权限处理，不改变原有失败行为。
async function fetchRoleFromDb(id: number): Promise<number | null> {
  try {
    const res = await pool.query(`SELECT role FROM admin_user WHERE id = $1`, [id])
    const raw = res.rows[0]?.role
    if (raw === undefined || raw === null) return null
    const n = Number(raw)
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await getServerSession(authOptions)
  const rawId = session?.user?.id
  if (!rawId) return null
  const id = Number(rawId)
  if (!Number.isFinite(id)) return null

  // session 中缺失 role（旧 JWT）时回退查库，避免把高权限账号降级成访客
  let role = session.user.role as number | null | undefined
  if (role === undefined || role === null) {
    role = await fetchRoleFromDb(id)
  }

  return {
    id,
    username: session.user.username || session.user.name || '',
    role: (role ?? 0) as Role,
    name: session.user.name || session.user.username || '',
  }
}

/**
 * 校验当前登录用户，并强制其角色达到要求的最低等级。
 * role 数值越大权限越高：0=访客 1=销售员 2=管理员。
 * 返回 sessionUser；若未登录或权限不足，返回 null（调用方应返回 401/403）。
 */
export async function requireRole(minRole: Role): Promise<SessionUser | null> {
  const u = await getSessionUser()
  if (!u) return null
  if (u.role < minRole) return null
  return u
}
