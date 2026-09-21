'use client'

import { useEffect } from 'react'
import { getSession, signOut } from 'next-auth/react'

// 标签页级活跃标记：sessionStorage 在关闭标签页时随标签页一起清空，
// 因此“关闭网页后重新打开”会丢失该标记，从而可检测并强制重新登录。
const ACTIVE_KEY = 'parking_active_session'

export default function SessionGuard() {
  useEffect(() => {
    const active = sessionStorage.getItem(ACTIVE_KEY)
    if (!active) {
      // 当前标签页没有活跃标记：说明是“关闭网页后重新打开”或新标签页。
      // 若仍处于登录态，则强制要求重新登录。
      getSession()
        .then((s) => {
          if (s) signOut({ callbackUrl: '/login' })
        })
        .catch(() => {})
    }
    // 标记本标签页为活跃（仅在同一次标签页会话内保留）
    sessionStorage.setItem(ACTIVE_KEY, '1')
  }, [])

  return null
}
