/**
 * 业务枚举 → 中文文案映射，保证全站用词一致。
 */
import type { ChatMode, NoteKind, RunKind, RunStatus, SourceType, SpanType, StudioKind } from './api'

export const NOTE_KIND_LABEL: Record<NoteKind, string> = {
  manual: '手动笔记',
  answer: '问答',
  briefing: '简报',
  study_guide: '学习指南',
  faq: '常见问题',
}

export const STUDIO_KIND_LABEL: Record<StudioKind, string> = {
  briefing: '简报',
  study_guide: '学习指南',
  faq: '常见问题',
}

export const MODE_LABEL: Record<ChatMode, string> = {
  full: '全文模式',
  rag: '检索模式',
}

export const RUN_KIND_LABEL: Record<RunKind, string> = {
  chat: '问答',
  ingest: '导入',
  studio: '生成',
}

export const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  running: '进行中',
  success: '成功',
  error: '失败',
}

export const SOURCE_TYPE_LABEL: Record<SourceType, string> = {
  pdf: 'PDF',
  text: '文本',
  markdown: 'Markdown',
  url: '网页',
}

export const SPAN_TYPE_LABEL: Record<SpanType, string> = {
  node: '节点',
  llm: '模型调用',
  retriever: '检索',
  embedding: '向量化',
}
