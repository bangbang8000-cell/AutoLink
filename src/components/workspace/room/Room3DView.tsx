/**
 * AL v5.0.6「3D 可视化」— 机房 3D 视图（react-three-fiber）
 *
 * 与 2D 平面保持「同一 store，同一数据源」：
 *   - 位置：以 room.store 的 matrix（rows/cols/cells 的 row/col）为唯一事实来源，
 *     而不是再造一份状态；每个已上架机柜按矩阵格子的行列落位。
 *   - 尺寸（A20）：柜宽/柜深/柜高/排距全部读 matrix.geometry（米制），
 *     与平面 mm 逻辑坐标同源；行数取矩阵 rows.length。
 *   - 朝向：按行号奇偶交替（偶数排朝 SE、奇数排朝经旋转与对面相向），铺开冷/热通道。
 *   - 热力：功率占比复用 getPowerColor 阈值（powerToHeatColor），无数据时中性灰。
 *   - 交互：点柜高亮（emissive + wireframe 放大）并联动 rack.store.selectCabinet +
 *     room.store.selectPosition（复用 RoomDesignTab 既有的 selectedPosition 联动导航到机柜设计）。
 *   - 导出：preserveDrawingBuffer 的 Canvas → toDataURL('image/png') 浏览器下载。
 *
 * 复用已有 3D 基础：仅使用 @react-three/fiber + @react-three/drei（与 Topology3DTab 同技术栈），
 * 机柜单体 3D/导出仍走既有 RackIsometricView 不变。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls, Grid, Instances, Instance, Html } from '@react-three/drei'
import { useTranslation } from 'react-i18next'
import { Box as BoxIcon, Download, Lock, X } from 'lucide-react'
import { useRoomStore } from '@/stores/room.store'
import { useRackStore, RACK_TYPE_COLORS, type RackCabinet, type RackDevice } from '@/stores/rack.store'
import { useToastStore } from '@/stores/toast.store'
import { makeTimestampedFilename } from '@/utils/exportSvg'
import { resolveGeometry, type RoomGeometryData } from '@/utils/roomGeometry'
import {
  cameraForScale,
  roomSceneScale,
  roomToWorld,
  powerToHeatColor,
  uHeight,
  type RoomCameraParams,
  type RoomSceneScale,
} from '@/utils/room3d'
import { ROOM_3D_TOKENS } from '@/utils/room3dTokens'

/** 机柜功率使用率（%），与 datacenter.computeLayout 口径一致 */
function cabinetUsagePercent(cabinet: RackCabinet): number {
  const used = cabinet.devices.reduce((s, d) => s + (d.power_watts || 0), 0)
  const limit = cabinet.power_limit || 12000
  return limit > 0 ? Math.round((used / limit) * 100) : 0
}

interface CabinetObject {
  ri: number
  ci: number
  position: string
  cabinet: RackCabinet
  percent: number
}

interface PlaceholderObject {
  ri: number
  ci: number
  position: string
  kind: 'ac' | 'pillar'
}

/** 5.2.4-524-b（D11）：柜内设备清单面板条目 */
interface DeviceRow {
  name: string
  type: string
  startU: number
  endU: number
  power: number
}

/** 设备类型 → 面板标签 */
const DEVICE_TYPE_LABEL: Record<string, string> = {
  server: '服务器', gpu_server: 'GPU服务器', storage_server: '存储服务器',
  compute_server: '通算服务器', param_leaf: '参数Leaf', storage_leaf: '存储Leaf',
  oob_access: '带外接入', oob_agg: '带外汇聚', biz_access: '业务接入', biz_agg: '业务汇聚',
  combined_leaf: '融合Leaf', inference_leaf: '推理Leaf', scaleup_gpu: 'Scale-Up GPU',
}

/** 机柜类型 → 3D 柜身色（类型着色；保留功率热力条叠加） */
function cabinetColor(cabinet: RackCabinet): string {
  return RACK_TYPE_COLORS[cabinet.type]?.bg ?? ROOM_3D_TOKENS.cabinetFallback
}

