/**
 * 2026-08-24（新增）：拓扑视图「真实渲染」PNG 导出器
 *
 * 直接把 topology.json 的渲染效果（react-flow 交互视图所见）导出为图片：
 *  - 复用 TopologyViewCanvas（与交互视图同源布局/节点/边渲染）→ html-to-image 截图；
 *  - 导出前做比例评估：按内容布局宽高比（computeTopologyLayout.totalWidth/Height）确定
 *    输出画布，等比 fit、不拉伸 → 1:1 还原；默认 4K（3840 宽 / 2160 高，按比例取短边）。
 */
import { createRoot } from 'react-dom/client'
import { ReactFlowProvider } from '@xyflow/react'
import { toPng } from 'html-to-image'
// 2026-08-24（修复）：导出用的临时 ReactFlow 依赖 react-flow 样式。
// 该 CSS 此前只在 TopologyTab/PlanTopologyView 模块加载（懒加载），
// 未打开过拓扑时导出会拿到无样式的 ReactFlow → 渲染为空白图。
// 此处随导出器静态引入，保证任何入口导出时样式就绪。
import '@xyflow/react/dist/style.css'
import { computeTopologyLayout } from '@/components/workspace/tabs/topology/topologyLayout'
import { TopologyViewCanvas } from '@/components/workspace/tabs/topology/TopologyViewCanvas'
import type { TopologyNode, TopologyEdge, TopologyLayout } from '@/stores/design.store'

/** 4K 上限（逻辑画布 × pixelRatio 2） */
const MAX_W = 1920
const MAX_H = 1080
const PIXEL_RATIO = 2
/** 内容宽高比下限保护（避免极端比例导致画布过小/过大） */
const MIN_W = 640
const MIN_H = 360

/** 比例评估：按「实际渲染内容包围盒」（saved layout 优先 ∪ POD 框）计算输出画布（等比、1:1 不拉伸） */
export function evaluateTopologyExportSize(
  nodes: TopologyNode[],
  savedLayout?: TopologyLayout | null,
): { width: number; height: number; pixelRatio: number } {
  const layout = computeTopologyLayout(nodes, [])
  const savedPos = savedLayout?.nodePositions ?? {}

  // 内容包围盒：设备节点有效位置（saved 优先）∪ POD 背景框
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  const include = (x: number, y: number) => {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  const layoutPos = new Map(layout.layoutNodes.map((n) => [n.id, n]))
  for (const node of nodes) {
    const pos = savedPos[node.id] ?? layoutPos.get(node.id)
    if (pos) include(pos.x, pos.y)
  }
  for (const pod of layout.pods) {
    include(pod.x, pod.y)
    include(pod.x + pod.width, pod.y + pod.height)
  }
  if (!isFinite(minX) || maxX <= minX || maxY <= minY) {
    minX = 0; minY = 0; maxX = layout.totalWidth; maxY = layout.totalHeight
  }
  const ratio = Math.max(1, (maxX - minX) / Math.max(1, maxY - minY))

  let logicalW: number
  let logicalH: number
  if (ratio >= MAX_W / MAX_H) {
    // 内容偏宽 → 宽撑满 1920，高按比例（给下限保护）
    logicalW = MAX_W
    logicalH = Math.max(MIN_H, Math.round(MAX_W / ratio))
  } else {
    // 内容偏高 → 高撑满 1080，宽按比例（给下限保护）
    logicalH = MAX_H
    logicalW = Math.max(MIN_W, Math.round(MAX_H * ratio))
  }
  return { width: logicalW, height: logicalH, pixelRatio: PIXEL_RATIO }
}

/**
 * 将 topology 渲染为 PNG（base64，无 data: 前缀）。
 * 1:1 还原交互视图渲染效果，默认 4K。
 */
export async function exportTopologyViewPng(
  nodes: TopologyNode[],
  edges: TopologyEdge[],
  savedLayout?: TopologyLayout | null,
): Promise<string> {
  if (!nodes || nodes.length === 0) throw new Error('拓扑数据为空')

  // 1. 比例评估 → 输出画布尺寸
  const { width, height, pixelRatio } = evaluateTopologyExportSize(nodes, savedLayout)

  // 2. 创建导出容器。
  // 2026-08-24（修复）：此前用 left:-9999px 的 off-screen 定位，html-to-image 克隆时
  // 会基于负的 getBoundingClientRect 计算，导致内容被裁出画布 → 导出全白。
  // 改为视口内 fixed（z-index:-1 被页面盖住，用户不可见），坐标有效、序列化正常。
  const container = document.createElement('div')
  container.style.cssText =
    `position:fixed;left:0;top:0;width:${width}px;height:${height}px;z-index:-1;background:#ffffff`
  document.body.appendChild(container)

  const root = createRoot(container)
  try {
    // 3. 渲染真实拓扑画布，等待 fit 完成后截图
    await new Promise<void>((resolve) => {
      root.render(
        <ReactFlowProvider>
          <TopologyViewCanvas nodes={nodes} edges={edges} savedLayout={savedLayout} width={width} height={height} onReady={resolve} />
        </ReactFlowProvider>,
      )
    })

    // 4. 留一点时间让字体/渲染稳定，再序列化
    await new Promise((r) => setTimeout(r, 150))

    const dataUrl = await toPng(container, {
      // 只传 pixelRatio：html-to-image 输出 = 容器逻辑尺寸 × pixelRatio（避免重复放大）
      pixelRatio,
      backgroundColor: '#ffffff',
      skipFonts: true,
    })
    return dataUrl.replace(/^data:image\/png;base64,/, '')
  } finally {
    // 5. 卸载并移除容器
    root.unmount()
    if (container.parentNode) container.parentNode.removeChild(container)
  }
}
