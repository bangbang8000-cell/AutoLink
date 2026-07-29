"""
AutoLink V2.4 — PUE 估算与收敛比计算引擎

PUE (Power Usage Effectiveness) = 数据中心总能耗 / IT 设备能耗
  - 风冷 PUE: 1.40-1.60
  - 冷板液冷 PUE: 1.20-1.30
  - 浸没式液冷 PUE: 1.08-1.20

收敛比 (Oversubscription Ratio) = 下行带宽 / 上行带宽
  - 参数网目标: 1:1（无阻塞）
  - 存储网目标: 1:1 ~ 2:1
  - 业务网目标: 3:1 ~ 4:1
"""
import math
from typing import Dict, List, Optional
from dataclasses import dataclass, field


@dataclass
class PUEInput:
    """PUE 估算输入参数"""
    it_power_kw: float               # IT 设备总功率 (kW)
    cooling_method: str = "air"      # 'air' | 'cold_plate' | 'immersion'
    outdoor_temp_c: float = 25.0     # 室外设计温度 (℃)
    load_factor: float = 0.8         # 负载率 (0-1)
    ups_efficiency: float = 0.96     # UPS 效率
    has_free_cooling: bool = True    # 是否支持自然冷


@dataclass
class PUEResult:
    """PUE 估算结果"""
    pue: float                       # 综合 PUE
    cooling_pue: float               # 制冷 PUE 分量
    power_distribution_pue: float    # 供配电 PUE 分量
    other_pue: float                 # 其他 PUE 分量
    total_power_kw: float            # 数据中心总功率 (kW)
    cooling_power_kw: float          # 制冷功率 (kW)
    ups_loss_kw: float               # UPS 损耗 (kW)
    estimated_cooling_method: str    # 建议散热方式
    meets_target: bool               # 是否满足 PUE < 1.25 目标
    recommendation: str              # 优化建议


def estimate_pue(inp: PUEInput) -> PUEResult:
    """
    PUE 估算
    基于散热方式、室外温度、负载率等参数估算数据中心 PUE
    """
    it_power = inp.it_power_kw

    # 1. 制冷 PUE 分量（取决于散热方式）
    if inp.cooling_method == "immersion":
        # 浸没式液冷：制冷效率极高
        cooling_pue = 1.08 + (inp.outdoor_temp_c - 25) * 0.002
        if inp.has_free_cooling:
            cooling_pue -= 0.02
    elif inp.cooling_method == "cold_plate":
        # 冷板液冷：部分液冷 + 部分风冷
        cooling_pue = 1.18 + (inp.outdoor_temp_c - 25) * 0.004
        if inp.has_free_cooling:
            cooling_pue -= 0.03
    else:
        # 风冷：传统精密空调
        cooling_pue = 1.35 + (inp.outdoor_temp_c - 25) * 0.008
        if inp.has_free_cooling:
            cooling_pue -= 0.08  # 自然冷对风冷提升明显

    # 负载率影响（低负载时 PUE 偏高）
    if inp.load_factor < 0.5:
        cooling_pue += (0.5 - inp.load_factor) * 0.3

    cooling_power = it_power * (cooling_pue - 1)

    # 2. 供配电 PUE 分量（UPS 损耗）
    power_distribution_pue = 1 + (1 - inp.ups_efficiency)
    ups_loss = it_power * (1 - inp.ups_efficiency)

    # 3. 其他 PUE 分量（照明、监控等）
    other_pue = 1.01

    # 综合 PUE
    total_pue = cooling_pue + (power_distribution_pue - 1) + (other_pue - 1)
    total_power = it_power * total_pue

    # 建议散热方式
    if it_power > 5000 and inp.cooling_method == "air":
        recommendation = "功率密度较高，建议升级为冷板液冷以降低 PUE 至 1.25 以下"
        estimated_method = "cold_plate"
    elif it_power > 10000 and inp.cooling_method != "immersion":
        recommendation = "功率密度极高，建议采用浸没式液冷以实现 PUE < 1.15"
        estimated_method = "immersion"
    elif total_pue > 1.25 and inp.cooling_method == "air":
        recommendation = "当前 PUE 超标，建议增加自然冷利用或升级液冷"
        estimated_method = inp.cooling_method
    else:
        recommendation = "PUE 达标"
        estimated_method = inp.cooling_method

    return PUEResult(
        pue=round(total_pue, 3),
        cooling_pue=round(cooling_pue, 3),
        power_distribution_pue=round(power_distribution_pue, 3),
        other_pue=round(other_pue, 3),
        total_power_kw=round(total_power, 1),
        cooling_power_kw=round(cooling_power, 1),
        ups_loss_kw=round(ups_loss, 1),
        estimated_cooling_method=estimated_method,
        meets_target=total_pue < 1.25,
        recommendation=recommendation,
    )


