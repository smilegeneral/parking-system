'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import * as XLSX from 'xlsx'
import { importInvoices } from '@/lib/actions'
import type { InvoiceImportRow, InvoiceImportResult } from '@/lib/types'

// 模板列：中文表头 → 字段名；带 * 为必填
const COLUMNS: { header: string; field: keyof InvoiceImportRow; tip?: string }[] = [
  { header: '登记单号', field: 'invoice_no', tip: '选填，留空自动生成 FP001…' },
  { header: '车位号', field: 'space_no', tip: '必填，已售/已核销且未开票' },
  { header: '房号', field: 'house_key', tip: '选填，留空取车位房号' },
  { header: '业主姓名', field: 'owner_name', tip: '选填，留空取车位业主' },
  { header: '联系电话', field: 'phone' },
  { header: '开票金额', field: 'amount' },
  { header: '发票类型', field: 'invoice_type', tip: '专票/普票/普票个人，默认普票' },
  { header: '发票代码', field: 'invoice_code' },
  { header: '发票号码', field: 'invoice_number' },
  { header: '开票日期', field: 'invoice_date', tip: 'YYYY-MM-DD，留空取今天' },
  { header: '备注', field: 'remarks' },
]

const HEADERS = COLUMNS.map(c => c.header)

function cellText(v: any): string {
  if (v === undefined || v === null) return ''
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  return String(v).trim()
}

