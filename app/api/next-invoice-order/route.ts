import { NextResponse } from 'next/server'
import { getNextInvoiceOrderNo } from '@/lib/queries'

// GET /api/next-invoice-order
// 返回下一个发票登记单号（FP + 三位数字，取库中 FP 前缀最大序号 +1）
export async function GET() {
  try {
    const invoice_no = await getNextInvoiceOrderNo()
    return NextResponse.json({ ok: true, invoice_no })
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || '获取单号失败' },
      { status: 500 }
    )
  }
}
