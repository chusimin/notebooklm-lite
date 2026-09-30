/**
 * Markdown：通用 Markdown 渲染（GFM：表格、任务列表、删除线）。
 * 链接统一新窗口打开。样式见 index.css 的 .md。
 */
import ReactMarkdown, { type Components, type Options } from 'react-markdown'
import remarkGfm from 'remark-gfm'

type PluggableList = NonNullable<Options['remarkPlugins']>
import { cn } from '../lib/cn'

const baseComponents: Components = {
  a: ({ href, children, ...rest }) => (
    <a href={href} target="_blank" rel="noreferrer" className="underline decoration-ink-400 underline-offset-2" {...rest}>
      {children}
    </a>
  ),
}

export function Markdown({
  children,
  className,
  components,
  remarkPlugins = [],
}: {
  children: string
  className?: string
  components?: Components
  remarkPlugins?: PluggableList
}) {
  return (
    <div className={cn('md', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm, ...remarkPlugins]} components={{ ...baseComponents, ...components }}>
        {children}
      </ReactMarkdown>
    </div>
  )
}