export default function InvoiceImport() {
  const router = useRouter()
  const [rows, setRows] = useState<InvoiceImportRow[]>([])
  const [fileName, setFileName] = useState('')
  const [error, setError] = useState('')
  const [result, setResult] = useState<InvoiceImportResult | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // 生成并下载模板
  function downloadTemplate() {
    const wb = XLSX.utils.book_new()
    const header = HEADERS
    const sample1 = ['FP001', 'A-001', '6-102', '张三', '13800000000', 88000, '普票', '', '', new Date().toISOString().slice(0, 10), '示例数据，导入前请删除']
    const sample2 = ['', 'A-002', '', '', '', '', '专票', '', '', '', '单号留空将自动生成']
    const ws = XLSX.utils.aoa_to_sheet([header, sample1, sample2])
    ws['!cols'] = HEADERS.map(h => ({ wch: h === '备注' || h === '登记单号' ? 24 : 14 }))
    XLSX.utils.book_append_sheet(wb, ws, '发票导入')

    const tips = [
      ['列', '说明'],
      ...COLUMNS.map(c => [c.header, c.tip || '']),
      ['提示1', '请删除示例行后再导入；单次最多 500 行。'],
      ['提示2', '仅「已售 / 已核销」且未开票的车位可导入；同一车位不要重复导入。'],
      ['提示3', '登记单号留空时系统自动生成 FP001、FP002…，与手工登记共用序号。'],
      ['提示4', '导入成功后车位自动标记「已开票」，业主已开票/未开票统计同步更新。'],
    ]
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(tips), '填写说明')
    XLSX.writeFile(wb, '发票开取登记_批量导入模板.xlsx')
  }

  // 解析上传的 Excel
  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    setError('')
    setResult(null)
    setRows([])
    setFileName('')
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const wb = XLSX.read(new Uint8Array(reader.result as ArrayBuffer), { type: 'array' })
        const sheet = wb.Sheets['发票导入'] || wb.Sheets[wb.SheetNames[0]]
        const aoa = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: '' })
        if (!aoa.length) throw new Error('表格为空')
        const head = (aoa[0] as any[]).map(h => cellText(h))
        const idx = (name: string) => head.indexOf(name)
        const spaceIdx = idx('车位号')
        if (spaceIdx < 0) throw new Error('未找到「车位号」列，请使用下载的模板')
        const map: { field: keyof InvoiceImportRow; idx: number }[] = COLUMNS
          .map(c => ({ field: c.field, idx: idx(c.header) }))
          .filter(x => x.idx >= 0)

        const parsed: InvoiceImportRow[] = []
        for (let i = 1; i < aoa.length; i++) {
          const arr = aoa[i] as any[]
          if (!arr || !cellText(arr[spaceIdx])) continue // 跳过空行（含示例行删除后的空行）
          const obj: any = {}
          for (const m of map) obj[m.field] = cellText(arr[m.idx])
          parsed.push(obj as InvoiceImportRow)
        }
        if (!parsed.length) throw new Error('未读取到有效数据行（车位号为空）')
        setRows(parsed)
        setFileName(file.name)
      } catch (err: any) {
        setError(err?.message || '解析失败，请检查文件格式')
      }
    }
    reader.readAsArrayBuffer(file)
  }

  async function handleImport() {
    if (!rows.length) return
    setSubmitting(true)
    setError('')
    try {
      const res = await importInvoices(rows)
      setResult(res)
      if (res.ok) {
        setRows([])
        setFileName('')
        router.refresh()
      }
    } catch (e: any) {
      setError(e?.message || '导入失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={{ borderTop: '1px solid #eee', paddingTop: 16, marginTop: 16 }}>
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>📥 批量导入已开票</h2>
      <p className="text-sm text-gray" style={{ marginBottom: 12 }}>
        下载模板填写后上传，系统自动校验车位状态、单号、金额与日期；仅「已售 / 已核销且未开票」车位可导入。
      </p>

      <div className="flex" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" className="btn-primary" onClick={downloadTemplate}>⬇️ 下载导入模板</button>
        <label style={{ fontSize: 14, color: '#555' }}>
          选择 Excel 文件（.xlsx / .xls）
          <div style={{ marginTop: 4 }}>
            <input type="file" accept=".xlsx,.xls" onChange={handleFile} className="text-sm" />
          </div>
        </label>
        {rows.length > 0 && (
          <button type="button" className="btn-success" onClick={handleImport} disabled={submitting}>
            {submitting ? '导入中...' : `✅ 确认导入（${rows.length} 条）`}
          </button>
        )}
      </div>

      {!!fileName && <p className="text-sm text-gray" style={{ marginTop: 8 }}>已读取：{fileName}，共 {rows.length} 条</p>}
      {!!error && <div className="text-red" style={{ marginTop: 8, fontSize: 14 }}>⚠️ {error}</div>}

      {rows.length > 0 && (
        <div style={{ overflowX: 'auto', marginTop: 12 }}>
          <table>
            <thead>
              <tr><th>行</th><th>登记单号</th><th>车位号</th><th>房号</th><th>业主</th><th>金额</th><th>发票类型</th><th>开票日期</th></tr>
            </thead>
            <tbody>
              {rows.slice(0, 10).map((r, i) => (
                <tr key={i}>
                  <td>{i + 2}</td>
                  <td>{r.invoice_no || '（自动生成）'}</td>
                  <td>{r.space_no}</td>
                  <td>{r.house_key || '-'}</td>
                  <td>{r.owner_name || '-'}</td>
                  <td>{r.amount || '-'}</td>
                  <td>{r.invoice_type || '-'}</td>
                  <td>{r.invoice_date || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > 10 && <p className="text-sm text-gray">仅预览前 10 行，实际导入 {rows.length} 行</p>}
        </div>
      )}

      {result && (
        <div style={{ marginTop: 12, padding: 12, borderRadius: 6, background: result.ok ? '#f0fdf4' : '#fff1f0', border: `1px solid ${result.ok ? '#86efac' : '#ffa39e'}` }}>
          <div style={{ fontWeight: 600, fontSize: 14, color: result.ok ? '#15803d' : '#cf1322' }}>
            {result.ok ? `✅ 导入成功：${result.success} / ${result.total} 条` : `❌ 导入失败：共 ${result.total} 条，${result.errors.length} 条有误`}
          </div>
          {!result.ok && result.errors.length > 0 && (
            <div style={{ marginTop: 6, fontSize: 13, lineHeight: 1.8 }}>
              {result.errors.slice(0, 30).map((e, i) => <div key={i}>第 {e.row} 行：{e.message}</div>)}
              {result.errors.length > 30 && <div>…… 仅显示前 30 条错误</div>}
              <div className="text-gray">请修正后重新上传，未写入任何数据。</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
