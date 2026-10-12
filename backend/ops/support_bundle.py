"""5.4.14-F54-14-1：支持包一键导出。

把「版本信息 + 配置快照 + 日志尾部 + 审计尾部」打包成时间戳 zip，供诊断/售后取证。
- 只取文件尾部（tail_n），避免超大日志拖垮导出
- 缺失文件静默跳过（不因局部缺失失败）
- 纯标准库实现，可单测
"""
from __future__ import annotations

import io
import json
import os
import time
import zipfile
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Dict, List, Optional


@dataclass
class SupportBundleSources:
    """支持包素材来源（均可缺省）。"""
    version_info: Optional[dict] = None
    config_snapshot: Optional[dict] = None
    log_files: Optional[List[str]] = None      # 绝对路径
    audit_files: Optional[List[str]] = None    # 绝对路径
    tail_n: int = 200


def _read_tail(path: str, n: int) -> Optional[str]:
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            lines = f.readlines()
        return "".join(lines[-n:])
    except OSError:
        return None


def _stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def export_support_bundle(dst_path: str, sources: SupportBundleSources) -> dict:
    """导出支持包到 dst_path；返回清单 dict。"""
    os.makedirs(os.path.dirname(os.path.abspath(dst_path)) or ".", exist_ok=True)
    manifest: Dict[str, object] = {
        "schema": "autolink.ops.support-bundle/1",
        "exportedAt": _stamp(),
        "app": sources.version_info or {},
        "files": {},
    }
    with zipfile.ZipFile(dst_path, "w", zipfile.ZIP_DEFLATED) as zf:
        if sources.config_snapshot is not None:
            zf.writestr("config_snapshot.json", json.dumps(sources.config_snapshot, ensure_ascii=False, indent=2))
            manifest["files"]["config_snapshot.json"] = "ok"
        for label, paths in (("log", sources.log_files or []), ("audit", sources.audit_files or [])):
            for p in paths:
                name = os.path.basename(p)
                tail = _read_tail(p, sources.tail_n)
                arc = f"{label}/{name}.tail"
                if tail is None:
                    manifest["files"][arc] = "missing"
                    continue
                zf.writestr(arc, tail)
                manifest["files"][arc] = "ok"
        # 清单随包内置（自描述）
        zf.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
    manifest["bundle"] = dst_path
    return manifest


__all__ = ["SupportBundleSources", "export_support_bundle", "_read_tail"]
