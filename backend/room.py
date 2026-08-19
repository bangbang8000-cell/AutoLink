"""AutoLink v3.0.4-T3-1 机房矩阵数据层

机房以矩阵建模（PRD 4.5 能力五）：
  - RoomMatrix：行×列（命名规则可自定义，如 A15~J15=225 柜）、占位标记（空调/柱子）、机柜类型标记
  - RoomConstraints：上架约束（占位不可放置 / 机柜类型约束设备域 / 功率上限），供 T3-3 前端即时校验
  - room_layout.json 持久化（schema_version 版本化 + 校验）

机柜类型复用 backend/rack_allocation.py 常量（gpu/compute/storage/network），
新增 combined（组合，PRD 4.5：GPU/网络/存储/通算任意组合）与 empty（未标记）。
"""
from __future__ import annotations

import json
import os
from typing import Any, Dict, List, Optional

from rack_allocation import (
    CABINET_TYPE_COMPUTE,
    CABINET_TYPE_GPU,
    CABINET_TYPE_NETWORK,
    CABINET_TYPE_STORAGE,
)

# --- 矩阵单元机柜类型（在 rack_allocation 基础上扩展） ---
ROOM_TYPE_GPU = CABINET_TYPE_GPU                    # GPU 柜
ROOM_TYPE_NETWORK = CABINET_TYPE_NETWORK            # 网络柜
ROOM_TYPE_STORAGE = CABINET_TYPE_STORAGE            # 存储柜
ROOM_TYPE_COMPUTE = CABINET_TYPE_COMPUTE            # 通算柜
ROOM_TYPE_COMBINED = 'combined'                     # 组合柜（任意设备域）
ROOM_TYPE_POWER = 'power'                           # v1.4 电源柜（无设备，仅占位标记）
ROOM_TYPE_EMPTY = 'empty'                           # 未标记（默认，宽松无类型约束）

# 可标记的机柜类型（UI 展示用）
ROOM_TYPES = (ROOM_TYPE_GPU, ROOM_TYPE_NETWORK, ROOM_TYPE_STORAGE,
              ROOM_TYPE_COMPUTE, ROOM_TYPE_COMBINED, ROOM_TYPE_POWER)

# --- 占位类型（不可放置设备） ---
PLACEHOLDER_AC = 'ac'          # 空调占位
PLACEHOLDER_PILLAR = 'pillar'  # 柱子占位
PLACEHOLDER_TYPES = (PLACEHOLDER_AC, PLACEHOLDER_PILLAR)

# --- 设备类型（与 rack_allocation DEVICE_TYPE_* 对齐） ---
DEVICE_TYPE_GPU = 'gpu'
DEVICE_TYPE_NETWORK = 'network'
DEVICE_TYPE_STORAGE = 'storage'
DEVICE_TYPE_COMPUTE = 'compute'

ROOM_SCHEMA_VERSION = 1
LAYOUT_FILENAME = 'room_layout.json'

# 矩阵规模防御上限（避免误配超大矩阵）
MAX_MATRIX_CELLS = 4096


class RoomCell:
    """矩阵单元（一个机柜位）"""

    def __init__(
        self,
        row: str,
        col: int,
        cell_type: str = ROOM_TYPE_EMPTY,
        placeholder: Optional[str] = None,
        cabinet_id: Optional[int] = None,
    ) -> None:
        self.row = str(row)
        self.col = int(col)
        self.type = cell_type
        self.placeholder = placeholder
        self.cabinet_id = cabinet_id

    @property
    def position(self) -> str:
        """位置标识：行 + 列（如 'A15'）"""
        return f"{self.row}{self.col}"

    def is_available(self) -> bool:
        """可放置设备：非占位（空调/柱子不可放）"""
        return self.placeholder is None

    def to_dict(self) -> dict:
        return {
            'row': self.row,
            'col': self.col,
            'type': self.type,
            'placeholder': self.placeholder,
            'cabinetId': self.cabinet_id,
        }

    @classmethod
    def from_dict(cls, data: dict) -> 'RoomCell':
        return cls(
            row=str(data.get('row', '')),
            col=int(data.get('col', 0)),
            cell_type=str(data.get('type') or ROOM_TYPE_EMPTY),
            placeholder=data.get('placeholder'),
            cabinet_id=data.get('cabinetId'),
        )


