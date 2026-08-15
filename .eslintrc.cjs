/**
 * ESLint 配置。
 *
 * package.json 声明了 `lint` 脚本且依赖齐备（eslint 8 + @typescript-eslint 7 +
 * eslint-plugin-react-hooks），但缺少配置文件导致脚本无法执行，此处补齐。
 *
 * 规则取向：以「能查出真实缺陷」为准，不追求风格洁癖。
 * react-hooks/exhaustive-deps 尤其关键——牌桌驱动 AI 的 useEffect
 * 依赖项缺失正是死锁类问题的高发区。
 */
module.exports = {
  root: true,
  env: { browser: true, es2022: true, node: true },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  plugins: ['@typescript-eslint', 'react-hooks'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  settings: { react: { version: 'detect' } },
  ignorePatterns: [
    'dist/',
    'node_modules/',
    '.tsbuild/',
    'coverage/',
    '*.mts',        // 主理人验收脚本，不参与生产代码规范
    '*.mjs',
    'vite.config.ts',
    'tailwind.config.ts',
    'postcss.config.js',
    '.eslintrc.cjs',
  ],
  rules: {
    // ---- Hooks 正确性（真缺陷来源）----
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn',

    // ---- 类型安全 ----
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': [
      'warn',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
    ],
    '@typescript-eslint/no-non-null-assertion': 'off',

    // ---- 逻辑陷阱 ----
    eqeqeq: ['error', 'always', { null: 'ignore' }],
    'no-console': 'off',
    'no-empty': ['error', { allowEmptyCatch: true }],
  },
  overrides: [
    {
      files: ['server/**/*.ts'],
      env: { node: true, browser: false },
    },
  ],
};
