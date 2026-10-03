/**
 * 问题怎么流转：回放一次真实问答（docs/RAG_FLOW_DEMO.md 第 4 节"问题怎么流转"）。
 *
 * 检索模式 8 步：提问 → 判断模式 → 改写 → 闻味道 → 两路寻找 → 合并 → 叼回 → 写答案
 * 全文模式 4 步：提问 → 判断模式（小金趴下）→ 摆上书桌 → 写答案
 *
 * 舞台（SVG）画"气味地图"和小金的动作；舞台下方的"数据台"（HTML）展示这一步的真实数据。
 */
import { useMemo, useState } from 'react'
import type { ChatSnapshot, FlowDetail } from '../../../lib/api'
import { fmtMs, fmtNum } from '../../../lib/format'
import { cn } from '../../../lib/cn'
import { Dog, type DogPose } from './Dog'
import {
  COLOR,
  type Box,
  type Pt,
  type Step,
  easeInOut,
  easeOut,
  lerpPt,
  segment,
  sourceColor,
  stagger,
  toMap,
  truncate,
  visibleTokens,
} from './shared'

type ChatDetail = Extract<FlowDetail, { kind: 'chat' }>

/** 画面上只展示两路各自的前几名；完整名次在合并表里 */
const SHOW_TOP = 5
const MAP: Box = { x: 30, y: 22, w: 580, h: 290 }
const HOME: Pt = { x: 58, y: 362 }
const DESK: Pt = { x: 600, y: 372 }
const BADGE_Y = 364

// ───────────────────────── 派生数据 ─────────────────────────

type Hit = 'both' | 'vector' | 'keyword'

function analyze(s: ChatSnapshot) {
  const vecTop = (s.vector ?? []).slice(0, SHOW_TOP)
  const bmTop = (s.bm25 ?? []).filter((b) => b.score > 0).slice(0, SHOW_TOP)
  const vecTopIds = new Set(vecTop.map((v) => v.id))
  const bmTopIds = new Set(bmTop.map((b) => b.id))
  // 金色 = 两路都排进前 SHOW_TOP；否则看哪一路名次更靠前
  const hitOf = (f: NonNullable<ChatSnapshot['fused']>[number]): Hit => {
    if (vecTopIds.has(f.id) && bmTopIds.has(f.id)) return 'both'
    if (f.bm25_rank == null) return 'vector'
    if (f.vector_rank == null) return 'keyword'
    return f.vector_rank <= f.bm25_rank ? 'vector' : 'keyword'
  }
  const fused = (s.fused ?? []).map((f) => ({ ...f, hit: hitOf(f) }))
  const sourceIdx = new Map((s.sources ?? []).map((src, i) => [src.id, i]))
  const chunkById = new Map((s.chunks ?? []).map((c) => [c.id, c]))
  return { vecTop, bmTop, fused, sourceIdx, chunkById, tokens: visibleTokens(s.query_tokens) }
}

const nodeMs = (d: ChatDetail, name: string) => d.nodes.find((n) => n.name === name)?.latency_ms ?? null
const label = (c: { source_title: string; idx: number } | undefined) => (c ? `《${c.source_title}》第 ${c.idx + 1} 张` : '—')
const wan = (n: number) => (n >= 10000 ? `${+(n / 10000).toFixed(1)} 万` : fmtNum(n))

// ───────────────────────── 分镜文案 ─────────────────────────

