'use server'
import { withTransaction } from './db'
import { getSpaceById, getOwnerSoldSpaces, getOldReceiptNo, insertLifecycleLog, getUnsoldSpaces, getNextGroupSwapOrderNo } from './queries'
import { getServerSession } from 'next-auth'
import { auth, authOptions } from './auth'
import { requireRole } from './guard'
import { encryptApiKey, maskApiKey, canEncrypt } from './ai-crypto'
import { presetOf } from './ai-presets'
import type { ParkingSpace } from './types'
import { groupBuyOrderNo, groupBuyVerifyOrderNo } from './types'

// 角色等级常量（与 lib/types 保持一致）：0=访客 1=销售员 2=管理员 3=超级管理员
const ROLE_GUEST = 0
const ROLE_SALE = 1
const ROLE_ADMIN = 2

// 统一的未授权处理：直接抛出，使 requireRole 失败分支在类型上不可达，
// 避免污染各 Action 的成功返回类型（调用方均以 try/catch 捕获）。
function unauthorized(action: string): never {
  throw new Error(`无权执行操作：${action}（权限不足）`)
}

// 密码强度策略：至少 8 位，含字母和数字（防止弱口令）
function validatePasswordStrength(pwd: string): string | null {
  if (!pwd || pwd.length < 8) return '密码长度至少 8 位'
  if (!/[a-zA-Z]/.test(pwd) || !/\d/.test(pwd)) return '密码须同时包含字母和数字'
  return null
}

// HOUSEKEY 格式: building_no-unit_no-room_no
function parseHouseKey(houseKey: string) {
  const parts = (houseKey || '').split('-')
  return {
    building_no: parts[0] || '',
    unit_no: parts[1] || '',
    room_no: parts[2] || '',
  }
}

// ============================================================
//  所有写操作（锁位/销售/调换/团购/核销）集中在此
//  全部使用数据库事务，保证数据一致性
// ============================================================

// ==================== 车位预订 ====================
export interface BookSpaceInput {
  space_id: string
  booker_name?: string
  booker_phone?: string
  house_key?: string
}

// 未售车位可预订（记录预订人/电话/房号），用于预留给客户
export async function bookSpace(input: BookSpaceInput) {
  if (!await requireRole(ROLE_SALE)) return unauthorized('预订车位')
  return withTransaction(async (client) => {
    // 乐观锁：只有"未售"才能预订，防止并发超卖
    const res = await client.query(
      `UPDATE parking_spaces
       SET status = '预订',
           booker_name = $2, booker_phone = $3, house_key = $4,
           updated_at = NOW()
       WHERE space_id = $1 AND status = '未售'
       RETURNING *`,
      [input.space_id, input.booker_name || '', input.booker_phone || '', input.house_key || '']
    )
    if (res.rowCount === 0) {
      throw new Error(`车位 ${input.space_id} 当前不可预订（可能已被占用）`)
    }
    return res.rows[0]
  })
}

// ==================== 解除预订 ====================
export async function cancelBooking(spaceId: string) {
  if (!await requireRole(ROLE_SALE)) return unauthorized('解除预订')
  return withTransaction(async (client) => {
    const res = await client.query(
      `UPDATE parking_spaces
       SET status = '未售', booker_name = '', booker_phone = '',
           owner_name = '', phone = '', house_key = '', updated_at = NOW()
       WHERE space_id = $1 AND status = '预订'
       RETURNING *`,
      [spaceId]
    )
    if (res.rowCount === 0) {
      throw new Error(`车位 ${spaceId} 当前不是预订状态，无需解除`)
    }
    return res.rows[0]
  })
}

// ==================== 零售销售确认 ====================
export interface RetailSaleInput {
  space_id: string
  sale_order_no: string
  owner_name: string
  phone: string
  price: number
  house_key: string
  receipt_no: string
  confirm_no: string
  remarks?: string
}

export async function confirmRetailSale(input: RetailSaleInput, _operator: string) {
  if (!await requireRole(ROLE_SALE)) return unauthorized('零售销售确认')
  return withTransaction(async (client) => {
    // 1. 检查车位状态（必须是零售锁定）
    const spaceRes = await client.query(
      `SELECT * FROM parking_spaces WHERE space_id = $1`,
      [input.space_id]
    )
    if (spaceRes.rowCount === 0) throw new Error('车位不存在')
    const space = spaceRes.rows[0] as ParkingSpace
    if (space.status !== '预订' && space.status !== '未售') {
      throw new Error(`车位状态为"${space.status}"，无法直接销售（需为预订或未售）`)
    }

    // 2. 使用界面录入的销售单号
    const saleOrderNo = input.sale_order_no

    // 2.1 查重: sale_order_no 为 UNIQUE, 重复则报错
    const dup = await client.query(
      `SELECT 1 FROM parking_sales_records WHERE sale_order_no = $1 LIMIT 1`,
      [saleOrderNo]
    )
    if (dup.rowCount && dup.rowCount > 0) {
      throw new Error(`销售单号 ${saleOrderNo} 已存在，请更换编号`)
    }

    // 3. 写入销售记录
    // 注意：is_group_buy 列是 varchar，数据库 CHECK 约束只允许 '是'/'否'
    await client.query(
      `INSERT INTO parking_sales_records
       (sale_order_no, space_no, space_type, room_no, house_key, owner_name, phone,
        amount, sale_time, receipt_no, confirmation_no, remarks, is_group_buy, status, process_result)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),$9,$10,$11,'否','已确认','更换车位牌')`,
      [
        saleOrderNo, input.space_id, space.space_type, input.house_key, input.house_key,
        input.owner_name, input.phone, input.price,
        input.receipt_no, input.confirm_no, input.remarks || '',
      ]
    )

    // 4. 更新车位状态 → 已售（同时拆分 HOUSEKEY 填入 building_no/unit_no/room_no）
    const saleHk = parseHouseKey(input.house_key)
    await client.query(
      `UPDATE parking_spaces
       SET status = '已售',
           owner_name = $1,
           phone = $2,
           price = $3,
           sale_date = NOW(),
           receipt_no = $4,
           confirm_no = $5,
           house_key = $6,
           building_no = $7,
           unit_no = $8,
           room_no = $9,
           remarks = COALESCE($10, ''),
           updated_at = NOW()
       WHERE space_id = $11`,
      [
        input.owner_name, input.phone, input.price,
        input.receipt_no, input.confirm_no,
        input.house_key, saleHk.building_no, saleHk.unit_no, saleHk.room_no,
        input.remarks || '',
        input.space_id,
      ]
    )

    // 5. 更新/插入业主信息
    await upsertOwner(client, {
      house_key: input.house_key,
      owner_name: input.owner_name,
      phone: input.phone,
      space_id: input.space_id,
      price: input.price,
    })

    return {
      sale_order_no: saleOrderNo,
      space_id: input.space_id,
      space_type: space.space_type,
      owner_name: input.owner_name,
      phone: input.phone,
      house_key: input.house_key,
      amount: input.price,
      receipt_no: input.receipt_no,
      confirm_no: input.confirm_no,
      remarks: input.remarks || '',
      sale_time: new Date().toISOString(),
    }
  })
}

