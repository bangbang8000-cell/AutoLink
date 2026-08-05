"""AutoLink AI Hub 记忆引擎（v3.1.1-T5-1.3，移植 MC ai_hub/memory/engine.py）

JSON 文件持久化：<user_data>/memory/{user_profile.json, habits.json, project_history/*.json}
由 engine 启动时显式 init_dir()（修复 MC 中未调用 init_dir 的隐患）
"""
import json
import logging
from pathlib import Path

from autolink_hub.memory.schemas import UserProfile, ProjectHistory, OperationHabit, now_iso

logger = logging.getLogger(__name__)


class MemoryEngine:
    def __init__(self):
        self.memory_dir = Path(".")
        self.user_profile = UserProfile()
        self.project_histories: dict[str, ProjectHistory] = {}
        self.habits = OperationHabit()
        self._loaded = False

    def init_dir(self, base_dir: str) -> None:
        self.memory_dir = Path(base_dir) / "memory"
        self.memory_dir.mkdir(parents=True, exist_ok=True)
        (self.memory_dir / "project_history").mkdir(parents=True, exist_ok=True)
        self._load_all()

    def _load_all(self) -> None:
        if self._loaded:
            return
        self._loaded = True
        for fname, cls in [("user_profile.json", UserProfile), ("habits.json", OperationHabit)]:
            path = self.memory_dir / fname
            if path.exists():
                try:
                    data = json.loads(path.read_text(encoding="utf-8"))
                    setattr(self, fname.replace(".json", ""), cls(**data))
                except Exception as e:
                    logger.warning(f"Failed to load {fname}: {e}")
        ph_dir = self.memory_dir / "project_history"
        if ph_dir.exists():
            for f in ph_dir.glob("*.json"):
                try:
                    data = json.loads(f.read_text(encoding="utf-8"))
                    self.project_histories[f.stem] = ProjectHistory(**data)
                except Exception as e:
                    logger.warning(f"Failed to load {f}: {e}")

    def update_user_profile(self, **kwargs) -> None:
        for k, v in kwargs.items():
            if hasattr(self.user_profile, k):
                setattr(self.user_profile, k, v)
        self.user_profile.updated_at = now_iso()
        self._save_json("user_profile.json", self.user_profile.__dict__)
        # T6-2: 用户画像变更影响记忆 prompt，使 system prompt 缓存失效
        from autolink_hub.prompts.loader import invalidate_system_prompt_cache
        invalidate_system_prompt_cache()

    def record_operation(self, project_name: str, operation: str) -> None:
        if project_name not in self.project_histories:
            self.project_histories[project_name] = ProjectHistory(project_name=project_name)
        ph = self.project_histories[project_name]
        ph.last_operations.append(operation)
        if len(ph.last_operations) > 20:
            ph.last_operations = ph.last_operations[-20:]
        ph.updated_at = now_iso()
        self._save_json(f"project_history/{project_name}.json", ph.__dict__)

    def get_memory_prompt(self, project_name: str = "") -> str:
        parts = []
        if self.user_profile.preferred_vendors:
            parts.append(f"- 常用厂商: {', '.join(self.user_profile.preferred_vendors)}")
        if project_name and project_name in self.project_histories:
            ph = self.project_histories[project_name]
            if ph.templates:
                parts.append(f"- 项目 {project_name} 模板: {', '.join(ph.templates)}")
        if parts:
            return "## 用户记忆\n" + "\n".join(parts)
        return ""

    def _save_json(self, rel_path: str, data: dict) -> None:
        try:
            path = self.memory_dir / rel_path
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        except Exception as e:
            logger.error(f"Failed to save {rel_path}: {e}")


_engine: MemoryEngine | None = None


def get_memory_engine() -> MemoryEngine:
    global _engine
    if _engine is None:
        _engine = MemoryEngine()
    return _engine
