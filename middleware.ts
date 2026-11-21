// middleware.ts
import { decode } from 'next-auth/jwt'
import { NextRequest, NextResponse } from 'next/server'

// 与 lib/auth.ts 的 cookies 配置保持一致：统一使用「无前缀 + 非 Secure」的会话 Cookie 名，
// 使 http(localhost 排障) 与 https(Cloudflare 隧道 parks.cc.cd) 都能正常保存会话。
// 注意：next-auth 的 withAuth 会按 NEXTAUTH_URL 推断 Cookie 名（https 下为 __Secure- 前缀），
// 与本项目显式改写的非前缀名不一致会导致登录后被中间件踢回 /login；
// 因此这里手动按显式名读取并 decode，而不是用 withAuth。
const SESSION_COOKIE = 'next-auth.session-token'

// 角色等级：0=访客 1=销售员 2=管理员 3=超级管理员
const ROLE_GUEST = 0
const ROLE_ADMIN = 2

// 仅管理员可访问的路由前缀
const ADMIN_ONLY_PREFIXES = [
  '/dashboard/users',
  '/dashboard/print',
  '/dashboard/reports',
  '/dashboard/owners',
]

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // 服务端 action（Next.js Server Action 请求带 next-action 头）不做重定向，
  // 交由各 action 自身的 requireRole 鉴权。否则中间件把 action 的 POST 重定向到
  // /login，浏览器 fetch 跟随重定向后拿不到 action 响应，前端会报 “Failed to fetch”。
  if (req.headers.get('next-action')) {
    return NextResponse.next()
  }

  const tokenValue = req.cookies.get(SESSION_COOKIE)?.value

  const redirectToLogin = () => {
    const url = new URL('/login', req.url)
    url.searchParams.set('callbackUrl', pathname + req.nextUrl.search)
    return NextResponse.redirect(url)
  }

  if (!tokenValue) {
    return redirectToLogin()
  }

  let token: { role?: number } | null = null
  try {
    token = await decode({ token: tokenValue, secret: process.env.NEXTAUTH_SECRET! })
  } catch {
    token = null
  }

  // 解析不到（Cookie 无效/过期）视为未登录
  if (!token) {
    return redirectToLogin()
  }

  const role = token.role as number

  // 访客（role=0）仅可访问车位分布图
  if (role === ROLE_GUEST) {
    if (pathname === '/dashboard/distribution') return NextResponse.next()
    return NextResponse.redirect(new URL('/dashboard/distribution', req.url))
  }

  // 管理员专属路由：role < 2 拦截
  if (
    ADMIN_ONLY_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'))
  ) {
    if (role < ROLE_ADMIN) {
      const url = new URL('/dashboard', req.url)
      url.searchParams.set('error', 'admin_only')
      return NextResponse.redirect(url)
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/dashboard/:path*', '/api/admin/:path*'],
}
