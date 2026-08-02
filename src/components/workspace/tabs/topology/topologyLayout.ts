/**
 * AutoLink V2.4.5 — 服务器区中心化 + 四象限网络设备分区布局算法
 *
 * 核心思路：服务器区居中，网络设备按四象限分区布置
 *
 * 布局结构：
 *   ┌──────────────────────────────────────────────────────────┐
 *   │  [OOB Agg]              [业务 Core/Agg]                  │ ← 顶部 L0
 *   │  [OOB Access]           [业务 Access]                    │ ← 顶部 L1
 *   │                                                          │
 *   │  ┌── 顶部间距 (≥100px) ──┐                              │
 *   │                                                          │
 *   │  ┌─GPU POD1─┐┌─GPU POD2─┐┌─存储POD─┐┌通算POD┐           │ ← 服务器区（居中）
 *   │  │S S S S   ││S S S S   ││S S S   ││S S  │           │
 *   │  │S S S S   ││S S S S   ││S S S   ││S S  │           │
 *   │  └──────────┘└──────────┘└────────┘└──────┘           │
 *   │                                                          │
 *   │  ┌── 底部间距 (≥100px) ──┐                              │
 *   │                                                          │
 *   │  [参数 Leaf][参数Spine]  [存储Leaf][存储Spine]           │ ← 底部 L2/L3
 *   └──────────────────────────────────────────────────────────┘
 *                      ≈ 16:9 矩形
 *
 * 四象限分区：
 *   左上：OOB（带外）Agg + Access
 *   右上：业务 Core + Agg + Access
 *   左下：参数网 Leaf + Spine
 *   右下：存储网 Leaf + Spine
 */

import type { TopologyNode, TopologyEdge } from '@/stores/design.store'

/* ================================================================
 *  常量定义
 * ================================================================ */

/** 服务器单元格尺寸（满足 PRD AC8: ≥80px 间距） */
const CELL_W = 90
const CELL_H = 80

/** POD 间距（POD 之间） */
const POD_GAP = 60

/** 服务器区左右 padding（需求8：左右无网络设备） */
const SIDE_PADDING = 120

/** 服务器区与顶部/底部网络设备间距（需求7：≥100px） */
const TOP_GAP = 120
const BOTTOM_GAP = 120

/** 网络设备层间间距（需求9：接入↔汇聚、Leaf↔Spine） */
const LAYER_GAP = 100

/** 同层网络设备水平间距 */
const NODE_SPACING = 90

/** 左右四象限中线间距 */
const QUADRANT_GAP = 80

/** 服务器矩形排列的宽高比目标（4:3，仅在无 colsHint 时使用） */
const GRID_ASPECT_RATIO = 4 / 3

/** 16:9 比例目标 */
const TARGET_RATIO = 16 / 9

/** 16:9 比例容差（±15%） */
const RATIO_TOLERANCE = 0.15

/** 最小画布尺寸（小规模时固定） */
const MIN_CANVAS_W = 1200
const MIN_CANVAS_H = 675

/** Y 轴层级基准坐标 */
const Y_AGG = 40
const Y_CORE = 40

/* ================================================================
 *  类型定义
 * ================================================================ */

export type LayerHint = 'core' | 'spine' | 'leaf' | 'server' | 'access' | 'agg' | 'gpu'

export interface LayoutNode {
  id: string
  x: number
  y: number
  type: string
  layerHint: LayerHint
  group?: string
  podid?: string
}

export interface LayoutPod {
  podid: string
  x: number
  y: number
  width: number
  height: number
  serverCount: number
  accessCount: number
  leafCount: number
}

export interface LayoutResult {
  layoutNodes: LayoutNode[]
  pods: LayoutPod[]
  totalWidth: number
  totalHeight: number
}

/* ================================================================
 *  辅助函数
 * ================================================================ */

function getLayerHint(node: TopologyNode): LayerHint {
  if (node.layerHint) return node.layerHint as LayerHint
  const t = node.type
  // V2.7.6-T5: GPU/NPU 节点 (Scale-Up 双栈联合视图)
  if (t === 'gpu') return 'gpu'
  if (t === 'server') return 'server'
  if (t.includes('core')) return 'core'
  if (t.includes('spine')) return 'spine'
  if (t.includes('leaf')) return 'leaf'
  if (t.includes('access')) return 'access'
  if (t.includes('agg')) return 'agg'
  return 'server'
}

