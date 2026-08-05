/**
 * V3.1.3-T7-6: 共享设备选型规则测试（device-defaults.ts）
 *
 * 与 backend/device_defaults.py 保持同一套映射（双端一致性由本组断言守护）。
 */
import { describe, it, expect } from 'vitest'
import {
  IB_DEFAULTS_BY_GPU,
  ROCE_DEFAULTS,
  IB_DEFAULTS_FALLBACK,
  STORAGE_DEFAULTS_BY_PROTOCOL,
  BIZ_DEFAULTS,
  OOB_DEFAULTS,
  resolveIBDefaults,
  getDefaultRefs,
} from '@/utils/device-defaults'

describe('device-defaults 共享选型规则', () => {
  it('IB 按 GPU 世代：h100→MQM9700(400G)，b300/gb300→Q3400(800G)', () => {
    expect(IB_DEFAULTS_BY_GPU.h100_and_below.param_leaf_switch).toBe('nvidia_mqm9700_64_400g_ib')
    expect(IB_DEFAULTS_BY_GPU.b300.param_leaf_switch).toBe('nvidia_q3400_144_800g_ib')
    expect(IB_DEFAULTS_BY_GPU.gb300.param_leaf_switch).toBe('nvidia_q3400_144_800g_ib')
    expect(IB_DEFAULTS_FALLBACK).toEqual(IB_DEFAULTS_BY_GPU.h100_and_below)
  })

  it('RoCE 固定 H3C 系列', () => {
    expect(ROCE_DEFAULTS.param_leaf_switch).toBe('h3c_s9850_64h')
    expect(ROCE_DEFAULTS.param_spine_switch).toBe('h3c_s9820_64h')
  })

  it('存储按协议：IB→Quantum HDR(200G)，RoCE/UEC→华为 CE6881', () => {
    expect(STORAGE_DEFAULTS_BY_PROTOCOL.IB.storage_leaf_switch).toBe('nvidia_mqm8700_40_200g_ib')
    expect(STORAGE_DEFAULTS_BY_PROTOCOL.RoCE.storage_leaf_switch).toBe('huawei_ce6881_48s6cq')
    expect(STORAGE_DEFAULTS_BY_PROTOCOL.UEC).toEqual(STORAGE_DEFAULTS_BY_PROTOCOL.RoCE)
  })

  it('业务/带外固定默认', () => {
    expect(BIZ_DEFAULTS.biz_access_switch).toBe('h3c_s6850_56hf')
    expect(OOB_DEFAULTS.oob_access_switch).toBe('h3c_s5130s_52p_ei')
  })

  it('resolveIBDefaults 按 GPU id 解析世代', () => {
    expect(resolveIBDefaults(undefined)).toEqual(IB_DEFAULTS_FALLBACK)
    expect(resolveIBDefaults('nvidia_gb300_nvl72')).toBe(IB_DEFAULTS_BY_GPU.gb300)
    expect(resolveIBDefaults('nvidia_b200_8s')).toBe(IB_DEFAULTS_BY_GPU.b300)
    expect(resolveIBDefaults('nvidia_h100_8s')).toBe(IB_DEFAULTS_BY_GPU.h100_and_below)
  })

  it('getDefaultRefs 输出完整引用（IB + GB300）', () => {
    const refs = getDefaultRefs('IB', 'nvidia_gb300_nvl72')
    expect(refs.param_leaf_switch).toEqual({ library_id: 'nvidia_q3400_144_800g_ib' })
    expect(refs.storage_leaf_switch).toEqual({ library_id: 'nvidia_mqm8700_40_200g_ib' })
    expect(refs.biz_access_switch).toEqual({ library_id: 'h3c_s6850_56hf' })
    expect(refs.oob_agg_switch).toEqual({ library_id: 'h3c_s5120v3_52p_ei' })
    expect(Object.keys(refs)).toHaveLength(9)
  })

  it('getDefaultRefs RoCE 走 H3C', () => {
    const refs = getDefaultRefs('RoCE')
    expect(refs.param_leaf_switch).toEqual({ library_id: 'h3c_s9850_64h' })
    expect(refs.storage_leaf_switch).toEqual({ library_id: 'huawei_ce6881_48s6cq' })
  })
})
