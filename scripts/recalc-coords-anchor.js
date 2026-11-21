/**
 * 用楼栋文字锚点建立 DXF图纸坐标 -> 图片像素 的线性映射，重新计算车位坐标
 * 锚点来源：截图(1064x656)中楼栋标签像素位置 + DXF中对应文字坐标
 * 用法: node scripts/recalc-coords-anchor.js garage.dxf
 */
const fs = require('fs')
const path = require('path')
const { Pool } = require('pg')

// [dxfX, dxfY, pixelX, pixelY] —— 楼栋 MTEXT 为左上角对齐(71=1)，像素取文字左上角
// 像素从 coord-grid.png 网格图精确读取
const ANCHORS = [
  [3741687, 1114984, 497, 128],  // 1#楼
  [3694886, 1075604, 300, 307],  // 2#楼
  [3636955, 1028135, 52, 500],   // 3#楼
  [3701434, 1015353, 330, 556],  // 4#楼
  [3773456, 1047438, 630, 430],  // 5#楼
  [3791914, 1080363, 715, 287],  // 6#楼
]

// 最小二乘拟合 px = a*dxfX + b*dxfY + c ; py = d*dxfX + e*dxfY + f
function fit(anchors, isX) {
  // 解正规方程 (M^T M) coeff = M^T v
  const n = anchors.length
  const M = anchors.map(a => [a[0], a[1], 1])
  const v = anchors.map(a => isX ? a[2] : a[3])
  // 3x3 矩阵
  const A = [[0,0,0],[0,0,0],[0,0,0]], B = [0,0,0]
  for (let i=0;i<n;i++){
    for(let r=0;r<3;r++){ for(let c=0;c<3;c++) A[r][c]+=M[i][r]*M[i][c]; B[r]+=M[i][r]*v[i] }
  }
  // 高斯消元
  for(let i=0;i<3;i++){
    let p=i; for(let r=i+1;r<3;r++) if(Math.abs(A[r][i])>Math.abs(A[p][i])) p=r
    ;[A[i],A[p]]=[A[p],A[i]]; [B[i],B[p]]=[B[p],B[i]]
    const d=A[i][i]
    for(let c=0;c<3;c++) A[i][c]/=d; B[i]/=d
    for(let r=0;r<3;r++){ if(r===i)continue; const f=A[r][i]; for(let c=0;c<3;c++) A[r][c]-=f*A[i][c]; B[r]-=f*B[i] }
  }
  return B // [a,b,c] or [d,e,f]
}
const [ax,bx,cx] = fit(ANCHORS, true)
const [ay,by,cy] = fit(ANCHORS, false)
const px = (X,Y) => ax*X + bx*Y + cx
const py = (X,Y) => ay*X + by*Y + cy
console.log(`映射: px = ${ax}*X + ${bx}*Y + ${cx}`)
console.log(`      py = ${ay}*X + ${by}*Y + ${cy}`)
console.log('\n锚点拟合误差(像素):')
for (const a of ANCHORS) {
  const ex = px(a[0],a[1])-a[2], ey = py(a[0],a[1])-a[3]
  console.log(`  ${a[2]},${a[3]} -> 误差 (${ex.toFixed(1)}, ${ey.toFixed(1)})`)
}

// 提取编号文字坐标
const abs = path.resolve(process.argv[2] || 'garage.dxf')
const buf = fs.readFileSync(abs)
let t
try { t = new TextDecoder('gbk').decode(buf) } catch { t = buf.toString('utf8') }
const L = t.split(/\r?\n/), pairs=[]
for(let i=0;i+1<L.length;i+=2) pairs.push({code:L[i].trim(),value:L[i+1]})
let inE=false, cur=null, labels=[]
const flush=()=>{if(cur){labels.push(cur);cur=null}}
for(let i=0;i<pairs.length;i++){
  const p=pairs[i]
  if(p.code==='0'){
    const v=String(p.value).trim()
    if(v==='SECTION'){flush();const nx=pairs[i+1];inE=nx&&nx.code==='2'&&String(nx.value).trim()==='ENTITIES';continue}
    if(v==='ENDSEC'){flush();inE=false;continue}
    if(v==='EOF'){flush();continue}
    if(inE&&(v==='TEXT'||v==='MTEXT')){flush();cur={layer:'',text:'',x:null,y:null}}
    else if(inE)flush()
    continue
  }
  if(!inE||!cur)continue
  if(p.code==='8')cur.layer=String(p.value).trim()
  else if(p.code==='1'||p.code==='3')cur.text+=String(p.value)
  else if(p.code==='10')cur.x=Number(p.value)
  else if(p.code==='20')cur.y=Number(p.value)
}
flush()
const isNo = s=>/^(X?\d{3}[A-Z]?)$/.test(String(s||'').replace(/\s+/g,'').toUpperCase())
const labs = labels.filter(l=>/新车位/.test(l.layer)&&isNo(l.text)&&l.x>3000000&&l.x<4000000&&l.y>0&&l.y<1500000)

const envText=fs.readFileSync(path.join(__dirname,'..','.env.local'),'utf8')
const m=envText.match(/^AIVEN_URL=(.*)$/m)
const url=(m?m[1].trim():'').replace(/[?&]sslmode=(verify-full|verify-ca|require|prefer)/,'')
const pool=new Pool({connectionString:url,ssl:{rejectUnauthorized:false},max:1,connectionTimeoutMillis:10000})

;(async()=>{
  const r=await pool.query(`SELECT space_id,space_num FROM parking_spaces WHERE garage_zone='A区'`)
  const dbMap=new Map(r.rows.map(row=>[String(row.space_num).trim().toUpperCase(),row.space_id]))
  const W=1064,H=656
  const out=[]
  for(const l of labs){
    const id=dbMap.get(l.text.toUpperCase())
    if(!id)continue
    const pxx=px(l.x,l.y), pyy=py(l.x,l.y)
    out.push({space_id:id,label:l.text,nx:Number((pxx/W*100).toFixed(2)),ny:Number((pyy/H*100).toFixed(2)),px:Number(pxx.toFixed(1)),py:Number(pyy.toFixed(1))})
  }
  await pool.end()
  console.log(`\n匹配车位: ${out.length}`)
  console.log('像素范围: X %d~%d, Y %d~%d', Math.min(...out.map(o=>o.px)).toFixed(0),Math.max(...out.map(o=>o.px)).toFixed(0),Math.min(...out.map(o=>o.py)).toFixed(0),Math.max(...out.map(o=>o.py)).toFixed(0))
  console.log('样本:', JSON.stringify(out.slice(0,5)))
  fs.writeFileSync(path.join(__dirname,'..','space-coords.json'),JSON.stringify(out,null,2),'utf8')
  console.log('已更新 space-coords.json')
})()
