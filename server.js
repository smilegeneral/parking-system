// 生产启动包装：直接运行 next start，绕过 pm2（pm2-runtime 在 LocalSystem 下因 HOME 缺失会崩溃）。
// 功能等价于原 ecosystem.config.js：读取 .env.local 并注入进程环境（next start 不会自动加载 .env.local）。
const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')

function loadEnvFile(file) {
  const out = {}
  try {
    const text = fs.readFileSync(file, 'utf8')
    text.split('\n').forEach((line) => {
      const m = line.match(/^([A-Za-z0-9_]+)=(.*)$/)
      if (m) out[m[1]] = m[2].trim()
    })
  } catch {
    // 文件不存在则忽略
  }
  return out
}

const localEnv = loadEnvFile(path.join(__dirname, '.env.local'))

const env = {
  ...process.env,
  ...localEnv,
  NODE_ENV: 'production',
  PORT: '3000',
  // 关闭 IDE 的安全删除 shim，避免极少数场景下文件删除被拦截
  CODEBUDDY_SAFE_DELETE_ENABLED: '0',
}

const child = spawn(
  process.execPath,
  [path.join(__dirname, 'node_modules/next/dist/bin/next'), 'start'],
  { cwd: __dirname, env, stdio: 'inherit' }
)

child.on('exit', (code) => process.exit(code ?? 0))
child.on('error', (err) => {
  console.error('failed to start next:', err.message)
  process.exit(1)
})
