'use server'

import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getMappedSpacesByZone, updateSpacePosition, updateSpacePositions, querySpaceByNum } from '@/lib/queries'
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

// 车位查询：无权限设定，所有登录用户（含访客）均可查询车位状态/类型/价格
// 价格仅未售可见：非未售车位的 price 一律置空，不下发到客户端
export async function querySpacesByNum(keyword: string): Promise<ParkingSpace[]> {
  const session = await getServerSession(authOptions)
  if (!session?.user) return []
  const rows = await querySpaceByNum(keyword)
  return rows.map(s => s.status === '未售' ? s : { ...s, price: null as any })
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

// 批量保存车位坐标（多选行/列对齐）：仅管理员(role>=2)可用
export async function saveSpacePositions(
  items: Array<{ spaceId: string; posX: number; posY: number }>
): Promise<{ ok: boolean; error?: string; saved?: number }> {
  const session = await getServerSession(authOptions)
  if (!session?.user) return { ok: false, error: '未登录' }
  const role = (session.user as any)?.role ?? 1
  if (role < 2) return { ok: false, error: '无权调整车位坐标' }
  if (!Array.isArray(items) || items.length === 0) return { ok: false, error: '没有需要保存的车位' }
  if (items.length > 500) return { ok: false, error: '单次最多保存 500 个车位' }
  for (const it of items) {
    if (!it || typeof it.spaceId !== 'string' || !it.spaceId ||
        !Number.isFinite(it.posX) || !Number.isFinite(it.posY) ||
        it.posX < 0 || it.posX > 100 || it.posY < 0 || it.posY > 100) {
      return { ok: false, error: '存在无效车位或坐标超出范围' }
    }
  }
  try {
    const saved = await updateSpacePositions(
      items.map(it => ({ spaceId: it.spaceId, posX: Number(it.posX.toFixed(2)), posY: Number(it.posY.toFixed(2)) }))
    )
    return { ok: true, saved }
  } catch (e: any) {
    return { ok: false, error: e?.message || '保存失败' }
  }
}
