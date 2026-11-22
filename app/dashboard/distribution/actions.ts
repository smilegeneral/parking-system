'use server'

import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getMappedSpacesByZone, updateSpacePosition } from '@/lib/queries'
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

// 手动拖拽调整车位坐标：仅管理员(role>=2)可用，guest/销售员禁止
export async function saveSpacePosition(spaceId: string, posX: number, posY: number): Promise<{ ok: boolean; error?: string }> {
  const session = await getServerSession(authOptions)
  if (!session?.user) return { ok: false, error: '未登录' }
  const role = (session.user as any)?.role ?? 1
  if (role < 2) return { ok: false, error: '无权调整车位坐标' }
  if (!Number.isFinite(posX) || !Number.isFinite(posY) || posX < 0 || posX > 100 || posY < 0 || posY > 100) {
    return { ok: false, error: '坐标超出范围' }
  }
  try {
    const ok = await updateSpacePosition(spaceId, Number(posX.toFixed(2)), Number(posY.toFixed(2)))
    return ok ? { ok: true } : { ok: false, error: '未找到该车位' }
  } catch (e: any) {
    return { ok: false, error: e?.message || '保存失败' }
  }
}
