/**
 * RAG 流转演示的公共定义：步骤结构、配色、动画工具函数。
 * 配色语义全页统一：蓝 = 按意思找（向量），橙 = 按字面找（关键词），金 = 两路都找到。
 */
import type { XY } from '../../../lib/api'

/** 一个分镜步骤：右侧讲解面板展示 title / say / facts，舞台按 key 渲染画面 */
export type Step = {
  key: string
  title: string
  /** 大白话讲解，一两句 */
  say: string
  /** 真实数据：分数、耗时、token 等 */
  facts: { label: string; value: string }[]
  /** 动画时长（毫秒），自动播放时播完再停留 HOLD_MS 进入下一步 */
  duration: number
}

export const HOLD_MS = 1600

export const COLOR = {
  vector: '#2563EB',
  keyword: '#EA580C',
  both: '#EAB308',
  bothSoft: '#FEF3C7',
  star: '#191919',
  fur: '#E8B04F',
  furDark: '#C98A2E',
  furLight: '#F5D394',
} as const

/** 不同资料的点用不同底色，刻意避开蓝 / 橙 / 金三种高亮色 */
const SOURCE_PALETTE = ['#94A3B8', '#A78BFA', '#2DD4BF', '#F472B6', '#A3E635', '#A8A29E', '#67E8F9', '#FCA5A5']

export function sourceColor(index: number): string {
  return SOURCE_PALETTE[index % SOURCE_PALETTE.length]
}

export const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2)
export const easeOut = (t: number) => 1 - (1 - t) ** 3

/** 把整步进度 t 切成 [from, to] 子区间的局部进度，用于分段动画 */
export const segment = (t: number, from: number, to: number) => clamp01((t - from) / (to - from))

/** 第 i 个元素的错峰进度：前 spread 比例内依次出发 */
export const stagger = (t: number, i: number, n: number, spread = 0.6) => {
  const start = n <= 1 ? 0 : (i / (n - 1)) * spread
  return clamp01((t - start) / (1 - spread))
}

export type Pt = { x: number; y: number }
export const lerpPt = (a: Pt, b: Pt, t: number): Pt => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) })

/** 地图区域（SVG 坐标）：把后端 0–1 坐标映射进去；y 轴翻转让"上"更直观 */
export type Box = { x: number; y: number; w: number; h: number }
export const toMap = (xy: XY | null | undefined, box: Box): Pt =>
  xy ? { x: box.x + xy[0] * box.w, y: box.y + (1 - xy[1]) * box.h } : { x: box.x + box.w / 2, y: box.y + box.h / 2 }

export const truncate = (s: string, n: number) => (s.length > n ? s.slice(0, n) + '…' : s)

/** 问题分词里去掉标点和单个虚字，只留给听众看得懂的关键词 */
const PUNCT = /^[\s\p{P}\p{S}]+$/u
const FILLER = new Set(['的', '了', '吗', '呢', '吧', '是', '我', '你', '们', '什么', '怎么', '还', '能', '把', '个', '有', '在', '和'])
export const visibleTokens = (tokens: string[] | undefined) =>
  (tokens ?? []).filter((t) => !PUNCT.test(t) && !FILLER.has(t))
