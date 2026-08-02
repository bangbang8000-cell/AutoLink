/**
 * AutoLink V2.7.6-T9 — 3D 拓扑可视化 PoC (Proof of Concept)
 *
 * 技术选型: react-three-fiber + @react-three/drei
 *
 * 功能演示:
 *   - 将拓扑节点 (server/switch/gpu) 在 3D 空间中按 layerHint 分层摆放
 *     - Core 层: 最高 (y = 80)
 *     - Spine 层: y = 40
 *     - Leaf/Access 层: y = 0
 *     - Server/GPU 层: y = -40
 *   - 节点用不同颜色和几何体区分类型 (盒子=服务器/交换机, 八面体=GPU)
 *   - 连接用 Line 描绘,颜色按 networkType 区分
 *   - OrbitControls 支持鼠标旋转/缩放/平移
 *
 * 限制 (PoC):
 *   - 不支持节点拖拽 (3D 拖拽需 raycasting + drag plane, 暂未实现)
 *   - 大规模拓扑 (>500 节点) 性能未优化 (无 instancing)
 *   - 无小地图 (Minimap 在 3D 中需要单独渲染相机俯视图)
 *
 * 后续 (正式版):
 *   - 引入 InstancedMesh 提升大规模拓扑性能
 *   - 增加 Html overlay 显示节点标签 (drei Html 组件)
 *   - 支持节点点击高亮 + 邻居高亮
 *   - 增加 GizmoHelper 显示坐标系
 */
import { Suspense, useMemo, useRef, type ElementRef } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Line, Text, Box, Octahedron, Grid } from '@react-three/drei'
import { useTranslation } from 'react-i18next'
import { Box as BoxIcon, RotateCcw } from 'lucide-react'
import { useDesignStore, type TopologyNode, type TopologyEdge } from '@/stores/design.store'
import { useToastStore } from '@/stores/toast.store'
import { EDGE_COLORS } from './topology/TopologyNodes'

/* ---------- 布局常量 ---------- */

// 各层级 Y 坐标 (从上到下: Core → Spine → Leaf/Access → Server/GPU)
const LAYER_Y: Record<string, number> = {
  core: 80,
  spine: 40,
  leaf: 0,
  access: 0,
  agg: 20,
  server: -40,
  gpu: -40,
}

// 每层水平间距
const NODE_SPACING_X = 12
const NODE_SPACING_Z = 12

// 节点尺寸
const NODE_SIZE = { width: 6, height: 4, depth: 4 }

// 节点颜色 (与 2D 版本保持一致的色系)
const NODE_COLOR_MAP: Record<string, string> = {
  server: '#3B82F6',     // 蓝色
  param_leaf: '#3B82F6',
  param_spine: '#1D4ED8',
  param_core: '#1E3A8A',
  storage_leaf: '#10B981',
  storage_spine: '#047857',
  storage_core: '#064E3B',
  oob_access: '#6B7280',
  oob_agg: '#4B5563',
  biz_access: '#8B5CF6',
  biz_agg: '#6D28D9',
  gpu: '#F59E0B',        // 琥珀色 (Scale-Up)
}

/* ---------- 工具函数 ---------- */

function getLayerHint(node: TopologyNode): string {
  if (node.layerHint) return node.layerHint
  const t = node.type
  if (t === 'gpu') return 'gpu'
  if (t === 'server') return 'server'
  if (t.includes('core')) return 'core'
  if (t.includes('spine')) return 'spine'
  if (t.includes('leaf')) return 'leaf'
  if (t.includes('access')) return 'access'
  if (t.includes('agg')) return 'agg'
  return 'server'
}

/** 将节点按层级分组并计算 3D 位置 */
function computeNodePositions(nodes: TopologyNode[]): Map<string, [number, number, number]> {
  const positions = new Map<string, [number, number, number]>()
  const layerGroups: Record<string, TopologyNode[]> = {}

  for (const n of nodes) {
    const hint = getLayerHint(n)
    if (!layerGroups[hint]) layerGroups[hint] = []
    layerGroups[hint].push(n)
  }

  // 每层按矩形网格摆放
  for (const [hint, groupNodes] of Object.entries(layerGroups)) {
    const y = LAYER_Y[hint] ?? 0
    const count = groupNodes.length
    const cols = Math.ceil(Math.sqrt(count))
    const rows = Math.ceil(count / cols)
    const startX = -(cols - 1) * NODE_SPACING_X / 2
    const startZ = -(rows - 1) * NODE_SPACING_Z / 2

    groupNodes.forEach((node, idx) => {
      const col = idx % cols
      const row = Math.floor(idx / cols)
      const x = startX + col * NODE_SPACING_X
      const z = startZ + row * NODE_SPACING_Z
      positions.set(node.id, [x, y, z])
    })
  }

  return positions
}

