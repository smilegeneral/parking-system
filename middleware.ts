// middleware.ts
import { withAuth } from 'next-auth/middleware'
import { NextResponse } from 'next/server'

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

export default withAuth(
  function middleware(req) {
    const token = req.nextauth.token
    const { pathname } = req.nextUrl

    // 服务端 action（Next.js Server Action 请求带 next-action 头）不做重定向，
    // 交由各 action 自身的 requireRole 鉴权。否则中间件把 action 的 POST 重定向到
    // /login，浏览器 fetch 跟随重定向后拿不到 action 响应，前端会报 “Failed to fetch”。
    if (req.headers.get('next-action')) {
      return NextResponse.next()
    }

    // 未登录：跳登录页并携带回调地址
    if (!token) {
      const url = new URL('/login', req.url)
      url.searchParams.set('callbackUrl', pathname)
      return NextResponse.redirect(url)
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
  },
  {
    callbacks: {
      // 正常页面要求已登录；服务端 action 请求一律放行，由 action 内部鉴权，
      // 避免 withAuth 在会话过期时把 action POST 重定向到 /login 引发 “Failed to fetch”
      authorized: ({ req, token }) =>
        !!token || !!req?.headers?.get?.('next-action'),
    },
    pages: {
      signIn: '/login',
    },
  }
)

export const config = {
  matcher: ['/dashboard/:path*', '/api/admin/:path*'],
}