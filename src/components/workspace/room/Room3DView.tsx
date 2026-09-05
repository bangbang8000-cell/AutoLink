/**
 * AL v5.0.6「3D 可视化」— 机房 3D 视图（react-three-fiber）
 *
 * 与 2D 平面保持「同一 store，同一数据源」：
 *   - 位置：以 room.store 的 matrix（rows/cols/cells 的 row/col）为唯一事实来源，
 *     而不是再造一份状态；每个已上架机柜按矩阵格子的行列落位。
 *   - 朝向：按行号奇偶交替（偶数排朝 SE、奇数排朝经旋转与对面相向），铺开冷/热通道。
 *   - 热力：功率占比复用 getPowerColor 阈值（powerToHeatColor），无数据时中性灰。
 *   - 交互：点柜高亮（emissive + wireframe 放大）并联动 rack.store.selectCabinet +
 *     room.store.selectPosition（复用 RoomDesignTab 既有的 selectedPosition 联动导航到机柜设计）。
 *   - 导出：preserveDrawingBuffer 的 Canvas → toDataURL('image/png') 浏览器下载。
 *
 * 复用已有 3D 基础：仅使用 @react-three/fiber + @react-three/drei（与 Topology3DTab 同技术栈），
 * 机柜单体 3D/导出仍走既有 RackIsometricView 不变。
 */
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls, Grid } from '@react-three/drei'
import { useTranslation } from 'react-i18next'
import { Box as BoxIcon, Download } from 'lucide-react'
import { useRoomStore } from '@/stores/room.store'
import { useRackStore, type RackCabinet } from '@/stores/rack.store'
import { useToastStore } from '@/stores/toast.store'
import { makeTimestampedFilename } from '@/utils/exportSvg'
import {
  roomToWorld,
  powerToHeatColor,
  ROOM_CABINET_WIDTH,
  ROOM_CABINET_DEPTH,
  ROOM_U_HEIGHT,
} from '@/utils/room3d'

/** 机柜功率使用率（%），与 datacenter.computeLayout 口径一致 */
function cabinetUsagePercent(cabinet: RackCabinet): number {
  const used = cabinet.devices.reduce((s, d) => s + (d.power_watts || 0), 0)
  const limit = cabinet.power_limit || 6000
  return limit > 0 ? Math.round((used / limit) * 100) : 0
}

interface CabinetObject {
  ri: number
  ci: number
  position: string
  cabinet: RackCabinet
  percent: number
}

interface CabinetMeshProps {
  row: number
  col: number
  rowCount: number
  colCount: number
  cabinet: RackCabinet
  percent: number
  facingNorth: boolean
  selected: boolean
  onClick: () => void
}