function isParamNetwork(n: TopologyNode): boolean { return n.type.startsWith('param_') }
function isStorageNetwork(n: TopologyNode): boolean { return n.type.startsWith('storage_') }
function isOobNetwork(n: TopologyNode): boolean { return n.type.startsWith('oob_') }
function isBizNetwork(n: TopologyNode): boolean { return n.type.startsWith('biz_') }

/**
 * 计算服务器矩形排列的列数和行数
 * - 传入 colsHint 时强制使用，否则按 4:3 宽高比自适应
 */
export function calculateGrid(count: number, colsHint?: number): { cols: number; rows: number } {
  if (count <= 0) return { cols: 0, rows: 0 }
  if (count === 1) return { cols: 1, rows: 1 }
  if (colsHint && colsHint > 0) {
    const cols = colsHint
    const rows = Math.ceil(count / cols)
    return { cols, rows }
  }
  const cols = Math.ceil(Math.sqrt(count * GRID_ASPECT_RATIO))
  const rows = Math.ceil(count / cols)
  return { cols, rows }
}

/** 在指定区间内水平居中排列节点 */
function layoutRowCentered(
  nodes: TopologyNode[],
  leftX: number,
  rightX: number,
  y: number,
  minSpacing: number,
): { positions: LayoutNode[]; width: number } {
  if (nodes.length === 0) return { positions: [], width: 0 }
  const availableWidth = rightX - leftX
  const neededWidth = (nodes.length - 1) * minSpacing
  const spacing = neededWidth <= availableWidth
    ? minSpacing
    : Math.max(60, Math.floor(availableWidth / Math.max(1, nodes.length - 1)))
  const totalWidth = (nodes.length - 1) * spacing
  const startX = leftX + (availableWidth - totalWidth) / 2
  const positions = nodes.map((node, idx) => ({
    id: node.id,
    x: startX + idx * spacing,
    y,
    type: node.type,
    layerHint: getLayerHint(node),
    group: node.group,
    podid: node.podid,
  }))
  return { positions, width: totalWidth }
}

/* ================================================================
 *  POD 分组
 * ================================================================ */

interface PodGroup {
  podid: string
  servers: TopologyNode[]
  paramLeaves: TopologyNode[]    // POD 内参数 Leaf（用于计算 colsHint）
  storageLeaves: TopologyNode[]  // POD 内存储 Leaf
  oobAccess: TopologyNode[]
  bizAccess: TopologyNode[]
}

interface NetworkGroups {
  // 顶部：OOB（左上）+ 业务（右上）
  oobAgg: TopologyNode[]
  oobAccess: TopologyNode[]
  bizCore: TopologyNode[]
  bizAgg: TopologyNode[]
  bizAccess: TopologyNode[]
  // 底部：参数网（左下）+ 存储网（右下）
  paramLeaves: TopologyNode[]
  paramSpines: TopologyNode[]
  storageLeaves: TopologyNode[]
  storageSpines: TopologyNode[]
  // 3-tier Core（如有）
  paramCores: TopologyNode[]
  storageCores: TopologyNode[]
}

