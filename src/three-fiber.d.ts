/**
 * V2.7.6-T9: @react-three/fiber v8 + React 19 类型兼容声明
 *
 * 问题: @react-three/fiber v8 通过 `declare global { namespace JSX }` 扩展 JSX 命名空间,
 *       但 React 19 的 @types/react 将 JSX 命名空间移至 `React.JSX`,
 *       导致全局 JSX 扩充不被识别, tsc 报错:
 *         TS2339: Property 'group' does not exist on type 'JSX.IntrinsicElements'.
 *
 * 修复: 将 ThreeElements 同时扩充到 React.JSX.IntrinsicElements,
 *       使 react-jsx 运行时能正确识别 three.js 的 JSX 元素 (group/mesh/ambientLight 等)。
 */
import type { ThreeElements } from '@react-three/fiber'

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements extends ThreeElements {}
  }
}
