"""AutoLink AI Hub 技能引擎（v3.1.1-T5-1.3，移植 MC ai_hub/skills/engine.py）"""
import logging
from pathlib import Path

logger = logging.getLogger(__name__)
SKILLS_DIR = Path(__file__).parent / "skills"


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

    def save_skill(self, name: str, content: str) -> Skill:
        safe_name = name.lower().replace(" ", "-").replace("/", "-")
        file_path = SKILLS_DIR / f"{safe_name}.md"
        file_path.write_text(content, encoding="utf-8")
        skill = Skill(name=safe_name, file_path=file_path, content=content)
        self.skills[safe_name] = skill
        return skill

    def record_usage(self, name: str) -> None:
        if name in self.skills:
            self.skills[name].use_count += 1
            from datetime import datetime
            self.skills[name].last_used = datetime.now().isoformat()


_engine: SkillsEngine | None = None


def get_skills_engine() -> SkillsEngine:
    global _engine
    if _engine is None:
        _engine = SkillsEngine()
        _engine.load_all()
    return _engine
