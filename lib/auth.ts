// lib/auth.ts
import NextAuth from 'next-auth'
import type { NextAuthOptions } from 'next-auth'
import { getServerSession } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import pool from './db'

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        username: { label: '账号', type: 'text' },
        password: { label: '密码', type: 'password' },
        code: { label: '邮箱验证码', type: 'text' },
      },
      async authorize(credentials) {
        if (!credentials?.username || !credentials?.password) {
          return null
        }

        // 先查数据库有没有这个用户
        let rows: any[]
        try {
          const res = await pool.query(
            `SELECT id, username, password_hash, role, email
             FROM public.admin_user  -- 显式指定public schema，避免连错库
             WHERE username = $1`,
            [credentials.username]
          )
          rows = res.rows
        } catch (err) {
          // 把数据库错误暴露出来，避免被统一误判为“账号密码错误”
          console.error('[auth] DB query failed:', (err as Error)?.message, (err as any)?.code)
          throw new Error('数据库连接失败：' + ((err as Error)?.message || String(err)))
        }
        console.log('[auth] rows.length=', rows.length)

        if (rows.length === 0) {
          return null
        }

        const isValid = await bcrypt.compare(
          credentials.password,
          rows[0].password_hash
        )
        console.log('[auth] isValid=', isValid)

        if (!isValid) return null

        const user = rows[0]

        // 双重验证（2FA）：已绑定邮箱的账号，密码正确后还需校验邮箱验证码
        if (user.email) {
          const code = credentials.code
          if (!code) return null
          const otpRes = await pool.query(
            `SELECT code, expires_at FROM email_otp
             WHERE email = $1 ORDER BY created_at DESC LIMIT 1`,
            [user.email]
          )
          if (otpRes.rowCount === 0) return null
          const otp = otpRes.rows[0]
          if (new Date(otp.expires_at).getTime() < Date.now()) return null
          if (otp.code !== code) return null
          // 一次性消费，防止验证码复用
          await pool.query('DELETE FROM email_otp WHERE email = $1', [user.email])
        }

        return {
          id: user.id.toString(),
          name: user.username,
          role: user.role,
          display_name: user.display_name || undefined,
          permissions: user.role >= 2
            ? undefined // role>=2 视为全权限，由前端判定
            : (user.permissions || '{}').startsWith('[')
              ? JSON.parse(user.permissions)
              : [],
        }
      },
    }),
  ],
  session: {
    strategy: 'jwt',
    // 会话有效期 1 小时：浏览器关闭后最多保留 1 小时，超时再打开即要求重新登录
    maxAge: 60 * 60,
    // 滑动续期：有操作（每次请求）时每 30 分钟把过期时间顺延 1 小时，
    // 无操作的空闲/关闭浏览器超过 1 小时后自动断开
    updateAge: 30 * 60,
  },
  pages: {
    signIn: '/login',
  },
  callbacks: {
    async jwt({ token, user }) {
      // 登录成功后把角色/权限/身份 写入 JWT
      if (user) {
        token.id = (user as { id?: string }).id
        token.username = (user as { username?: string }).username ?? (user as { name?: string }).name
        token.role = (user as { role?: number }).role
        token.display_name = (user as { display_name?: string }).display_name
        token.permissions = (user as { permissions?: string[] }).permissions
      }
      return token
    },
    async session({ session, token }) {
      // 从 JWT 把角色/权限/身份 读到 session.user
      if (session.user) {
        ;(session.user as { id?: string }).id = token.id
        ;(session.user as { username?: string }).username = token.username
        ;(session.user as { role?: number }).role = token.role as number | undefined
        ;(session.user as { display_name?: string }).display_name = token.display_name as string | undefined
        ;(session.user as { permissions?: string[] }).permissions = token.permissions as string[] | undefined
      }
      return session
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
}

// 供 Server Component 获取会话（替代 NextAuth v5 的 auth()）
export function auth() {
  return getServerSession(authOptions)
}

export default NextAuth(authOptions)