function groupNodes(nodes: TopologyNode[]): { pods: PodGroup[]; networks: NetworkGroups } {
  const podMap = new Map<string, PodGroup>()
  const networks: NetworkGroups = {
    oobAgg: [], oobAccess: [],
    bizCore: [], bizAgg: [], bizAccess: [],
    paramLeaves: [], paramSpines: [],
    storageLeaves: [], storageSpines: [],
    paramCores: [], storageCores: [],
  }

  for (const node of nodes) {
    const hint = getLayerHint(node)
    const podid = node.podid || ''

    const getOrCreatePod = (pid: string): PodGroup => {
      if (!podMap.has(pid)) {
        podMap.set(pid, {
          podid: pid,
          servers: [],
          paramLeaves: [], storageLeaves: [],
          oobAccess: [], bizAccess: [],
        })
      }
      return podMap.get(pid)!
    }

    if (hint === 'server' || hint === 'gpu') {
      // V2.7.6-T5: GPU/NPU 节点归入 POD 服务器区(按服务器布局)
      // superpod 归入虚拟全局 POD（实际场景下存储/通算 POD 也有 podid）
      const key = podid || '_global'
      getOrCreatePod(key).servers.push(node)
    } else if (hint === 'access') {
      // Access 按网络类型分组到全局
      if (isOobNetwork(node)) networks.oobAccess.push(node)
      else if (isBizNetwork(node)) networks.bizAccess.push(node)
      // 同时若 podid 非 superpod，也加入 POD（用于 colsHint 计算）
      if (podid && podid !== 'superpod') {
        const pod = getOrCreatePod(podid)
        if (isOobNetwork(node)) pod.oobAccess.push(node)
        else if (isBizNetwork(node)) pod.bizAccess.push(node)
      }
    } else if (hint === 'leaf') {
      // Leaf 按网络类型分组到全局
      if (isParamNetwork(node)) {
        networks.paramLeaves.push(node)
        if (podid && podid !== 'superpod') {
          getOrCreatePod(podid).paramLeaves.push(node)
        }
      } else if (isStorageNetwork(node)) {
        networks.storageLeaves.push(node)
        if (podid && podid !== 'superpod') {
          getOrCreatePod(podid).storageLeaves.push(node)
        }
      }
    } else if (hint === 'agg') {
      if (isOobNetwork(node)) networks.oobAgg.push(node)
      else if (isBizNetwork(node)) networks.bizAgg.push(node)
      else networks.oobAgg.push(node)
    } else if (hint === 'spine') {
      if (isParamNetwork(node)) networks.paramSpines.push(node)
      else if (isStorageNetwork(node)) networks.storageSpines.push(node)
      else networks.paramSpines.push(node)
    } else if (hint === 'core') {
      if (isParamNetwork(node)) networks.paramCores.push(node)
      else if (isStorageNetwork(node)) networks.storageCores.push(node)
      else networks.paramCores.push(node)
    }
  }

  // 过滤空 POD（无服务器的 POD 不显示）
  const pods = Array.from(podMap.values()).filter((p) => p.servers.length > 0)

  return { pods, networks }
}

/* ================================================================
 *  Step 1: 统计 POD 数量与类型
 * ================================================================ */

export interface PodStats {
  total: number
  gpu: number
  storage: number
  general: number
}

export function countPods(pods: PodGroup[]): PodStats {
  let gpu = 0, storage = 0, general = 0
  for (const pod of pods) {
    const pid = pod.podid.toLowerCase()
    if (pid.includes('gpu')) gpu++
    else if (pid.includes('storage') || pid.includes('存储')) storage++
    else if (pid.includes('general') || pid.includes('通算')) general++
    else gpu++ // 默认归入 GPU
  }
  return { total: pods.length, gpu, storage, general }
}

/* ================================================================
 *  Step 2: 计算服务器区尺寸
 * ================================================================ */

interface PodDimension {
  podid: string
  cols: number
  rows: number
  width: number
  height: number
  serverCount: number
}

export function calculateServerArea(
  pods: PodGroup[],
): { pods: PodDimension[]; totalWidth: number; maxHeight: number } {
  const dims: PodDimension[] = []
  let totalWidth = 0
  let maxHeight = 0

  for (const pod of pods) {
    const colsHint = pod.paramLeaves.length > 0 ? pod.paramLeaves.length : undefined
    const { cols, rows } = calculateGrid(pod.servers.length, colsHint)
    const width = cols * CELL_W
    const height = rows * CELL_H
    dims.push({
      podid: pod.podid,
      cols, rows, width, height,
      serverCount: pod.servers.length,
    })
    totalWidth += width
    if (height > maxHeight) maxHeight = height
  }

  // 加上 POD 间距
  if (dims.length > 1) {
    totalWidth += (dims.length - 1) * POD_GAP
  }

  return { pods: dims, totalWidth, maxHeight }
}

