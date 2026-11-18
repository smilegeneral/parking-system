import { NextRequest, NextResponse } from 'next/server'
import pool from '@/lib/db'

// GET /api/check-invoice-order?no=FP001
// 校验发票登记单号是否已存在（invoice_no 为 UNIQUE）
export async function GET(req: NextRequest) {
  const no = req.nextUrl.searchParams.get('no')?.trim()
  if (!no) {
    return NextResponse.json({ ok: true, exists: false })
  }
  try {
    const { rows } = await pool.query(
      `SELECT 1 FROM invoice_records WHERE invoice_no = $1 LIMIT 1`,
      [no]
    )
    return NextResponse.json({ ok: true, exists: rows.length > 0 })
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || '校验失败' },
      { status: 500 }
    )
  }
}