export function buildChatSteps(d: ChatDetail): Step[] {
  const s = d.data
  const rag = s.mode === 'rag'
  const a = analyze(s)
  const ctxN = s.contexts?.length ?? 0
  const steps: Step[] = []

  steps.push({
    key: 'ask',
    title: '提问',
    say: `有人问：「${s.question}」。小金竖起耳朵，准备去资料堆里找答案。`,
    facts: [
      { label: '可用资料', value: `${s.sources.length} 份` },
      { label: '之前的对话', value: `${s.history_count} 条` },
    ],
    duration: 1600,
  })

  const modeSay = s.forced
    ? `资料一共 ${wan(s.total_chars)} 字，不到 ${wan(s.threshold)} 字的门槛，本来可以整份交给模型。但这次打开了「强制检索」，所以小金还是要去找。`
    : rag
      ? `资料一共 ${wan(s.total_chars)} 字，超过 ${wan(s.threshold)} 字的门槛。整份塞给模型又贵又慢，只能先找出最相关的几张卡片。`
      : `资料一共 ${wan(s.total_chars)} 字，不到 ${wan(s.threshold)} 字。东西不多，干脆整份交给模型，小金不用跑，趴下休息。`
  steps.push({
    key: 'mode',
    title: '判断要不要找',
    say: modeSay,
    facts: [
      { label: '资料总字数', value: fmtNum(s.total_chars) },
      { label: '全文门槛', value: fmtNum(s.threshold) },
      { label: '结果', value: rag ? (s.forced ? '检索模式（强制）' : '检索模式') : '全文模式' },
    ],
    duration: 2200,
  })

  if (rag) {
    const rewritten = s.rewritten ?? s.query ?? s.question
    const changed = rewritten.trim() !== s.question.trim()
    steps.push({
      key: 'rewrite',
      title: '把问题说完整',
      say: changed
        ? `这句话是接着上文问的，单独看说不清。先让模型改写成一句完整的问题：「${rewritten}」，再拿去找。`
        : '这是一句独立的问题，没有上文要补，原样拿去找。',
      facts: [{ label: '耗时', value: fmtMs(nodeMs(d, 'rewrite_query')) }],
      duration: 1800,
    })

    steps.push({
      key: 'sniff',
      title: '闻味道',
      say: `问题也被翻译成一串数字，落在气味地图上（★）。意思越接近的卡片，离★越近。同时把问题拆成关键词：${a.tokens.join('、') || '（没有可用关键词）'}。`,
      facts: [
        { label: '候选卡片', value: `${s.candidate_count ?? s.chunks?.length ?? 0} 张` },
        { label: '关键词', value: `${a.tokens.length} 个` },
        { label: '注意', value: '地图压成了 2 维，远近会失真，以分数为准' },
      ],
      duration: 2400,
    })

    const v1 = a.vecTop[0]
    const b1 = a.bmTop[0]
    const verdict = !b1
      ? '关键词一张卡片都没对上，这次全靠按意思找。'
      : v1 && v1.id === b1.id
        ? '两路的第一名是同一张卡片，说明它很可能就是答案。'
        : '两路的第一名不一样：一个看意思，一个看字面，所以需要合并。'
    steps.push({
      key: 'search',
      title: '两路一起找',
      say: `蓝线是「按意思找」：离★最近的几张卡片。橙圈是「按字面找」：卡片里出现了同样的词。${verdict}`,
      facts: [
        { label: '按意思第一名', value: v1 ? `${label(a.chunkById.get(v1.id))} · 相似度 ${v1.score.toFixed(2)}` : '—' },
        { label: '按字面第一名', value: b1 ? `${label(a.chunkById.get(b1.id))} · 命中「${b1.matched.join('、')}」` : '没有命中' },
        { label: '检索耗时', value: fmtMs(nodeMs(d, 'retrieve')) },
      ],
      duration: 3200,
    })

    const count = (h: Hit) => a.fused.filter((f) => f.hit === h).length
    steps.push({
      key: 'merge',
      title: '合并两份名单',
      say: `两份名单按名次加分合并（RRF）：在哪份名单里越靠前，加分越多；两边都排进前 ${SHOW_TOP} 的卡片是金色。最后留下前 ${a.fused.length} 张。`,
      facts: [
        { label: '两路都找到', value: `${count('both')} 张` },
        { label: '主要靠按意思', value: `${count('vector')} 张` },
        { label: '主要靠按字面', value: `${count('keyword')} 张` },
        { label: '加分公式', value: `1 / (${s.params?.rrf_k ?? 60} + 名次)` },
      ],
      duration: 2800,
    })
  }

  steps.push({
    key: 'carry',
    title: rag ? '叼回书桌' : '整份摆上书桌',
    say: rag
      ? `小金把这 ${ctxN} 张卡片叼到书桌上，编号 [1]–[${ctxN}]。模型只看这几张卡片回答，看不到别的资料。`
      : `全文模式：所有 ${ctxN} 张卡片直接摆上书桌，编号 [1]–[${ctxN}]，模型能看到全部资料。`,
    facts: [{ label: '交给模型', value: `${ctxN} 张卡片` }],
    duration: 2400,
  })

  const dropped = s.dropped ?? []
  const cited = s.cited ?? []
  let answerSay = '模型照着书桌上的卡片写答案，每句话后面标上用了哪张卡片 [n]，点角标能追到原文。'
  if (dropped.length) answerSay += `它还写了不存在的编号 ${dropped.map((n) => `[${n}]`).join(' ')}，系统查不到对应卡片，直接划掉。`
  if (!cited.length) answerSay += '这次答案没有引用任何卡片：资料里没有答案，模型如实说了，没有编。'
  const run = d.run
  steps.push({
    key: 'answer',
    title: '写答案',
    say: answerSay,
    facts: [
      { label: '模型', value: run.model ?? '—' },
      { label: 'token', value: `${fmtNum(run.prompt_tokens)} 读 + ${fmtNum(run.completion_tokens)} 写` },
      { label: '生成耗时', value: fmtMs(nodeMs(d, 'generate')) },
      { label: '引用卡片', value: cited.length ? cited.map((n) => `[${n}]`).join(' ') : '无' },
    ],
    duration: Math.max(2500, Math.min(8000, (s.raw_answer ?? s.answer ?? '').length * 30)),
  })
  return steps
}