/** 单个机柜：热力 Box + 朝向板 + 选中高亮 */
function CabinetMesh({
  row,
  col,
  rowCount,
  colCount,
  cabinet,
  percent,
  facingNorth,
  selected,
  onClick,
}: CabinetMeshProps) {
  const { x, z } = roomToWorld(row, col, rowCount, colCount)
  const color = powerToHeatColor(percent)
  const height = Math.max(0.5, (cabinet.totalU || 42) * ROOM_U_HEIGHT)
  // 行号奇偶交替朝向，形成对向排列（冷/热通道交替）
  const rotationY = facingNorth ? Math.PI : 0

  return (
    <group position={[x, height / 2, z]} rotation={[0, rotationY, 0]} onClick={onClick}>
      {/* 柜身 */}
      <mesh>
        <boxGeometry args={[ROOM_CABINET_WIDTH, height, ROOM_CABINET_DEPTH]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={selected ? 0.55 : 0.18}
          metalness={0.15}
          roughness={0.6}
        />
      </mesh>
      {/* 朝向板：正面中部竖向深色条，标识前面板方向 */}
      <mesh position={[0, 0, ROOM_CABINET_DEPTH / 2 + 0.02]}>
        <boxGeometry args={[ROOM_CABINET_WIDTH * 0.9, height * 0.92, 0.02]} />
        <meshStandardMaterial color="#1f2937" metalness={0.3} roughness={0.4} />
      </mesh>
      {/* 选中高亮：线框放大叠加 */}
      {selected && (
        <mesh scale={[1.06, 1.06, 1.06]}>
          <boxGeometry args={[ROOM_CABINET_WIDTH, height, ROOM_CABINET_DEPTH]} />
          <meshBasicMaterial color="#ec4899" wireframe transparent opacity={0.9} />
        </mesh>
      )}
    </group>
  )
}

/** 3D 场景（读取同一份 room.store / rack.store） */
function RoomScene() {
  const matrix = useRoomStore((s) => s.matrix)
  const cabinets = useRackStore((s) => s.cabinets)
  const selectedCabinetId = useRackStore((s) => s.selectedCabinetId)
  const selectCabinet = useRackStore((s) => s.selectCabinet)
  const selectPosition = useRoomStore((s) => s.selectPosition)

  const rowCount = matrix?.rows.length ?? 0
  const colCount = matrix?.cols.length ?? 0

  const rowIdx = useMemo(() => new Map((matrix?.rows ?? []).map((r, i) => [r, i])), [matrix])
  const colIdx = useMemo(() => new Map((matrix?.cols ?? []).map((c, i) => [c, i])), [matrix])
  const cabinetMap = useMemo(() => new Map(cabinets.map((c) => [c.id, c])), [cabinets])

  const objects = useMemo<CabinetObject[]>(() => {
    if (!matrix || rowCount === 0 || colCount === 0) return []
    const out: CabinetObject[] = []
    for (const cell of matrix.cells) {
      if (cell.cabinetId == null) continue
      const ri = rowIdx.get(cell.row)
      const ci = colIdx.get(cell.col)
      if (ri == null || ci == null) continue
      const cabinet = cabinetMap.get(cell.cabinetId)
      if (!cabinet) continue
      out.push({
        ri,
        ci,
        position: `${cell.row}${cell.col}`,
        cabinet,
        percent: cabinetUsagePercent(cabinet),
      })
    }
    return out
  }, [matrix, rowCount, colCount, rowIdx, colIdx, cabinetMap])

  const handleClick = (obj: CabinetObject) => {
    selectCabinet(obj.cabinet.id)
    // 复用 RoomDesignTab 的 selectedPosition 联动：有上架柜时选中并导航机柜设计
    selectPosition(obj.position)
  }

  return (
    <>
      <ambientLight intensity={0.55} />
      <directionalLight position={[60, 120, 80]} intensity={0.85} castShadow />
      <pointLight position={[-60, 60, -80]} intensity={0.35} />

      <Grid
        args={[400, 400]}
        position={[0, -0.05, 0]}
        cellSize={ROOM_CABINET_WIDTH}
        cellThickness={0.5}
        cellColor="#d1d5db"
        sectionSize={ROOM_CABINET_WIDTH * 5}
        sectionThickness={1}
        sectionColor="#9ca3af"
        fadeDistance={400}
        fadeStrength={1}
        infiniteGrid={false}
      />

      {objects.map((obj) => (
        <CabinetMesh
          key={`${obj.cabinet.id}-${obj.position}`}
          row={obj.ri}
          col={obj.ci}
          rowCount={rowCount}
          colCount={colCount}
          cabinet={obj.cabinet}
          percent={obj.percent}
          facingNorth={obj.ri % 2 === 1}
          selected={obj.cabinet.id === selectedCabinetId}
          onClick={() => handleClick(obj)}
        />
      ))}

      <OrbitControls
        enablePan
        enableZoom
        enableRotate
        minDistance={15}
        maxDistance={800}
        maxPolarAngle={Math.PI / 2 + 0.25}
        target={[0, 8, 0]}
      />
    </>
  )
}

/** 暴露底层的 WebGL canvas（供导出 PNG 用） */
function CanvasProbe({ onCanvas }: { onCanvas: (c: HTMLCanvasElement) => void }) {
  const dom = useThree((s) => s.gl.domElement)
  useEffect(() => {
    onCanvas(dom)
  }, [dom, onCanvas])
  return null
}

export function Room3DView() {
  const { t } = useTranslation()
  const addToast = useToastStore((s) => s.addToast)
  const matrix = useRoomStore((s) => s.matrix)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  const setCanvas = useCallback((c: HTMLCanvasElement) => {
    canvasRef.current = c
  }, [])

  const cabinetCount = useMemo(
    () => (matrix?.cells ?? []).filter((c) => c.cabinetId != null).length,
    [matrix],
  )

  const handleExport = () => {
    const canvas = canvasRef.current
    if (!canvas) {
      addToast('error', t('common:toast.exportFailed', { error: 'canvas 未就绪' }))
      return
    }
    try {
      const dataUrl = canvas.toDataURL('image/png')
      const a = document.createElement('a')
      a.href = dataUrl
      a.download = makeTimestampedFilename('机房3D', 'png')
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      addToast('success', t('common:toast.exportedToOutput', { filename: a.download }))
    } catch (err) {
      addToast('error', t('common:toast.exportFailed', { error: err instanceof Error ? err.message : 'PNG 导出失败' }))
    }
  }

  if (!matrix || matrix.rows.length === 0 || matrix.cols.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-500 dark:text-gray-400 gap-3">
        <BoxIcon size={48} className="opacity-40" />
        <p className="text-sm">{t('rack:needMatrixFirst', '请先定义机柜矩阵（排/列）')}</p>
      </div>
    )
  }

  return (
    <div className="relative w-full h-full bg-white dark:bg-app">
      {/* 顶部信息 + 导出 */}
      <div className="absolute top-2 left-2 z-10 flex items-center gap-3 px-3 py-1.5 bg-white/80 dark:bg-app-elevated/80 backdrop-blur rounded-md shadow-sm border border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-1.5 text-xs text-gray-700 dark:text-gray-300">
          <BoxIcon size={12} />
          <span>{t('rack:room.title', '机房')} 3D</span>
        </div>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {matrix.rows.length}×{matrix.cols.length} · 已上架 {cabinetCount}
        </span>
        <button
          onClick={handleExport}
          className="flex items-center gap-1 px-2 py-0.5 text-xs rounded border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300"
          title="导出 PNG"
        >
          <Download size={10} />
          {t('rack:exportPng', '导出 PNG')}
        </button>
      </div>

      {/* 底部提示 */}
      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-10 px-3 py-1 bg-white/80 dark:bg-app-elevated/80 backdrop-blur rounded-md shadow-sm border border-gray-200 dark:border-gray-700">
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {t('rack:isoViewHint', '鼠标左键旋转 · 右键平移 · 滚轮缩放 · 点击机柜查看')}
        </span>
      </div>

      <Canvas
        gl={{ preserveDrawingBuffer: true }}
        camera={{ position: [0, 110, 170], fov: 50, near: 0.1, far: 2000 }}
        shadows
        className="w-full h-full"
      >
        <RoomScene />
        <CanvasProbe onCanvas={setCanvas} />
      </Canvas>
    </div>
  )
}

export default Room3DView