"""AutoLink AI Hub 技能引擎（v3.1.1-T5-1.3，移植 MC ai_hub/skills/engine.py）

4.3 F3-3 深化：补齐 list / 详情 / 启用禁用 + 状态持久化（user_data/skills_state.json），
技能可被 AI 工具调用（skill_list / skill_view / skill_set_enabled）。
"""
import json
import logging
import os
import re
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
        # 5.0.3-503-b: 技能级元数据（伴生 <name>.metadata.json，保持纯 md 兼容）
        self.metadata: dict = self._load_metadata()

    def _load_metadata(self) -> dict:
        path = self.file_path.with_suffix(".metadata.json")
        if path.exists():
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                return data if isinstance(data, dict) else {}
            except Exception as e:
                logger.warning(f"Failed to load skill metadata {path}: {e}")
        return {}

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

    def save_skill(self, name: str, content: str, metadata: dict | None = None) -> Skill:
        safe_name = name.lower().replace(" ", "-").replace("/", "-")
        file_path = SKILLS_DIR / f"{safe_name}.md"
        file_path.write_text(content, encoding="utf-8")
        # 5.0.3-503-b: 可选技能级元数据（伴生 <name>.metadata.json，保持纯 md 兼容）
        if metadata is not None:
            meta_path = file_path.with_suffix(".metadata.json")
            meta = dict(metadata)
            meta.setdefault("name", safe_name)
            meta["updated_at"] = datetime.now().isoformat()
            try:
                meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
            except Exception as e:
                logger.warning(f"Failed to save skill metadata {meta_path}: {e}")
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

    # ============================================================
    # 5.0.3-503-b: 技能自学习闭环（反馈持久化 / 自学习触发器 / 工具接线）
    # ============================================================

    @staticmethod
    def _safe_name(name: str) -> str:
        return (name or "").lower().replace(" ", "-").replace("/", "-")

    def _feedback_path(self, name: str) -> Path:
        return _state_dir() / "skill_feedback" / f"{self._safe_name(name)}.json"

    def _load_feedback(self, name: str) -> dict:
        path = self._feedback_path(name)
        if path.exists():
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                if isinstance(data, dict):
                    return data
            except Exception as e:
                logger.warning(f"Failed to load feedback {path}: {e}")
        return {"name": self._safe_name(name), "total": 0, "success": 0,
                "failure": 0, "success_rate": 0.0, "recent": []}

    def get_skill_feedback(self, name: str) -> dict | None:
        """技能反馈统计（成功/失败/成功率/最近样本）；技能不存在返回 None"""
        if self.get_skill(name) is None:
            return None
        return self._load_feedback(name)

    def list_feedback(self) -> list[dict]:
        """全部技能反馈统计"""
        return [self._load_feedback(s.name) for s in self.skills.values()]

    def record_feedback(self, name: str, success: bool, detail: str = "") -> dict:
        """持久化技能反馈（成功/失败 + 最近样本 + 成功率）。

        达阈值自动触发自学习修订（maybe_optimize_skill）——「达阈值自动修订技能定义」。
        返回 {ok, feedback, auto_optimized}。
        """
        safe = self._safe_name(name)
        if self.get_skill(safe) is None:
            return {"ok": False, "error": f"技能不存在: {name}"}
        data = self._load_feedback(safe)
        data["total"] += 1
        if success:
            data["success"] += 1
        else:
            data["failure"] += 1
        data["success_rate"] = round(data["success"] / data["total"], 4) if data["total"] else 0.0
        data["recent"].append({
            "ts": datetime.now().isoformat(),
            "success": bool(success),
            "detail": detail or "",
        })
        data["recent"] = data["recent"][-20:]
        try:
            path = self._feedback_path(safe)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        except Exception as e:
            logger.warning(f"Failed to save feedback {path}: {e}")

        # 自学习触发器：达阈值且成功率低 → 自动修订技能定义
        auto_optimized = False
        opt = self.maybe_optimize_skill(safe)
        auto_optimized = bool(opt.get("optimized"))
        return {"ok": True, "feedback": data, "auto_optimized": auto_optimized,
                "learning": opt.get("learning")}

    # ---- 自学习改进记录（追加结构化「自学习改进记录」到技能 md）----

    LEARNING_SECTION_HEADING = "## 🔄 自学习改进记录"

    def append_learning_record(self, name: str, record: dict) -> Skill | None:
        """把一条结构化自学习改进记录追加到技能 md（含时间戳 + 原因 + 措施）"""
        skill = self.get_skill(name)
        if skill is None:
            return None
        entry = {
            "ts": datetime.now().isoformat(),
            "reason": record.get("reason", ""),
            "action": record.get("action", ""),
            "detail": record.get("detail", ""),
        }
        # 技能级元数据同步维护 learning_records
        meta = dict(skill.metadata)
        records = meta.setdefault("learning_records", [])
        records.append(entry)
        meta["learning_records"] = records[-20:]
        meta["optimized_count"] = int(meta.get("optimized_count", 0)) + 1
        self.save_skill(skill.name, skill.content, meta)

        # md 追加结构化「自学习改进记录」段（保持纯 md 兼容）
        existing_entries = 0
        if self.LEARNING_SECTION_HEADING in skill.content:
            # 统计既有编号条目数（逐行匹配 "N. <ts> — "）
            for ln in skill.content.splitlines():
                if re.match(r"^\d+\. \d{4}-\d{2}-\d{2}", ln.strip()):
                    existing_entries += 1
        entry_line = (
            f"{existing_entries + 1}. {entry['ts']} — 原因: {entry['reason']}；"
            f"措施: {entry['action']}；详情: {entry['detail']}"
        )
        if existing_entries:
            content = skill.content.rstrip() + f"\n{entry_line}"
        else:
            content = skill.content.rstrip() + f"\n{self.LEARNING_SECTION_HEADING}\n{entry_line}"
        skill.file_path.write_text(content, encoding="utf-8")
        self.skills[skill.name] = Skill(name=skill.name, file_path=skill.file_path, content=content)
        self._invalidate_prompt_cache()
        return self.skills[skill.name]

    def maybe_optimize_skill(self, name: str, force: bool = False, notes: str = "",
                             threshold: int = 3, min_success_rate: float = 0.5) -> dict:
        """自学习触发器：达阈值且成功率低于阈值 → 自动修订技能定义。

        - 采样数达 threshold 且成功率 < min_success_rate（或 force=True 主动优化）
          时，追加一条结构化「自学习改进记录」并刷新元数据。
        - 返回 {ok, optimized, reason, skill?, learning?}
        """
        safe = self._safe_name(name)
        skill = self.get_skill(safe)
        if skill is None:
            return {"ok": False, "error": f"技能不存在: {name}"}
        feedback = self._load_feedback(safe)
        total = int(feedback.get("total", 0))
        success_rate = float(feedback.get("success_rate", 0.0))

        reason = ""
        if force:
            reason = "主动优化（skill_optimize）"
        elif total >= threshold and success_rate < min_success_rate:
            reason = f"自学习触发：{total} 次反馈成功率 {success_rate:.0%} 低于 {min_success_rate:.0%}"
        else:
            return {"ok": True, "optimized": False, "reason": "未达自学习阈值",
                    "total": total, "success_rate": success_rate}

        failures = [r for r in feedback.get("recent", []) if not r.get("success")]
        detail = (notes or (failures[-1].get("detail", "") if failures else "") or
                  f"成功率 {success_rate:.0%}（成功 {feedback.get('success', 0)}/{total}）")
        learning = {
            "reason": reason,
            "action": "已追加自学习改进记录，建议复核技能步骤/参数描述",
            "detail": detail,
        }
        updated = self.append_learning_record(safe, learning)
        if updated is None:
            return {"ok": False, "error": "修订技能失败"}
        return {"ok": True, "optimized": True, "reason": reason,
                "learning": learning, "skill": updated.name,
                "content": updated.content}