// ==================== 业主信息 upsert 辅助 ====================
async function upsertOwner(
  client: any,
  data: { house_key: string; owner_name: string; phone: string; space_id: string; price: number }
) {
  const exist = await client.query(
    `SELECT * FROM owner_info WHERE house_key = $1`,
    [data.house_key]
  )

  if (exist.rowCount > 0) {
    const cur = exist.rows[0]
    const oldSpaces = cur.parking_spaces || ''
    const newSpaces = oldSpaces
      ? oldSpaces.split(',').concat([data.space_id]).join(',')
      : data.space_id
    const newCount = (cur.parking_count || 0) + 1
    const newPrice = parseFloat(cur.parking_price || 0) + data.price

    await client.query(
      `UPDATE owner_info
       SET owner_name = $1, phone = $2, parking_spaces = $3,
           parking_count = $4, parking_price = $5, updated_at = NOW()
       WHERE house_key = $6`,
      [data.owner_name, data.phone, newSpaces, newCount, newPrice, data.house_key]
    )
  } else {
    const parts = data.house_key.split('-')
    await client.query(
      `INSERT INTO owner_info
       (house_key, building_no, unit_no, room_no, building_unit_room,
        owner_name, phone, parking_count, parking_spaces, parking_price)
       VALUES ($1,$2,$3,$4,$5,$6,$7,1,$8,$9)`,
      [
        data.house_key,
        parts[0] || '', parts[1] || '', parts[2] || '', data.house_key,
        data.owner_name, data.phone, data.space_id, data.price,
      ]
    )
  }
}

// ==================== 车位调换 ====================
export interface SwapInput {
  old_space_id: string
  new_space_id: string
  owner_name: string
  phone: string
  house_key: string
  price_difference: number
  swap_type: string
  change_reason: string
  receipt_no: string
  new_receipt_no?: string
  new_space_price?: string
  remarks?: string
  swap_order_no?: string   // 手动录入的车位调换单号，缺省则自动生成
  operator: string
}

export async function swapSpace(input: SwapInput) {
  if (!await requireRole(ROLE_SALE)) return unauthorized('车位调换')
  try {
    return await withTransaction(async (client) => {
    const oldS = await client.query(
      `SELECT * FROM parking_spaces WHERE space_id = $1`,
      [input.old_space_id]
    )
    if (oldS.rowCount === 0) throw new Error(`原车位 ${input.old_space_id} 不存在`)

    const newS = await client.query(
      `SELECT * FROM parking_spaces WHERE space_id = $1`,
      [input.new_space_id]
    )
    if (newS.rowCount === 0) throw new Error(`目标车位 ${input.new_space_id} 不存在`)

    const targetSpace = newS.rows[0]
    // swap_type 约束允许值: '加钱换车位' / '平换车位'
    // 加钱换车位: 目标必须为未售; 平换车位(含业主间互换/团购互换): 允许目标已售
    if (targetSpace.status !== '未售' && input.swap_type !== '平换车位') {
      throw new Error(`目标车位状态为"${targetSpace.status}"，无法调换`)
    }

    let swapOrderNo = input.swap_order_no?.trim()
    if (!swapOrderNo) {
      // 兜底: 前端一般已预填 BG 单号; 若为空则查库生成
      const maxRes = await client.query(
        `SELECT swap_order_no FROM parking_space_change_log
         WHERE swap_order_no LIKE 'BG%'
         ORDER BY swap_order_no DESC LIMIT 1`
      )
      let next = 74
      if (maxRes.rowCount && maxRes.rowCount > 0) {
        const m = /BG(\d+)/.exec(maxRes.rows[0].swap_order_no || '')
        if (m) next = parseInt(m[1], 10) + 1
      }
      swapOrderNo = `BG${String(next).padStart(3, '0')}`
    }

    // 查重: 若用户输入的调换单号已存在则报错
    const dup = await client.query(
      `SELECT 1 FROM parking_space_change_log WHERE swap_order_no = $1 LIMIT 1`,
      [swapOrderNo]
    )
    if (dup.rowCount && dup.rowCount > 0) {
      throw new Error(`调换单号 ${swapOrderNo} 已存在，请更换编号`)
    }

    await client.query(
      `INSERT INTO parking_space_change_log
       (owner_name, phone, old_space_no, old_space_type, old_house_key,
        old_space_price, new_space_no, new_space_type, new_house_key,
        new_space_price,         price_difference, swap_type, change_reason,
        receipt_no, new_receipt_no, remarks, operator, changed_at, swap_order_no, process_result, employee_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW(),$18,'更换车位牌',$19)`,
        // 注意: swap_type 必须属于约束允许值('加钱换车位'/'平换车位')
      [
        input.owner_name, input.phone,
        input.old_space_id, oldS.rows[0].space_type, input.house_key,
        oldS.rows[0].price,
        input.new_space_id, targetSpace.space_type, input.house_key,
        input.new_space_price ? Number(input.new_space_price) : null,
        input.price_difference, input.swap_type, input.change_reason,
        input.receipt_no, input.new_receipt_no || '', input.remarks || '', input.operator, swapOrderNo,
        oldS.rows[0].employee_name || '',
      ]
    )

    // 原车位 → 未售，并清空楼栋/单元/房间及员工字段
    await client.query(
      `UPDATE parking_spaces
       SET status = '未售', owner_name = '', phone = '',
           house_key = '', building_no = '', unit_no = '', room_no = '', employee_name = '',
           updated_at = NOW()
       WHERE space_id = $1`,
      [input.old_space_id]
    )

    // 新车位 → 已售（同时拆分 HOUSEKEY 填入 building_no/unit_no/room_no）
    const swapHk = parseHouseKey(input.house_key)
    await client.query(
      `UPDATE parking_spaces
       SET status = '已售', owner_name = $1, phone = $2,
           house_key = $3, price = $4, sale_date = NOW(),
           confirm_no = $5,
           building_no = $6, unit_no = $7, room_no = $8,
           updated_at = NOW()
       WHERE space_id = $9`,
      [
        input.owner_name, input.phone, input.house_key,
        input.new_space_price ? Number(input.new_space_price) : null, input.new_receipt_no || '',
        swapHk.building_no, swapHk.unit_no, swapHk.room_no, input.new_space_id,
      ]
    )

    // 更新业主车位列表
    await client.query(
      `UPDATE owner_info
       SET parking_spaces = REPLACE(parking_spaces, $1, $2),
           updated_at = NOW()
       WHERE house_key = $3`,
      [input.old_space_id, input.new_space_id, input.house_key]
    )

    return { swap_order_no: swapOrderNo }
    })
  } catch (err: any) {
    const msg = `[swapSpace] 失败: ${err?.message || err}`
    console.error(msg, err?.stack)
    return { ok: false, error: `调换失败：${err?.message || '数据库错误'}` } as any
  }
}