// ───────────────────────── 舞台 + 数据台 ─────────────────────────

export function ChatFlowView({ detail, step, t, clock }: { detail: ChatDetail; step: Step; t: number; clock: number }) {
  const s = detail.data
  const [hoverN, setHoverN] = useState<number | null>(null)
  const a = useMemo(() => analyze(s), [s])
  return (
    <div>
      <svg viewBox="0 0 640 400" className="max-h-[56vh] w-full rounded-card border border-line bg-surface-soft" role="img" aria-label={`第 ${step.title} 步画面`}>
        {s.mode === 'rag' ? <RagStage s={s} a={a} stepKey={step.key} t={t} clock={clock} hoverN={hoverN} /> : <FullStage s={s} stepKey={step.key} t={t} clock={clock} hoverN={hoverN} />}
      </svg>
      {s.mode === 'rag' && <SourceLegend s={s} />}
      <div className="mt-3 min-h-[180px] rounded-card border border-line bg-white p-4">
        <ChatDesk s={s} a={a} stepKey={step.key} t={t} onHover={setHoverN} />
      </div>
    </div>
  )
}

type Analysis = ReturnType<typeof analyze>

/** 地图坐标里小金"站在某个点左侧、鼻子对着它"的位置 */
const beside = (p: Pt): Pt => ({ x: Math.max(30, p.x - 36), y: Math.min(392, p.y + 30) })

function badgeX(i: number, n: number) {
  const left = 130
  const right = 540
  return n <= 1 ? (left + right) / 2 : left + ((right - left) * i) / Math.max(n - 1, 7)
}

