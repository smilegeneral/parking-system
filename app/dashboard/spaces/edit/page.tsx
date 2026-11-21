import { auth } from '@/lib/auth'
import SpaceEditor from './space-editor'

export const dynamic = 'force-dynamic'

export default async function SpaceEditPage() {
  const session = await auth()
  if (!session) throw new Error('未登录')
  const user = session.user as any
  const role = user?.role ?? 1
  if (role < 1) throw new Error('无权访问')
  const operator = user?.display_name || user?.displayName || user?.name || ''
  return <SpaceEditor operator={operator} />
}
