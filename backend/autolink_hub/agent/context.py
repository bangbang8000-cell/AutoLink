"""AutoLink AI Hub 项目上下文管理器（v3.1.1-T5-1.4，移植 MC ai_hub/agent/context.py，简化版）

AutoLink 项目为独立目录结构（见 project-io），T5-1 先记录最近操作；
目录结构扫描在 T5-2 按 AutoLink 项目布局完善。
"""
import logging
from datetime import datetime

logger = logging.getLogger(__name__)


class ProjectContext:
    def __init__(self, project_name: str = ""):
        self.project_name = project_name
        self.last_operation: str = ""
        self.last_operation_time: datetime | None = None

    def load(self, project_name: str):
        self.project_name = project_name

    def record_operation(self, operation: str):
        self.last_operation = operation
        self.last_operation_time = datetime.now()

    def get_prompt_context(self) -> str:
        if not self.project_name:
            return ""
        parts = [f"## 当前项目上下文", f"- 项目名: {self.project_name}"]
        if self.last_operation:
            t = self.last_operation_time.strftime("%H:%M") if self.last_operation_time else ""
            parts.append(f"- 最近操作: {self.last_operation} ({t})")
        return "\n".join(parts)


_contexts: dict[str, ProjectContext] = {}


def get_project_context(session_id: str) -> ProjectContext:
    if session_id not in _contexts:
        _contexts[session_id] = ProjectContext()
    return _contexts[session_id]


def clear_project_context(session_id: str):
    _contexts.pop(session_id, None)
