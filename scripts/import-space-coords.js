/**
 * 把 space-coords.json 的车位坐标导入数据库 parking_spaces.pos_x/pos_y
 * 用法: node scripts/import-space-coords.js [--apply]
 * 默认 dry-run（只预览）；加 --apply 才真正写入。
 */
const fs = require('fs')
const path = require('path')
const { Pool } = require('pg')

const apply = process.argv.includes('--apply')
const coords = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'space-coords.json'), 'utf8'))

const envText = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8')
const m = envText.match(/^AIVEN_URL=(.*)$/m)
const url = (m ? m[1].trim() : '').replace(/[?&]sslmode=(verify-full|verify-ca|require|prefer)/, '')
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max: 1, connectionTimeoutMillis: 10000 })

;(async () => {
  const client = await pool.connect()
  try {
    // 检查字段是否已由属主执行 sql/add-parking-coords.sql 添加
    const col = await client.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema=current_schema() AND table_name='parking_spaces' AND column_name IN ('pos_x','pos_y')`
    )
    if (col.rows.length < 2) {
      console.error('字段 pos_x/pos_y 不存在。请先由表属主执行: sql/add-parking-coords.sql')
      return
    }

    // 去重：同一 space_id 取第一个（166 重复）
    const seen = new Set()
    const list = []
    for (const c of coords) {
      if (seen.has(c.space_id)) continue
      seen.add(c.space_id)
      list.push(c)
    }

    // 校验：space_id 是否都在库中
    const ids = list.map(c => c.space_id)
    const chk = await client.query(`SELECT space_id FROM parking_spaces WHERE space_id = ANY($1::text[])`, [ids])
    const dbIds = new Set(chk.rows.map(r => r.space_id))
    const missing = ids.filter(id => !dbIds.has(id))
    console.log(`坐标数(去重): ${list.length}, 库中匹配: ${chk.rows.length}, 缺失: ${missing.length}`)
    if (missing.length) console.log('  缺失:', missing.slice(0, 20).join(', '))

    if (!apply) {
      console.log('\n[DRY-RUN] 未写入。样本:')
      for (const c of list.slice(0, 8)) console.log(`  ${c.space_id} -> ${c.nx}%, ${c.ny}%`)
      console.log('\n确认无误后执行: node scripts/import-space-coords.js --apply')
      return
    }

    await client.query('BEGIN')
    let updated = 0
    for (const c of list) {
      const r = await client.query(
        `UPDATE parking_spaces SET pos_x=$1, pos_y=$2, updated_at=NOW() WHERE space_id=$3`,
        [c.nx, c.ny, c.space_id]
      )
      updated += r.rowCount || 0
    }
    await client.query('COMMIT')
    console.log(`\n[APPLY] 已更新 ${updated} 个车位坐标`)

    const v = await client.query(`SELECT COUNT(*)::int n FROM parking_spaces WHERE pos_x IS NOT NULL AND pos_y IS NOT NULL`)
    console.log('当前已定位车位总数:', v.rows[0].n)
  } catch (e) {
    try { await client.query('ROLLBACK') } catch {}
    console.error('ERROR:', e.message)
  } finally {
    client.release()
    await pool.end()
  }
})()
