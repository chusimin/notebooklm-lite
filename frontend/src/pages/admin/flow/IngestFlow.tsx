/**
 * 资料怎么流转：回放一次真实导入（docs/RAG_FLOW_DEMO.md 第 4 节"资料怎么流转"）。
 *
 * 5 步：读取（长纸条）→ 切分（剪成卡片，斜纹为重叠）→ 翻译成数字（卡片飞上气味地图）→ 贴词签 → 入库
 */
import type { FlowDetail, IngestSnapshot } from '../../../lib/api'
import { fmtMs, fmtNum } from '../../../lib/format'
import { Dog, type DogPose } from './Dog'
import { COLOR, type Box, type Pt, type Step, easeInOut, easeOut, lerpPt, segment, stagger, toMap, truncate } from './shared'

type IngestDetail = Extract<FlowDetail, { kind: 'ingest' }>

const PAPER = { x: 24, y: 36, w: 100, h: 328 }
const GRID = { x: 150, y: 36, cardW: 100, cardH: 38, gapX: 10, gapY: 8, cols: 2, maxCards: 14 }
const MAP: Box = { x: 420, y: 44, w: 190, h: 300 }
const DOG_HOME: Pt = { x: 200, y: 388 }
const DOG_MAP: Pt = { x: 400, y: 388 }

const nodeMs = (d: IngestDetail, name: string) => d.nodes.find((n) => n.name === name)?.latency_ms ?? null

export function buildIngestSteps(d: IngestDetail): Step[] {
  const s = d.data
  const embedSpan = Object.values(d.leaf_spans).find((l) => l.model && /embed/i.test(l.model))
  const firstKw = s.chunks[0]?.keywords ?? []
  return [
    {
      key: 'load',
      title: '读取',
      say: `读进一份资料《${s.title}》，一共 ${fmtNum(s.char_count)} 字。在小金眼里，这是一张很长很长的纸条。`,
      facts: [
        { label: '类型', value: s.type },
        { label: '字数', value: fmtNum(s.char_count) },
        { label: '耗时', value: fmtMs(nodeMs(d, 'load')) },
      ],
      duration: 1600,
    },
    {
      key: 'split',
      title: '切分',
      say: `纸条太长，一次塞不进模型，也不好找。剪成每张约 ${s.chunk_size} 字的卡片，一共 ${s.chunk_count} 张。相邻卡片重叠 ${s.chunk_overlap} 字（斜纹部分），防止一句话正好被剪断。`,
      facts: [
        { label: '卡片', value: `${s.chunk_count} 张` },
        { label: '每张约', value: `${s.chunk_size} 字` },
        { label: '重叠', value: `${s.chunk_overlap} 字` },
        { label: '耗时', value: fmtMs(nodeMs(d, 'split')) },
      ],
      duration: 2800,
    },
    {
      key: 'embed',
      title: '翻译成数字',
      say: `每张卡片被翻译成 ${fmtNum(s.dim)} 个数字，就像一种"气味"。意思相近的卡片气味相近，在地图上落得近。这里把 ${fmtNum(s.dim)} 维压成 2 维给你看，远近会有些失真。`,
      facts: [
        { label: '每张卡片', value: `${fmtNum(s.dim)} 个数字` },
        { label: '向量模型', value: embedSpan?.model ?? '—' },
        { label: '耗时', value: fmtMs(nodeMs(d, 'embed')) },
      ],
      duration: 2800,
    },
    {
      key: 'tags',
      title: '贴词签',
      say: '同时记下每张卡片里有哪些词。以后有人按字面问（编号、人名、专有名词），就靠这些词签来找。',
      facts: [{ label: '第 1 张的词签', value: firstKw.join('、') || '—' }],
      duration: 2200,
    },
    {
      key: 'save',
      title: '入库',
      say: '卡片、数字、词签一起存进数据库，顺手让模型写了一段概要和推荐问题。之后每次提问，小金就在这张地图上找。',
      facts: [
        { label: '入库卡片', value: `${s.chunk_count} 张` },
        { label: '总耗时', value: fmtMs(d.run.latency_ms) },
        { label: 'token', value: fmtNum(d.run.prompt_tokens + d.run.completion_tokens) },
      ],
      duration: 1800,
    },
  ]
}

function gridPos(i: number): Pt {
  const col = i % GRID.cols
  const row = Math.floor(i / GRID.cols)
  return { x: GRID.x + col * (GRID.cardW + GRID.gapX), y: GRID.y + row * (GRID.cardH + GRID.gapY) }
}