function RagStage({ s, a, stepKey, t, clock, hoverN }: { s: ChatSnapshot; a: Analysis; stepKey: string; t: number; clock: number; hoverN: number | null }) {
  const order = ['ask', 'mode', 'rewrite', 'sniff', 'search', 'merge', 'carry', 'answer']
  const at = order.indexOf(stepKey)
  const after = (k: string) => at > order.indexOf(k)
  const on = (k: string) => stepKey === k

  const pos = (id: string) => toMap(a.chunkById.get(id)?.xy, MAP)
  const star = toMap(s.query_xy ?? null, MAP)
  const top1 = a.vecTop[0] ? pos(a.vecTop[0].id) : star
  const fusedIds = new Set(a.fused.map((f) => f.id))

  // 小金的位置与姿态
  let dog: { p: Pt; pose: DogPose; facing: 1 | -1; bubble?: string }
  const move = (from: Pt, to: Pt, k: number, pose: DogPose, endPose: DogPose) => ({
    p: lerpPt(from, to, easeInOut(k)),
    pose: k < 1 ? pose : endPose,
    facing: (to.x >= from.x ? 1 : -1) as 1 | -1,
  })
  if (at <= order.indexOf('rewrite')) dog = { p: HOME, pose: 'sit', facing: 1, bubble: on('ask') ? '?' : on('mode') && s.forced ? '!' : on('rewrite') ? '…' : undefined }
  else if (on('sniff')) dog = move(HOME, beside(star), segment(t, 0.2, 0.8), 'run', 'sniff')
  else if (on('search')) dog = move(beside(star), beside(top1), segment(t, 0.3, 0.85), 'run', 'sniff')
  else if (on('merge')) dog = { p: beside(top1), pose: 'sit', facing: 1 }
  else if (on('carry')) dog = move(beside(top1), DESK, segment(t, 0.15, 0.9), 'carry', 'sit')
  else dog = { p: DESK, pose: 'sit', facing: -1 }

  const showStar = at >= order.indexOf('sniff')
  const starK = on('sniff') ? easeOut(segment(t, 0, 0.4)) : showStar ? 1 : 0
  const lineK = on('search') ? t : after('search') ? 1 : 0
  const mergeK = on('merge') ? easeOut(segment(t, 0, 0.6)) : after('merge') ? 1 : 0

  return (
    <g>
      <MapBackdrop />
      {/* 卡片点：合并后没入选的变淡 */}
      {(s.chunks ?? []).map((c) => {
        const p = toMap(c.xy, MAP)
        const dim = mergeK > 0 && !fusedIds.has(c.id)
        return <circle key={c.id} cx={p.x} cy={p.y} r={5} fill={sourceColor(a.sourceIdx.get(c.source_id) ?? 0)} opacity={dim ? 1 - 0.75 * mergeK : 0.9} />
      })}

      {/* 蓝线：问题 → 按意思找的前几名 */}
      {lineK > 0 &&
        a.vecTop.map((v, i) => {
          const p = pos(v.id)
          const k = easeOut(stagger(lineK, i, a.vecTop.length, 0.5))
          const end = lerpPt(star, p, k)
          return (
            <g key={v.id} opacity={1 - 0.6 * mergeK}>
              <line x1={star.x} y1={star.y} x2={end.x} y2={end.y} stroke={COLOR.vector} strokeWidth={i === 0 ? 2.2 : 1.4} strokeDasharray={i === 0 ? undefined : '4 3'} />
              {k >= 1 && (
                <text x={p.x + 8} y={p.y - 7} fontSize={10} fill={COLOR.vector} fontWeight={600}>
                  {v.score.toFixed(2)}
                </text>
              )}
            </g>
          )
        })}

      {/* 橙圈：按字面找的前几名 */}
      {lineK > 0 &&
        a.bmTop.map((b, i) => {
          const p = pos(b.id)
          const k = easeOut(stagger(segment(lineK, 0.25, 1), i, a.bmTop.length, 0.5))
          return k > 0 ? (
            <g key={b.id} opacity={1 - 0.6 * mergeK}>
              <circle cx={p.x} cy={p.y} r={9 + 4 * (1 - k)} fill="none" stroke={COLOR.keyword} strokeWidth={2} opacity={k} />
              {k >= 1 && b.matched[0] && (
                <text x={p.x} y={p.y + 21} fontSize={9.5} textAnchor="middle" fill={COLOR.keyword} fontWeight={600}>
                  {truncate(b.matched.join('·'), 8)}
                </text>
              )}
            </g>
          ) : null
        })}

      {/* 合并结果：名次徽章，颜色表示主要靠哪一路 */}
      {mergeK > 0 &&
        a.fused.map((f, i) => {
          const p = pos(f.id)
          const color = COLOR[f.hit]
          const flyK = on('carry') ? easeInOut(stagger(t, i, a.fused.length, 0.5)) : after('carry') ? 1 : 0
          const target = { x: badgeX(i, a.fused.length), y: BADGE_Y }
          const b = lerpPt(p, target, flyK)
          const n = i + 1
          const cited = on('answer') && (s.cited ?? []).includes(n)
          const hovered = hoverN === n
          return (
            <g key={f.id} opacity={mergeK}>
              {flyK < 1 && <circle cx={p.x} cy={p.y} r={10} fill="none" stroke={color} strokeWidth={2.4} />}
              {flyK > 0 && hovered && <circle cx={p.x} cy={p.y} r={12} fill="none" stroke={COLOR.star} strokeWidth={2} />}
              <g transform={`translate(${b.x} ${b.y}) scale(${hovered ? 1.25 : 1})`}>
                {flyK > 0 ? (
                  <>
                    <rect x={-16} y={-12} width={32} height={22} rx={4} fill={cited ? COLOR.star : f.hit === 'both' ? COLOR.bothSoft : '#fff'} stroke={color} strokeWidth={f.hit === 'both' ? 2.4 : 1.6} />
                    <text y={4} textAnchor="middle" fontSize={11} fontWeight={700} fill={cited ? '#fff' : COLOR.star}>
                      [{n}]
                    </text>
                  </>
                ) : (
                  <>
                    <circle cx={11} cy={-11} r={7} fill={color} />
                    <text x={11} y={-7.5} textAnchor="middle" fontSize={9} fontWeight={700} fill="#fff">
                      {n}
                    </text>
                  </>
                )}
              </g>
            </g>
          )
        })}

      {/* 问题★ */}
      {starK > 0 && (
        <g transform={`translate(${star.x} ${star.y}) scale(${starK})`}>
          <circle r={14 + ((clock / 25) % 22)} fill="none" stroke={COLOR.star} strokeOpacity={0.35 * (1 - ((clock / 25) % 22) / 22)} />
          <path d={starPath(9, 4)} fill={COLOR.star} />
        </g>
      )}

      {after('merge') && (
        <g>
          <line x1={110} y1={BADGE_Y + 16} x2={560} y2={BADGE_Y + 16} stroke="#ddd" strokeWidth={6} strokeLinecap="round" />
          <text x={110} y={BADGE_Y - 18} fontSize={10} fill="#999">
            书桌（模型只看这里）
          </text>
        </g>
      )}

      {/* 在地图上活动时缩小，避免挡住卡片点 */}
      <Dog x={dog.p.x} y={dog.p.y} pose={dog.pose} facing={dog.facing} clock={clock} bubble={dog.bubble} scale={at >= order.indexOf('sniff') && !on('answer') ? 0.65 : 0.9} />
    </g>
  )
}

