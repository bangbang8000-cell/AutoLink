const { FlatCompat } = require('@eslint/eslintrc');
const globals = require('globals');

const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: require('@eslint/js').configs.recommended,
});

module.exports = [
  ...compat.extends(
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react/recommended',
    'plugin:react-hooks/recommended',
    'prettier',
  ),
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      // react-hooks v7+ stricter rules — demote to warnings
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/immutability': 'warn',
    },
    settings: { react: { version: 'detect' } },
  },
  {
    // V2.9.1-T4: 测试文件中 mock 数据/状态注入使用 any 是合理用法, 豁免 no-explicit-any
    files: ['src/test/**'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    // V2.7.6-T9: three.js JSX 元素属性 (position/intensity/args 等) 是合法 DOM 属性,
    // 与 DOM 属性 (className/style) 不同, 需豁免 react/no-unknown-property
    files: ['src/components/workspace/tabs/Topology3DTab.tsx', 'src/components/workspace/room/**/*.tsx'],
    rules: {
      'react/no-unknown-property': 'off',
    },
  },
  {
    // V2.7.6-T9: three-fiber 类型兼容声明, 空扩展接口是类型合并手段, 豁免空对象类型告警
    files: ['src/three-fiber.d.ts'],
    rules: {
      '@typescript-eslint/no-empty-object-type': 'off',
    },
  },
];
