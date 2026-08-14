"""共享设备选型规则（V3.1.3-T7-6，AI 侧）

与 src/utils/device-defaults.ts 保持同一套映射（修改需双端同步）：
  - 参数网 IB 按 GPU 世代：h100_and_below → MQM9700(400G) / b300、gb300 → Q3400(800G)
  - 参数网 RoCE → H3C 系列
  - 存储网按协议：IB → Quantum HDR(200G) / RoCE、UEC → 华为 CE6881
  - 业务网/带外网固定默认

供 device:defaults action / AIHUB 工具调用，使 LLM 回答设备选型时与向导默认一致。
"""

from __future__ import annotations

from typing import Dict, List

# IB 协议默认交换机（按 GPU 世代）
IB_DEFAULTS_BY_GPU: Dict[str, Dict[str, str]] = {
    # H100 and below (400G NDR era): three-tier all MQM9700
    'h100_and_below': {
        'param_leaf_switch': 'nvidia_mqm9700_64_400g_ib',
        'param_spine_switch': 'nvidia_mqm9700_64_400g_ib',
        'param_core_switch': 'nvidia_mqm9700_64_400g_ib',
    },
    # B200/B300 (800G NDR era): Leaf/Spine/Core 全系 Q3400(144口,支持 72 Leaf 下行 3-tier)
    'b300': {
        'param_leaf_switch': 'nvidia_q3400_144_800g_ib',
        'param_spine_switch': 'nvidia_q3400_144_800g_ib',
        'param_core_switch': 'nvidia_q3400_144_800g_ib',
    },
    # GB300 NVL72 (800G NDR, large scale): all Q3400
    'gb300': {
        'param_leaf_switch': 'nvidia_q3400_144_800g_ib',
        'param_spine_switch': 'nvidia_q3400_144_800g_ib',
        'param_core_switch': 'nvidia_q3400_144_800g_ib',
    },
}

# RoCE 协议默认交换机：H3C 系列（H1 纠错：原 S9850-64H/S9820-64H/S9820-8C 为 100G/框式误用，改真实 400G）
ROCE_DEFAULTS: Dict[str, str] = {
    'param_leaf_switch': 'h3c_s9825_64d',
    'param_spine_switch': 'h3c_s9827',
    'param_core_switch': 'h3c_s9827',
}

# 兜底 IB 默认（GPU 类型未知时）
IB_DEFAULTS_FALLBACK: Dict[str, str] = dict(IB_DEFAULTS_BY_GPU['h100_and_below'])

# 存储交换机按协议分流
STORAGE_DEFAULTS_BY_PROTOCOL: Dict[str, Dict[str, str]] = {
    # IB: 复用 Quantum HDR 交换机(IB 存储与参数面共用 Quantum 系列)
    'IB': {
        'storage_leaf_switch': 'nvidia_mqm8700_40_200g_ib',
        'storage_spine_switch': 'nvidia_mqm8700_40_200g_ib',
    },
    # RoCE: 专用存储接入交换机(ce6881,支持 RoCEv2/FC-NVMe)
    'RoCE': {
        'storage_leaf_switch': 'huawei_ce6881_48s6cq',
        'storage_spine_switch': 'huawei_ce6881_48s6cq',
    },
    # UEC: 基于以太网,存储接入与 RoCE 一致
    'UEC': {
        'storage_leaf_switch': 'huawei_ce6881_48s6cq',
        'storage_spine_switch': 'huawei_ce6881_48s6cq',
    },
}

# 已知的存储默认设备 ID（用于判断用户是否手动改过）
STORAGE_DEFAULT_IDS: List[str] = list(
    dict.fromkeys(
        list(STORAGE_DEFAULTS_BY_PROTOCOL['IB'].values())
        + list(STORAGE_DEFAULTS_BY_PROTOCOL['RoCE'].values())
    )
)