function FullStage({ s, stepKey, t, clock, hoverN }: { s: ChatSnapshot; stepKey: string; t: number; clock: number; hoverN: number | null }) {
  const ctx = s.contexts ?? []
  const shown = ctx.slice(0, 12)
  const pile = { x: 320, y: 150 }
  const flying = stepKey === 'carry' || stepKey === 'answer'
  return (
    <g>
      <text x={20} y={30} fontSize={11} fill="#999">
        全文模式：资料不多，不用找
      </text>
      {s.sources.slice(0, 6).map((src, i) => (
        <g key={src.id} transform={`translate(${pile.x - 70 + i * 6} ${pile.y - 60 + i * 8}) rotate(${(i - 2) * 2})`}>
          <rect width={140} height={90} rx={4} fill="#fff" stroke="#ddd" />
          <text x={10} y={20} fontSize={10.5} fill={COLOR.star}>
            {truncate(src.title, 11)}
          </text>
          <text x={10} y={38} fontSize={9.5} fill="#999">
            {fmtNum(src.char_count)} 字
          </text>
        </g>
      ))}
      {flying &&
        shown.map((c, i) => {
          const k = stepKey === 'carry' ? easeInOut(stagger(t, i, shown.length, 0.5)) : 1
          const b = lerpPt(pile, { x: 110 + i * 38, y: BADGE_Y }, k)
          const cited = stepKey === 'answer' && (s.cited ?? []).includes(c.n)
          return (
            <g key={c.n} transform={`translate(${b.x} ${b.y}) scale(${hoverN === c.n ? 1.25 : 1})`}>
              <rect x={-16} y={-12} width={32} height={22} rx={4} fill={cited ? COLOR.star : '#fff'} stroke={COLOR.star} strokeWidth={1.2} />
              <text y={4} textAnchor="middle" fontSize={11} fontWeight={700} fill={cited ? '#fff' : COLOR.star}>
                [{c.n}]
              </text>
            </g>
          )
        })}
      {flying && ctx.length > shown.length && (
        <text x={110 + shown.length * 38} y={BADGE_Y + 4} fontSize={11} fill="#999">
          +{ctx.length - shown.length}
        </text>
      )}
      <Dog x={110} y={300} pose="lie" clock={clock} scale={1.1} bubble={stepKey === 'ask' ? '?' : undefined} />
    </g>
  )
}

