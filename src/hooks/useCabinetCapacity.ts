/**
 * B1-09~B1-11 / FR-A07~A09：柜数容量单一来源（三处同源）。
 *
 * 规划阶段容量建议卡（WorkbenchTab aidc 子视图）与机房设计差额状态条（RoomDesignTab）
 * 必须读取同一次估算结果，禁止各自重算：本 hook 内 `estimateCabinetDemand`
 * 与 `checkRackFeasibility` 共用同一份设备清单与同一组柜参数，
 * 且 `estimate.totalCabinets === feasibility.requiredCabinets`（均由 `packCabinetsByType` 产出）。
 *
 * 纯读：不写 store、不落盘。
 */
import { useMemo } from 'react'
import {
  estimateCabinetDemand,
  type CabinetDemandDevice,
  type CabinetDemandEstimate,
  type CabinetPackingOptions,
} from '@/utils/cabinetDemand'
import { checkRackFeasibility, type RackFeasibilityResult } from '@/utils/rackFeasibility'
import type { RoomMatrixData } from '@/stores/room.store'

export interface CabinetCapacityParams {
  /** 设备清单（通常为设计拓扑节点）；为空时不产出估算（型号未定不给值） */
  devices: CabinetDemandDevice[] | null | undefined
  /** 机房矩阵；为 null 时只产出估算、不产出预检 */
  matrix?: RoomMatrixData | null
  topReservedU?: number
  gpuPerCabinet?: number
  powerLimit?: number
  perRowBasis?: number
  marginRatio?: number
  areaPerCabinetSqm?: number
}

export interface CabinetCapacityResult {
  estimate: CabinetDemandEstimate
  feasibility: RackFeasibilityResult | null
}

export function useCabinetCapacity({
  devices,
  matrix,
  topReservedU,
  gpuPerCabinet,
  powerLimit,
  perRowBasis,
  marginRatio,
  areaPerCabinetSqm,
}: CabinetCapacityParams): CabinetCapacityResult | null {
  return useMemo(() => {
    if (!devices || devices.length === 0) return null
    const packOpts: CabinetPackingOptions = {
      ...(topReservedU != null ? { topReservedU } : {}),
      ...(gpuPerCabinet != null ? { gpuPerCabinet } : {}),
      ...(powerLimit != null ? { powerLimit } : {}),
    }
    const estimate = estimateCabinetDemand(devices, {
      ...packOpts,
      ...(perRowBasis != null ? { perRowBasis } : {}),
      ...(marginRatio != null ? { marginRatio } : {}),
      ...(areaPerCabinetSqm != null ? { areaPerCabinetSqm } : {}),
    })
    const feasibility = matrix ? checkRackFeasibility(matrix, devices, packOpts) : null
    return { estimate, feasibility }
  }, [devices, matrix, topReservedU, gpuPerCabinet, powerLimit, perRowBasis, marginRatio, areaPerCabinetSqm])
}