// ==================== 团购下单 ====================
export interface GroupBuyInput {
  company_id: number
  space_ids: string[]
  operator: string
}

export async function createGroupBuy(input: GroupBuyInput) {
  if (!await requireRole(ROLE_SALE)) return unauthorized('创建团购')
  return withTransaction(async (client) => {
    const comp = await client.query(
      `SELECT * FROM group_buy_company WHERE company_id = $1`,
      [input.company_id]
    )
    if (comp.rowCount === 0) throw new Error('团购公司不存在')

    for (const sid of input.space_ids) {
      const r = await client.query(
        `UPDATE parking_spaces
         SET status = '团购锁定', updated_at = NOW()
         WHERE space_id = $1 AND status = '未售'
         RETURNING *`,
        [sid]
      )
      if (r.rowCount === 0) {
        throw new Error(`车位 ${sid} 锁定失败（可能已被占用）`)
      }
    }

    await client.query(
      `UPDATE group_buy_company
       SET space_list = $1, space_count = $2, updated_at = NOW()
       WHERE company_id = $3`,
      [input.space_ids.join(','), input.space_ids.length, input.company_id]
    )

    return { locked_count: input.space_ids.length }
  })
}

// ==================== 团购公司购买登记 ====================
export interface GroupBuyPurchaseInput {
  company_name: string
  department: string
  contact_person: string
  contact_phone: string
  space_ids: string[]      // 购买的车位编号列表
  amount: number
  is_paid: boolean
  invoice_type: string     // 专票/普票/普票个人/未开票
  remarks: string
  operator: string
}

export async function createGroupBuyPurchase(input: GroupBuyPurchaseInput) {
  // 业务失败（权限不足 / 车位已被占用 / SQL 异常）需要让用户看到具体原因，
  // 若直接抛出，生产构建会把信息脱敏成通用错误，无法定位问题。
  try {
    if (!await requireRole(ROLE_SALE)) {
      throw new Error('无权执行操作：团购认购（权限不足）')
    }
    return await createGroupBuyPurchaseInner(input)
  } catch (e: any) {
    console.error('[createGroupBuyPurchase] failed:', e)
    return { ok: false as const, error: e?.message || '登记失败（未知错误）' }
  }
}

async function createGroupBuyPurchaseInner(input: GroupBuyPurchaseInput) {
  // department 在库中 NOT NULL，这里提前校验非空，
  // 避免把空值直接抛给数据库导致 500。部门允许手工输入任意值。
  const dept = (input.department || '').trim()
  if (!dept) {
    throw new Error('请填写部门（可下拉选择或直接输入）')
  }
  return withTransaction(async (client) => {
    // 1. 写入购买记录
    const purRes = await client.query(
      `INSERT INTO group_buy_purchase
       (company_name, department, contact_person, contact_phone,
        space_count, space_list, amount, is_paid, invoice_type, remarks, operator)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING purchase_id`,
      [
        input.company_name, dept, input.contact_person, input.contact_phone,
        input.space_ids.length, input.space_ids.join(','),
        input.amount, input.is_paid, input.invoice_type, input.remarks || '', input.operator,
      ]
    )
    const purchaseId = purRes.rows[0].purchase_id
    // 车位变更单号直接沿用团购单号（TG + 三位数字），不再用 GBP-时间戳 的长单号
    const groupOrderNo = groupBuyOrderNo(purchaseId)

    // 2. 联动锁定车位（乐观锁，只有未售状态才能锁）
    //    同时写入车位总账变更日志（parking_space_lifecycle_log）
    //    团购车位金额（= 车位实际卖价）：按登记总金额平摊到每个车位写入 price，
    //    以便「团购预定（待核销）」与后续「团购已核销」均能正确汇总金额。
    //    （核销动作明确不改写 price，故此处必须写入团购实际卖价。）
    const lockCount = input.space_ids.length
    const unitPrice = lockCount > 0 ? Number(input.amount) / lockCount : 0
    for (const sid of input.space_ids) {
      const r = await client.query(
        `UPDATE parking_spaces
         SET status = '团购锁定', group_company = $2, price = $3, updated_at = NOW()
         WHERE space_id = $1 AND status = '未售'
         RETURNING *`,
        [sid, input.company_name, unitPrice]
      )
      if (r.rowCount === 0) {
        throw new Error(`车位 ${sid} 锁定失败（可能已被占用或非未售状态）`)
      }
      await insertLifecycleLog(client, {
        space_id: sid,
        op_type: '团购锁定',
        change_order_no: groupOrderNo,
        old_status: '未售',
        new_status: '团购锁定',
        reason: `团购公司「${input.company_name}」购买登记${input.remarks ? '：' + input.remarks : ''}`,
        operator: input.operator,
      })
    }

    // 3. 同步/更新团购公司主档信息（按公司名 upsert）
    const comp = await client.query(
      `SELECT * FROM group_buy_company WHERE company_name = $1`,
      [input.company_name]
    )
    if ((comp.rowCount ?? 0) > 0) {
      const cur = comp.rows[0]
      const oldSpaces = (cur.space_list || '').split(',').filter(Boolean)
      const merged = Array.from(new Set(oldSpaces.concat(input.space_ids)))
      const newCount = merged.length
      const newTotal = parseFloat(cur.total_price || 0) + input.amount
      await client.query(
        `UPDATE group_buy_company
         SET department = COALESCE(NULLIF($1,''), department),
             contact_person = COALESCE(NULLIF($2,''), contact_person),
             phone = COALESCE(NULLIF($3,''), phone),
             space_list = $4,
             space_count = $5,
             total_price = $6,
             is_paid = CASE WHEN $7 THEN TRUE ELSE is_paid END,
             invoice_type = COALESCE(NULLIF($8,''), invoice_type),
             updated_at = NOW()
         WHERE company_id = $9`,
        [
          dept, input.contact_person, input.contact_phone,
          merged.join(','), newCount, newTotal,
          input.is_paid, input.invoice_type, cur.company_id,
        ]
      )
    } else {
      // 团购公司主档不存在则新建
      await client.query(
        `INSERT INTO group_buy_company
         (company_name, department, contact_person, phone, space_count,
          space_list, total_price, is_paid, invoice_type, remarks, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW())`,
        [
          input.company_name, dept, input.contact_person || '',
          input.contact_phone || '', input.space_ids.length, input.space_ids.join(','),
          input.amount, input.is_paid, input.invoice_type || '', input.remarks || '',
        ]
      )
    }

    return { purchase_id: purchaseId, locked_count: input.space_ids.length }
  })
}

