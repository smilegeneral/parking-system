import './globals.css'
import type { ReactNode } from 'react'
import type { Viewport } from 'next'
import SessionGuard from '@/components/SessionGuard'

export const metadata = {
  title: '小区车库车位管理系统',
  description: '车位销售·调换·团购·核销一体化管理平台',
}

// 允许缩放：手机用户可双指放大分布图查看车位细节
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <SessionGuard />
        {children}
      </body>
    </html>
  )
}
