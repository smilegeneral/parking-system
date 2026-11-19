'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import * as XLSX from 'xlsx'
import { importInvoices } from '@/lib/actions'
import type { InvoiceImportRow, InvoiceImportResult } from '@/lib/types'

// 模板列：一张发票 = 一个业主(housekey) + 多个车位
const HEADERS = ['housekey', '开票日期', '发票号', '价税合计额', '车位号', '车位号2', '车位号3', '车位号4']
const FIELD_KEYS: (keyof InvoiceImportRow)[] = ['house_key', 'invoice_date', 'invoice_no', 'amount', 'space_no', 'space_no2', 'space_no3', 'space_no4']

// 发票号是长数字串，xlsx 一律按文本读取，避免精度丢失
function cellText(v: any): string {
  if (v === undefined || v === null) return ''
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'number') return String(v)
  return String(v).trim()
}

export default function InvoiceImport() {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState<InvoiceImportRow[]>([])
  const [fileName, setFileName] = useState('')
  const [error, setError] = useState('')
  const [result, setResult] = useState<InvoiceImportResult | null>(null)
  const [submitting, setSubmitting] = useState(false)

  function clearAll() {
    setRows([])
    setFileName('')
    setError('')
    setResult(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function downloadTemplate() {
    const wb = XLSX.utils.book_new()
    const sample1 = ['20-2-1202', '2026年10月22日', '26372000005201825836', '80,000.00', 'E-3259', '', '', '']
    const sample2 = ['16-1-401', '2026年10月19日', '26372000005144335561', '204,000.00', 'C071', 'C075', '', '']
    const ws = XLSX.utils.aoa_to_sheet([HEADERS, sample1, sample2])
    ws['!cols'] = [{ wch: 14 }, { wch: 18 }, { wch: 26 }, { wch: 16 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }]
    XLSX.utils.book_append_sheet(wb, ws, '发票导入')

    const tips = [
      ['列', '说明'],
      ['housekey', '必填，业主房号组合键，用于归属业主与统计；一张发票只对应一个 housekey'],
      ['开票日期', '支持「2026年10月22日」或 2026-10-22；留空取今天'],
      ['发票号', '必填，作为唯一登记单号，长期数字请保持为文本，避免科学计数法'],
      ['价税合计额', '整张发票金额，支持带千分位如 80,000.00'],
      ['车位号 / 车位号2 / 车位号3 / 车位号4', '同一业主的多个车位分别填在各列；一行发票可对应 1~4 个车位'],
      ['提示1', '请删除示例行后再导入；单次最多 500 行。'],
      ['提示2', '仅「已售 / 已核销」且未开票的车位可导入；同一车位不要重复导入。'],
      ['提示3', '导入后这些车位全部标记「已开票」，该 housekey 的业主开票统计同步更新。'],
    ]
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(tips), '填写说明')
    XLSX.writeFile(wb, '发票开取登记_批量导入模板.xlsx')
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // 重置 input，确保修正后可再次选择同一文件触发 onChange
    setError('')
    setResult(null)
    setRows([])
    setFileName('')
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const wb = XLSX.read(new Uint8Array(reader.result as ArrayBuffer), { type: 'array', raw: false })
        const sheet = wb.Sheets['发票导入'] || wb.Sheets[wb.SheetNames[0]]
        const aoa = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: '', raw: false })
        if (!aoa.length) throw new Error('表格为空')
        const head = (aoa[0] as any[]).map(h => cellText(h))
        const hkIdx = head.findIndex(h => /house\s*key/i.test(h))
        const invIdx = head.indexOf('发票号')
        if (hkIdx < 0 || invIdx < 0) throw new Error('未找到「housekey」或「发票号」列，请使用下载的模板')
        const idxOf = (i: number) => {
          const name = HEADERS[i]
          let idx = head.indexOf(name)
          if (idx < 0 && i === 0) idx = hkIdx
          return idx
        }
        const idxs = FIELD_KEYS.map((_, i) => idxOf(i))

        const parsed: InvoiceImportRow[] = []
        for (let i = 1; i < aoa.length; i++) {
          const arr = aoa[i] as any[]
          if (!arr) continue
          const obj: any = {}
          FIELD_KEYS.forEach((field, k) => { obj[field] = idxs[k] >= 0 ? cellText(arr[idxs[k]]) : '' })
          if (!String(obj.house_key || '').trim() && !String(obj.invoice_no || '').trim()) continue
          parsed.push(obj as InvoiceImportRow)
        }
        if (!parsed.length) throw new Error('未读取到有效数据行')
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
      if (!res || typeof res.ok !== 'boolean' || !Array.isArray(res.errors)) {
        throw new Error('导入服务未返回有效结果，请稍后重试')
      }
      setResult(res)
      if (res.ok) {
        setRows([])
        setFileName('')
        if (fileInputRef.current) fileInputRef.current.value = ''
        router.refresh()
      }
    } catch (e: any) {
      setError(e?.message || '导入失败')
    } finally {
      setSubmitting(false)
    }
  }

  function spacesOf(r: InvoiceImportRow): string {
    return [r.space_no, r.space_no2, r.space_no3, r.space_no4].map(v => String(v || '').trim()).filter(Boolean).join('、') || '-'
  }

  return (
    <div style={{ borderTop: '1px solid #eee', paddingTop: 16, marginTop: 16 }}>
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>📥 前期发票补录（批量导入）</h2>
      <p className="text-sm text-gray" style={{ marginBottom: 12 }}>
        仅用于<strong>前期销售后补开发票</strong>：一张发票可按一个业主(housekey)对应多个车位批量导入。
        <span style={{ color: '#d97706' }}> 日常新销售请勿用此处</span>——请在上方的「发票登记」中先确认车位销售，再按「一个车位一张发票」逐笔登记。
      </p>

      <div className="flex" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" className="btn-primary" onClick={downloadTemplate}>⬇️ 下载导入模板</button>
        <label style={{ fontSize: 14, color: '#555' }}>
          选择 Excel 文件（.xlsx / .xls）
          <div style={{ marginTop: 4 }}>
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls" onChange={handleFile} className="text-sm" />
          </div>
        </label>
        {rows.length > 0 && (
          <button type="button" className="btn-success" onClick={handleImport} disabled={submitting}>
            {submitting ? '导入中...' : `✅ 确认导入（${rows.length} 张发票）`}
          </button>
        )}
        {(rows.length > 0 || !!error || !!result) && (
          <button type="button" onClick={clearAll} disabled={submitting} style={{ fontSize: 13, padding: '6px 10px' }}>🧹 清除重选</button>
        )}
      </div>

      {!!fileName && <p className="text-sm text-gray" style={{ marginTop: 8 }}>已读取：{fileName}，共 {rows.length} 张发票</p>}
      {!!error && <div className="text-red" style={{ marginTop: 8, fontSize: 14 }}>⚠️ {error}</div>}

      {rows.length > 0 && (
        <div style={{ overflowX: 'auto', marginTop: 12 }}>
          <table>
            <thead>
              <tr><th>行</th><th>housekey</th><th>开票日期</th><th>发票号</th><th>价税合计额</th><th>车位号（含多个）</th></tr>
            </thead>
            <tbody>
              {rows.slice(0, 10).map((r, i) => (
                <tr key={i}>
                  <td>{i + 2}</td>
                  <td>{r.house_key}</td>
                  <td>{r.invoice_date}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{r.invoice_no}</td>
                  <td>{r.amount}</td>
                  <td>{spacesOf(r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > 10 && <p className="text-sm text-gray">仅预览前 10 行，实际导入 {rows.length} 张发票</p>}
        </div>
      )}

      {result && (
        <div style={{ marginTop: 12, padding: 12, borderRadius: 6, background: result.ok ? '#f0fdf4' : '#fff1f0', border: `1px solid ${result.ok ? '#86efac' : '#ffa39e'}` }}>
          <div style={{ fontWeight: 600, fontSize: 14, color: result.ok ? '#15803d' : '#cf1322' }}>
            {result.ok ? `✅ 导入成功：${result.success} / ${result.total} 张发票` : `❌ 导入失败：共 ${result.total} 张发票，${result.errors.length} 条有误`}
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
