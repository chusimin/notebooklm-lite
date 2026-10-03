/**
 * 小金：金毛寻回犬（Retriever）。RAG 里负责"找资料"的组件就叫 Retriever，所以由它来演示检索。
 *
 * 纯 SVG 绘制，原点在脚底中心，默认朝右；facing=-1 时水平翻转。
 * 姿态：sit 坐 / run 跑 / sniff 低头闻 / lie 趴下（全文模式不用找）/ carry 叼着卡片跑
 * clock 为持续时钟（毫秒），驱动摆腿、摇尾巴、呼吸等循环动作。
 */
import { COLOR } from './shared'

export type DogPose = 'sit' | 'run' | 'sniff' | 'lie' | 'carry'

export function Dog({
  x,
  y,
  pose,
  facing = 1,
  clock,
  scale = 1,
  bubble,
}: {
  x: number
  y: number
  pose: DogPose
  facing?: 1 | -1
  clock: number
  scale?: number
  /** 头顶小气泡（如 "?"、"!"），不翻转 */
  bubble?: string
}) {
  const moving = pose === 'run' || pose === 'carry'
  const swing = moving ? Math.sin(clock / 70) * 28 : 0
  const bob = moving ? Math.abs(Math.sin(clock / 70)) * -3 : Math.sin(clock / 600) * 0.6
  const wag = Math.sin(clock / (pose === 'lie' ? 900 : 120)) * (pose === 'lie' ? 6 : 22)
  const headDrop = pose === 'sniff' ? 12 : 0

  const leg = (lx: number, phase: number) => (
    <rect
      x={lx - 2.6}
      y={-14}
      width={5.2}
      height={14}
      rx={2.6}
      fill={COLOR.furDark}
      transform={`rotate(${swing * phase} ${lx} -13)`}
    />
  )

  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`} style={{ pointerEvents: 'none' }}>
      <ellipse cx={0} cy={1} rx={pose === 'lie' ? 34 : 26} ry={3.5} fill="rgba(0,0,0,0.08)" />
      <g transform={`scale(${facing} 1)`}>
        {pose === 'lie' ? (
          <g transform={`translate(0 ${bob})`}>
            <path d="M-26 -9 q-12 -2 -16 -8" stroke={COLOR.furDark} strokeWidth={5} strokeLinecap="round" fill="none" transform={`rotate(${wag} -26 -9)`} />
            <ellipse cx={-4} cy={-9} rx={26} ry={9.5} fill={COLOR.fur} />
            <ellipse cx={18} cy={-2} rx={9} ry={3} fill={COLOR.furDark} />
            <ellipse cx={-20} cy={-2} rx={8} ry={3} fill={COLOR.furDark} />
            <circle cx={22} cy={-15} r={10.5} fill={COLOR.fur} />
            <ellipse cx={31} cy={-11} rx={6.5} ry={4.5} fill={COLOR.furLight} />
            <circle cx={36.5} cy={-12} r={2.2} fill="#2b2b2b" />
            <path d="M20 -18 q2.5 2 5 0" stroke="#2b2b2b" strokeWidth={1.4} fill="none" strokeLinecap="round" />
            <ellipse cx={15} cy={-12} rx={4.5} ry={8} fill={COLOR.furDark} transform="rotate(20 15 -12)" />
            <text x={30} y={-30} fontSize={11} fill="#999" opacity={0.5 + Math.sin(clock / 500) * 0.5}>
              z z
            </text>
          </g>
        ) : (
          <g transform={`translate(0 ${bob})`}>
            {/* 尾巴 */}
            <path
              d={pose === 'sit' ? 'M-18 -10 q-14 0 -18 -12' : 'M-26 -26 q-12 -4 -14 -16'}
              stroke={COLOR.furDark}
              strokeWidth={6}
              strokeLinecap="round"
              fill="none"
              transform={`rotate(${wag} ${pose === 'sit' ? -18 : -26} ${pose === 'sit' ? -10 : -26})`}
            />
            {pose === 'sit' ? (
              <>
                <ellipse cx={-6} cy={-18} rx={16} ry={17} fill={COLOR.fur} />
                <ellipse cx={-12} cy={-4} rx={11} ry={5} fill={COLOR.furDark} />
                {leg(6, 0)}
                {leg(12, 0)}
              </>
            ) : (
              <>
                {leg(-20, 1)}
                {leg(-12, -1)}
                <ellipse cx={-5} cy={-24} rx={25} ry={12.5} fill={COLOR.fur} />
                {leg(6, -1)}
                {leg(14, 1)}
              </>
            )}
            {/* 头 */}
            <g transform={`translate(${pose === 'sit' ? -4 : 0} ${headDrop + (pose === 'sit' ? -4 : 0)})`}>
              <rect x={10} y={-34} width={10} height={6} rx={2} fill={COLOR.star} />
              <circle cx={16} cy={-26} r={2.2} fill={COLOR.both} />
              <circle cx={20} cy={-38} r={12} fill={COLOR.fur} />
              <ellipse cx={31} cy={-33.5} rx={7.5} ry={5.2} fill={COLOR.furLight} />
              <circle cx={37.5} cy={-35} r={2.6} fill="#2b2b2b" />
              <circle cx={23} cy={-41} r={1.9} fill="#2b2b2b" />
              <ellipse cx={13} cy={-35} rx={5} ry={9} fill={COLOR.furDark} transform="rotate(16 13 -35)" />
              {pose === 'carry' && (
                <g transform="translate(34 -32) rotate(8)">
                  <rect x={0} y={-6} width={22} height={15} rx={2} fill="#fff" stroke={COLOR.star} strokeWidth={1.2} />
                  <line x1={4} y1={-1} x2={18} y2={-1} stroke="#ccc" strokeWidth={1.4} />
                  <line x1={4} y1={3} x2={14} y2={3} stroke="#ccc" strokeWidth={1.4} />
                </g>
              )}
              {pose === 'sniff' && (
                <g stroke={COLOR.vector} strokeWidth={1.3} fill="none" strokeLinecap="round" opacity={0.4 + Math.sin(clock / 160) * 0.3}>
                  <path d="M44 -40 q4 -3 0 -6 q-4 -3 0 -6" />
                  <path d="M50 -36 q4 -3 0 -6 q-4 -3 0 -6" />
                </g>
              )}
            </g>
          </g>
        )}
      </g>
      {bubble && (
        <g transform={`translate(${facing * 10} ${pose === 'lie' ? -42 : -66})`}>
          <rect x={-11} y={-14} width={22} height={18} rx={9} fill="#fff" stroke={COLOR.star} strokeWidth={1.2} />
          <text x={0} y={0} textAnchor="middle" fontSize={12} fontWeight={700} fill={COLOR.star}>
            {bubble}
          </text>
        </g>
      )}
    </g>
  )
}
