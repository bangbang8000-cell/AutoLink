"""成本估算（V3.2.0-T9-1 TCO 全口径：硬件/电力/空间）

基于推荐拓扑（交换机规模）+ GPU 规模 + 单价参数，估算总拥有成本：
  - 硬件：参数网/存储网/业务网/OOB 交换机 + 网卡（双口）+ 光模块
  - 电力：GPU + 交换机功耗 → 年耗电 × 电价 × 年限
  - 空间：机柜数 × 单柜月成本（含制冷）× 年限

单价为默认参考值，可通过 params 覆盖（便于按实际询价校准）。
"""
import math
from typing import Optional

from .model_parser import ModelProfile
from .comm_calculator import CommRequirement
from .topology_recommender import TopologyRecommendation

# 默认单价/参数（USD）
DEFAULT_UNIT_PRICES = {
    # 网络硬件
    'leaf_price': 80000,          # 参数网 Leaf 交换机单价
    'spine_price': 150000,        # 参数网 Spine/Core 单价
    'storage_leaf_price': 40000,  # 存储网 Leaf 单价
    'biz_switch_price': 20000,    # 业务网交换机单价
    'oob_switch_price': 5000,     # OOB 管理交换机单价
    'nic_price': 600,             # 单口网卡单价
    'module_price': 400,          # 光模块单价
    # 电力
    'gpu_watts': 700,             # 单 GPU 功耗（W）
    'switch_watts': 800,          # 单台交换机功耗（W）
    'electricity_per_kwh': 0.8,   # 电价（USD/kWh）
    # 空间
    'gpu_per_rack': 8,            # 每机柜 GPU 数（8 卡机柜）
    'rack_monthly_cost': 1500,    # 单柜月成本（USD，含制冷/空间）
    # 周期
    'years': 3,                   # 估算年限
}


def _ceil_div(a: int, b: int) -> int:
    return math.ceil(a / b) if b > 0 else 0


def estimate_tco(model: ModelProfile, comm: CommRequirement,
                 rec: TopologyRecommendation, num_gpus: int,
                 params: Optional[dict] = None) -> dict:
    """TCO 全口径估算（V3.2.0-T9-1）

    返回 {total_usd, hardware{switches/nic/modules/subtotal}, power{kwh_per_year/subtotal},
          space{racks/subtotal}, breakdown[分项明细]}
    """
    p = {**DEFAULT_UNIT_PRICES, **(params or {})}
    years = int(p.get('years') or 3)

    # ---- 硬件规模推导（简化模型） ----
    # 参数网 Leaf：每 Leaf 64 口，每 GPU 1 个参数网下联口
    leaf_count = _ceil_div(num_gpus, 64)
    # 参数网 Spine：按收敛比推导上联口 → 每 Spine 提供 32 上联口
    conv = max(1.0, float(getattr(rec, 'convergence_ratio', 1.2) or 1.2))
    spine_count = _ceil_div(int(leaf_count * conv), 32)
    # 存储网 Leaf：每 GPU 1 个存储下联口（简化与参数网同规模）
    storage_leaf_count = _ceil_div(num_gpus, 64)
    # 业务网 + OOB：按规模分摊（每 128 GPU 一组）
    biz_count = _ceil_div(num_gpus, 128)
    oob_count = _ceil_div(num_gpus, 512)

    switches_total = leaf_count + spine_count + storage_leaf_count + biz_count + oob_count
    switch_cost = (
        leaf_count * p['leaf_price']
        + spine_count * p['spine_price']
        + storage_leaf_count * p['storage_leaf_price']
        + biz_count * p['biz_switch_price']
        + oob_count * p['oob_switch_price']
    )
    # 网卡：双口（参数 + 存储）
    nic_total = num_gpus * 2
    nic_cost = nic_total * p['nic_price']
    # 光模块：下联（参数 + 存储）+ 上联
    downlinks = num_gpus * 2
    uplinks = int(leaf_count * conv) + storage_leaf_count
    module_total = downlinks + uplinks
    module_cost = module_total * p['module_price']

    hardware_cost = switch_cost + nic_cost + module_cost

    # ---- 电力 ----
    gpu_power_kw = num_gpus * float(p['gpu_watts']) / 1000
    switch_power_kw = switches_total * float(p['switch_watts']) / 1000
    # 年耗电 = 功率 × 24h × 365d（含 PUE 1.3 系数）
    pue = 1.3
    kwh_per_year = (gpu_power_kw + switch_power_kw) * 24 * 365 * pue
    power_cost = kwh_per_year * float(p['electricity_per_kwh']) * years

    # ---- 空间 ----
    racks = _ceil_div(num_gpus, int(p.get('gpu_per_rack') or 8))
    space_cost = racks * float(p['rack_monthly_cost']) * 12 * years

    total = hardware_cost + power_cost + space_cost

    breakdown = [
        {'item': '参数网交换机', 'count': leaf_count + spine_count, 'subtotal': switch_cost},
        {'item': '存储/业务/OOB 交换机', 'count': storage_leaf_count + biz_count + oob_count,
         'subtotal': (storage_leaf_count * p['storage_leaf_price']
                      + biz_count * p['biz_switch_price'] + oob_count * p['oob_switch_price'])},
        {'item': '网卡', 'count': nic_total, 'subtotal': nic_cost},
        {'item': '光模块', 'count': module_total, 'subtotal': module_cost},
        {'item': f'电力（{years} 年）', 'count': round(kwh_per_year), 'subtotal': power_cost},
        {'item': f'机柜空间（{years} 年）', 'count': racks, 'subtotal': space_cost},
    ]

    return {
        'total_usd': round(total, 0),
        'hardware': {
            'switches': switches_total,
            'nic': nic_total,
            'modules': module_total,
            'subtotal_usd': round(hardware_cost, 0),
        },
        'power': {
            'kwh_per_year': round(kwh_per_year, 0),
            'subtotal_usd': round(power_cost, 0),
        },
        'space': {
            'racks': racks,
            'subtotal_usd': round(space_cost, 0),
        },
        'breakdown': breakdown,
    }
