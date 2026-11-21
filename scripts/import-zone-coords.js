/**
 * 把 B/D1/D2/E 区 coords-<zone>.json 的坐标导入 parking_spaces.pos_x/pos_y
 * 用法: node scripts/import-zone-coords.js [--apply]   默认 dry-run
 */
const fs = require('fs'), path = require('path'), { Pool } = require('pg')
const apply = process.argv.includes('--apply')
const ZONES = ['B','D1','D2','E']
const DBZONE = { B:'B区', D1:'D1区', D2:'D2区', E:'E区' }

const envText=fs.readFileSync(path.join(__dirname,'..','.env.local'),'utf8')
const m=envText.match(/^AIVEN_URL=(.*)$/m)
const url=(m?m[1].trim():'').replace(/[?&]sslmode=(verify-full|verify-ca|require|prefer)/,'')
const pool=new Pool({connectionString:url,ssl:{rejectUnauthorized:false},max:1,connectionTimeoutMillis:10000})

;(async()=>{
  const client=await pool.connect()
  try{
    const all=[]
    for(const z of ZONES){
      const p=path.join(__dirname,'..',`coords-${z}.json`)
      if(!fs.existsSync(p)){console.log('MISSING',p);continue}
      const arr=JSON.parse(fs.readFileSync(p,'utf8'))
      const seen=new Set()
      let bad=0
      for(const c of arr){
        if(seen.has(c.space_id))continue
        seen.add(c.space_id)
        if(!(c.nx>=0&&c.nx<=100&&c.ny>=0&&c.ny<=100)){bad++;continue}
        all.push({...c,dbZone:DBZONE[z]})
      }
      console.log(`${z}: ${arr.length} -> ${seen.size} 去重, 越界${bad}, nx[${Math.min(...arr.map(x=>x.nx))}~${Math.max(...arr.map(x=>x.nx))}] ny[${Math.min(...arr.map(x=>x.ny))}~${Math.max(...arr.map(x=>x.ny))}]`)
    }
    const ids=all.map(c=>c.space_id)
    const chk=await client.query(`SELECT space_id FROM parking_spaces WHERE space_id=ANY($1::text[])`,[ids])
    const dbIds=new Set(chk.rows.map(r=>r.space_id))
    const missing=ids.filter(id=>!dbIds.has(id))
    console.log(`\n总计 ${all.length}, 库中匹配 ${chk.rows.length}, 缺失 ${missing.length}`)
    if(missing.length)console.log('  缺失样本:',missing.slice(0,10).join(','))

    if(!apply){
      console.log('\n[DRY-RUN] 未写入。样本:')
      for(const c of all.slice(0,3))console.log(`  ${c.space_id} -> ${c.nx}%, ${c.ny}%`)
      console.log('\n确认后: node scripts/import-zone-coords.js --apply')
      return
    }
    await client.query('BEGIN')
    let upd=0
    for(const c of all){
      const r=await client.query(`UPDATE parking_spaces SET pos_x=$1,pos_y=$2,updated_at=NOW() WHERE space_id=$3`,[c.nx,c.ny,c.space_id])
      upd+=r.rowCount||0
    }
    await client.query('COMMIT')
    console.log(`\n[APPLY] 更新 ${upd} 个车位坐标`)
    const v=await client.query(`SELECT COUNT(*)::int n FROM parking_spaces WHERE pos_x IS NOT NULL AND pos_y IS NOT NULL`)
    console.log('已定位车位总数:',v.rows[0].n)
  }catch(e){
    try{await client.query('ROLLBACK')}catch{}
    console.error('ERROR:',e.message)
  }finally{
    client.release();await pool.end()
  }
})()