function MapBackdrop() {
  return (
    <g>
      <rect x={MAP.x - 10} y={MAP.y - 10} width={MAP.w + 20} height={MAP.h + 20} rx={10} fill="#fff" stroke="#eee" />
      {Array.from({ length: 9 }, (_, i) => (
        <line key={`v${i}`} x1={MAP.x + (MAP.w * (i + 1)) / 10} y1={MAP.y - 6} x2={MAP.x + (MAP.w * (i + 1)) / 10} y2={MAP.y + MAP.h + 6} stroke="#f4f4f4" />
      ))}
      {Array.from({ length: 4 }, (_, i) => (
        <line key={`h${i}`} x1={MAP.x - 6} y1={MAP.y + (MAP.h * (i + 1)) / 5} x2={MAP.x + MAP.w + 6} y2={MAP.y + (MAP.h * (i + 1)) / 5} stroke="#f4f4f4" />
      ))}
      <text x={MAP.x + MAP.w} y={MAP.y + 4} fontSize={10} fill="#bbb" textAnchor="end">
        气味地图 · 每个点是一张卡片（2 维示意）
      </text>
    </g>
  )
}

function starPath(outer: number, inner: number) {
  const pts: string[] = []
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner
    const ang = (Math.PI / 5) * i - Math.PI / 2
    pts.push(`${(Math.cos(ang) * r).toFixed(2)},${(Math.sin(ang) * r).toFixed(2)}`)
  }
  return `M${pts.join('L')}Z`
}

function SourceLegend({ s }: { s: ChatSnapshot }) {
  return (
    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-ink-450">
      {s.sources.map((src, i) => (
        <span key={src.id} className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-full" style={{ background: sourceColor(i) }} />
          {src.title}
        </span>
      ))}
      <span className="ml-auto inline-flex items-center gap-3">
        <Swatch color={COLOR.vector} text="按意思找" />
        <Swatch color={COLOR.keyword} text="按字面找" />
        <Swatch color={COLOR.both} text="两路都找到" />
      </span>
    </div>
  )
}

function Swatch({ color, text }: { color: string; text: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="h-2.5 w-2.5 rounded-full border-2" style={{ borderColor: color }} />
      {text}
    </span>
  )
}

// ───────────────────────── 数据台 ─────────────────────────

