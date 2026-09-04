"""AutoLink AI Hub 知识库引擎（5.0.5-505-b，与 MC ai_hub/knowledge/engine.py 同构）

知识条目 = knowledge/*.md + 伴生 <name>.metadata.json；持久化 <user_data>/knowledge/。
检索式注入：get_knowledge_prompt(query, project) 按 Top-K（默认 5）检索并拼接进 system prompt。

与技能自学习解耦：知识库只做条目 CRUD + 检索注入，不参与技能反馈/自学习闭环。
"""
import json
import logging
import re
import os
from datetime import datetime
from pathlib import Path

logger = logging.getLogger(__name__)

# 检索式注入 Top-K 默认值
DEFAULT_TOP_K = 5

# 条目 md 文件目录（无 user_data 时兜底，开发/测试环境可写）
KNOWLEDGE_DIR = Path(__file__).parent / "knowledge"

# metadata 可选扩展字段白名单（其余忽略，避免脏数据）
_META_KEYS = ("title", "category", "project", "tags", "enabled", "description")


class KnowledgeEntry:
    """知识条目：md 内容 + 伴生 metadata（缺失时兜底默认值，保持纯 md 兼容）"""

    def __init__(self, name: str, file_path: Path, content: str):
        self.name = name
        self.file_path = file_path
        self.content = content
        self.metadata: dict = self._load_metadata()

    def _load_metadata(self) -> dict:
        path = self.file_path.with_suffix(".metadata.json")
        if path.exists():
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                return data if isinstance(data, dict) else {}
            except Exception as e:
                logger.warning(f"Failed to load knowledge metadata {path}: {e}")
        return {}

    @property
    def title(self) -> str:
        return str(self.metadata.get("title") or self.name)

    @property
    def category(self) -> str:
        return str(self.metadata.get("category") or "通用")

    @property
    def project(self) -> str:
        return str(self.metadata.get("project") or "")

    @property
    def tags(self) -> list:
        tags = self.metadata.get("tags") or []
        return [str(t) for t in tags] if isinstance(tags, list) else []

    @property
    def enabled(self) -> bool:
        return bool(self.metadata.get("enabled", True))

    def to_dict(self, with_content: bool = False) -> dict:
        d = {
            "name": self.name,
            "title": self.title,
            "category": self.category,
            "project": self.project,
            "tags": self.tags,
            "enabled": self.enabled,
            "updated_at": str(self.metadata.get("updated_at") or ""),
            "file": self.file_path.name,
        }
        if with_content:
            d["content"] = self.content
        return d