/** 5.2.4-524-c：柜身 InstancedMesh（全部机柜一次 draw call，大场景流畅） */
function CabinetBodies({
  objects,
  rowCount,
  colCount,
  geo,
  onSelect,
}: {
  objects: CabinetObject[]
  rowCount: number
  colCount: number
  geo: RoomGeometryData
  onSelect: (obj: CabinetObject) => void
}) {
  const h = geo.cabinetHeight
  return (
    <Instances range={objects.length} castShadow>
      <boxGeometry args={[geo.cabinetWidth, 1, geo.cabinetDepth]} />
      <meshStandardMaterial metalness={0.18} roughness={0.55} />
      {objects.map((obj, i) => {
        const { x, z } = roomToWorld(obj.ri, obj.ci, rowCount, colCount, geo)
        return (
          <Instance
            key={`${obj.cabinet.id}-${i}`}
            position={[x, h / 2, z]}
            scale={[1, h, 1]}
            color={cabinetColor(obj.cabinet)}
            onClick={() => onSelect(obj)}
          />
        )
      })}
    </Instances>
  )
}

/** 5.2.4-524-b：柜内设备块（按 U 位堆叠，InstancedMesh 批量） */
function DeviceBlocks({
  objects,
  rowCount,
  colCount,
  geo,
}: {
  objects: CabinetObject[]
  rowCount: number
  colCount: number
  geo: RoomGeometryData
}) {
  const blocks = useMemo(() => {
    const out: Array<{ x: number; y: number; z: number; sy: number; color: string }> = []
    const uh = uHeight(geo)
    for (const obj of objects) {
      const { x, z } = roomToWorld(obj.ri, obj.ci, rowCount, colCount, geo)
      for (const dev of obj.cabinet.devices ?? []) {
        const hU = Math.max(1, (dev.endU ?? dev.startU) - (dev.startU ?? 0) + 1)
        const y = ((dev.startU ?? 1) - 1 + hU / 2) * uh
        out.push({
          x,
          y,
          z,
          sy: hU * uh,
          color: dev.type === 'server' ? ROOM_3D_TOKENS.serverBlock : ROOM_3D_TOKENS.switchBlock,
        })
      }
    }
    return out
  }, [objects, rowCount, colCount, geo])
  if (blocks.length === 0) return null
  return (
    <Instances range={blocks.length}>
      <boxGeometry args={[geo.cabinetWidth * 0.82, 1, geo.cabinetDepth * 0.9]} />
      <meshStandardMaterial metalness={0.25} roughness={0.5} />
      {blocks.map((b, i) => (
        <Instance key={i} position={[b.x, b.y, b.z]} scale={[1, b.sy, 1]} color={b.color} />
      ))}
    </Instances>
  )
}

/** 5.2.4-524-b：占位体（空调圆柱 / 立柱方柱，按矩阵格子位置渲染） */
function PlaceholderMeshes({
  placeholders,
  rowCount,
  colCount,
  geo,
}: {
  placeholders: PlaceholderObject[]
  rowCount: number
  colCount: number
  geo: RoomGeometryData
}) {
  return (
    <>
      {placeholders.map((p, i) => {
        const { x, z } = roomToWorld(p.ri, p.ci, rowCount, colCount, geo)
        const isAc = p.kind === 'ac'
        const h = geo.cabinetHeight + (isAc ? 0.2 : 0)
        return (
          <group key={`ph-${p.position}-${i}`} position={[x, h / 2, z]}>
            {isAc ? (
              <mesh castShadow>
                <cylinderGeometry args={[geo.cabinetWidth * 0.42, geo.cabinetWidth * 0.42, h, 16]} />
                <meshStandardMaterial color={ROOM_3D_TOKENS.acBody} metalness={0.4} roughness={0.4} />
              </mesh>
            ) : (
              <mesh castShadow>
                <boxGeometry args={[geo.cabinetWidth * 0.3, h, geo.cabinetDepth * 0.3]} />
                <meshStandardMaterial color={ROOM_3D_TOKENS.pillarBody} metalness={0.2} roughness={0.7} />
              </mesh>
            )}
            {/* 占位标签 */}
            <Html center position={[0, h / 2 + 0.2, 0]} style={{ pointerEvents: 'none' }}>
              <div className="text-[10px] px-1 rounded bg-white/80 dark:bg-gray-800/80 text-gray-600 dark:text-gray-300 whitespace-nowrap">
                {isAc ? '空调' : '立柱'}
              </div>
            </Html>
          </group>
        )
      })}
    </>
  )
}