# 5.0.3-503-b: 技能相关工具名（用于 record_tool_outcome 接线 run_stream）
SKILL_TOOL_NAMES = {"skill_view", "skill_set_enabled", "skill_update", "skill_save", "skill_optimize"}


def skill_name_from_tool_args(tool_name: str, args: dict | None) -> str:
    """从技能工具调用参数中提取技能名（非技能工具返回空串）。

    validator 会把 name 归一为 projectName，两者都兼容。
    """
    if (tool_name or "") not in SKILL_TOOL_NAMES:
        return ""
    a = args or {}
    return str(a.get("name") or a.get("projectName") or "").strip()


def record_tool_outcome(tool_name: str, args: dict | None, success: bool, detail: str = "") -> dict:
    """技能工具执行结果 → 记录使用 + 采集反馈（run_stream 工具成功后接线）。

    返回 {ok, feedback?, auto_optimized?}；非技能工具返回 {ok: False}。
    """
    name = skill_name_from_tool_args(tool_name, args)
    if not name:
        return {"ok": False}
    engine = get_skills_engine()
    skill = engine.get_skill(name)
    if skill is None:
        return {"ok": False, "error": f"技能不存在: {name}"}
    if success:
        engine.record_usage(name)
    fb = engine.record_feedback(name, bool(success), detail or f"工具 {tool_name} 执行")
    return {
        "ok": True,
        "skill": name,
        "feedback": fb.get("feedback"),
        "auto_optimized": bool(fb.get("auto_optimized")),
    }


_engine: SkillsEngine | None = None


def get_skills_engine() -> SkillsEngine:
    global _engine
    if _engine is None:
        _engine = SkillsEngine()
        _engine.load_all()
    return _engine