function ChatDesk({ s, a, stepKey, t, onHover }: { s: ChatSnapshot; a: Analysis; stepKey: string; t: number; onHover: (n: number | null) => void }) {
  switch (stepKey) {
    case 'ask':
      return (
        <div className="flex justify-end">
          <div className="max-w-[80%] rounded-panel rounded-br-sm bg-ink px-4 py-2.5 text-[14px] text-white">{s.question}</div>
        </div>
      )
    case 'mode': {
      const ratio = Math.min(1, s.total_chars / s.threshold)
      return (
        <div>
          <div className="mb-2 flex items-center justify-between text-[12.5px] text-ink-600">
            <span>资料总字数 {fmtNum(s.total_chars)}</span>
            <span>全文门槛 {fmtNum(s.threshold)}</span>
          </div>
          <div className="relative h-3 overflow-hidden rounded-full bg-surface-muted">
            <div className="h-full rounded-full bg-ink transition-[width] duration-700" style={{ width: `${ratio * 100 * Math.min(1, t * 1.5)}%` }} />
          </div>
          <div className="mt-3 flex items-center gap-2 text-[13px]">
            <span className={cn('rounded-full border px-2.5 py-0.5', s.mode === 'full' ? 'border-ink bg-ink text-white' : 'border-line text-ink-450')}>全文模式：整份给模型</span>
            <span className={cn('rounded-full border px-2.5 py-0.5', s.mode === 'rag' ? 'border-ink bg-ink text-white' : 'border-line text-ink-450')}>检索模式：先找再答</span>
            {s.forced && <span className="rounded-full border border-dashed border-ink px-2.5 py-0.5 text-ink">已打开强制检索</span>}
          </div>
        </div>
      )
    }
    case 'rewrite': {
      const rw = s.rewritten ?? s.query ?? s.question
      return (
        <div className="flex flex-wrap items-center gap-3 text-[14px]">
          <span className="rounded-card border border-line px-3 py-2 text-ink-600">{s.question}</span>
          <span className="text-ink-400">→</span>
          <span className="rounded-card border border-ink px-3 py-2 font-medium text-ink">{rw}</span>
          {s.history_count === 0 && <span className="text-[12px] text-ink-450">（没有上文，原样使用）</span>}
        </div>
      )
    }
    case 'sniff':
      return (
        <div className="space-y-3 text-[13px]">
          <div className="flex items-center gap-2 text-ink-600">
            <span className="font-medium text-ink">按意思：</span>问题 → 一串数字 → 地图上的 ★
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-ink-600">
            <span className="font-medium text-ink">按字面：</span>
            {a.tokens.length ? a.tokens.map((tk) => (
              <span key={tk} className="rounded-full border px-2 py-0.5" style={{ borderColor: COLOR.keyword, color: COLOR.keyword }}>
                {tk}
              </span>
            )) : '没有可用关键词'}
          </div>
        </div>
      )
    case 'search':
      return (
        <div className="grid grid-cols-2 gap-4">
          <HitList title="按意思找 · 前 5" color={COLOR.vector} rows={a.vecTop.map((v) => ({ id: v.id, c: a.chunkById.get(v.id), right: `相似度 ${v.score.toFixed(2)}` }))} />
          <HitList
            title="按字面找 · 前 5"
            color={COLOR.keyword}
            rows={a.bmTop.map((b) => ({ id: b.id, c: a.chunkById.get(b.id), right: `命中 ${b.matched.join('、') || '—'}` }))}
            empty="没有任何卡片包含这些词"
          />
        </div>
      )
    case 'merge':
      return (
        <table className="w-full text-[12.5px]">
          <thead className="text-left text-ink-450">
            <tr>
              <th className="pb-1.5 font-normal">合并名次</th>
              <th className="pb-1.5 font-normal">卡片</th>
              <th className="pb-1.5 font-normal">按意思名次</th>
              <th className="pb-1.5 font-normal">按字面名次</th>
              <th className="pb-1.5 text-right font-normal">合并得分</th>
            </tr>
          </thead>
          <tbody>
            {a.fused.map((f, i) => (
              <tr key={f.id} className="border-t border-line-divider" style={{ opacity: Math.min(1, t * 3 - i * 0.2 + 0.2) }}>
                <td className="py-1.5">
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold text-white" style={{ background: COLOR[f.hit] }}>
                    {i + 1}
                  </span>
                </td>
                <td className="py-1.5 text-ink">{label(a.chunkById.get(f.id))}</td>
                <td className="py-1.5 text-ink-600">{f.vector_rank ?? '未上榜'}</td>
                <td className="py-1.5 text-ink-600">{f.bm25_rank ?? '未上榜'}</td>
                <td className="py-1.5 text-right font-mono text-ink-600">{f.score.toFixed(4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )
    case 'carry':
      return (
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {(s.contexts ?? []).slice(0, 8).map((c) => (
            <div key={c.n} className="rounded-card border border-line p-2 text-[12px]">
              <div className="mb-1 font-semibold text-ink">
                [{c.n}] <span className="font-normal text-ink-450">{truncate(c.source_title, 8)} · 第 {c.idx + 1} 张</span>
              </div>
              <div className="line-clamp-3 text-ink-600">{c.text}</div>
            </div>
          ))}
          {(s.contexts?.length ?? 0) > 8 && <div className="self-center text-[12px] text-ink-450">还有 {(s.contexts?.length ?? 0) - 8} 张…</div>}
        </div>
      )
    case 'answer':
      return <TypedAnswer s={s} t={t} onHover={onHover} />
    default:
      return null
  }
}

function HitList({ title, color, rows, empty }: { title: string; color: string; rows: { id: string; c?: { source_title: string; idx: number; text: string }; right: string }[]; empty?: string }) {
  return (
    <div>
      <div className="mb-2 text-[12.5px] font-semibold" style={{ color }}>
        {title}
      </div>
      {rows.length === 0 && <div className="text-[12.5px] text-ink-450">{empty}</div>}
      <ol className="space-y-1.5">
        {rows.map((r, i) => (
          <li key={r.id} className="text-[12px] leading-5">
            <div className="flex justify-between gap-2">
              <span className="truncate text-ink">
                {i + 1}. {label(r.c)}
              </span>
              <span className="shrink-0" style={{ color }}>
                {r.right}
              </span>
            </div>
            <div className="truncate text-ink-450">{r.c?.text}</div>
          </li>
        ))}
      </ol>
    </div>
  )
}

/** 逐字打出原始答案：有效引用变成角标，越界编号划掉 */
function TypedAnswer({ s, t, onHover }: { s: ChatSnapshot; t: number; onHover: (n: number | null) => void }) {
  const raw = s.raw_answer ?? s.answer ?? ''
  const max = s.contexts?.length ?? 0
  const parts = useMemo(() => {
    const out: ({ kind: 'text'; text: string } | { kind: 'cite'; nums: number[]; len: number })[] = []
    const re = /\[([\d\s,，、]+)\]/g
    let last = 0
    for (const m of raw.matchAll(re)) {
      if (m.index! > last) out.push({ kind: 'text', text: raw.slice(last, m.index) })
      out.push({ kind: 'cite', nums: m[1].split(/[\s,，、]+/).filter(Boolean).map(Number), len: m[0].length })
      last = m.index! + m[0].length
    }
    if (last < raw.length) out.push({ kind: 'text', text: raw.slice(last) })
    return out
  }, [raw])

  let budget = Math.floor(raw.length * t)
  const done = t >= 1
  return (
    <div className={cn('whitespace-pre-wrap text-[14px] leading-7 text-ink-900', !done && 'typing-caret')}>
      {parts.map((p, i) => {
        if (budget <= 0) return null
        if (p.kind === 'text') {
          const shown = p.text.slice(0, budget)
          budget -= p.text.length
          return <span key={i}>{shown}</span>
        }
        if (budget < p.len) {
          budget = 0
          return null
        }
        budget -= p.len
        return (
          <span key={i} className="mx-0.5 inline-flex gap-0.5 align-[1px]">
            {p.nums.map((n, j) =>
              n >= 1 && n <= max ? (
                <span
                  key={j}
                  onMouseEnter={() => onHover(n)}
                  onMouseLeave={() => onHover(null)}
                  className="inline-flex h-[18px] min-w-[18px] cursor-default items-center justify-center rounded-[4px] bg-ink px-1 text-[11px] font-semibold text-white"
                >
                  {n}
                </span>
              ) : (
                <span key={j} title="资料里没有这张卡片，已删除" className="inline-flex h-[18px] items-center rounded-[4px] border border-danger px-1 text-[11px] text-danger line-through">
                  {n}
                </span>
              ),
            )}
          </span>
        )
      })}
    </div>
  )
}
