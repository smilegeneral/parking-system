import { Pool, PoolClient } from 'pg'

// Aiven PostgreSQL 连接池
// 免费档连接数有限，max=1 保证不超额
// 注意：pg v8 会把 sslmode=require/verify-ca 当 verify-full 处理，
// 而连接串里未提供 Aiven CA 证书，导致握手失败（self-signed certificate）。
// 因此这里剥离 sslmode 参数，改由下方 ssl 选项控制。
// 安全：生产环境强制校验证书链（防中间人攻击）；
// 仅在显式设置 AIVEN_NO_VERIFY=1 或 NODE_TLS_REJECT_UNAUTHORIZED=0 的开发环境才放宽。
import { readFileSync } from 'fs'
import { join } from 'path'

// AIVEN_CA 提供方式（任意其一即可）：
//   1) 环境变量 AIVEN_CA：PEM 文本（多行）。
//   2) 环境变量 AIVEN_CA_B64：PEM 的 Base64 编码（单行、无任何特殊字符，
//      专为 EdgeOne 等"变量值禁止换行"的平台设计，避免粘贴证书时报错）。
//   3) 仓库/构建产物中的 ca.pem 文件：构建脚本把 AIVEN_CA 落盘后，运行时从此读取。
// 若三者皆无，则回退到 Node 内置根证书校验（rejectUnauthorized=true，仍防中间人）。
const tlsVerifyDisabled =
  process.env.AIVEN_NO_VERIFY === '1' ||
  process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0'

// 将单/多行 PEM 规范化为标准多行格式（每个 ----- 标记独立成行）
function normalizePem(raw: string): string {
  let s = raw.replace(/\\n/g, '\n') // 字面量 \n -> 真实换行
  if (!s.includes('\n')) {
    // 直接去掉真实换行的单行 PEM：在边界标记处补换行
    s = s.replace(/(-----BEGIN CERTIFICATE-----)/g, '$1\n')
    s = s.replace(/(-----END CERTIFICATE-----)/g, '\n$1\n')
    s = s.replace(/(\n)+/g, '\n').trim() + '\n'
  }
  return s
}

function resolveCa(): string | undefined {
  // 方式 1：单变量 AIVEN_CA_B64（Base64，适用于变量值无长度限制的平台）
  if (process.env.AIVEN_CA_B64) {
    try {
      return normalizePem(Buffer.from(process.env.AIVEN_CA_B64, 'base64').toString('utf8'))
    } catch {
      // 解码失败则忽略，继续尝试其他方式
    }
  }
  // 方式 2：分片变量 AIVEN_CA_B64_1 / _2 / _3 ...（规避 EdgeOne 等 1000 字符变量上限）
  const fragKeys = Object.keys(process.env)
    .filter(k => /^AIVEN_CA_B64_\d+$/.test(k))
    .sort()
  if (fragKeys.length > 0) {
    const joined = fragKeys.map(k => process.env[k] || '').join('')
    try {
      return normalizePem(Buffer.from(joined, 'base64').toString('utf8'))
    } catch {
      // 解码失败则忽略
    }
  }
  // 方式 3：环境变量 AIVEN_CA（多行 PEM 文本）
  if (process.env.AIVEN_CA) return normalizePem(process.env.AIVEN_CA)
  // 方式 4：文件 ca.pem
  try {
    return normalizePem(readFileSync(join(process.cwd(), 'ca.pem'), 'utf8'))
  } catch {
    return undefined
  }
}

const ca = resolveCa()
const sslConfig = tlsVerifyDisabled
  ? { rejectUnauthorized: false }
  : ca
    ? { ca }
    : { rejectUnauthorized: true }

// 用 new URL 解析连接串，提取显式参数构建 Pool。
// 原因：pg 的 connectionString 解析对 URL 编码的密码（%40/%26）处理不稳，
// 会导致 "client password must be a string" 而连接失败；显式参数可正确传入解码后的密码。
function buildPoolConfig() {
  const raw = process.env.AIVEN_URL || ''
  try {
    const u = new URL(raw.replace(/[?&]sslmode=(verify-full|verify-ca|require|prefer)/, ''))
    return {
      host: u.hostname,
      port: u.port ? Number(u.port) : 5432,
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: u.pathname.replace(/^\//, '') || 'postgres',
      ssl: sslConfig,
      max: 1,
      idleTimeoutMillis: 5000,
      connectionTimeoutMillis: 10000,
    }
  } catch {
    // 退化到连接串方式
    return {
      connectionString: raw.replace(/[?&]sslmode=(verify-full|verify-ca|require|prefer)/, ''),
      ssl: sslConfig,
      max: 1,
      idleTimeoutMillis: 5000,
      connectionTimeoutMillis: 10000,
    }
  }
}

const pool = new Pool(buildPoolConfig())

// 事务助手：自动 BEGIN / COMMIT / ROLLBACK
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK')
    // 打印真实错误到服务端日志，便于在 Vercel 函数日志中定位（生产环境前端不暴露详情）
    console.error('[withTransaction] rolled back due to error:', err)
    throw err
  } finally {
    client.release()
  }
}

export default pool
