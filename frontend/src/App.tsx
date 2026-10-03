/**
 * 路由表：
 *   /                 笔记本列表
 *   /notebooks/:id    笔记本三栏工作台
 *   /admin            观测后台（独立布局，按需加载 recharts 等依赖）：总览 / 调用记录 / 调用详情 / RAG 演示
 */
import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import NotebooksPage from './pages/NotebooksPage'
import NotebookPage from './pages/NotebookPage'
import NotFound from './pages/NotFound'
import { LoadingBlock } from './components/Spinner'

const AdminLayout = lazy(() => import('./pages/admin/AdminLayout'))
const OverviewPage = lazy(() => import('./pages/admin/OverviewPage'))
const RunsPage = lazy(() => import('./pages/admin/RunsPage'))
const RunDetailPage = lazy(() => import('./pages/admin/RunDetailPage'))
const FlowPage = lazy(() => import('./pages/admin/FlowPage'))

export default function App() {
  return (
    <Suspense fallback={<LoadingBlock className="h-full" />}>
      <Routes>
        <Route path="/" element={<NotebooksPage />} />
        <Route path="/notebooks/:id" element={<NotebookPage />} />
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<OverviewPage />} />
          <Route path="runs" element={<RunsPage />} />
          <Route path="runs/:id" element={<RunDetailPage />} />
          <Route path="flow" element={<FlowPage />} />
        </Route>
        <Route path="/notebooks" element={<Navigate to="/" replace />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  )
}