// ==================== 团购车位调换 ====================
// 将某个团购锁定车位，与某个未售车位互换：
//   - 团购锁定车位 → 恢复为"未售"（释放）
//   - 未售车位   → 变为"团购锁定"，继承原团购公司信息
export interface GroupSwapInput {
  from_space_id: string   // 当前团购锁定车位（要被替换出去）
  to_space_id: string     // 目标未售车位（换进来）
  operator: string
}

export async function swapGroupBuySpace(input: GroupSwapInput) {
  if (!await requireRole(ROLE_SALE)) return unauthorized('团购车位调换')
  return withTransaction(async (client) => {
    const fromRes = await client.query(
      `SELECT * FROM parking_spaces WHERE space_id = $1`,
      [input.from_space_id]
    )
    if (fromRes.rowCount === 0) throw new Error('原团购车位不存在')
    const from = fromRes.rows[0]
    if (from.status !== '团购锁定') {
      throw new Error(`车位 ${input.from_space_id} 不是团购锁定状态，无法调换`)
    }

    const toRes = await client.query(
      `SELECT * FROM parking_spaces WHERE space_id = $1`,
      [input.to_space_id]
    )
    if (toRes.rowCount === 0) throw new Error('目标未售车位不存在')
    const to = toRes.rows[0]
    if (to.status !== '未售') {
      throw new Error(`车位 ${input.to_space_id} 不是未售状态，无法换入`)
    }

    // 释放原团购车位
    await client.query(
      `UPDATE parking_spaces
       SET status = '未售',
           is_group_buy = FALSE,
           group_company = NULL,
           updated_at = NOW()
       WHERE space_id = $1`,
      [input.from_space_id]
    )

    // 新车位继承团购公司信息与团购价（实际卖价）并锁定
    await client.query(
      `UPDATE parking_spaces
       SET status = '团购锁定',
           is_group_buy = TRUE,
           group_company = $2,
           price = $3,
           updated_at = NOW()
       WHERE space_id = $1`,
      [input.to_space_id, from.group_company, from.price]
    )

    // 同步团购公司主档的车位列表
    const comp = await client.query(
      `SELECT * FROM group_buy_company WHERE company_name = $1`,
      [from.group_company]
    )
    if ((comp.rowCount ?? 0) > 0) {
      const cur = comp.rows[0]
      const oldSpaces = (cur.space_list || '').split(',').filter(Boolean)
      const merged = Array.from(
        new Set(oldSpaces.filter((s: string) => s !== input.from_space_id).concat(input.to_space_id))
      )
      await client.query(
        `UPDATE group_buy_company SET space_list = $1, space_count = $2, updated_at = NOW()
         WHERE company_id = $3`,
        [merged.join(','), merged.length, cur.company_id]
      )
    }

    // 写入车位调换记录表（parking_space_change_log）
    const swapOrderNo = await getNextGroupSwapOrderNo(client)
    await client.query(
      `INSERT INTO parking_space_change_log
       (owner_name, phone, old_space_no, old_space_type, old_house_key, old_space_price,
        new_space_no, new_space_type, new_house_key, new_space_price,
        price_difference, swap_type, change_reason, operator, changed_at, swap_order_no, process_result)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,0,'平换车位','团购车位调换（团购锁定车位互换）',
               $11,NOW(),$12,'已完成')`,
      [
        from.group_company || '', '', input.from_space_id, from.space_type, from.house_key || '', from.price || 0,
        input.to_space_id, to.space_type, to.house_key || '', to.price || 0,
        input.operator, swapOrderNo,
      ]
    )

    // 记录总账变更日志（两个车位的状态变化）
    await insertLifecycleLog(client, {
      space_id: input.from_space_id,
      op_type: '团购调换',
      change_order_no: swapOrderNo,
      old_status: '团购锁定',
      new_status: '未售',
      reason: `团购车位调换：释放原团购锁定车位，换入 ${input.to_space_id}`,
      operator: input.operator,
    })
    await insertLifecycleLog(client, {
      space_id: input.to_space_id,
      op_type: '团购调换',
      change_order_no: swapOrderNo,
      old_status: '未售',
      new_status: '团购锁定',
      reason: `团购车位调换：换入为团购锁定车位（原 ${input.from_space_id}）`,
      operator: input.operator,
    })

    return { from: input.from_space_id, to: input.to_space_id, swap_order_no: swapOrderNo }
  })
}

// ==================== 团购核销（公司 → 业主） ====================
export interface GroupVerifyInput {
  company_id: number
  space_id: string
  owner_name: string
  owner_phone: string
  house_key: string
  sale_amount: number   // 销售金额
  receipt_no: string    // 车位确认单号
  remarks: string
  operator: string
}