interface CabinetMeshProps {
  row: number
  col: number
  rowCount: number
  colCount: number
  geo: RoomGeometryData
  cabinet: RackCabinet
  percent: number
  facingNorth: boolean
  selected: boolean
  onClick: () => void
}

/** 5.2.4-524-b：选中柜高亮线框 + 名称标签 + 功率热力条（叠加在 Instanced 柜身上） */
function CabinetOverlay({
  row,
  col,
  rowCount,
  colCount,
  geo,
  cabinet,
  percent,
  facingNorth,
  selected,
  onClick,
}: CabinetMeshProps) {
  const { x, z } = roomToWorld(row, col, rowCount, colCount, geo)
  const height = geo.cabinetHeight
  const rotationY = facingNorth ? Math.PI : 0
  const heatColor = powerToHeatColor(percent)

  return (
    <group position={[x, height / 2, z]} rotation={[0, rotationY, 0]} onClick={onClick}>
      {/* 朝向板：正面中部竖向深色条，标识前面板方向 */}
      <mesh position={[0, 0, geo.cabinetDepth / 2 + 0.02]}>
        <boxGeometry args={[geo.cabinetWidth * 0.9, height * 0.92, 0.02]} />
        <meshStandardMaterial color={ROOM_3D_TOKENS.frontPanel} metalness={0.3} roughness={0.4} />
      </mesh>
      {/* 功率热力条：柜身顶部细条（绿→黄→红，复用 2D 口径） */}
      <mesh position={[0, height / 2 + 0.03, 0]}>
        <boxGeometry args={[geo.cabinetWidth * 0.98, 0.06, geo.cabinetDepth * 0.98]} />
        <meshBasicMaterial color={heatColor} />
      </mesh>
      {/* 选中高亮：线框放大叠加 */}
      {selected && (
        <mesh scale={[1.06, 1.06, 1.06]}>
          <boxGeometry args={[geo.cabinetWidth, height, geo.cabinetDepth]} />
          <meshBasicMaterial color={ROOM_3D_TOKENS.selectionWireframe} wireframe transparent opacity={0.9} />
        </mesh>
      )}
      {/* 5.2.4-524-b：名称标签（Html overlay，始终朝向相机） */}
      <Html center position={[0, height / 2 + 0.35, 0]} style={{ pointerEvents: 'none' }}>
        <div
          className={`text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap shadow-sm border ${
            selected
              ? 'bg-pink-500/90 text-white border-pink-400'
              : 'bg-white/85 dark:bg-gray-800/85 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-gray-600'
          }`}
        >
          {cabinet.name}
        </div>
      </Html>
    </group>
  )
}

