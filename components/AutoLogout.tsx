'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { signOut } from 'next-auth/react'

// 30 分钟无操作自动登出（毫秒）
const IDLE_TIMEOUT = 30 * 60 * 1000
// 活动事件频繁触发，节流：每分钟最多重置一次定时器，避免性能开销
const RESET_THROTTLE = 60 * 1000

export default function AutoLogout() {
  const pathname = usePathname()
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastReset = useRef(0)
  // 是否已登录（由 /api/auth/session 决定），用 ref 避免重复触发 effect
  const enabled = useRef(false)

  useEffect(() => {
    // 仅登录态启用；未登录/加载中不起动计时器
    const resetTimer = () => {
      if (!enabled.current) return
      const now = Date.now()
      if (now - lastReset.current < RESET_THROTTLE) return
      lastReset.current = now
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        signOut({ callbackUrl: '/login' })
      }, IDLE_TIMEOUT)
    }

    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click']
    events.forEach((e) => window.addEventListener(e, resetTimer, { passive: true }))
    resetTimer() // 若本就处于登录态，立即启动

    // 每次路由变化重新确认登录态（登录成功跳转 /dashboard 后据此启用）
    let cancelled = false
    fetch('/api/auth/session', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled) return
        enabled.current = !!(d && d.user)
        resetTimer()
      })
      .catch(() => {})

    return () => {
      cancelled = true
      events.forEach((e) => window.removeEventListener(e, resetTimer))
      if (timer.current) clearTimeout(timer.current)
    }
  }, [pathname])

  return null
}