export function IngestFlowView({ detail, step, t, clock }: { detail: IngestDetail; step: Step; t: number; clock: number }) {
  const s = detail.data
  return (
    <div>
      <svg viewBox="0 0 640 410" className="max-h-[56vh] w-full rounded-card border border-line bg-surface-soft" role="img" aria-label={`${step.title} 步画面`}>
        <IngestStage s={s} stepKey={step.key} t={t} clock={clock} />
      </svg>
      <div className="mt-3 min-h-[180px] rounded-card border border-line bg-white p-4">
        <IngestDesk detail={detail} stepKey={step.key} t={t} />
      </div>
    </div>
  )
}

function IngestStage({ s, stepKey, t, clock }: { s: IngestSnapshot; stepKey: string; t: number; clock: number }) {
  const order = ['load', 'split', 'embed', 'tags', 'save']
  const at = order.indexOf(stepKey)
  const on = (k: string) => stepKey === k
  const after = (k: string) => at > order.indexOf(k)

  const cards = s.chunks.slice(0, GRID.maxCards)
  const paperK = on('load') ? easeOut(t) : 1
  const cutK = on('split') ? segment(t, 0, 0.4) : after('split') ? 1 : 0
  const dropK = on('split') ? segment(t, 0.3, 1) : after('split') ? 1 : 0
  const flyK = on('embed') ? t : after('embed') ? 1 : 0
  const tagK = on('tags') ? t : after('tags') ? 1 : 0

  let dog: { p: Pt; pose: DogPose; facing: 1 | -1; bubble?: string } = { p: DOG_HOME, pose: 'sit', facing: 1, bubble: on('load') ? '?' : undefined }
  if (on('embed')) {
    const k = segment(t, 0.1, 0.8)
    dog = { p: lerpPt(DOG_HOME, DOG_MAP, easeInOut(k)), pose: k < 1 ? 'run' : 'sit', facing: 1 }
  } else if (on('tags')) dog = { p: DOG_MAP, pose: 'sniff', facing: 1 }
  else if (on('save')) dog = { p: DOG_MAP, pose: 'sit', facing: -1, bubble: '!' }

  return (
    <g>
      <defs>
        <pattern id="overlap-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="6" stroke={COLOR.both} strokeWidth="2.5" opacity="0.55" />
        </pattern>
      </defs>

      {/* 长纸条 */}
      <g transform={`translate(${-60 * (1 - paperK)} 0)`} opacity={paperK * (after('split') ? 0.35 : 1)}>
        <rect x={PAPER.x} y={PAPER.y} width={PAPER.w} height={PAPER.h} rx={4} fill="#fff" stroke="#ddd" />
        <text x={PAPER.x + 8} y={PAPER.y + 18} fontSize={10.5} fontWeight={600} fill={COLOR.star}>
          {truncate(s.title, 7)}
        </text>
        {Array.from({ length: 26 }, (_, i) => (
          <line key={i} x1={PAPER.x + 8} y1={PAPER.y + 32 + i * 11.5} x2={PAPER.x + PAPER.w - 8 - ((i * 37) % 30)} y2={PAPER.y + 32 + i * 11.5} stroke="#e5e5e5" strokeWidth={3} strokeLinecap="round" />
        ))}
        {/* 剪刀线：按卡片数等分 */}
        {cutK > 0 &&
          Array.from({ length: Math.max(0, s.chunk_count - 1) }, (_, i) => {
            const k = segment(cutK, i / Math.max(1, s.chunk_count), (i + 1) / Math.max(1, s.chunk_count))
            const y = PAPER.y + (PAPER.h * (i + 1)) / s.chunk_count
            return k > 0 ? <line key={i} x1={PAPER.x - 4} y1={y} x2={PAPER.x - 4 + (PAPER.w + 8) * k} y2={y} stroke={COLOR.star} strokeDasharray="4 3" /> : null
          })}
      </g>

      {/* 气味地图：先画，让灰色邻居点垫在新卡片下面 */}
      {at >= order.indexOf('embed') && (
        <g opacity={on('embed') ? easeOut(segment(t, 0, 0.3)) : 1}>
          <rect x={MAP.x - 12} y={MAP.y - 14} width={MAP.w + 24} height={MAP.h + 28} rx={10} fill="none" stroke="#e5e5e5" strokeDasharray="5 4" />
          <text x={MAP.x - 4} y={MAP.y - 20} fontSize={10} fill="#aaa">
            气味地图（2 维示意）{s.neighbors?.length ? '· 灰点 = 已有卡片' : ''}
          </text>
          {s.neighbors?.map((n, i) => {
            const p = toMap(n.xy, MAP)
            return (
              <circle key={i} cx={p.x} cy={p.y} r={3.5} fill="#d4d4d4">
                <title>{n.source_title}</title>
              </circle>
            )
          })}
        </g>
      )}

      {/* 卡片：从纸条落到网格，再飞上地图变成点 */}
      {dropK > 0 &&
        cards.map((c, i) => {
          const from: Pt = { x: PAPER.x, y: PAPER.y + (PAPER.h * i) / Math.max(1, s.chunk_count) }
          const g = gridPos(i)
          const dk = easeOut(stagger(dropK, i, cards.length, 0.6))
          const fk = easeInOut(stagger(flyK, i, cards.length, 0.5))
          const p = lerpPt(lerpPt(from, g, dk), toMap(c.xy, MAP), fk)
          const cardOpacity = flyK > 0 ? 1 - fk * 0.7 : dk
          return (
            <g key={c.id}>
              {/* 网格里留一张淡卡片，表示原文还在 */}
              <g transform={`translate(${fk > 0 ? g.x : p.x} ${fk > 0 ? g.y : p.y})`} opacity={fk > 0 ? 0.3 : cardOpacity}>
                <rect width={GRID.cardW} height={GRID.cardH} rx={4} fill="#fff" stroke="#d4d4d4" />
                {i > 0 && <rect width={GRID.cardW} height={7} rx={3} fill="url(#overlap-hatch)" />}
                <text x={7} y={20} fontSize={10} fontWeight={700} fill={COLOR.star}>
                  #{c.idx + 1}
                </text>
                <text x={7} y={32} fontSize={9.5} fill="#888">
                  {truncate(c.text.replace(/\s+/g, ''), 8)}
                </text>
              </g>
              {fk > 0 && (
                <circle cx={p.x + (1 - fk) * (GRID.cardW / 2)} cy={p.y + (1 - fk) * (GRID.cardH / 2)} r={3 + 3 * fk} fill={COLOR.vector} opacity={0.35 + 0.55 * fk} />
              )}
              {tagK > 0 && i < 10 && (() => {
                const pt = toMap(c.xy, MAP)
                const k = easeOut(stagger(tagK, i, Math.min(10, cards.length), 0.6))
                return (
                  <text x={pt.x + 9} y={pt.y + 3.5} fontSize={9.5} fill={COLOR.keyword} opacity={k} fontWeight={600}>
                    {c.keywords.slice(0, 2).join(' · ')}
                  </text>
                )
              })()}
            </g>
          )
        })}
      {dropK > 0 && s.chunks.length > cards.length && (
        <text x={GRID.x} y={GRID.y + Math.ceil(cards.length / GRID.cols) * (GRID.cardH + GRID.gapY) + 10} fontSize={10.5} fill="#999">
          还有 {s.chunks.length - cards.length} 张没画出来
        </text>
      )}

      {on('save') && (
        <g transform={`translate(${GRID.x + 105} 200)`} opacity={easeOut(segment(t, 0, 0.4))}>
          <rect x={-90} y={-38} width={180} height={76} rx={10} fill="#fff" stroke={COLOR.star} strokeWidth={1.4} />
          <ellipse cx={-56} cy={-12} rx={16} ry={5} fill="none" stroke={COLOR.star} strokeWidth={1.4} />
          <path d="M-72 -12 v24 a16 5 0 0 0 32 0 v-24" fill="none" stroke={COLOR.star} strokeWidth={1.4} />
          <path d="M-72 0 a16 5 0 0 0 32 0" fill="none" stroke={COLOR.star} strokeWidth={1.4} />
          <text x={-30} y={-6} fontSize={13} fontWeight={700} fill={COLOR.star}>
            已入库
          </text>
          <text x={-30} y={14} fontSize={10.5} fill="#666">
            {s.chunk_count} 张卡片 · {s.dim} 维
          </text>
        </g>
      )}

      <Dog x={dog.p.x} y={dog.p.y} pose={dog.pose} facing={dog.facing} clock={clock} bubble={dog.bubble} scale={0.85} />
    </g>
  )
}