/* ================================================================
 *  Step 3: 计算画布尺寸（16:9 比例自适应）
 * ================================================================ */

export interface CanvasSize {
  width: number
  height: number
  serverAreaX: number       // 服务器区起始 X（概念宽度起点，含网络设备区）
  serverAreaY: number       // 服务器区起始 Y
  serverAreaWidth: number   // 服务器区概念宽度（可能大于实际服务器节点宽度，以容纳网络设备）
  serverAreaHeight: number
  serverCenterX: number     // 服务器区中心 X
  topRegionHeight: number   // 顶部网络设备区高度
  bottomRegionHeight: number // 底部网络设备区高度
  /** 实际服务器节点排列宽度（可能小于 serverAreaWidth，用于居中排列） */
  serverNodesWidth: number
  /** 左半区网络设备所需宽度（非对称分配） */
  leftHalfWidth: number
  /** 右半区网络设备所需宽度（非对称分配） */
  rightHalfWidth: number
  /** V2.4.5: 服务器区与顶部/底部网络设备的动态垂直间距（相等，确保服务器组居中） */
  verticalGap: number
}

export function calculateCanvasSize(
  serverAreaWidth: number,
  serverAreaHeight: number,
  hasBizCore: boolean,
  hasParamCore: boolean,
  hasStorageCore: boolean,
  networkNodeCounts?: {
    oobAgg?: number
    oobAccess?: number
    bizCore?: number
    bizAgg?: number
    bizAccess?: number
    paramLeaves?: number
    paramSpines?: number
    storageLeaves?: number
    storageSpines?: number
    paramCores?: number
    storageCores?: number
  },
): CanvasSize {
  // 顶部网络设备区高度（含 Y_AGG 顶部边距，确保 verticalGap 计算准确）
  const oobLayers = 2
  const bizLayers = hasBizCore ? 3 : 2
  const topLayers = Math.max(oobLayers, bizLayers)
  const topRegionHeight = Y_AGG + topLayers * LAYER_GAP

  // 底部网络设备区高度
  const paramBottomLayers = hasParamCore ? 3 : 2
  const storageBottomLayers = hasStorageCore ? 3 : 2
  const bottomLayers = Math.max(paramBottomLayers, storageBottomLayers)
  const bottomRegionHeight = bottomLayers * LAYER_GAP

  // V2.4.5: 计算左右半区网络设备所需宽度（不压缩间距）
  const counts = networkNodeCounts || {}
  const leftHalfNodes = Math.max(
    counts.oobAgg || 0,
    counts.oobAccess || 0,
    counts.paramLeaves || 0,
    counts.paramSpines || 0,
    counts.paramCores || 0,
  )
  const rightHalfNodes = Math.max(
    counts.bizCore || 0,
    counts.bizAgg || 0,
    counts.bizAccess || 0,
    counts.storageLeaves || 0,
    counts.storageSpines || 0,
    counts.storageCores || 0,
  )
  const leftHalfNeeded = leftHalfNodes > 0 ? (leftHalfNodes - 1) * NODE_SPACING : 0
  const rightHalfNeeded = rightHalfNodes > 0 ? (rightHalfNodes - 1) * NODE_SPACING : 0

  // V2.4.5: 服务器区"概念宽度"= max(实际服务器节点宽度, 网络设备区需要宽度)
  // 左右半区对称分配（以中心为界），确保左半区在中心左侧、右半区在中心右侧
  const maxHalfNeeded = Math.max(leftHalfNeeded, rightHalfNeeded)
  const networkNeededWidth = 2 * maxHalfNeeded + QUADRANT_GAP
  const effectiveServerAreaWidth = Math.max(serverAreaWidth, networkNeededWidth)

  // 对称分配：左右半区宽度相等
  const leftHalfWidth = (effectiveServerAreaWidth - QUADRANT_GAP) / 2
  const rightHalfWidth = leftHalfWidth

  // 画布宽度 = 服务器区概念宽度 + 左右 padding
  let width = effectiveServerAreaWidth + 2 * SIDE_PADDING
  let height = topRegionHeight + TOP_GAP + serverAreaHeight + BOTTOM_GAP + bottomRegionHeight

  // 16:9 比例自适应调整（需求10）
  const ratio = width / height
  const minRatio = TARGET_RATIO * (1 - RATIO_TOLERANCE)
  const maxRatio = TARGET_RATIO * (1 + RATIO_TOLERANCE)

  // 计算服务器区居中位置（左右对称，基于概念宽度）
  const computeServerAreaX = (w: number) => (w - effectiveServerAreaWidth) / 2

  if (ratio > maxRatio) {
    // 太宽 → 增加高度（顶部/底部留白）
    height = width / TARGET_RATIO
  } else if (ratio < minRatio) {
    // 太窄 → 增加左右 padding（服务器区概念宽度不变，节点居中）
    width = height * TARGET_RATIO
  } else if (width < MIN_CANVAS_W) {
    // 应用最小画布尺寸
    width = MIN_CANVAS_W
    height = Math.max(height, MIN_CANVAS_H)
  }

  // V2.4.5: 服务器区垂直居中，使上方/下方间距相等（解决服务器组不居中问题）
  // 上方空间 = topRegionHeight + 上方间距；下方空间 = bottomRegionHeight + 下方间距
  // 服务器区 Y = topRegionHeight + (可用高度 - 服务器区高度) / 2
  // 这样无论 topRegionHeight 与 bottomRegionHeight 是否相等，服务器区都垂直居中
  const availableVerticalSpace = height - topRegionHeight - bottomRegionHeight - serverAreaHeight
  const verticalGap = Math.max(TOP_GAP, availableVerticalSpace / 2)
  const serverAreaY = topRegionHeight + verticalGap

  return {
    width,
    height,
    serverAreaX: computeServerAreaX(width),
    serverAreaY,
    serverAreaWidth: effectiveServerAreaWidth,
    serverAreaHeight,
    serverCenterX: computeServerAreaX(width) + effectiveServerAreaWidth / 2,
    topRegionHeight,
    bottomRegionHeight,
    serverNodesWidth: serverAreaWidth,
    leftHalfWidth,
    rightHalfWidth,
    verticalGap,
  }
}

