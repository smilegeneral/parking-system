/**
 * 从「新车位图层」提取车位编号文字 + 坐标（GBK 正确解码）
 * 用法: node scripts/extract-space-labels.js garage.dxf
 */
const fs = require('fs')
const path = require('path')

const file = process.argv[2] || 'garage.dxf'
const abs = path.resolve(file)
const buf = fs.readFileSync(abs)
function decode(b) { try { return new TextDecoder('gbk').decode(b) } catch { return b.toString('utf8') } }
let text = decode(buf)
if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
const lines = text.split(/\r?\n/)
const pairs = []
for (let i = 0; i + 1 < lines.length; i += 2) pairs.push({ code: lines[i].trim(), value: lines[i + 1] })

// 解析 ENTITIES 段
let section = '', inEntities = false
const texts = []
let cur = null
const flush = () => { if (cur) { texts.push(cur); cur = null } }
for (let i = 0; i < pairs.length; i++) {
  const p = pairs[i]
  if (p.code === '0') {
    const v = String(p.value).trim()
    if (v === 'SECTION') {
      flush()
      const nx = pairs[i + 1]
      section = nx && nx.code === '2' ? String(nx.value).trim() : ''
      inEntities = section === 'ENTITIES'
      continue
    }
    if (v === 'ENDSEC') { flush(); inEntities = false; section = ''; continue }
    if (v === 'EOF') { flush(); continue }
    if (inEntities && (v === 'TEXT' || v === 'MTEXT')) {
      flush()
      cur = { type: v, layer: '', text: '', x: null, y: null }
    } else if (inEntities) { flush() }
    continue
  }
  if (!inEntities || !cur) continue
  const c = p.code, val = p.value
  if (c === '8') cur.layer = String(val).trim()
  else if (c === '1') cur.text += String(val)
  else if (c === '3') cur.text += String(val)
  else if (c === '10') cur.x = Number(val)
  else if (c === '20') cur.y = Number(val)
}
flush()

// 列出所有含"车位"字样的图层
const layers = {}
for (const t of texts) layers[t.layer] = (layers[t.layer] || 0) + 1
console.log('== 含"车位"的图层(GBK解码后) ==')
for (const [k, v] of Object.entries(layers)) {
  if (/车位/.test(k)) console.log(`  [${k}] ${v} 个文字`)
}

const inRange = (x, y) => x != null && y != null && x > 3000000 && x < 4000000 && y > 0 && y < 1500000
// 目标是"新车位"图层
const targets = texts.filter(t => /新车位/.test(t.layer) && inRange(t.x, t.y))
console.log(`\n== 「新车位」图层文字(有效范围) 共 ${targets.length} 个，全部列出 ==`)
// 按 Y 降序、X 升序排，便于看编排规律
targets.sort((a, b) => Math.abs(b.y - a.y) > 300 ? b.y - a.y : a.x - b.x)
for (const t of targets) {
  console.log(`  (${t.x.toFixed(1)},${t.y.toFixed(1)}) [${t.type}] ${t.text.replace(/[\r\n]/g, ' ')}`)
}
