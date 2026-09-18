import './globals.css'
import type { ReactNode } from 'react'
import AutoLogout from '@/components/AutoLogout'

export const metadata = {
  title: '小区车库车位管理系统',
  description: '车位销售·调换·团购·核销一体化管理平台',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <AutoLogout />
        {children}
      </body>
    </html>
  )
}