/* ================================================================
 *  Step 4: 布局服务器区
 * ================================================================ */

function layoutServerArea(
  pods: PodGroup[],
  dims: PodDimension[],
  originX: number,
  originY: number,
  effectiveWidth: number,
): { nodes: LayoutNode[]; podLayouts: LayoutPod[] } {
  const nodes: LayoutNode[] = []
  const podLayouts: LayoutPod[] = []

  // V2.4.5: 服务器节点在概念宽度内居中排列
  const podsTotalWidth = dims.reduce((sum, d) => sum + d.width, 0)
    + (dims.length > 1 ? (dims.length - 1) * POD_GAP : 0)
  const centerOffset = Math.max(0, (effectiveWidth - podsTotalWidth) / 2)
  let cursorX = originX + centerOffset

  for (let i = 0; i < pods.length; i++) {
    const pod = pods[i]
    const dim = dims[i]
    const podY = originY // 所有 POD 顶部对齐

    // 服务器网格排列
    pod.servers.forEach((node, idx) => {
      const row = Math.floor(idx / dim.cols)
      const col = idx % dim.cols
      nodes.push({
        id: node.id,
        x: cursorX + col * CELL_W,
        y: podY + row * CELL_H,
        type: node.type,
        layerHint: 'server',
        group: node.group,
        podid: pod.podid,
      })
    })

    podLayouts.push({
      podid: pod.podid,
      x: cursorX - 10,
      y: podY - 10,
      width: dim.width + 20,
      height: dim.height + 20,
      serverCount: pod.servers.length,
      accessCount: pod.oobAccess.length + pod.bizAccess.length,
      leafCount: pod.paramLeaves.length + pod.storageLeaves.length,
    })

    cursorX += dim.width + POD_GAP
  }

  return { nodes, podLayouts }
}

/* ================================================================
 *  Step 5: 布局顶部网络设备区（左上 OOB + 右上 业务）
 * ================================================================ */

