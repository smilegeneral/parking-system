'use client'

// 顶层错误边界：捕获所有未被子路由 error.tsx 兜住的服务端渲染/服务端 Action 错误
// （Next.js 中 Server Action 抛错只会冒泡到 global-error，缺失时显示默认英文白屏）。
// 必须自带 <html>/<body>，因为它会替换根布局。
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="zh-CN">
      <body
        style={{
          margin: 0,
          fontFamily: 'system-ui, sans-serif',
          background: '#fff',
          color: '#333',
        }}
      >
        <div style={{ padding: 40, maxWidth: 820, margin: '0 auto' }}>
          <h1 style={{ fontSize: 20 }}>操作出错</h1>
          <p style={{ fontSize: 13, color: '#888' }}>
            服务端执行过程中发生异常。下方为错误信息，可据此定位数据库或渲染问题。
          </p>
          <pre
            style={{
              whiteSpace: 'pre-wrap',
              background: '#f5f5f5',
              padding: 14,
              borderRadius: 8,
              fontSize: 13,
              color: '#c0392b',
            }}
          >
            {error?.message || '未知错误'}
          </pre>
          {error?.digest && (
            <p style={{ color: '#888', fontSize: 12 }}>digest: {error.digest}</p>
          )}
          <button
            onClick={reset}
            style={{
              marginTop: 14,
              padding: '8px 16px',
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            重试
          </button>
        </div>
      </body>
    </html>
  )
}