export async function verifyGroupBuy(input: GroupVerifyInput) {
  if (!await requireRole(ROLE_SALE)) return unauthorized('团购核销')
  return withTransaction(async (client) => {
    const spaceRes = await client.query(
      `SELECT * FROM parking_spaces WHERE space_id = $1`,
      [input.space_id]
    )
    if (spaceRes.rowCount === 0) throw new Error('车位不存在')
    const space = spaceRes.rows[0]
    if (space.status !== '团购锁定') {
      throw new Error(`车位 ${input.space_id} 不是团购锁定状态`)
    }

    const comp = await client.query(
      `SELECT company_name FROM group_buy_company WHERE company_id = $1`,
      [input.company_id]
    )
    if (comp.rowCount === 0) throw new Error('团购公司不存在')
    const companyName = comp.rows[0].company_name

    // 核销 = 团购锁定车位转让给最终业主 → 状态变为"已售"
    // 保留 is_group_buy=TRUE 与 group_company，以便区分团购来源的已售车位
    // 同时拆分 HOUSEKEY 填入 building_no/unit_no/room_no
    // 金额口径：不区分团购价与业主实付价的差价，统一使用 price 字段，
    // 故此处不改写 price（保留团购购买价作为成交价），
    // 也不再写 sale_price —— 该字段在所有建表脚本中都不存在，写入会直接报错。
    // 核销金额另存于 group_buy_verify_detail.sale_amount 备查。
    const verifyHk = parseHouseKey(input.house_key)
    await client.query(
      `UPDATE parking_spaces
       SET status = '已售',
           owner_name = $1,
           phone = $2,
           house_key = $3,
           sale_date = NOW(),
           is_group_buy = TRUE,
           group_company = $4,
           building_no = $5,
           unit_no = $6,
           room_no = $7,
           updated_at = NOW()
       WHERE space_id = $8`,
      [input.owner_name, input.owner_phone, input.house_key, companyName,
       verifyHk.building_no, verifyHk.unit_no, verifyHk.room_no, input.space_id]
    )

    const verRes = await client.query(
      `INSERT INTO group_buy_verify_detail
       (company_id, company_name, space_id, house_key, owner_name, owner_phone, sale_amount, receipt_no, verify_date, operator, remarks)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),$9,$10)
       RETURNING verify_id`,
      [
        input.company_id, companyName, input.space_id, input.house_key,
        input.owner_name, input.owner_phone, input.sale_amount, input.receipt_no, input.operator, input.remarks || '',
      ]
    )
    // 车位变更单号直接沿用核销单号（GCV + 三位数字）
    const verifyOrderNo = groupBuyVerifyOrderNo(verRes.rows[0].verify_id)

    await upsertOwner(client, {
      house_key: input.house_key,
      owner_name: input.owner_name,
      phone: input.owner_phone,
      space_id: input.space_id,
      price: space.price || 0,
    })

    // 写入车位总账变更日志（parking_space_lifecycle_log）
    // 注意：核销只更新车位台账(parking_spaces)与团购核销记录表(group_buy_verify_detail)，
    // 不写入通用车位销售记录表(parking_sales_records)
    await insertLifecycleLog(client, {
      space_id: input.space_id,
      op_type: '团购核销',
      change_order_no: verifyOrderNo,
      old_status: '团购锁定',
      new_status: '已售',
      reason: `团购核销：${companyName} → 业主 ${input.owner_name}${input.receipt_no ? '，确认单号 ' + input.receipt_no : ''}${input.remarks ? '，备注 ' + input.remarks : ''}`,
      operator: input.operator,
    })

    return { space_id: input.space_id, status: '已售' }
  })
}

// ==================== 业主信息变更 ====================
export interface UpdateOwnerInput {
  house_key: string
  owner_name: string
  phone: string
  phone2: string
  change_reason: string
  operator: string
}

export async function updateOwnerInfo(input: UpdateOwnerInput) {
  if (!await requireRole(ROLE_SALE)) return unauthorized('变更业主信息')
  return withTransaction(async (client) => {
    const exist = await client.query(
      `SELECT * FROM owner_info WHERE house_key = $1`,
      [input.house_key]
    )
    if (exist.rowCount === 0) throw new Error(`业主 ${input.house_key} 不存在`)
    const cur = exist.rows[0]

    // 逐字段比对，记录变化
    const changes: { field: string; old: string; neu: string }[] = []
    if ((cur.owner_name || '') !== input.owner_name) {
      changes.push({ field: 'owner_name', old: cur.owner_name || '', neu: input.owner_name })
    }
    if ((cur.phone || '') !== input.phone) {
      changes.push({ field: 'phone', old: cur.phone || '', neu: input.phone })
    }
    if ((cur.phone2 || '') !== (input.phone2 || '')) {
      changes.push({ field: 'phone2', old: cur.phone2 || '', neu: input.phone2 })
    }
    if (changes.length === 0) {
      throw new Error('没有检测到信息变更（姓名/电话/二电话均未改变）')
    }

    // 更新业主信息
    await client.query(
      `UPDATE owner_info
       SET owner_name = $1, phone = $2, phone2 = $3, updated_at = NOW()
       WHERE house_key = $4`,
      [input.owner_name, input.phone, input.phone2, input.house_key]
    )

    // 写变更日志（每个变化字段一条）
    for (const c of changes) {
      await client.query(
        `INSERT INTO owner_info_change_log
         (house_key, owner_name, phone, change_field, old_value, new_value,
          change_reason, operator, changed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())`,
        [
          input.house_key, input.owner_name, input.phone,
          c.field, c.old, c.neu, input.change_reason || '', input.operator,
        ]
      )
    }

    return { changed_fields: changes.map(c => c.field) }
  })
}

// ==================== 后台用户与权限管理 ====================
import bcrypt from 'bcryptjs'

export interface CreateUserInput {
  username: string
  password: string
  display_name: string
  role: number
  permissions: string[]
  email?: string
}