/** 3D 场景（读取同一份 room.store / rack.store） */
function RoomScene({
  geo,
  scale,
  camera,
}: {
  geo: RoomGeometryData
  scale: RoomSceneScale
  camera: RoomCameraParams
}) {
  const matrix = useRoomStore((s) => s.matrix)
  const cabinets = useRackStore((s) => s.cabinets)
  const selectedCabinetId = useRackStore((s) => s.selectedCabinetId)
  const selectCabinet = useRackStore((s) => s.selectCabinet)
  const selectPosition = useRoomStore((s) => s.selectPosition)
  // 5.2.4-524-b（D11）：设备清单面板目标
  const [panelCabinetId, setPanelCabinetId] = useState<number | null>(null)

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

  // 5.2.4-524-b：占位体（空调/立柱）
  const placeholders = useMemo<PlaceholderObject[]>(() => {
    if (!matrix) return []
    const out: PlaceholderObject[] = []
    for (const cell of matrix.cells) {
      if (!cell.placeholder) continue
      const ri = rowIdx.get(cell.row)
      const ci = colIdx.get(cell.col)
      if (ri == null || ci == null) continue
      out.push({ ri, ci, position: `${cell.row}${cell.col}`, kind: cell.placeholder as 'ac' | 'pillar' })
    }
    return out
  }, [matrix, rowIdx, colIdx])

  const handleClick = (obj: CabinetObject) => {
    selectCabinet(obj.cabinet.id)
    // 复用 RoomDesignTab 的 selectedPosition 联动：有上架柜时选中并导航机柜设计
    selectPosition(obj.position)
    // 5.2.4-524-b（D11）：点击弹出设备清单面板
    setPanelCabinetId(obj.cabinet.id)
  }

  // 5.2.4-524-b（D11）：设备清单面板条目
  const panelRows = useMemo<DeviceRow[]>(() => {
    const cab = cabinetMap.get(panelCabinetId ?? -1)
    if (!cab) return []
    return (cab.devices ?? []).map((d: RackDevice) => ({
      name: d.name,
      type: DEVICE_TYPE_LABEL[d.type] || d.type || '设备',
      startU: d.startU ?? 1,
      endU: d.endU ?? d.startU ?? 1,
      power: d.power_watts ?? 0,
    }))
  }, [panelCabinetId, cabinetMap])

  return (
    <>
      <ambientLight intensity={0.55} />
      <directionalLight
        position={[scale.span * 0.5, scale.span * 1.0, scale.span * 0.66]}
        intensity={0.85}
        castShadow
      />
      <pointLight position={[-scale.span * 0.5, scale.span * 0.5, -scale.span * 0.66]} intensity={0.35} />

      {/* 网格尺度随 geometry 联动（cellSize = 柜宽，sectionSize = 5 柜） */}
      <Grid
        args={[scale.span * 3, scale.span * 3]}
        position={[0, -0.01, 0]}
        cellSize={geo.cabinetWidth}
        cellThickness={0.5}
        cellColor={ROOM_3D_TOKENS.gridCell}
        sectionSize={geo.cabinetWidth * 5}
        sectionThickness={1}
        sectionColor={ROOM_3D_TOKENS.gridSection}
        fadeDistance={scale.span * 3}
        fadeStrength={1}
        infiniteGrid={false}
      />

      {/* 5.2.4-524-c：柜身 InstancedMesh（一次 draw call） */}
      <CabinetBodies objects={objects} rowCount={rowCount} colCount={colCount} geo={geo} onSelect={handleClick} />
      {/* 5.2.4-524-b：柜内设备块（按 U 位，InstancedMesh） */}
      <DeviceBlocks objects={objects} rowCount={rowCount} colCount={colCount} geo={geo} />
      {/* 5.2.4-524-b：空调/立柱占位体 */}
      <PlaceholderMeshes placeholders={placeholders} rowCount={rowCount} colCount={colCount} geo={geo} />

      {/* 5.2.4-524-b：名称标签/朝向板/功率热力条/选中高亮（逐柜叠加） */}
      {objects.map((obj) => (
        <CabinetOverlay
          key={`${obj.cabinet.id}-${obj.position}`}
          row={obj.ri}
          col={obj.ci}
          rowCount={rowCount}
          colCount={colCount}
          geo={geo}
          cabinet={obj.cabinet}
          percent={obj.percent}
          facingNorth={obj.ri % 2 === 1}
          selected={obj.cabinet.id === selectedCabinetId}
          onClick={() => handleClick(obj)}
        />
      ))}

      {/* 5.2.4-524-b（D11）：设备清单面板（Html overlay，字段 = 设备名/类型/U位/功率） */}
      {panelCabinetId != null && (
        <Html position={[0, 0, 0]} style={{ pointerEvents: 'none' }} zIndexRange={[100, 0]}>
          <div
            className="w-64 max-h-72 overflow-auto rounded-lg bg-white/95 dark:bg-gray-900/95 shadow-xl border border-gray-200 dark:border-gray-700"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-700 text-xs font-medium text-gray-800 dark:text-gray-100">
              <span>{cabinetMap.get(panelCabinetId)?.name ?? '机柜'}</span>
              <button
                type="button"
                onClick={() => setPanelCabinetId(null)}
                className="p-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400"
              >
                <X size={12} />
              </button>
            </div>
            {panelRows.length === 0 ? (
              <div className="px-3 py-4 text-xs text-gray-400 text-center">该机柜暂无设备</div>
            ) : (
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-gray-50 dark:bg-gray-800">
                  <tr className="text-left text-gray-500 dark:text-gray-400">
                    <th className="px-2 py-1">设备</th>
                    <th className="px-2 py-1">类型</th>
                    <th className="px-2 py-1">U位</th>
                    <th className="px-2 py-1">功率</th>
                  </tr>
                </thead>
                <tbody>
                  {panelRows.map((d, i) => (
                    <tr key={`${d.name}-${i}`} className="border-t border-gray-100 dark:border-gray-800">
                      <td className="px-2 py-1 font-mono text-gray-700 dark:text-gray-200">{d.name}</td>
                      <td className="px-2 py-1 text-gray-500">{d.type}</td>
                      <td className="px-2 py-1 text-gray-500">{d.startU}-{d.endU}U</td>
                      <td className="px-2 py-1 text-gray-500">{d.power}W</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Html>
      )}

      <OrbitControls
        enablePan
        enableZoom
        enableRotate
        minDistance={camera.minDistance}
        maxDistance={camera.maxDistance}
        maxPolarAngle={Math.PI / 2 + 0.25}
        target={camera.target}
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

  // A20：3D 与平面共用同一份 geometry（柜宽/柜深/柜高/通道宽），行数取矩阵 rows
  const geo = useMemo(() => resolveGeometry(matrix), [matrix])
  const sceneScale = useMemo(
    () => roomSceneScale(geo, matrix?.rows.length ?? 0, matrix?.cols.length ?? 0),
    [geo, matrix],
  )
  const camera = useMemo(() => cameraForScale(sceneScale), [sceneScale])

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

      {/* FR-A29（B5-06）：3D 只读态显式标注——本轮不做 3D 拖拽（FR-A28 关闭），
          避免用户在 3D 中尝试拖拽无响应 */}
      <div
        data-testid="room3d-readonly-badge"
        className="absolute top-2 right-2 z-10 flex items-center gap-1 px-2 py-1 bg-warning-50/90 dark:bg-warning-900/30 backdrop-blur rounded-md shadow-sm border border-warning-300 dark:border-warning-700"
      >
        <Lock size={10} className="text-warning-600 dark:text-warning-400" />
        <span className="text-xs text-warning-700 dark:text-warning-300">
          {t('rack:room3dReadonly', '只读预览 · 编辑请切 2D')}
        </span>
      </div>

      {/* 底部提示 */}
      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-10 px-3 py-1 bg-white/80 dark:bg-app-elevated/80 backdrop-blur rounded-md shadow-sm border border-gray-200 dark:border-gray-700">
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {t('rack:isoViewHint', '鼠标左键旋转 · 右键平移 · 滚轮缩放 · 点击机柜查看')}
        </span>
      </div>

      <Canvas
        gl={{ preserveDrawingBuffer: true }}
        camera={{ position: camera.position, fov: 50, near: 0.05, far: camera.far }}
        shadows
        className="w-full h-full"
      >
        <RoomScene geo={geo} scale={sceneScale} camera={camera} />
        <CanvasProbe onCanvas={setCanvas} />
      </Canvas>
    </div>
  )
}

export default Room3DView