@dataclass
class ConvergenceResult:
    """收敛比计算结果"""
    network_type: str          # 网络类型
    downlink_bw_gbps: float    # 下行总带宽 (Gbps)
    uplink_bw_gbps: float      # 上行总带宽 (Gbps)
    convergence_ratio: float   # 收敛比 (下行/上行)
    is_blocking: bool          # 是否阻塞 (>1 为阻塞)
    target_ratio: float        # 目标收敛比
    meets_target: bool         # 是否满足目标
    recommendation: str        # 建议


def calc_convergence_ratio(
    network_type: str,
    leaf_downlink_ports: int,
    leaf_uplink_ports: int,
    port_speed_gbps: float,
    num_leaves: int = 1,
) -> ConvergenceResult:
    """
    计算收敛比
    收敛比 = 下行总带宽 / 上行总带宽
    """
    targets = {
        "param": 1.0,
        "storage": 2.0,
        "biz": 4.0,
        "oob": 8.0,
    }
    target = targets.get(network_type, 4.0)

    downlink_bw = leaf_downlink_ports * port_speed_gbps * num_leaves
    uplink_bw = leaf_uplink_ports * port_speed_gbps * num_leaves
    ratio = downlink_bw / uplink_bw if uplink_bw > 0 else float('inf')

    if ratio <= 1.0:
        rec = "无阻塞设计，满足全互联需求"
    elif ratio <= target:
        rec = f"收敛比 {ratio:.1f}:1 在目标范围内"
    else:
        rec = f"收敛比 {ratio:.1f}:1 超过目标 {target:.1f}:1，建议增加上行端口或减少下行接入"

    return ConvergenceResult(
        network_type=network_type,
        downlink_bw_gbps=round(downlink_bw, 1),
        uplink_bw_gbps=round(uplink_bw, 1),
        convergence_ratio=round(ratio, 2),
        is_blocking=ratio > 1.0,
        target_ratio=target,
        meets_target=ratio <= target,
        recommendation=rec,
    )


def estimate_cabinet_power_density(
    total_power_kw: float,
    num_cabinets: int,
    u_height_per_cabinet: int = 46,
) -> Dict:
    """
    估算机柜功率密度
    返回机柜功率密度评估结果
    """
    if num_cabinets == 0:
        return {"error": "机柜数量为 0"}

    power_per_cabinet = total_power_kw * 1000 / num_cabinets  # W/柜

    if power_per_cabinet <= 5000:
        cooling = "air"
        density = "低密度"
    elif power_per_cabinet <= 15000:
        cooling = "air"
        density = "中密度"
    elif power_per_cabinet <= 30000:
        cooling = "cold_plate"
        density = "高密度"
    elif power_per_cabinet <= 60000:
        cooling = "cold_plate"
        density = "超高密度"
    else:
        cooling = "immersion"
        density = "极限密度"

    return {
        "power_per_cabinet_w": round(power_per_cabinet, 0),
        "density_level": density,
        "recommended_cooling": cooling,
        "total_power_kw": round(total_power_kw, 1),
        "num_cabinets": num_cabinets,
        "avg_u_height": u_height_per_cabinet,
    }