// 新增用户
export async function createUser(input: CreateUserInput) {
  if (!await requireRole(ROLE_ADMIN)) return unauthorized('新增用户')
  return withTransaction(async (client) => {
    const exist = await client.query(`SELECT 1 FROM admin_user WHERE username = $1`, [input.username])
    if (exist.rowCount && exist.rowCount > 0) throw new Error('用户名已存在')
    const hash = await bcrypt.hash(input.password, 10)
    // role>=2 视为拥有全部权限，permissions 仅对 role=1 生效
    const perms = input.role >= 2 ? '[]' : JSON.stringify(input.permissions)
    const r = await client.query(
      `INSERT INTO admin_user (username, password_hash, display_name, role, permissions, email)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [input.username, hash, input.display_name || input.username, input.role, perms, input.email?.trim() || null]
    )
    return { id: r.rows[0].id }
  })
}

// 修改用户角色与权限
export async function updateUserRole(input: { id: number; role: number; permissions: string[]; display_name?: string; email?: string }) {
  if (!await requireRole(ROLE_ADMIN)) return unauthorized('修改用户角色')
  return withTransaction(async (client) => {
    const perms = input.role >= 2 ? '[]' : JSON.stringify(input.permissions)
    await client.query(
      `UPDATE admin_user SET role = $1, permissions = $2, display_name = COALESCE($3, display_name), email = $4, updated_at = NOW()
       WHERE id = $5`,
      [input.role, perms, input.display_name || null, input.email?.trim() || null, input.id]
    )
    return { ok: true }
  })
}

// ==================== 打印模板管理 ====================
export async function savePrintTemplate(input: { id?: number; name: string; type: string; content: string }) {
  if (!await requireRole(ROLE_ADMIN)) return unauthorized('保存打印模板')
  return withTransaction(async (client) => {
    if (input.id) {
      const r = await client.query(
        `UPDATE print_templates SET name=$1, type=$2, content=$3, updated_at=NOW() WHERE id=$4`,
        [input.name, input.type, input.content, input.id]
      )
      if (!r.rowCount || r.rowCount === 0) throw new Error('模板不存在')
      return { id: input.id }
    }
    const r = await client.query(
      `INSERT INTO print_templates (name, type, content) VALUES ($1,$2,$3) RETURNING id`,
      [input.name, input.type, input.content]
    )
    return { id: r.rows[0]?.id }
  })
}

export async function deletePrintTemplate(id: number) {
  if (!await requireRole(ROLE_ADMIN)) return unauthorized('删除打印模板')
  return withTransaction(async (client) => {
    await client.query(`DELETE FROM print_templates WHERE id=$1`, [id])
    return { ok: true }
  })
}

// 重置他人密码
export async function resetUserPassword(input: { id: number; newPassword: string }) {
  if (!await requireRole(ROLE_ADMIN)) return unauthorized('重置用户密码')
  const strengthErr = validatePasswordStrength(input.newPassword)
  if (strengthErr) return { ok: false, error: strengthErr } as const
  return withTransaction(async (client) => {
    const hash = await bcrypt.hash(input.newPassword, 10)
    const r = await client.query(
      `UPDATE admin_user SET password_hash = $1, updated_at = NOW() WHERE id = $2`,
      [hash, input.id]
    )
    if (!r.rowCount || r.rowCount === 0) throw new Error('用户不存在')
    return { ok: true }
  })
}

// 当前用户修改自己的密码
export async function changeMyPassword(input: { userId: number; oldPassword: string; newPassword: string }) {
  const strengthErr = validatePasswordStrength(input.newPassword)
  if (strengthErr) throw new Error(strengthErr)
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT password_hash FROM admin_user WHERE id = $1`,
      [input.userId]
    )
    if (rows.length === 0) throw new Error('用户不存在')
    const ok = await bcrypt.compare(input.oldPassword, rows[0].password_hash)
    if (!ok) throw new Error('原密码不正确')
    const hash = await bcrypt.hash(input.newPassword, 10)
    await client.query(
      `UPDATE admin_user SET password_hash = $1, updated_at = NOW() WHERE id = $2`,
      [hash, input.userId]
    )
    return { ok: true }
  })
}

// ==================== 车位分布图：上传车库图片 ====================
// zone 限定为六个区之一；image_url 为对象存储公开 URL（R2）
export interface UploadGarageMapInput {
  zone: string
  image_url: string
  image_name?: string
  uploaded_by?: string
}

const GARAGE_MAP_ZONES = ['A区', 'B区', 'C区', 'D1区', 'D2区', 'E区']

export async function uploadGarageMap(input: UploadGarageMapInput) {
  if (!await requireRole(ROLE_ADMIN)) return unauthorized('上传车库分布图')
  if (!GARAGE_MAP_ZONES.includes(input.zone)) {
    throw new Error('车库分区不合法，仅支持 A区/B区/C区/D1区/D2区/E区')
  }
  const url = (input.image_url || '').trim()
  if (!url) throw new Error('图片地址无效')

  return withTransaction(async (client) => {
    // 先查旧图，替换后删除本地旧文件（释放磁盘空间）
    const old = await client.query(`SELECT image_url FROM garage_maps WHERE zone = $1`, [input.zone])
    if (old.rowCount && old.rowCount > 0 && old.rows[0].image_url) {
      const { deleteUpload } = await import('./storage')
      await deleteUpload(old.rows[0].image_url)
    }

    // upsert：同一分区覆盖更新
    await client.query(
      `INSERT INTO garage_maps (zone, image_url, image_name, uploaded_by, updated_at)
       VALUES ($1,$2,$3,$4,NOW())
       ON CONFLICT (zone) DO UPDATE
       SET image_url = EXCLUDED.image_url,
           image_name = EXCLUDED.image_name,
           uploaded_by = EXCLUDED.uploaded_by,
           updated_at = NOW()`,
      [input.zone, url, input.image_name || null, input.uploaded_by || null]
    )
    return { ok: true, zone: input.zone }
  })
}

// ==================== 车位牌照片上传后回写 ====================
export interface MarkSpacePlateInput {
  record_id: number
  image_url: string
}

// 上传车位牌照片成功后，将图片地址写入销售记录，并把处理状态置为「已完成」
export async function markSpacePlateUploaded(input: MarkSpacePlateInput) {
  if (!await requireRole(ROLE_SALE)) return unauthorized('回写车位牌照片')
  const recordId = Number(input.record_id)
  if (!recordId || recordId <= 0) throw new Error('销售记录 ID 不合法')
  const url = (input.image_url || '').trim()
  if (!url) throw new Error('图片地址无效')

  return withTransaction(async (client) => {
    const exist = await client.query(`SELECT record_id, preview_url FROM parking_sales_records WHERE record_id = $1`, [recordId])
    if (!exist.rowCount || exist.rowCount === 0) {
      throw new Error('销售记录不存在')
    }
    // 若已存在旧图，替换后删除本地旧文件
    const oldUrl: string | null = exist.rows[0].preview_url
    if (oldUrl) {
      try {
        const { deleteUpload } = await import('./storage')
        await deleteUpload(oldUrl)
      } catch {
        // 删除旧图失败不阻断主流程
      }
    }

    await client.query(
      `UPDATE parking_sales_records
       SET preview_url = $1, process_result = '已完成', updated_at = NOW()
       WHERE record_id = $2`,
      [url, recordId]
    )
    return { ok: true, record_id: recordId }
  })
}

