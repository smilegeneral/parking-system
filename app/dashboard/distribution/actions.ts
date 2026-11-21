'use server'

import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getMappedSpacesByZone } from '@/lib/queries'
import type { ParkingSpace } from '@/lib/types'

// 供动态分布图客户端轮询：返回某区带坐标车位的最新状态
// guest(role=0) 仅返回未售车位，避免下发已售等非公开信息
export async function getMappedSpacesClient(zone: string): Promise<ParkingSpace[]> {
  const session = await getServerSession(authOptions)
  if (!session?.user) return []
  const role = (session.user as any)?.role ?? 1
  const all = await getMappedSpacesByZone(zone)
  return role === 0 ? all.filter(s => s.status === '未售') : all
}