/** 前一张卡片的结尾与后一张的开头重合的部分（切分器的 overlap） */
function overlapOf(prev: string, next: string): number {
  const max = Math.min(prev.length, next.length, 400)
  for (let k = max; k >= 8; k--) if (prev.endsWith(next.slice(0, k))) return k
  return 0
}

function IngestDesk({ detail, stepKey, t }: { detail: IngestDetail; stepKey: string; t: number }) {
  const s = detail.data
  switch (stepKey) {
    case 'load':
      return (
        <div className="text-[13px]">
          <div className="mb-2 font-semibold text-ink">
            《{s.title}》<span className="ml-2 font-normal text-ink-450">{fmtNum(s.char_count)} 字</span>
          </div>
          <div className="line-clamp-4 text-ink-600">{s.chunks.map((c) => c.text).join('')}</div>
        </div>
      )
    case 'split':
      return (
        <div className="grid grid-cols-3 gap-3">
          {s.chunks.slice(0, 3).map((c, i) => {
            const head = i > 0 ? overlapOf(s.chunks[i - 1].text, c.text) : 0
            return (
              <div key={c.id} className="rounded-card border border-line p-2.5 text-[12px] leading-5" style={{ opacity: Math.min(1, t * 2.5 - i * 0.4) }}>
                <div className="mb-1 font-semibold text-ink">
                  第 {c.idx + 1} 张 <span className="font-normal text-ink-450">{c.text.length} 字</span>
                </div>
                <div className="line-clamp-6 text-ink-600">
                  {head > 0 && (
                    <mark className="rounded-sm px-0.5 text-ink" style={{ background: 'repeating-linear-gradient(45deg, rgba(202,138,4,.22) 0 4px, transparent 4px 8px)' }}>
                      {c.text.slice(0, head)}
                    </mark>
                  )}
                  {c.text.slice(head)}
                </div>
              </div>
            )
          })}
          <div className="col-span-3 text-[11.5px] text-ink-450">斜纹 = 和上一张重叠的部分</div>
        </div>
      )
    case 'embed':
      return (
        <div className="space-y-1.5 text-[12.5px]">
          {s.chunks.slice(0, 4).map((c) => (
            <div key={c.id} className="flex items-center gap-2">
              <span className="w-12 shrink-0 font-semibold text-ink">第 {c.idx + 1} 张</span>
              <span className="min-w-0 flex-1 truncate text-ink-600">{c.text}</span>
              <span className="shrink-0 text-ink-400">→</span>
              <span className="shrink-0 rounded-full border px-2 py-0.5 text-[11.5px]" style={{ borderColor: COLOR.vector, color: COLOR.vector }}>
                {fmtNum(s.dim)} 个数字
              </span>
            </div>
          ))}
        </div>
      )
    case 'tags':
      return (
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-[12.5px]">
          {s.chunks.slice(0, 8).map((c) => (
            <div key={c.id} className="flex items-center gap-2">
              <span className="w-12 shrink-0 font-semibold text-ink">第 {c.idx + 1} 张</span>
              <span className="flex flex-wrap gap-1">
                {c.keywords.map((k) => (
                  <span key={k} className="rounded-full border px-1.5 text-[11.5px]" style={{ borderColor: COLOR.keyword, color: COLOR.keyword }}>
                    {k}
                  </span>
                ))}
              </span>
            </div>
          ))}
        </div>
      )
    case 'save': {
      const max = Math.max(1, ...detail.nodes.map((n) => n.latency_ms ?? 0))
      return (
        <div className="space-y-1.5 text-[12.5px]">
          <div className="mb-1 text-ink-450">每一步花了多久</div>
          {detail.nodes.map((n) => (
            <div key={n.name} className="flex items-center gap-2">
              <span className="w-20 shrink-0 text-ink-600">{NODE_LABEL[n.name] ?? n.name}</span>
              <span className="h-2 rounded-full bg-ink" style={{ width: `${Math.max(2, ((n.latency_ms ?? 0) / max) * 70)}%` }} />
              <span className="shrink-0 font-mono text-ink-450">{fmtMs(n.latency_ms)}</span>
            </div>
          ))}
        </div>
      )
    }
    default:
      return null
  }
}

const NODE_LABEL: Record<string, string> = { load: '读取', split: '切分', embed: '翻译成数字', summarize: '写概要', save: '入库' }