class KnowledgeEngine:
    def __init__(self):
        self.knowledge_dir = Path(".")
        self.entries: dict[str, KnowledgeEntry] = {}
        self._loaded = False

    # ---- 目录 / 加载 ----

    def init_dir(self, base_dir: str) -> None:
        """设置知识库目录 <base_dir>/knowledge/ 并加载全部条目（重入安全：切换目录强制重载）"""
        base = Path(base_dir or ".")
        self.knowledge_dir = base / "knowledge"
        self.knowledge_dir.mkdir(parents=True, exist_ok=True)
        self.entries.clear()
        self._loaded = False
        self.load_all()

    def _dir(self) -> Path:
        """知识库目录：优先已 init 的 user_data，兜底 knowledge 同级目录（测试可写）"""
        if str(self.knowledge_dir) != "." and self.knowledge_dir.exists():
            return self.knowledge_dir
        user_data = os.environ.get("AUTOLINK_USER_DATA", "")
        if user_data:
            d = Path(user_data) / "knowledge"
            try:
                d.mkdir(parents=True, exist_ok=True)
                return d
            except Exception:
                pass
        try:
            from autolink_hub.config import settings
            if settings.user_data_dir:
                d = Path(settings.user_data_dir) / "knowledge"
                try:
                    d.mkdir(parents=True, exist_ok=True)
                    return d
                except Exception:
                    pass
        except Exception:
            pass
        try:
            KNOWLEDGE_DIR.mkdir(parents=True, exist_ok=True)
        except Exception:
            pass
        return KNOWLEDGE_DIR

    def load_all(self) -> None:
        if self._loaded:
            return
        self._loaded = True
        d = self._dir()
        if not d.exists():
            return
        for md_file in d.glob("*.md"):
            try:
                content = md_file.read_text(encoding="utf-8")
                name = md_file.stem
                self.entries[name] = KnowledgeEntry(name=name, file_path=md_file, content=content)
            except Exception as e:
                logger.error(f"Failed to load knowledge {md_file}: {e}")
        logger.info(f"Loaded {len(self.entries)} knowledge entries")

    def reload(self) -> None:
        self.entries.clear()
        self._loaded = False
        self.load_all()
        self._invalidate_prompt_cache()

    # ---- 条目 CRUD ----

    def _entry_path(self, name: str) -> Path:
        return self._dir() / f"{name}.md"

    def _normalize_name(self, name: str) -> str:
        """条目名归一：小写 + 空格/斜杠 → 中划线（与技能 safe_name 约定一致）"""
        return (name or "").strip().lower().replace(" ", "-").replace("/", "-")

    def list_entries(self, category: str = "", project: str = "") -> list[dict]:
        """知识条目清单（可按 category / project 过滤）"""
        result = []
        for e in sorted(self.entries.values(), key=lambda x: x.name):
            if category and e.category != category:
                continue
            if project and e.project != project:
                continue
            result.append(e.to_dict())
        return result

    def list_categories(self) -> list[str]:
        """全部去重分类（供前端筛选下拉）"""
        seen: dict[str, bool] = {}
        for e in self.entries.values():
            seen.setdefault(e.category, True)
        return sorted(seen.keys())

    def get_entry(self, name: str) -> dict | None:
        """按名称获取条目详情（含 content）；不存在返回 None"""
        e = self.entries.get(self._normalize_name(name)) or self.entries.get(name)
        if e is None:
            return None
        return e.to_dict(with_content=True)

    def entry_exists(self, name: str) -> bool:
        return (self._normalize_name(name) in self.entries) or (name in self.entries)

    def add_entry(self, name: str, content: str, metadata: dict | None = None) -> dict:
        """新增知识条目（md + 伴生 metadata），写失败抛异常；成功后失效 system prompt 缓存"""
        safe = self._normalize_name(name)
        if not safe:
            raise ValueError("知识条目名不能为空")
        if self.entry_exists(safe):
            raise ValueError(f"知识条目已存在: {name}")
        if not content or not str(content).strip():
            raise ValueError("知识条目内容不能为空")
        path = self._entry_path(safe)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        self._save_metadata(safe, metadata)
        entry = KnowledgeEntry(name=safe, file_path=path, content=content)
        self.entries[safe] = entry
        self._invalidate_prompt_cache()
        return entry.to_dict(with_content=True)

    def update_entry(self, name: str, content: str | None = None, metadata: dict | None = None) -> dict:
        """更新条目内容与/或 metadata；条目不存在抛异常"""
        e = self.entries.get(self._normalize_name(name)) or self.entries.get(name)
        if e is None:
            raise ValueError(f"知识条目不存在: {name}")
        if content is not None:
            if not str(content).strip():
                raise ValueError("知识条目内容不能为空")
            e.file_path.write_text(content, encoding="utf-8")
            e.content = content
        if metadata is not None:
            self._save_metadata(e.name, metadata)
            e.metadata = self._load_metadata_from(e.name)
        self._invalidate_prompt_cache()
        return e.to_dict(with_content=True)

    def delete_entry(self, name: str) -> bool:
        """删除条目（md + metadata）；不存在返回 False"""
        e = self.entries.get(self._normalize_name(name)) or self.entries.get(name)
        if e is None:
            return False
        try:
            e.file_path.unlink(missing_ok=True)
            e.file_path.with_suffix(".metadata.json").unlink(missing_ok=True)
        except OSError as exc:
            logger.warning(f"Failed to delete knowledge files {e.file_path}: {exc}")
        self.entries.pop(e.name, None)
        self._invalidate_prompt_cache()
        return True

    # ---- metadata 落盘 ----

    def _load_metadata_from(self, name: str) -> dict:
        path = self._entry_path(name).with_suffix(".metadata.json")
        if path.exists():
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                return data if isinstance(data, dict) else {}
            except Exception as e:
                logger.warning(f"Failed to load knowledge metadata {path}: {e}")
        return {}

    def _save_metadata(self, name: str, metadata: dict | None) -> None:
        """保存伴生 <name>.metadata.json（白名单字段 + 时间戳），纯 md 兼容"""
        if metadata is None:
            metadata = {}
        if not isinstance(metadata, dict):
            metadata = {}
        meta = {}
        for k in _META_KEYS:
            if k in metadata and metadata[k] not in (None, ""):
                meta[k] = metadata[k]
        tags = meta.get("tags")
        if tags is not None and not isinstance(tags, list):
            meta["tags"] = []
        meta.setdefault("name", name)
        meta["updated_at"] = datetime.now().isoformat()
        path = self._entry_path(name).with_suffix(".metadata.json")
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
        except Exception as e:
            logger.warning(f"Failed to save knowledge metadata {path}: {e}")

    # ---- 检索 ----

    def search(self, query: str = "", category: str = "", project: str = "",
               top_k: int = DEFAULT_TOP_K) -> list[dict]:
        """关键词检索：对 query 分词，与内容/标题/分类/标签/项目做加权打分，返回 Top-K 条目。

        - category / project 过滤（命中才参与排序）
        - query 为空时按最近更新排序（用于「全部」浏览）
        - 返回 [{entry: {...}, score}]，score > 0 表示命中
        """
        q = (query or "").strip()
        tokens = _tokenize(q)
        pool = [e for e in self.entries.values() if e.enabled]
        if category:
            pool = [e for e in pool if e.category == category]
        if project:
            # 项目过滤：命中指定项目 + 通用条目（无 project）始终可检索（供上下文注入）
            pool = [e for e in pool if e.project == project or not e.project]

        scored: list[tuple[float, KnowledgeEntry]] = []
        for e in pool:
            if not tokens:
                scored.append((0.0, e))
                continue
            score = _score_entry(e, tokens)
            if score > 0:
                scored.append((score, e))
        scored.sort(key=lambda x: (-x[0], x[1].name))
        if not tokens:
            # 无关键词：按更新时间倒序浏览（无时间戳者排后）
            scored.sort(key=lambda x: (x[1].metadata.get("updated_at") or "", x[1].name), reverse=True)
        result = []
        for score, e in scored[:max(1, int(top_k or DEFAULT_TOP_K))]:
            item = e.to_dict(with_content=True)
            item["score"] = round(score, 4)
            result.append(item)
        return result

    def get_knowledge_prompt(self, query: str = "", project: str = "", top_k: int = DEFAULT_TOP_K) -> str:
        """检索式注入：Top-K 知识条目拼接为「知识库上下文」markdown 段。

        - query 为空时以 project 兜底（按项目过滤 + 最近更新）
        - 无命中返回空串（不注入）
        """
        q = (query or "").strip()
        if not q:
            q = (project or "").strip()
        hits = self.search(q, project=project, top_k=top_k)
        if not hits:
            return ""
        parts = ["\n## 知识库上下文（检索式注入）\n"]
        for h in hits:
            e = h
            parts.append(f"### {e.get('title') or e.get('name')}")
            meta_bits = [e.get("category") or ""]
            if e.get("project"):
                meta_bits.append(f"项目: {e['project']}")
            if e.get("tags"):
                meta_bits.append(f"标签: {', '.join(e['tags'])}")
            parts.append("- " + "；".join(meta_bits))
            parts.append(e.get("content", "").strip())
        return "\n\n".join(parts)

    @staticmethod
    def _invalidate_prompt_cache() -> None:
        """知识库内容变更 → system prompt 缓存失效（函数内 import 避免循环依赖）"""
        try:
            from autolink_hub.prompts.loader import invalidate_system_prompt_cache
            invalidate_system_prompt_cache()
        except Exception:
            pass