class RoomMatrix:
    """机房矩阵：行×列 + 占位/类型/上架机柜关联"""

    def __init__(
        self,
        rows: List[str],
        cols: List[int],
        name: str = '机房',
    ) -> None:
        self.name = name or '机房'
        self.rows = [str(r) for r in (rows or [])]
        self.cols = [int(c) for c in (cols or [])]
        self.cells: Dict[str, RoomCell] = {}
        self._init_cells()

    def _init_cells(self) -> None:
        for r in self.rows:
            for c in self.cols:
                cell = RoomCell(r, c)
                self.cells[cell.position] = cell

    # ------------------------------------------------------------------
    # 基本查询
    # ------------------------------------------------------------------
    @property
    def size(self) -> int:
        return len(self.cells)

    def get(self, row: str, col: int) -> Optional[RoomCell]:
        return self.cells.get(f"{row}{col}")

    def get_position(self, position: str) -> Optional[RoomCell]:
        return self.cells.get(position)

    def cabinet_position(self, cabinet_id: int) -> Optional[str]:
        """机柜 id → 所在矩阵位置（未上架返回 None）"""
        for pos, cell in self.cells.items():
            if cell.cabinet_id == cabinet_id:
                return pos
        return None

    # ------------------------------------------------------------------
    # 编辑操作
    # ------------------------------------------------------------------
    def set_placeholder(self, position: str, placeholder: Optional[str]) -> None:
        """标记占位（空调/柱子），None 清除。占位位置不可放置设备。"""
        cell = self._require(position)
        cell.placeholder = placeholder
        # 占位位置禁止上架机柜
        if placeholder is not None:
            cell.cabinet_id = None

    def set_type(self, position: str, cell_type: str) -> None:
        """标记机柜类型（gpu/network/storage/compute/combined/empty）"""
        cell = self._require(position)
        cell.type = cell_type

    def place_cabinet(self, position: str, cabinet_id: int) -> None:
        """将机柜上架到矩阵位置（占位位置拒绝）"""
        cell = self._require(position)
        if not cell.is_available():
            raise ValueError(f"位置 {position} 是占位（{cell.placeholder}），不可放置机柜")
        cell.cabinet_id = int(cabinet_id)

    def remove_cabinet(self, position: str) -> None:
        cell = self._require(position)
        cell.cabinet_id = None

    def _require(self, position: str) -> RoomCell:
        cell = self.cells.get(position)
        if cell is None:
            raise KeyError(f"矩阵位置不存在: {position}")
        return cell

    # ------------------------------------------------------------------
    # 序列化 / 校验
    # ------------------------------------------------------------------
    def to_dict(self) -> dict:
        return {
            'schemaVersion': ROOM_SCHEMA_VERSION,
            'name': self.name,
            'rows': self.rows,
            'cols': self.cols,
            'cells': [c.to_dict() for c in self.cells.values()],
        }

    @classmethod
    def from_dict(cls, data: dict) -> 'RoomMatrix':
        matrix = cls(
            rows=[str(r) for r in data.get('rows', [])],
            cols=[int(c) for c in data.get('cols', [])],
            name=str(data.get('name') or '机房'),
        )
        for cell_data in data.get('cells', []) or []:
            try:
                cell = RoomCell.from_dict(cell_data)
            except (KeyError, TypeError, ValueError):
                continue
            matrix.cells[cell.position] = cell
        return matrix

    def validate(self) -> List[str]:
        """结构校验，返回错误列表（空 = 合法）"""
        errors: List[str] = []
        if not self.rows or not self.cols:
            errors.append("矩阵必须定义行(rows)与列(cols)")
            return errors
        if self.size > MAX_MATRIX_CELLS:
            errors.append(f"矩阵规模过大（{self.size} > {MAX_MATRIX_CELLS}）")
        for pos, cell in self.cells.items():
            if cell.position != pos:
                errors.append(f"单元位置不一致: {pos} vs {cell.position}")
            if cell.placeholder not in (None,) + PLACEHOLDER_TYPES:
                errors.append(f"{pos}: 非法占位类型 {cell.placeholder!r}")
            if cell.type not in (ROOM_TYPES + (ROOM_TYPE_EMPTY,)):
                errors.append(f"{pos}: 非法机柜类型 {cell.type!r}")
        return errors