function layoutTopRegion(
  networks: NetworkGroups,
  canvas: CanvasSize,
): LayoutNode[] {
  const nodes: LayoutNode[] = []

  // V2.4.5: 非对称左右半区范围
  const leftStart = canvas.serverAreaX
  const leftEnd = canvas.serverAreaX + canvas.leftHalfWidth
  const rightStart = leftEnd + QUADRANT_GAP
  const rightEnd = rightStart + canvas.rightHalfWidth

  // 左上：OOB Agg（L0）→ OOB Access（L1）
  const oobAggY = Y_AGG
  const oobAccessY = oobAggY + LAYER_GAP
  const oobAggResult = layoutRowCentered(networks.oobAgg, leftStart, leftEnd, oobAggY, NODE_SPACING)
  nodes.push(...oobAggResult.positions)
  const oobAccessResult = layoutRowCentered(networks.oobAccess, leftStart, leftEnd, oobAccessY, NODE_SPACING)
  nodes.push(...oobAccessResult.positions)

  // 右上：业务 Core（L0，如有）→ 业务 Agg（L1）→ 业务 Access（L2）
  let bizY = Y_CORE
  if (networks.bizCore.length > 0) {
    const result = layoutRowCentered(networks.bizCore, rightStart, rightEnd, bizY, NODE_SPACING)
    nodes.push(...result.positions)
    bizY += LAYER_GAP
  }
  if (networks.bizAgg.length > 0) {
    const result = layoutRowCentered(networks.bizAgg, rightStart, rightEnd, bizY, NODE_SPACING)
    nodes.push(...result.positions)
    bizY += LAYER_GAP
  }
  if (networks.bizAccess.length > 0) {
    const result = layoutRowCentered(networks.bizAccess, rightStart, rightEnd, bizY, NODE_SPACING)
    nodes.push(...result.positions)
  }

  return nodes
}

/* ================================================================
 *  Step 6: 布局底部网络设备区（左下 参数 + 右下 存储）
 * ================================================================ */

function layoutBottomRegion(
  networks: NetworkGroups,
  canvas: CanvasSize,
): LayoutNode[] {
  const nodes: LayoutNode[] = []
  const serverBottomY = canvas.serverAreaY + canvas.serverAreaHeight

  // V2.4.5: 使用动态 verticalGap（与顶部间距相等，确保服务器组垂直居中）
  const bottomGap = canvas.verticalGap

  // V2.4.5: 非对称左右半区范围
  const leftStart = canvas.serverAreaX
  const leftEnd = canvas.serverAreaX + canvas.leftHalfWidth
  const rightStart = leftEnd + QUADRANT_GAP
  const rightEnd = rightStart + canvas.rightHalfWidth

  // 左下：参数 Leaf（靠近服务器）→ 参数 Spine → 参数 Core（如有）
  let paramY = serverBottomY + bottomGap
  const paramLeafResult = layoutRowCentered(networks.paramLeaves, leftStart, leftEnd, paramY, NODE_SPACING)
  nodes.push(...paramLeafResult.positions)
  paramY += LAYER_GAP
  const paramSpineResult = layoutRowCentered(networks.paramSpines, leftStart, leftEnd, paramY, NODE_SPACING)
  nodes.push(...paramSpineResult.positions)
  if (networks.paramCores.length > 0) {
    paramY += LAYER_GAP
    const paramCoreResult = layoutRowCentered(networks.paramCores, leftStart, leftEnd, paramY, NODE_SPACING)
    nodes.push(...paramCoreResult.positions)
  }

  // 右下：存储 Leaf（靠近服务器）→ 存储 Spine → 存储 Core（如有）
  let storageY = serverBottomY + bottomGap
  const storageLeafResult = layoutRowCentered(networks.storageLeaves, rightStart, rightEnd, storageY, NODE_SPACING)
  nodes.push(...storageLeafResult.positions)
  storageY += LAYER_GAP
  const storageSpineResult = layoutRowCentered(networks.storageSpines, rightStart, rightEnd, storageY, NODE_SPACING)
  nodes.push(...storageSpineResult.positions)
  if (networks.storageCores.length > 0) {
    storageY += LAYER_GAP
    const storageCoreResult = layoutRowCentered(networks.storageCores, rightStart, rightEnd, storageY, NODE_SPACING)
    nodes.push(...storageCoreResult.positions)
  }

  return nodes
}