// 上传车位牌照片成功后，将图片地址写入车位变更记录，并把处理状态置为「已完成」
export async function markChangeLogPlateUploaded(input: { log_id: number; image_url: string }) {
  if (!await requireRole(ROLE_SALE)) return unauthorized('回写调换记录车位牌照片')
  const logId = Number(input.log_id)
  if (!logId || logId <= 0) throw new Error('变更记录 ID 不合法')
  const url = (input.image_url || '').trim()
  if (!url) throw new Error('图片地址无效')

  return withTransaction(async (client) => {
    const exist = await client.query(`SELECT log_id, preview_url FROM parking_space_change_log WHERE log_id = $1`, [logId])
    if (!exist.rowCount || exist.rowCount === 0) {
      throw new Error('变更记录不存在')
    }
    const oldUrl: string | null = exist.rows[0].preview_url
    if (oldUrl) {
      try {
        const { deleteUpload } = await import('./storage')
        await deleteUpload(oldUrl)
      } catch {
        // 删除旧图失败不阻断主流程
      }
    }

    await client.query(
      `UPDATE parking_space_change_log
       SET preview_url = $1, process_result = '已完成'
       WHERE log_id = $2`,
      [url, logId]
    )
    return { ok: true, log_id: logId }
  })
}

// ==================== 车位销售：按车位号查询 ====================
// 返回车位详情（含状态），供销售页面先查询再填写
export async function lookupSpace(spaceId: string): Promise<{
  ok: boolean
  space?: ParkingSpace
  error?: string
}> {
  const sid = (spaceId || '').trim()
  if (!sid) return { ok: false, error: '请输入车位号' }
  const space = await getSpaceById(sid)
  if (!space) return { ok: false, error: `未找到车位「${sid}」` }
  return { ok: true, space }
}

// ==================== 车位调换：按房号查旧车位 / 旧确认单号 ====================
export async function getOwnerSpaces(houseKey: string): Promise<{
  ok: boolean
  spaces?: ParkingSpace[]
  error?: string
}> {
  const key = (houseKey || '').trim()
  if (!key) return { ok: false, error: '请输入房号' }
  const spaces = await getOwnerSoldSpaces(key)
  return { ok: true, spaces }
}

export async function getOldConfirmNo(spaceId: string): Promise<{
  ok: boolean
  receipt_no?: string | null
  error?: string
}> {
  const sid = (spaceId || '').trim()
  if (!sid) return { ok: false, error: '请输入车位号' }
  const receipt_no = await getOldReceiptNo(sid)
  return { ok: true, receipt_no }
}

// ==================== 新增车位 ====================
export interface AddSpaceInput {
  space_id: string          // 车位号（如 A-001）
  garage_zone?: string      // 车库分区
  space_type?: string       // 车位类型（如 标准/子母/微型）
  building_no?: string
  unit_no?: string
  room_no?: string
  remarks?: string
  change_order_no?: string  // 变更单号
  operator?: string         // 操作人
}

// 在车位台账中新增一条记录，初始状态=未售
export async function addParkingSpace(input: AddSpaceInput) {
  if (!await requireRole(ROLE_SALE)) return unauthorized('新增车位')
  const space_id = (input.space_id || '').trim()
  if (!space_id) throw new Error('请输入车位号')

  return withTransaction(async (client) => {
    // 防重复：主键冲突直接抛错
    const exist = await client.query(`SELECT 1 FROM parking_spaces WHERE space_id = $1`, [space_id])
    if (exist.rowCount && exist.rowCount > 0) {
      throw new Error(`车位 ${space_id} 已存在，无法重复新增`)
    }

    const parts = space_id.split('-')
    const garage_zone = (input.garage_zone || parts[0] || '').trim()
    const building_no = (input.building_no || '').trim()
    const unit_no = (input.unit_no || '').trim()
    const room_no = (input.room_no || '').trim()

    await client.query(
      `INSERT INTO parking_spaces
       (space_id, garage_zone, space_num, status, space_type, building_no, unit_no, room_no, remarks, created_at, updated_at)
       VALUES ($1,$2,$3,'未售',$4,$5,$6,$7,$8,NOW(),NOW())`,
      [
        space_id,
        garage_zone,
        parts[1] || space_id,
        (input.space_type || '').trim(),
        building_no, unit_no, room_no,
        (input.remarks || '').trim(),
      ]
    )

    // 记录新增日志
    const operator = ((await auth())?.user as { display_name?: string } | undefined)?.display_name || ''
    await insertLifecycleLog(client, {
      space_id,
      op_type: '新增',
      change_order_no: (input.change_order_no || '').trim() || null,
      old_status: null,
      new_status: '未售',
      reason: (input.remarks || '').trim() || null,
      operator: operator || null,
    })

    return { space_id, status: '未售' }
  })
}

// ==================== 取消车位 ====================
// 仅允许将"未售"车位置为"取消"，取消后不可销售
export async function cancelParkingSpace(spaceId: string, remarks?: string, changeOrderNo?: string, operator?: string) {
  if (!await requireRole(ROLE_SALE)) return unauthorized('取消车位')
  const sid = (spaceId || '').trim()
  if (!sid) throw new Error('请选择要取消的车位')

  return withTransaction(async (client) => {
    const res = await client.query(
      `UPDATE parking_spaces
       SET status = '取消',
           remarks = CASE WHEN $2 <> '' THEN $2 ELSE remarks END,
           updated_at = NOW()
       WHERE space_id = $1 AND status = '未售'
       RETURNING *`,
      [sid, (remarks || '').trim()]
    )
    if (res.rowCount === 0) {
      throw new Error(`车位 ${sid} 不是未售状态，无法取消（可能已售/已预订/已取消）`)
    }

    // 记录取消日志（含原因）
    const operator = ((await auth())?.user as { display_name?: string } | undefined)?.display_name || ''
    await insertLifecycleLog(client, {
      space_id: sid,
      op_type: '取消',
      change_order_no: (changeOrderNo || '').trim() || null,
      old_status: '未售',
      new_status: '取消',
      reason: (remarks || '').trim() || null,
      operator: operator || null,
    })

    return res.rows[0]
  })
}

// 供客户端组件调用：查询未售车位（封装为 server action，避免 pg 进入浏览器 bundle）
export async function fetchUnsoldSpaces(): Promise<ParkingSpace[]> {
  return await getUnsoldSpaces()
}

// ==================== AI 配置管理（统计报表「AI 智能问数」） ====================
// 约定：API Key 一律经 AES-256-GCM 加密后落库，明文既不落库也不返回前端。

/**
 * AI 配置专用鉴权：把「读不到身份」和「角色不足」分开提示。
 * 早期签发的 JWT 可能不含 id 字段，会让 getSessionUser 返回 null，
 * 与真正的权限不足混为一谈，导致无法定位。
 */