class RoomConstraints:
    """上架约束（占位/类型/功率；U 位与散热分区在 T3-3 前端联动 rack_allocation）"""

    def __init__(
        self,
        power_limit_per_rack: int = 6000,
        type_device_map: Optional[Dict[str, List[str]]] = None,
    ) -> None:
        self.power_limit_per_rack = max(1, int(power_limit_per_rack or 6000))
        # 机柜类型 → 允许设备类型域（combined 与 empty 不设限）
        self.type_device_map = type_device_map or {
            ROOM_TYPE_GPU: [DEVICE_TYPE_GPU],
            ROOM_TYPE_NETWORK: [DEVICE_TYPE_NETWORK],
            ROOM_TYPE_STORAGE: [DEVICE_TYPE_STORAGE],
            ROOM_TYPE_COMPUTE: [DEVICE_TYPE_COMPUTE],
        }

    def validate_placement(
        self,
        cell: RoomCell,
        device_type: str,
        power_watts: int = 0,
    ) -> List[str]:
        """校验设备是否可放置到矩阵单元，返回错误列表（空 = 允许）

        - 占位（空调/柱子）不可放置
        - 机柜类型约束设备域（combined/empty 任意）
        - 功率上限（单柜功率 ≤ 上限）
        """
        errors: List[str] = []
        if cell is None:
            return ["矩阵单元不存在"]
        if not cell.is_available():
            errors.append(f"位置 {cell.position} 是占位（{cell.placeholder}），不可放置设备")
            return errors
        if cell.type not in (ROOM_TYPE_COMBINED, ROOM_TYPE_EMPTY):
            allowed = self.type_device_map.get(cell.type, [])
            if device_type not in allowed:
                errors.append(
                    f"位置 {cell.position} 类型为 {cell.type}，不允许放置 {device_type} 设备")
        if power_watts and int(power_watts) > self.power_limit_per_rack:
            errors.append(
                f"位置 {cell.position} 功率 {power_watts}W 超过上限 {self.power_limit_per_rack}W")
        return errors

    def to_dict(self) -> dict:
        return {
            'powerLimitPerRack': self.power_limit_per_rack,
            'typeDeviceMap': self.type_device_map,
        }

    @classmethod
    def from_dict(cls, data: dict) -> 'RoomConstraints':
        return cls(
            power_limit_per_rack=int(data.get('powerLimitPerRack', 6000) or 6000),
            type_device_map=data.get('typeDeviceMap') or None,
        )


# ================================================================
# 持久化（room_layout.json）
# ================================================================

def create_default_room(rows: List[str], cols: List[int], name: str = '机房') -> RoomMatrix:
    """创建默认机房矩阵（全部单元 empty、无占位）"""
    return RoomMatrix(rows=rows, cols=cols, name=name)


def save_room_layout(path: str, matrix: RoomMatrix) -> None:
    """保存矩阵到 room_layout.json（UTF-8，ensure_ascii=False）"""
    path = os.path.abspath(path)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(matrix.to_dict(), f, ensure_ascii=False, indent=2)


def load_room_layout(path: str) -> RoomMatrix:
    """从 room_layout.json 读取矩阵（文件不存在抛 FileNotFoundError）"""
    with open(path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    return RoomMatrix.from_dict(data)


def validate_room_layout(data: dict) -> List[str]:
    """校验 room_layout.json 数据，返回错误列表（空 = 合法）

    字段缺失/类型非法 → 报错；可恢复的单元级问题（cell 损坏）不阻塞整体。
    """
    if not isinstance(data, dict):
        return ["room_layout 必须是 JSON 对象"]
    errors: List[str] = []
    if not data.get('rows') or not data.get('cols'):
        errors.append("缺少 rows/cols 矩阵定义")
        return errors
    try:
        matrix = RoomMatrix.from_dict(data)
        errors.extend(matrix.validate())
    except (KeyError, TypeError, ValueError) as e:
        errors.append(f"矩阵解析失败: {e}")
    return errors