# 业务网默认交换机（D-1/D-2：BIZ_AGG=S9850-32H 100G 汇聚，BIZ_ACCESS=S6850-56HF 25G 接入）
BIZ_DEFAULTS: Dict[str, str] = {
    'biz_access_switch': 'h3c_s6850_56hf',
    'biz_agg_switch': 'h3c_s9850_32h',
}

# 带外管理网默认交换机（D-3：AGG=S6805-56HF-G，ACC=S5560X-54C-EI）
OOB_DEFAULTS: Dict[str, str] = {
    'oob_access_switch': 'h3c_s5560x_54c_ei',
    'oob_agg_switch': 'h3c_s6805_56hf_g',
}

# 全部设备引用键（按网络分组，供说明输出）
REF_KEY_GROUPS: Dict[str, List[str]] = {
    'param_network': ['param_leaf_switch', 'param_spine_switch', 'param_core_switch'],
    'storage_network': ['storage_leaf_switch', 'storage_spine_switch'],
    'biz_network': ['biz_access_switch', 'biz_agg_switch'],
    'oob_network': ['oob_access_switch', 'oob_agg_switch'],
}


def resolve_ib_defaults(gpu_library_id: str | None) -> Dict[str, str]:
    """按 GPU 设备库 id 解析 IB 默认交换机（gb300/nvl72 → 800G；b200/b300 → 800G；其余 → 400G）"""
    if not gpu_library_id:
        return IB_DEFAULTS_FALLBACK
    id_lower = gpu_library_id.lower()
    if 'gb300' in id_lower or 'nvl72' in id_lower:
        return IB_DEFAULTS_BY_GPU['gb300']
    if 'b200' in id_lower or 'b300' in id_lower:
        return IB_DEFAULTS_BY_GPU['b300']
    return IB_DEFAULTS_BY_GPU['h100_and_below']


def _normalize_protocol(protocol: str | None) -> str:
    """规范化协议键（大小写不敏感 → 与前端 ParamProtocol 一致的键：IB/RoCE/UEC）"""
    key = (protocol or 'IB').upper()
    return {'IB': 'IB', 'ROCE': 'RoCE', 'UEC': 'UEC'}.get(key, 'IB')


def get_device_defaults(protocol: str, gpu_library_id: str | None = None) -> Dict[str, str]:
    """生成完整默认设备引用（协议 + GPU 世代 → 全部交换机默认 refKey → 设备库 id）"""
    protocol = _normalize_protocol(protocol)

    refs: Dict[str, str] = {}

    # 参数网交换机（IB 按 GPU 世代 / RoCE 固定 H3C）
    param_defaults = resolve_ib_defaults(gpu_library_id) if protocol == 'IB' else ROCE_DEFAULTS
    refs.update(param_defaults)

    # 存储网按协议
    refs.update(STORAGE_DEFAULTS_BY_PROTOCOL[protocol])

    # 业务网 / 带外网固定默认
    refs.update(BIZ_DEFAULTS)
    refs.update(OOB_DEFAULTS)

    return refs


def defaults(params: dict) -> dict:
    """device:defaults action 主入口：返回共享选型规则（按协议 + GPU 可选）"""
    protocol = _normalize_protocol(params.get('protocol') or 'IB')
    gpu_library_id = params.get('gpu_library_id') or params.get('gpu') or None

    all_refs = get_device_defaults(protocol, gpu_library_id)

    # 分网络组织返回，便于 LLM/前端按组说明
    by_network: Dict[str, Dict[str, str]] = {}
    for network, keys in REF_KEY_GROUPS.items():
        by_network[network] = {k: all_refs[k] for k in keys if k in all_refs}

    return {
        'success': True,
        'protocol': protocol,
        'gpu_library_id': gpu_library_id,
        'device_refs': all_refs,
        'by_network': by_network,
        # V3.1.3-T7-6: 规则与前端向导共用同一份映射，LLM 作答需与之一致
        'shared_with_wizard': True,
        'note': '默认设备映射与向导一致，可作设备选型建议；用户已手动选择的设备不强制覆盖',
    }