async function requireAdminFor(
  action: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  let session: any = null
  try {
    session = await getServerSession(authOptions)
  } catch (e) {
    return { ok: false, error: `读取登录状态失败：${(e as Error)?.message || String(e)}（${action}）` }
  }

  const u = session?.user as { id?: string; role?: number } | undefined
  if (!session || !u) {
    return {
      ok: false,
      error: `未登录或会话已失效（${action}）：Server Action 未取到 session，请退出后重新登录再试`,
    }
  }

  const role = Number(u.role ?? 0)
  if (role < ROLE_ADMIN) {
    return {
      ok: false,
      error:
        `权限不足（${action}）：当前会话角色等级 ${role}，` +
        `需要管理员（2）及以上` +
        (u.id ? '' : '；且会话中缺少用户ID，很可能是旧登录凭证') +
        '。若账号本身是管理员，请退出后重新登录以刷新会话。',
    }
  }
  return { ok: true }
}

export interface AiConfigInput {
  id?: number
  name: string
  provider: string
  apiKey?: string // 新增必填；编辑时留空表示不修改
  baseUrl?: string
  model?: string
  enabled?: boolean
  isDefault?: boolean
}

async function currentActor(): Promise<string> {
  const u = (await auth())?.user as { username?: string; name?: string } | undefined
  return String(u?.username || u?.name || 'system')
}

// 说明：这里统一返回结构化结果，而不是 throw。
// 生产构建下 Server Action 抛出的错误会被 Next.js 脱敏，客户端只会看到
// "An error occurred in the Server Components render..."，无法定位问题。
export async function saveAiConfig(
  input: AiConfigInput
): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  try {
    const auth = await requireAdminFor('保存 AI 配置')
    if (!auth.ok) return auth

    const name = (input.name || '').trim()
    if (!name) return { ok: false, error: '请填写 AI 名称' }
    if (name.length > 50) return { ok: false, error: 'AI 名称最长 50 个字符' }

    const provider = (input.provider || 'groq').toLowerCase()
    if (!presetOf(provider)) return { ok: false, error: '不支持的 AI 服务商' }

    const apiKey = (input.apiKey || '').trim()
    if (apiKey && !canEncrypt()) {
      return { ok: false, error: '服务端未配置 AI_KEY_SECRET（或 NEXTAUTH_SECRET），无法安全保存 API Key' }
    }

    const baseUrl = (input.baseUrl || '').trim()
    const model = (input.model || '').trim()
    const enabled = input.enabled !== false
    const actor = await currentActor()

    const id = await withTransaction(async (client) => {
      const dupName = await client.query(
        `SELECT 1 FROM ai_config WHERE lower(name) = lower($1)` + (input.id ? ` AND id <> $2` : ''),
        input.id ? [name, input.id] : [name]
      )
      if (dupName.rowCount && dupName.rowCount > 0) throw new Error('AI 名称已存在')

      // ---- 编辑 ----
      if (input.id) {
        const updates = ['name = $1', 'provider = $2', 'base_url = $3', 'model = $4', 'enabled = $5', 'updated_at = NOW()']
        const params: any[] = [name, provider, baseUrl, model, enabled]
        let i = params.length
        if (apiKey) {
          updates.push(`api_key_enc = $${++i}`, `api_key_hint = $${++i}`)
          params.push(encryptApiKey(apiKey), maskApiKey(apiKey))
        }
        params.push(input.id)
        const r = await client.query(`UPDATE ai_config SET ${updates.join(', ')} WHERE id = $${++i}`, params)
        if (!r.rowCount || r.rowCount === 0) throw new Error('AI 配置不存在')

        if (input.isDefault) {
          await client.query(`UPDATE ai_config SET is_default = FALSE WHERE id <> $1`, [input.id])
          await client.query(`UPDATE ai_config SET is_default = TRUE WHERE id = $1`, [input.id])
        }
        return input.id
      }

      // ---- 新增 ----
      if (!apiKey) throw new Error('请填写 API Key')
      if (provider === 'custom' && (!baseUrl || !model)) {
        throw new Error('自定义服务商需同时填写 Base URL 与模型名')
      }
      // 第一条配置自动成为默认，保证查询窗口有可用选项
      const cnt = await client.query(`SELECT COUNT(*)::int AS c FROM ai_config`)
      const makeDefault = input.isDefault === true || cnt.rows[0].c === 0
      if (makeDefault) await client.query(`UPDATE ai_config SET is_default = FALSE`)

      const r = await client.query(
        `INSERT INTO ai_config (name, provider, api_key_enc, api_key_hint, base_url, model, is_default, enabled, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [name, provider, encryptApiKey(apiKey), maskApiKey(apiKey), baseUrl, model, makeDefault, enabled, actor]
      )
      return r.rows[0].id as number
    })

    return { ok: true, id }
  } catch (e) {
    return { ok: false, error: (e as Error)?.message || String(e) }
  }
}

// 设为查询窗口默认选中的 AI
export async function setDefaultAiConfig(
  input: { id: number }
): Promise<{ ok: boolean; error?: string }> {
  try {
    const auth = await requireAdminFor('设置默认 AI')
    if (!auth.ok) return auth
    await withTransaction(async (client) => {
      const exist = await client.query(`SELECT 1 FROM ai_config WHERE id = $1`, [input.id])
      if (!exist.rowCount || exist.rowCount === 0) throw new Error('AI 配置不存在')
      await client.query(`UPDATE ai_config SET is_default = FALSE WHERE is_default = TRUE`)
      await client.query(`UPDATE ai_config SET is_default = TRUE, updated_at = NOW() WHERE id = $1`, [input.id])
    })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error)?.message || String(e) }
  }
}

export async function deleteAiConfig(
  input: { id: number }
): Promise<{ ok: boolean; error?: string }> {
  try {
    const auth = await requireAdminFor('删除 AI 配置')
    if (!auth.ok) return auth
    await withTransaction(async (client) => {
      const r = await client.query(`DELETE FROM ai_config WHERE id = $1 RETURNING is_default`, [input.id])
      if (!r.rowCount || r.rowCount === 0) throw new Error('AI 配置不存在')
      // 删掉默认配置时顺延指定新的默认，避免下拉无默认项
      if (r.rows[0]?.is_default) {
        await client.query(
          `UPDATE ai_config SET is_default = TRUE WHERE id = (SELECT id FROM ai_config ORDER BY id ASC LIMIT 1)`
        )
      }
    })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error)?.message || String(e) }
  }
}

