/**
 * 从数据库导出所有已定位车位坐标，生成幂等 SQL 脚本 sql/seed-parking-coords.sql
 * 用法: node scripts/gen-coords-sql.js
 * 生成的脚本：加字段(IF NOT EXISTS) + 批量 UPSERT 坐标，可重复执行。
 */
const fs = require('fs')
const path = require('path')
const { Pool } = require('pg')

const envText = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8')
const m = envText.match(/^AIVEN_URL=(.*)$/m)
const url = (m ? m[1].trim() : '').replace(/[?&]sslmode=(verify-full|verify-ca|require|prefer)/, '')
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max: 1, connectionTimeoutMillis: 10000 })

function esc(s) { return String(s).replace(/'/g, "''") }
function num(v) { const n = Number(v); return Number.isFinite(n) ? n.toFixed(2) : 'NULL' }

;(async () => {
  const r = await pool.query(`
    SELECT space_id, garage_zone, pos_x, pos_y
    FROM parking_spaces
    WHERE pos_x IS NOT NULL AND pos_y IS NOT NULL
    ORDER BY garage_zone, space_id`)
  await pool.end()

  const rows = r.rows
  const lines = []
  lines.push('-- ============================================================')
  lines.push('--  车位分布图坐标数据（幂等，可重复执行）')
  lines.push('--  由 scripts/gen-coords-sql.js 从数据库导出生成')
  lines.push('--  执行顺序：先由表属主执行 sql/add-parking-coords.sql 加字段，再执行本脚本灌数据')
  lines.push(`--  共 ${rows.length} 个已定位车位，坐标来自 DXF「新车位图层」编号文字提取 + 底图锚点配准`)
  lines.push('--  坐标为图纸归一化百分比 (0~100)，nx 从左到右，ny 从上到下')
  lines.push('-- ============================================================')
  lines.push('')
  lines.push('-- 前置条件：字段 pos_x/pos_y 需由表属主先执行 sql/add-parking-coords.sql 添加。')
  lines.push('-- 本脚本只更新数据，无需属主权限。')
  lines.push('')
  lines.push('BEGIN;')
  lines.push('')
  lines.push('-- 坐标数据：按 space_id 更新（不存在则跳过，不新增车位）')
  // 分批，每 200 行一个 UPDATE ... FROM (VALUES ...) 语句
  const BATCH = 200
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH)
    lines.push(`UPDATE parking_spaces AS p SET pos_x = v.pos_x, pos_y = v.pos_y`)
    lines.push(`FROM (VALUES`)
    batch.forEach((row, j) => {
      const comma = j < batch.length - 1 ? ',' : ''
      lines.push(`  ('${esc(row.space_id)}', ${num(row.pos_x)}::numeric, ${num(row.pos_y)}::numeric)${comma}`)
    })
    lines.push(`) AS v(space_id, pos_x, pos_y) WHERE p.space_id = v.space_id;`)
    lines.push('')
  }
  lines.push('COMMIT;')
  lines.push('')
  lines.push('-- 校验：')
  lines.push(`-- SELECT garage_zone, COUNT(*) FROM parking_spaces WHERE pos_x IS NOT NULL AND pos_y IS NOT NULL GROUP BY garage_zone ORDER BY garage_zone;`)
  lines.push(`-- 预期已定位车位总数: ${rows.length}`)

  const out = path.join(__dirname, '..', 'sql', 'seed-parking-coords.sql')
  fs.writeFileSync(out, lines.join('\n'), 'utf8')
  const byZone = {}
  for (const row of rows) byZone[row.garage_zone] = (byZone[row.garage_zone] || 0) + 1
  console.log(`生成 ${out}`)
  console.log(`已定位车位 ${rows.length}:`, JSON.stringify(byZone))
})().catch(e => { console.error('ERROR:', e.message); process.exit(1) })
