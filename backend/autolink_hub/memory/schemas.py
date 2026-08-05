"""AutoLink AI Hub 记忆模型（v3.1.1-T5-1.3，移植 MC ai_hub/memory/schemas.py，dataclass）"""
from dataclasses import dataclass, field
from datetime import datetime


def now_iso() -> str:
    return datetime.now().isoformat()


@dataclass
class UserProfile:
    """用户画像（AutoLink 语义：设备/网络偏好）"""
    preferred_vendors: list[str] = field(default_factory=list)
    preferred_device_types: list[str] = field(default_factory=list)
    default_autonomy_mode: str = "semi_auto"
    updated_at: str = ""


@dataclass
class ProjectHistory:
    """项目历史"""
    project_name: str = ""
    templates: list[str] = field(default_factory=list)
    excel_columns: list[str] = field(default_factory=list)
    last_operations: list[str] = field(default_factory=list)
    last_render_result: str = ""
    updated_at: str = ""


@dataclass
class OperationHabit:
    """操作习惯"""
    common_sequences: list[list[str]] = field(default_factory=list)
    failed_patterns: list[str] = field(default_factory=list)
    tool_corrections: list[str] = field(default_factory=list)
    updated_at: str = ""