/** 根据 networkType 获取边颜色 */
function getEdgeColor(edge: TopologyEdge): string {
  const nt = edge.networkType || ''
  if (nt === 'param') return EDGE_COLORS.param
  if (nt === 'storage') return EDGE_COLORS.storage
  if (nt === 'oob') return EDGE_COLORS.oob
  if (nt === 'biz') return EDGE_COLORS.biz
  if (nt === 'scale_up') return EDGE_COLORS.scale_up
  return '#9CA3AF'
}

/* ---------- 3D 节点组件 ---------- */

interface Node3DProps {
  node: TopologyNode
  position: [number, number, number]
  onClick?: () => void
}

function Node3D({ node, position, onClick }: Node3DProps) {
  const color = NODE_COLOR_MAP[node.type] || '#3B82F6'
  const isGpu = node.type === 'gpu'

  return (
    <group position={position} onClick={onClick}>
      {isGpu ? (
        // GPU 节点用八面体 (区别于服务器/交换机的盒子)
        <Octahedron args={[3, 0]}>
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.2} />
        </Octahedron>
      ) : (
        // 服务器/交换机用盒子
        <Box args={[NODE_SIZE.width, NODE_SIZE.height, NODE_SIZE.depth]}>
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.15} />
        </Box>
      )}
      {/* 节点标签 (悬浮在节点上方) */}
      <Text
        position={[0, 4, 0]}
        fontSize={2}
        color="#1F2937"
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.2}
        outlineColor="#FFFFFF"
      >
        {node.id.length > 16 ? node.id.slice(0, 14) + '...' : node.id}
      </Text>
    </group>
  )
}

/* ---------- 3D 边组件 ---------- */

interface Edge3DProps {
  start: [number, number, number]
  end: [number, number, number]
  color: string
}

function Edge3D({ start, end, color }: Edge3DProps) {
  return (
    <Line
      points={[start, end]}
      color={color}
      lineWidth={1}
      transparent
      opacity={0.5}
    />
  )
}

/* ---------- 主 3D 场景 ---------- */

function Topology3DScene() {
  const topology = useDesignStore((s) => s.topology)

  const nodePositions = useMemo(() => {
    if (!topology) return new Map<string, [number, number, number]>()
    return computeNodePositions(topology.nodes)
  }, [topology])

  const edges = useMemo(() => {
    if (!topology) return []
    return topology.edges.map((edge, idx) => {
      const start = nodePositions.get(edge.source)
      const end = nodePositions.get(edge.target)
      if (!start || !end) return null
      return { key: `edge-${idx}`, edge, start, end }
    }).filter(Boolean) as Array<{
      key: string
      edge: TopologyEdge
      start: [number, number, number]
      end: [number, number, number]
    }>
  }, [topology, nodePositions])

  if (!topology || topology.nodes.length === 0) {
    return null
  }

  return (
    <>
      {/* 灯光 */}
      <ambientLight intensity={0.6} />
      <directionalLight position={[50, 80, 50]} intensity={0.8} castShadow />
      <pointLight position={[-50, 50, -50]} intensity={0.4} />

      {/* 地面网格 */}
      <Grid
        args={[400, 400]}
        position={[0, -50, 0]}
        cellSize={10}
        cellThickness={0.5}
        cellColor="#D1D5DB"
        sectionSize={50}
        sectionThickness={1}
        sectionColor="#9CA3AF"
        fadeDistance={300}
        fadeStrength={1}
        infiniteGrid={false}
      />

      {/* 节点 */}
      {topology.nodes.map((node) => (
        <Node3D
          key={node.id}
          node={node}
          position={nodePositions.get(node.id) || [0, 0, 0]}
        />
      ))}

      {/* 连接 */}
      {edges.map(({ key, edge, start, end }) => (
        <Edge3D
          key={key}
          start={start}
          end={end}
          color={getEdgeColor(edge)}
        />
      ))}

      {/* 视角控制 */}
      <OrbitControls
        enablePan
        enableZoom
        enableRotate
        minDistance={20}
        maxDistance={400}
        maxPolarAngle={Math.PI / 2 + 0.3}
      />
    </>
  )
}