/* ================================================================
 *  主布局入口
 * ================================================================ */

/**
 * 服务器区中心化 + 四象限网络设备分区布局（V2.4.5）
 */
export function computeTopologyLayout(
  nodes: TopologyNode[],
  _edges: TopologyEdge[],
): LayoutResult {
  if (nodes.length === 0) {
    return { layoutNodes: [], pods: [], totalWidth: 0, totalHeight: 0 }
  }

  /* === Step 1: 按节点分组 === */
  const { pods, networks } = groupNodes(nodes)

  /* === Step 2: 计算服务器区尺寸 === */
  const { pods: dims, totalWidth: serverAreaWidth, maxHeight: serverAreaHeight } =
    calculateServerArea(pods)

  /* === Step 3: 计算画布尺寸（16:9 比例自适应 + 网络设备宽度）=== */
  const canvas = calculateCanvasSize(
    serverAreaWidth,
    serverAreaHeight,
    networks.bizCore.length > 0,
    networks.paramCores.length > 0,
    networks.storageCores.length > 0,
    {
      oobAgg: networks.oobAgg.length,
      oobAccess: networks.oobAccess.length,
      bizCore: networks.bizCore.length,
      bizAgg: networks.bizAgg.length,
      bizAccess: networks.bizAccess.length,
      paramLeaves: networks.paramLeaves.length,
      paramSpines: networks.paramSpines.length,
      storageLeaves: networks.storageLeaves.length,
      storageSpines: networks.storageSpines.length,
      paramCores: networks.paramCores.length,
      storageCores: networks.storageCores.length,
    },
  )

  /* === Step 4: 布局服务器区（V2.4.5: 服务器节点在概念宽度内居中）=== */
  const { nodes: serverNodes, podLayouts } = layoutServerArea(
    pods, dims, canvas.serverAreaX, canvas.serverAreaY, canvas.serverAreaWidth,
  )

  /* === Step 5: 布局顶部网络设备区 === */
  const topNodes = layoutTopRegion(networks, canvas)

  /* === Step 6: 布局底部网络设备区 === */
  const bottomNodes = layoutBottomRegion(networks, canvas)

  /* === 合并所有节点 === */
  const allNodes = [...topNodes, ...serverNodes, ...bottomNodes]

  return {
    layoutNodes: allNodes,
    pods: podLayouts,
    totalWidth: canvas.width,
    totalHeight: canvas.height,
  }
}

/* ================================================================
 *  POD 背景色配置
 * ================================================================ */

export const POD_BG_COLORS = [
  { fill: 'rgba(59,130,246,0.06)', fillDark: 'rgba(59,130,246,0.10)', border: 'rgba(59,130,246,0.25)' },
  { fill: 'rgba(16,185,129,0.06)', fillDark: 'rgba(16,185,129,0.10)', border: 'rgba(16,185,129,0.25)' },
  { fill: 'rgba(139,92,246,0.06)', fillDark: 'rgba(139,92,246,0.10)', border: 'rgba(139,92,246,0.25)' },
  { fill: 'rgba(245,158,11,0.06)', fillDark: 'rgba(245,158,11,0.10)', border: 'rgba(245,158,11,0.25)' },
  { fill: 'rgba(236,72,153,0.06)', fillDark: 'rgba(236,72,153,0.10)', border: 'rgba(236,72,153,0.25)' },
  { fill: 'rgba(14,165,233,0.06)', fillDark: 'rgba(14,165,233,0.10)', border: 'rgba(14,165,233,0.25)' },
  { fill: 'rgba(168,85,247,0.06)', fillDark: 'rgba(168,85,247,0.10)', border: 'rgba(168,85,247,0.25)' },
  { fill: 'rgba(34,197,94,0.06)', fillDark: 'rgba(34,197,94,0.10)', border: 'rgba(34,197,94,0.25)' },
]

export function getPodColor(index: number) {
  return POD_BG_COLORS[index % POD_BG_COLORS.length]
}
