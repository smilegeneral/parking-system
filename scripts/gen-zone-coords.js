/**
 * 用 DXF $EXTMIN/$EXTMAX 线性映射到底图像素，提取"新车位图层"编号坐标并匹配数据库。
 * 用法: node scripts/gen-zone-coords.js <zone>
 * 配置见下方 CFG。生成 coords-<zone>.json
 * 映射: px=(X-minX)/(maxX-minX)*imgW ; py=(maxY-Y)/(maxY-minY)*imgH
 */
const fs = require('fs'), path = require('path'), { Pool } = require('pg')

const CFG = {
  B:  { dxf:'dxf/B.dxf',  dbZone:'B区',  min:[29917.10095394217,-799309.6107542368],  max:[1682621.037735542,107590.147408886],  img:[22400,12800] },
  D1: { dxf:'dxf/D1.dxf', dbZone:'D1区', min:[183425.2088480271,125243.6952983584],    max:[437534.4593026299,320213.8460171427],  img:[7840,6020] },
  D2: { dxf:'dxf/D2.dxf', dbZone:'D2区', min:[28859.54206183538,30037.18857833088],    max:[282968.7925164382,225007.3392971152],  img:[9300,7130] },
  E:  { dxf:'dxf/E.dxf',  dbZone:'E区',  min:[3052669,-637711],    max:[3306778,-441741],  img:[18800,13320] },
}
const zone = process.argv[2]
const cfg = CFG[zone]
if (!cfg) { console.error('zone must be one of', Object.keys(CFG)); process.exit(1) }

const b = fs.readFileSync(path.resolve(__dirname,'..',cfg.dxf))
let t
try { t = new TextDecoder('gbk').decode(b) } catch { t = b.toString('utf8') }
const L = t.split(/\r?\n/), pairs = []
for (let i = 0; i + 1 < L.length; i += 2) pairs.push({ code: L[i].trim(), value: L[i + 1] })
let inE = false, cur = null, texts = []
const flush = () => { if (cur) { texts.push(cur); cur = null } }
for (let i = 0; i < pairs.length; i++) {
  const p = pairs[i]
  if (p.code === '0') {
    const v = String(p.value).trim()
    if (v === 'SECTION') { flush(); const nx = pairs[i+1]; inE = nx && nx.code==='2' && String(nx.value).trim()==='ENTITIES'; continue }
    if (v === 'ENDSEC') { flush(); inE = false; continue }
    if (v === 'EOF') { flush(); continue }
    if (inE && (v === 'TEXT' || v === 'MTEXT')) { flush(); cur = { layer:'', text:'', x:null, y:null } }
    else if (inE) flush()
    continue
  }
  if (!inE || !cur) continue
  if (p.code==='8') cur.layer=String(p.value).trim()
  else if (p.code==='1'||p.code==='3') cur.text+=String(p.value)
  else if (p.code==='10') cur.x=Number(p.value)
  else if (p.code==='20') cur.y=Number(p.value)
}
flush()
const clean = s => String(s||'').replace(/\\U\+[0-9A-Fa-f]+/g,'').replace(/\\[A-Za-z][^;]*;/g,'').replace(/[{}]/g,'').replace(/\s+/g,'').toUpperCase()
const isNo = s => /^(X?\d{3,4}[A-Z]?)$/.test(s) && s.length<=6
const labels = texts.filter(x=>/新车位/.test(x.layer) && isNo(clean(x.text)) && Number.isFinite(x.x) && Number.isFinite(x.y))

const [minX,minY]=cfg.min, [maxX,maxY]=cfg.max, [imgW,imgH]=cfg.img
// 若存在仿射系数文件则用它（被污染 EXT 的区），否则用 EXT 线性映射
const affPath = path.join(__dirname, `affine-${zone}.json`)
let px, py
if (fs.existsSync(affPath)) {
  const k = JSON.parse(fs.readFileSync(affPath,'utf8'))
  console.log(`  使用仿射变换 (score=${k.score}, avg_err=${k.avg_err?.toFixed(0)})`)
  px = (X,Y) => k.a*X + k.b*Y + k.c
  py = (X,Y) => k.d*X + k.e*Y + k.f
} else {
  px = (X,Y) => (X-minX)/(maxX-minX)*imgW
  py = (X,Y) => (maxY-Y)/(maxY-minY)*imgH
}

const envText=fs.readFileSync(path.join(__dirname,'..','.env.local'),'utf8')
const m=envText.match(/^AIVEN_URL=(.*)$/m)
const url=(m?m[1].trim():'').replace(/[?&]sslmode=(verify-full|verify-ca|require|prefer)/,'')
const pool=new Pool({connectionString:url,ssl:{rejectUnauthorized:false},max:1,connectionTimeoutMillis:10000})

;(async()=>{
  const r=await pool.query(`SELECT space_id,space_num FROM parking_spaces WHERE garage_zone=$1`,[cfg.dbZone])
  const dbMap=new Map(r.rows.map(row=>[String(row.space_num).trim().toUpperCase(),row.space_id]))
  const out=[], seen=new Set()
  for(const l of labels){
    const label=clean(l.text)
    const id=dbMap.get(label)
    if(!id || seen.has(id)) continue
    seen.add(id)
    const pxx=px(l.x,l.y), pyy=py(l.x,l.y)
    out.push({space_id:id,label,nx:Number((pxx/imgW*100).toFixed(2)),ny:Number((pyy/imgH*100).toFixed(2)),px:Number(pxx.toFixed(0)),py:Number(pyy.toFixed(0))})
  }
  await pool.end()
  console.log(`${zone}: DXF编号=${labels.length} 匹配=${out.length} DB总数=${r.rows.length}`)
  console.log(`  像素范围 X ${Math.min(...out.map(o=>o.px))}~${Math.max(...out.map(o=>o.px))} Y ${Math.min(...out.map(o=>o.py))}~${Math.max(...out.map(o=>o.py))} (图 ${imgW}x${imgH})`)
  console.log('  样本:', JSON.stringify(out.slice(0,4)))
  fs.writeFileSync(path.join(__dirname,'..',`coords-${zone}.json`), JSON.stringify(out,null,2),'utf8')
})().catch(e=>{console.error('ERROR:',e.message);process.exit(1)})
