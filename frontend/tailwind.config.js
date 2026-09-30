import typography from '@tailwindcss/typography'

/** 设计 token：白底 + 黑白灰，柔黑 #191919 强调，border 划界 */
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: '#191919', // 柔黑：强调 / 主按钮 / 大标题
          900: '#171717', // 正文
          700: '#444444',
          600: '#666666', // 副标题 / 描述
          450: '#767676', // 元数据 / hint
          400: '#999999', // 装饰字符
        },
        line: {
          DEFAULT: '#EEEEEE', // 主描边
          divider: '#F0F0F0', // 卡片内分隔
          strong: '#D1D5DB', // hover 描边
        },
        surface: {
          DEFAULT: '#FFFFFF',
          soft: '#FAFAFA',
          muted: '#F8F8F8',
          hover: 'rgba(25,25,25,0.04)',
          active: 'rgba(25,25,25,0.06)',
        },
        danger: { DEFAULT: '#F53F3F', soft: 'rgba(245,63,63,0.08)' },
        ok: { DEFAULT: '#16A34A', soft: 'rgba(22,163,74,0.08)' },
      },
      fontFamily: {
        sans: [
          '-apple-system', 'BlinkMacSystemFont', '"PingFang SC"', '"Segoe UI"',
          '"Microsoft YaHei"', '"Helvetica Neue"', 'Arial', 'sans-serif',
        ],
        mono: ['"SF Mono"', 'Menlo', 'Consolas', 'monospace'],
      },
      borderRadius: { card: '8px', panel: '12px' },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'slide-in': { from: { transform: 'translateX(16px)', opacity: '0' }, to: { transform: 'none', opacity: '1' } },
        'pop-in': { from: { transform: 'translateY(4px) scale(0.98)', opacity: '0' }, to: { transform: 'none', opacity: '1' } },
      },
      animation: {
        'fade-in': 'fade-in 150ms ease-out',
        'slide-in': 'slide-in 180ms ease-out',
        'pop-in': 'pop-in 160ms ease-out',
      },
    },
  },
  plugins: [typography],
}
