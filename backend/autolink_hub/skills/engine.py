"""AutoLink AI Hub 技能引擎（v3.1.1-T5-1.3，移植 MC ai_hub/skills/engine.py）

4.3 F3-3 深化：补齐 list / 详情 / 启用禁用 + 状态持久化（user_data/skills_state.json），
技能可被 AI 工具调用（skill_list / skill_view / skill_set_enabled）。
"""
import json
import logging
import os
from datetime import datetime
from pathlib import Path

logger = logging.getLogger(__name__)
SKILLS_DIR = Path(__file__).parent / "skills"


def _state_dir() -> Path:
    """技能启用状态目录：优先 $AUTOLINK_USER_DATA，兜底 skills 目录（开发/测试环境可写）"""
    user_data = os.environ.get("AUTOLINK_USER_DATA", "")
    if user_data:
        return Path(user_data)
    try:
        from autolink_hub.config import settings
        if settings.user_data_dir:
            return Path(settings.user_data_dir)
    except Exception:
        pass
    return SKILLS_DIR


class Skill:
    def __init__(self, name: str, file_path: Path, content: str):
        self.name = name
        self.file_path = file_path
        self.content = content
        self.enabled = True
        self.use_count = 0
        self.last_used: str = ""

    def get_prompt_text(self) -> str:
        return f"\n## 技能: {self.name}\n\n{self.content}\n"


class SkillsEngine:
    def __init__(self):
        self.skills: dict[str, Skill] = {}
        self._loaded = False

    def load_all(self) -> None:
        if self._loaded:
            return
        self._loaded = True
        if not SKILLS_DIR.exists():
            return
        for md_file in SKILLS_DIR.glob("*.md"):
            try:
                content = md_file.read_text(encoding="utf-8")
                name = md_file.stem
                self.skills[name] = Skill(name=name, file_path=md_file, content=content)
            except Exception as e:
                logger.error(f"Failed to load skill {md_file}: {e}")
        self._restore_state()
        logger.info(f"Loaded {len(self.skills)} skills")

    def get_skills_prompt(self) -> str:
        if not self.skills:
            return ""
        parts = ["\n## 可用技能\n"]
        for skill in self.skills.values():
            if skill.enabled:
                parts.append(skill.get_prompt_text())
        return "\n".join(parts)

    def reload(self) -> None:
        self.skills.clear()
        self._loaded = False
        self.load_all()
        self._invalidate_prompt_cache()

    def save_skill(self, name: str, content: str) -> Skill:
        safe_name = name.lower().replace(" ", "-").replace("/", "-")
        file_path = SKILLS_DIR / f"{safe_name}.md"
        file_path.write_text(content, encoding="utf-8")
        skill = Skill(name=safe_name, file_path=file_path, content=content)
        self.skills[safe_name] = skill
        self._invalidate_prompt_cache()
        return skill

    @staticmethod
    def _invalidate_prompt_cache() -> None:
        """T6-2: skills 内容变更 → system prompt 缓存失效（函数内 import 避免循环依赖）"""
        from autolink_hub.prompts.loader import invalidate_system_prompt_cache
        invalidate_system_prompt_cache()

    def record_usage(self, name: str) -> None:
        if name in self.skills:
            self.skills[name].use_count += 1
            self.skills[name].last_used = datetime.now().isoformat()

    # ---- 4.3 F3-3: 技能库补齐（list / 详情 / 启用禁用 + 持久化）----

    def list_skills(self) -> list[dict]:
        """技能清单（名称/启用/使用次数/最近使用/来源文件）"""
        return [
            {
                "name": s.name,
                "enabled": s.enabled,
                "use_count": s.use_count,
                "last_used": s.last_used,
                "file": s.file_path.name,
            }
            for s in sorted(self.skills.values(), key=lambda x: x.name)
        ]

    def get_skill(self, name: str) -> Skill | None:
        """按名称获取技能详情（精确匹配 + 后缀归一）"""
        if name in self.skills:
            return self.skills[name]
        safe = name.lower().replace(" ", "-").replace("/", "-")
        return self.skills.get(safe)

    def set_enabled(self, name: str, enabled: bool) -> bool:
        """启用/禁用技能；持久化到 user_data/skills_state.json，并失效 prompt 缓存。返回是否命中。"""
        skill = self.get_skill(name)
        if skill is None:
            return False
        skill.enabled = bool(enabled)
        self._save_state()
        self._invalidate_prompt_cache()
        return True

    def _restore_state(self) -> None:
        """从 skills_state.json 恢复启用状态（不存在的技能忽略）"""
        path = _state_dir() / "skills_state.json"
        if not path.exists():
            return
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            disabled = set(data.get("disabled", []) or [])
            for s in self.skills.values():
                if s.name in disabled:
                    s.enabled = False
        except Exception as e:
            logger.warning(f"Failed to restore skills state: {e}")

    def _save_state(self) -> None:
        """把当前禁用列表写入 skills_state.json（写失败不阻塞）"""
        try:
            disabled = [s.name for s in self.skills.values() if not s.enabled]
            path = _state_dir() / "skills_state.json"
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps({"disabled": disabled}, ensure_ascii=False, indent=2), encoding="utf-8")
        except Exception as e:
            logger.warning(f"Failed to save skills state: {e}")


_engine: SkillsEngine | None = None


def get_skills_engine() -> SkillsEngine:
    global _engine
    if _engine is None:
        _engine = SkillsEngine()
        _engine.load_all()
    return _engine
