/**
 * 正式生成车位坐标表：从「新车位图层」提取编号+坐标，匹配数据库 space_id
 * 用法: node scripts/gen-space-coords.js garage.dxf
 * 输出: space-coords.json  { space_id, label, x, y, nx, ny }  (nx/ny 为归一化百分比)
 */
const fs = require('fs')
const path = require('path')
const { Pool } = require('pg')

const file = process.argv[2] || 'garage.dxf'
const abs = path.resolve(file)
const buf = fs.readFileSync(abs)
function decode(b) { try { return new TextDecoder('gbk').decode(b) } catch { return b.toString('utf8') } }
let text = decode(buf)
if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
const lines = text.split(/\r?\n/)
const pairs = []
for (let i = 0; i + 1 < lines.length; i += 2) pairs.push({ code: lines[i].trim(), value: lines[i + 1] })

// 解析 ENTITIES：提取 TEXT/MTEXT 的插入点、对齐点(11/21)、图层、文字
let inEntities = false
const labels = []
let cur = null
const flush = () => { if (cur) { labels.push(cur); cur = null } }
for (let i = 0; i < pairs.length; i++) {
  const p = pairs[i]
  if (p.code === '0') {
    const v = String(p.value).trim()
    if (v === 'SECTION') {
      flush()
      const nx = pairs[i + 1]
      inEntities = nx && nx.code === '2' && String(nx.value).trim() === 'ENTITIES'
      continue
    }
    if (v === 'ENDSEC') { flush(); inEntities = false; continue }
    if (v === 'EOF') { flush(); continue }
    if (inEntities && (v === 'TEXT' || v === 'MTEXT')) { flush(); cur = { layer: '', text: '', x: null, y: null, ax: null, ay: null, h: 0 } }
    else if (inEntities) flush()
    continue
  }
  if (!inEntities || !cur) continue
  const c = p.code, val = p.value
  if (c === '8') cur.layer = String(val).trim()
  else if (c === '1' || c === '3') cur.text += String(val)
  else if (c === '10') cur.x = Number(val)
  else if (c === '20') cur.y = Number(val)
  else if (c === '11') cur.ax = Number(val)
  else if (c === '21') cur.ay = Number(val)
  else if (c === '40') cur.h = Number(val)
}
flush()

const inRange = (x, y) => x != null && y != null && x > 3000000 && x < 4000000 && y > 0 && y < 1500000
// 清洗编号：只保留纯编号（三位数字，可带 C/X 及字母），剔除说明文字
function cleanLabel(s) {
  let v = String(s || '').replace(/\s+/g, '').toUpperCase()
  v = v.replace(/^\{|\}$/g, '').replace(/\\P/g, '')
  return v
}
const isSpaceNo = v => /^(X?\d{3}[A-Z]?)$/.test(v)

const found = []
for (const t of labels) {
  if (!/新车位/.test(t.layer)) continue
  if (!inRange(t.x, t.y)) continue
  const v = cleanLabel(t.text)
  if (!isSpaceNo(v)) continue
  // MTEXT 对齐点(11/21)若为 -1/0 是无效哨兵，仅当有效范围才用，否则用插入点
  const cx = t.ax != null && Number.isFinite(t.ax) && t.ax > 1000 ? t.ax : t.x
  const cy = t.ay != null && Number.isFinite(t.ay) && t.ay > 1000 ? t.ay : t.y
  if (!inRange(cx, cy)) continue
  found.push({ label: v, x: cx, y: cy })
}

console.log('新车位图层有效编号数:', found.length)

// 坐标范围（用这些车位自身，避免脏点）
const xs = found.map(f => f.x), ys = found.map(f => f.y)
const minX = Math.min(...xs), maxX = Math.max(...xs)
const minY = Math.min(...ys), maxY = Math.max(...ys)
console.log(`坐标范围 X:${minX.toFixed(0)}~${maxX.toFixed(0)} Y:${minY.toFixed(0)}~${maxY.toFixed(0)}`)

// 读数据库 A 区 space_id -> space_num，做精确匹配
const envText = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8')
const m = envText.match(/^AIVEN_URL=(.*)$/m)
const url = (m ? m[1].trim() : '').replace(/[?&]sslmode=(verify-full|verify-ca|require|prefer)/, '')
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max: 1, connectionTimeoutMillis: 10000 })

;(async () => {
  let dbMap = new Map()
  try {
    const r = await pool.query(`SELECT space_id, space_num FROM parking_spaces WHERE garage_zone='A区'`)
    for (const row of r.rows) dbMap.set(String(row.space_num).trim().toUpperCase(), row.space_id)
    console.log('数据库 A 区车位数:', dbMap.size)
  } catch (e) {
    console.error('DB ERROR:', e.message)
  } finally {
    await pool.end()
  }

  const out = []
  const unmatched = []
  for (const f of found) {
    const spaceId = dbMap.get(f.label) || dbMap.get(f.label.replace(/^X/, 'X'))
    if (!spaceId) { unmatched.push(f.label); continue }
    // 归一化：X 从左到右 0~100，Y 从下到上 0~100（图上 Y 越大越靠上，故反转）
    const nx = (f.x - minX) / (maxX - minX) * 100
    const ny = (maxY - f.y) / (maxY - minY) * 100
    out.push({ space_id: spaceId, label: f.label, x: Number(f.x.toFixed(2)), y: Number(f.y.toFixed(2)), nx: Number(nx.toFixed(2)), ny: Number(ny.toFixed(2)) })
  }
  console.log('成功匹配:', out.length, ' 未匹配:', unmatched.length)
  if (unmatched.length) console.log('未匹配编号(前40):', unmatched.slice(0, 40).join(', '))

  const outFile = path.join(path.dirname(abs), 'space-coords.json')
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2), 'utf8')
  console.log('已输出:', outFile)
  console.log('\n样本(前10):')
  for (const o of out.slice(0, 10)) console.log(`  ${o.space_id} (${o.label}) -> ${o.nx}%,${o.ny}%`)
})()