/* ---------- 主组件 ---------- */

export function Topology3DTab() {
  const { t } = useTranslation()
  const topology = useDesignStore((s) => s.topology)
  const addToast = useToastStore((s) => s.addToast)
  const controlsRef = useRef<ElementRef<typeof OrbitControls>>(null)

  const handleResetView = () => {
    if (controlsRef.current) {
      controlsRef.current.reset()
    }
    addToast('info', '视角已重置')
  }

  if (!topology || topology.nodes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-500 dark:text-gray-400 gap-3">
        <BoxIcon size={48} className="opacity-40" />
        <p className="text-sm">
          {t('workspace.noTopology', '请先生成拓扑设计以查看 3D 视图')}
        </p>
      </div>
    )
  }

  const nodeCount = topology.nodes.length
  const edgeCount = topology.edges.length

  return (
    <div className="relative w-full h-full bg-gradient-to-b from-blue-50 to-white dark:from-app-50 dark:to-app-elevated">
      {/* 顶部信息栏 */}
      <div className="absolute top-2 left-2 z-10 flex items-center gap-3 px-3 py-1.5 bg-white/80 dark:bg-app-elevated/80 backdrop-blur rounded-md shadow-sm border border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-1.5 text-xs text-gray-700 dark:text-gray-300">
          <BoxIcon size={12} />
          <span>3D PoC</span>
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400">
          节点: {nodeCount} | 连接: {edgeCount}
        </div>
        <button
          onClick={handleResetView}
          className="flex items-center gap-1 px-2 py-0.5 text-xs rounded border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300"
          title="重置视角"
        >
          <RotateCcw size={10} />
          重置
        </button>
      </div>

      {/* 图例 */}
      <div className="absolute top-2 right-2 z-10 px-3 py-2 bg-white/80 dark:bg-app-elevated/80 backdrop-blur rounded-md shadow-sm border border-gray-200 dark:border-gray-700">
        <div className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">
          图例
        </div>
        <div className="space-y-1">
          <LegendItem color={EDGE_COLORS.param} label="参数网" />
          <LegendItem color={EDGE_COLORS.storage} label="存储网" />
          <LegendItem color={EDGE_COLORS.biz} label="业务网" />
          <LegendItem color={EDGE_COLORS.oob} label="OOB" />
          <LegendItem color={EDGE_COLORS.scale_up} label="Scale-Up" />
        </div>
        <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700 space-y-1">
          <ShapeLegendItem shape="box" color="#3B82F6" label="服务器/交换机" />
          <ShapeLegendItem shape="octahedron" color={EDGE_COLORS.scale_up} label="GPU/NPU" />
        </div>
      </div>

      {/* 底部提示 */}
      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-10 px-3 py-1 bg-white/80 dark:bg-app-elevated/80 backdrop-blur rounded-md shadow-sm border border-gray-200 dark:border-gray-700">
        <span className="text-xs text-gray-500 dark:text-gray-400">
          鼠标左键旋转 · 右键平移 · 滚轮缩放
        </span>
      </div>

      {/* 3D Canvas */}
      <Canvas
        camera={{ position: [80, 60, 80], fov: 50, near: 0.1, far: 1000 }}
        shadows
        className="w-full h-full"
      >
        <Suspense fallback={<div className="h-full flex items-center justify-center text-sm text-gray-400 dark:text-gray-500">加载 3D 场景...</div>}>
          <Topology3DScene />
        </Suspense>
      </Canvas>
    </div>
  )
}

/* ---------- 图例子组件 ---------- */

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-3 h-0.5 rounded" style={{ backgroundColor: color }} />
      <span className="text-xs text-gray-600 dark:text-gray-400">{label}</span>
    </div>
  )
}

function ShapeLegendItem({
  shape,
  color,
  label,
}: {
  shape: 'box' | 'octahedron'
  color: string
  label: string
}) {
  return (
    <div className="flex items-center gap-1.5">
      {shape === 'box' ? (
        <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: color }} />
      ) : (
        <div
          className="w-2.5 h-2.5"
          style={{
            backgroundColor: color,
            transform: 'rotate(45deg)',
            clipPath: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)',
          }}
        />
      )}
      <span className="text-xs text-gray-600 dark:text-gray-400">{label}</span>
    </div>
  )
}

export default Topology3DTab
