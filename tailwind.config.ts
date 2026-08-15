import type { Config } from 'tailwindcss';

/**
 * Tailwind 配置。
 *
 * 视觉体系（UI 重构）：
 * - felt：牌桌绒布色阶（深绿），用于牌桌背景与面板层级；
 * - gold：金色强调（地主、倍数、主操作按钮），营造牌桌质感；
 * - shadow：卡片投影、悬停抬升、品牌/金色发光，塑造空间层次；
 * - animation：发牌、出牌弹入、柔和脉冲、倒计时呼吸等牌桌动效。
 *
 * 断点遵循 DESIGN §8.8：默认 mobile first，md=768，lg=1024。
 */
const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        /** 牌桌主题色（兼容旧引用） */
        table: {
          felt: '#0f5132',
          feltDark: '#0b3d26',
          feltLight: '#15703f',
        },
        /** 绒布色阶：越深越靠近桌面边缘暗角 */
        felt: {
          950: '#06170f',
          900: '#0a2b1c',
          800: '#0d3a25',
          700: '#10492e',
          600: '#125a38',
          500: '#0f5132',
          400: '#1b7a4a',
          300: '#2a9d62',
        },
        /** 金色强调（地主/倍数/主按钮） */
        gold: {
          100: '#fef3c7',
          200: '#fde68a',
          300: '#fcd34d',
          400: '#fbbf24',
          500: '#f59e0b',
          600: '#d97706',
          700: '#b45309',
        },
        /** 牌面色 */
        card: {
          face: '#fdfdfd',
          back: '#1e3a8a',
          red: '#d92626',
          black: '#1a1a1a',
        },
        /** 品牌主色 */
        brand: {
          50: '#eef4ff',
          100: '#d9e5ff',
          200: '#bcd1ff',
          300: '#8fb3ff',
          400: '#5b8aff',
          500: '#3563e9',
          600: '#2449c7',
          700: '#1d3aa1',
          800: '#1c3382',
          900: '#1c2f6b',
        },
      },
      boxShadow: {
        card: '0 2px 6px rgba(0,0,0,0.28)',
        cardHover: '0 10px 22px rgba(0,0,0,0.38)',
        panel: '0 4px 24px rgba(0,0,0,0.18)',
        /** 选中牌/行动面板的蓝色柔光 */
        glow: '0 0 0 3px rgba(53, 99, 233, 0.35), 0 0 18px rgba(53, 99, 233, 0.32)',
        /** 金色强调光（地主/主按钮悬停） */
        glowGold: '0 0 0 3px rgba(245, 158, 11, 0.38), 0 0 22px rgba(245, 158, 11, 0.35)',
        /** 深色面板顶部内高光 */
        innerTop: 'inset 0 1px 0 rgba(255, 255, 255, 0.08)',
      },
      fontFamily: {
        card: ['"Segoe UI"', '"PingFang SC"', '"Microsoft YaHei"', 'sans-serif'],
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0', transform: 'translateY(-6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'pop-in': {
          '0%': { opacity: '0', transform: 'scale(0.94)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        /** 发牌落入 */
        'deal-in': {
          '0%': { opacity: '0', transform: 'translateY(22px) scale(0.9)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        /** 出牌弹入（带回弹） */
        'play-pop': {
          '0%': { opacity: '0', transform: 'scale(0.5) translateY(14px)' },
          '60%': { opacity: '1', transform: 'scale(1.09) translateY(-3px)' },
          '100%': { opacity: '1', transform: 'scale(1) translateY(0)' },
        },
        /** 柔和呼吸（等待提示等） */
        'pulse-soft': {
          '0%, 100%': { opacity: '0.55' },
          '50%': { opacity: '1' },
        },
        /** 行动中光晕扩散 */
        'pulse-ring': {
          '0%': { boxShadow: '0 0 0 0 rgba(52, 211, 153, 0.5)' },
          '70%': { boxShadow: '0 0 0 9px rgba(52, 211, 153, 0)' },
          '100%': { boxShadow: '0 0 0 0 rgba(52, 211, 153, 0)' },
        },
        /** 高光扫过（牌背/主按钮） */
        shine: {
          '0%': { transform: 'translateX(-130%) skewX(-20deg)' },
          '100%': { transform: 'translateX(230%) skewX(-20deg)' },
        },
        /** 缓慢悬浮（装饰元素） */
        'float-slow': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-7px)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.2s ease-out',
        'pop-in': 'pop-in 0.18s ease-out',
        'deal-in': 'deal-in 0.38s cubic-bezier(0.22, 1, 0.36, 1) both',
        'play-pop': 'play-pop 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) both',
        'pulse-soft': 'pulse-soft 1.8s ease-in-out infinite',
        'pulse-ring': 'pulse-ring 1.6s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        shine: 'shine 2.8s ease-in-out infinite',
        'float-slow': 'float-slow 3.6s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};

export default config;
