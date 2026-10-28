/**
 * B1-05 / FR-A01：预检「同输入同输出」契约（前端侧）。
 *
 * 与 backend/tests/backend/test_rack_feasibility.py 共读同一份夹具
 * `fixtures/rackFeasibilityContract.json`：同一矩阵 + 同一设备清单 + 同一参数，
 * 前后端结论必须逐字段一致（含建议文案逐字），任何一侧改动而另一侧未跟随即红。
 */
import { describe, expect, it } from 'vitest'

import contract from './fixtures/rackFeasibilityContract.json'
import { checkRackFeasibility } from '@/utils/rackFeasibility'
import type { CabinetDemandDevice } from '@/utils/cabinetDemand'
import type { RoomMatrixData } from '@/stores/room.store'

interface MatrixSpec {
  rows: number
  cols: number
  fill?: { type: string; count: number }[]
}

interface DeviceSpec {
  idPrefix: string
  count: number
  type: string
  domain: string
  group: string
  uHeight: number
  powerWatts: number
}

interface ContractCase {
  name: string
  matrix: MatrixSpec
  devices: DeviceSpec[]
  opts: Record<string, number>
  expected: unknown
}

const CASES = (contract as unknown as { cases: ContractCase[] }).cases

/** 行优先铺格：fill 依次占用格子，未铺到的为 empty */
function buildMatrix(spec: MatrixSpec): RoomMatrixData {
  const rows = Array.from({ length: spec.rows }, (_, i) => String.fromCharCode(65 + i))
  const cols = Array.from({ length: spec.cols }, (_, i) => i + 1)
  const flat: string[] = []
  for (const seg of spec.fill ?? []) {
    for (let i = 0; i < seg.count; i += 1) flat.push(seg.type)
  }
  const cells = []
  let index = 0
  for (const row of rows) {
    for (const col of cols) {
      cells.push({ row, col, type: flat[index] ?? 'empty', placeholder: null, cabinetId: null })
      index += 1
    }
  }
  return { schemaVersion: 1, name: '契约矩阵', rows, cols, cells }
}

function expandDevices(specs: DeviceSpec[]): CabinetDemandDevice[] {
  const devices: CabinetDemandDevice[] = []
  for (const spec of specs) {
    for (let i = 0; i < spec.count; i += 1) {
      devices.push({
        id: `${spec.idPrefix}-${i + 1}`,
        type: spec.type,
        domain: spec.domain,
        group: spec.group,
        uHeight: spec.uHeight,
        powerWatts: spec.powerWatts,
      })
    }
  }
  return devices
}

describe('B1-05 预检契约：前端与后端逐字段一致', () => {
  it('夹具至少覆盖「拒绝 / 通过 / 多缺口」三态', () => {
    expect(CASES.length).toBeGreaterThanOrEqual(3)
  })

  for (const testCase of CASES) {
    it(testCase.name, () => {
      const result = checkRackFeasibility(
        buildMatrix(testCase.matrix),
        expandDevices(testCase.devices),
        testCase.opts,
      )
      expect(result).toEqual(testCase.expected)
    })
  }
})