# 全局单例
_engine: KnowledgeEngine | None = None


def get_knowledge_engine() -> KnowledgeEngine:
    global _engine
    if _engine is None:
        _engine = KnowledgeEngine()
        _engine.load_all()
    return _engine


# ============================================================
# 检索打分（纯函数，便于单测）
# ============================================================

_WORD_RE = re.compile(r"[\w\u4e00-\u9fff]+")


def _tokenize(text: str) -> list[str]:
    """分词：连续字母数字/下划线/中文作为 token（中文整体作为大词 + 双字滑动窗口）"""
    if not text:
        return []
    tokens: list[str] = []
    for m in _WORD_RE.finditer(text.lower()):
        tok = m.group(0)
        tokens.append(tok)
        # 中文 → 追加双字滑动窗口（提高长句命中率）
        if len(tok) > 2 and re.search(r"[\u4e00-\u9fff]", tok):
            for i in range(len(tok) - 1):
                tokens.append(tok[i:i + 2])
    return tokens


def _score_entry(entry: KnowledgeEntry, tokens: list[str]) -> float:
    """对单条目打分：标题/分类/标签命中权重大，内容命中其次"""
    title = (entry.title or "").lower()
    category = (entry.category or "").lower()
    project = (entry.project or "").lower()
    tags = " ".join(t.lower() for t in entry.tags)
    desc = str(entry.metadata.get("description") or "").lower()
    content = (entry.content or "").lower()
    score = 0.0
    for tok in tokens:
        if tok in title:
            score += 3.0
        if tok in tags:
            score += 2.0
        if tok in category:
            score += 1.5
        if tok in project:
            score += 1.0
        if tok in desc:
            score += 1.0
        if tok in content:
            score += 0.5
    return score
