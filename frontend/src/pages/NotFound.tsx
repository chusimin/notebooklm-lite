import { Link } from 'react-router-dom'
import { EmptyState } from '../components/EmptyState'
import { Compass } from 'lucide-react'

/** 404 页面 */
export default function NotFound() {
  return (
    <div className="flex h-full items-center justify-center">
      <EmptyState
        icon={<Compass size={18} />}
        title="页面不存在"
        description="链接可能已失效，或该内容已被删除。"
        action={
          <Link to="/" className="text-sm font-medium text-ink underline underline-offset-4">
            返回笔记本列表
          </Link>
        }
      />
    </div>
  )
}
