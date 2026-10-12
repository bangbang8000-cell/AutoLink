"""5.4.12-F54-12-4（P3.5）：内置设备配置自检项（示范检查项模型 + TextFSM 消费）。

这些检查是"最小可用"起点，后续按模板族扩充；每个检查返回 0..n 个 CheckResult。
CheckResult 字段序：check_id / name / severity / ok / message / detail / suggestion。
"""
from __future__ import annotations

from typing import List

from .core import CheckItem, CheckResult, SEV_ERROR, SEV_WARN, collect_lines
from .textfsm_mini import MiniTextFSM

_HOSTNAME_TEMPLATE = """Value HOSTNAME (\\S+)

Start
  ^hostname\\s+${HOSTNAME} -> Record
"""

_INTERFACE_MTU_TEMPLATE = """Value INTERFACE (\\S+)
Value MTU (\\d+)

Start
  ^interface\\s+${INTERFACE}
  ^\\s*mtu\\s+${MTU} -> Record
"""

_DUPLEX_TEMPLATE = """Value INTERFACE (\\S+)
Value DUPLEX (\\S+)

Start
  ^interface\\s+${INTERFACE}
  ^\\s*duplex\\s+${DUPLEX} -> Record
"""


def check_hostname(config_text: str) -> List[CheckResult]:
    """主机名存在性：缺失 → error。"""
    records = MiniTextFSM(_HOSTNAME_TEMPLATE).parse(config_text)
    hostname = records[0].get("HOSTNAME", "") if records else ""
    if hostname:
        return [
            CheckResult("hostname-present", "主机名已配置", SEV_ERROR, True, f"hostname {hostname}")
        ]
    return [
        CheckResult(
            "hostname-present",
            "主机名已配置",
            SEV_ERROR,
            False,
            "未找到 hostname 指令",
            suggestion="在全局视图配置 hostname <设备名>",
        )
    ]


def check_interface_mtu_consistency(config_text: str) -> List[CheckResult]:
    """接口 MTU 一致性：同一台设备 MTU 取值漂移 → warn。"""
    records = MiniTextFSM(_INTERFACE_MTU_TEMPLATE).parse(config_text)
    mtus = {r["MTU"] for r in records if r.get("MTU")}
    if len(mtus) <= 1:
        return [
            CheckResult(
                "interface-mtu-consistency",
                "接口 MTU 一致性",
                SEV_WARN,
                True,
                f"MTU 取值一致: {sorted(mtus) if mtus else '未配置'}",
            )
        ]
    return [
        CheckResult(
            "interface-mtu-consistency",
            "接口 MTU 一致性",
            SEV_WARN,
            False,
            f"检测到 {len(mtus)} 种 MTU: {sorted(mtus)}",
            suggestion="建议统一接口 MTU，避免分片与丢包",
        )
    ]


def check_duplex_mode(config_text: str) -> List[CheckResult]:
    """双工模式：显式配置 half/full 而非 auto → warn（最佳实践）。"""
    records = MiniTextFSM(_DUPLEX_TEMPLATE).parse(config_text)
    non_auto = [r for r in records if r.get("DUPLEX", "").lower() != "auto"]
    if not non_auto:
        return [
            CheckResult(
                "duplex-mode-auto", "接口双工模式", SEV_WARN, True, "未发现显式非 auto 双工配置"
            )
        ]
    return [
        CheckResult(
            "duplex-mode-auto",
            "接口双工模式",
            SEV_WARN,
            False,
            f"{len(non_auto)} 个接口显式配置双工: " + ", ".join(f"{r['INTERFACE']}={r['DUPLEX']}" for r in non_auto[:5]),
            suggestion="推荐使用 auto 协商；确需固定时保持收发端一致",
        )
    ]


def check_acl_logging(config_text: str) -> List[CheckResult]:
    """ACL 安全：permit any 未带 log → error。"""
    hits = [ln for ln in collect_lines(config_text, r"permit\s+(ip|tcp|udp)\s+any\s+any") if " log" not in ln.lower()]
    if not hits:
        return [
            CheckResult("acl-logging", "ACL 命中日志", SEV_ERROR, True, "未发现 permit any 无 log 条目")
        ]
    return [
        CheckResult(
            "acl-logging",
            "ACL 命中日志",
            SEV_ERROR,
            False,
            f"{len(hits)} 条 permit any 未记录日志",
            suggestion="为关键 permit 规则追加 log，便于安全审计",
        )
    ]


BUILTIN_CHECKS: List[CheckItem] = [
    CheckItem("hostname-present", "主机名已配置", "basic", SEV_ERROR, check_hostname),
    CheckItem("interface-mtu-consistency", "接口 MTU 一致性", "layer2", SEV_WARN, check_interface_mtu_consistency),
    CheckItem("duplex-mode-auto", "接口双工模式", "layer2", SEV_WARN, check_duplex_mode),
    CheckItem("acl-logging", "ACL 命中日志", "security", SEV_ERROR, check_acl_logging),
]
