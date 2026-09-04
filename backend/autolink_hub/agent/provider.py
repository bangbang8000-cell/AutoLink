"""AutoLink AI Hub Agent Provider 抽象层（5.0.2-502-a：AI Agent 底座 / Hermes 并存）

「适配器骨架 + 探测降级」设计（与 MC ai_hub/agent/provider.py 同构对齐）：
- AgentProvider 抽象基类：会话 stream chat + clear_session / 工具 list_tools+execute_tool /
  技能 list_skills+get_skill / 记忆 get_memory_prompt
- OwnAgentProvider：包装既有 AgentSession / SkillsEngine / MemoryEngine / tools（自有引擎适配）
- HermesAgentProvider：适配 NousResearch/hermes-agent（探测 importlib.find_spec，
  未安装 → AgentNotAvailableError 友好提示；已安装 → 惰性调用其 Python API，
  Hermes 原生 MEMORY.md / USER.md / SKILL.md 映射）
- 引擎注册表/路由：get_engine(mode) ∈ {own, hermes, auto}；
  auto = hermes 可用且启用则 hermes 否则 own

本版不真实 pip 安装 hermes-agent：Hermes 成熟后经 AgentProvider 无缝启用（探测降级）。
"""
import importlib.util
import logging
import os
from abc import ABC, abstractmethod
from pathlib import Path
from typing import AsyncIterator, Optional

logger = logging.getLogger(__name__)

# ============================================================
# 引擎常量
# ============================================================

ENGINE_OWN = "own"
ENGINE_HERMES = "hermes"
ENGINE_AUTO = "auto"
ENGINE_MODES = (ENGINE_OWN, ENGINE_HERMES, ENGINE_AUTO)

# Hermes 运行时模块名（find_spec 任一命中即视为已安装）
HERMES_MODULES = ("hermes", "hermes_agent")

HERMES_OFFICIAL_URL = "https://github.com/NousResearch/hermes-agent"
HERMES_INSTALL_HINT = (
    "Hermes 引擎未安装。请先执行 `pip install hermes-agent` 安装 "
    f"（项目地址：{HERMES_OFFICIAL_URL}），安装后重启 AI Hub 即可切换启用。"
)

HERMES_BASE_PROMPT = (
    "你是 AutoLink 的 AI 助手，专门帮助用户进行 AI 数据中心网络规划"
    "（拓扑设计/设备选型/机房布局）。使用中文回复。"
)


class AgentNotAvailableError(RuntimeError):
    """Agent 引擎不可用（如 Hermes 未安装）"""


# ============================================================
# AgentProvider 抽象基类（与 MC ai_hub/agent/provider.py 接口对齐）
# ============================================================

class AgentProvider(ABC):
    """AI Agent 引擎 Provider 抽象基类（会话 / 工具 / 技能 / 记忆四域）

    与 MC 端同构：AL 用 ABC（与既有 LLMProvider 一致）；MC 端若用 typing.Protocol，
    本类的方法签名保持一致，适配器可互灌。
    """

    @property
    @abstractmethod
    def engine_name(self) -> str:
        """引擎标识：own / hermes"""

    # ---- 会话 ----

    @abstractmethod
    async def stream_chat(
        self,
        session_id: str,
        message: str,
        mode: str = "general",
        provider: Optional[str] = None,
        attachments: Optional[list[dict]] = None,
        autonomy_mode: str = "semi_auto",
        project_name: Optional[str] = None,
        knowledge: Optional[str] = None,
    ) -> AsyncIterator[str]:
        """流式对话（逐 chunk 产出文本；5.0.5-505-c：knowledge 为知识库检索 query，可选）"""

    @abstractmethod
    def clear_session(self, session_id: str) -> None:
        """清除会话（保留其他引擎同名会话）"""

    # ---- 工具 ----

    @abstractmethod
    def list_tools(self) -> list[dict]:
        """工具清单（JSON-Schema 风格，含 permission）"""

    @abstractmethod
    async def execute_tool(self, name: str, arguments: dict) -> dict:
        """执行工具，返回 {success, result/error}"""

    # ---- 技能 ----

    @abstractmethod
    def list_skills(self) -> list[dict]:
        """技能清单"""

    @abstractmethod
    def get_skill(self, name: str) -> Optional[dict]:
        """技能详情（不存在返回 None）"""

    # ---- 记忆 ----

    @abstractmethod
    def get_memory_prompt(self, project_name: str = "") -> str:
        """记忆 prompt 片段（按项目）"""


# ============================================================
# OwnAgentProvider：自有引擎适配（包装既有 AgentSession/Skills/Memory/tools）
# ============================================================

class OwnAgentProvider(AgentProvider):
    """自有引擎适配器：包装 AgentSession / SkillsEngine / MemoryEngine / tools"""

    @property
    def engine_name(self) -> str:
        return ENGINE_OWN

    async def stream_chat(
        self,
        session_id: str,
        message: str,
        mode: str = "general",
        provider: Optional[str] = None,
        attachments: Optional[list[dict]] = None,
        autonomy_mode: str = "semi_auto",
        project_name: Optional[str] = None,
        knowledge: Optional[str] = None,
    ) -> AsyncIterator[str]:
        from autolink_hub.agent.agent import get_or_create_session
        session = get_or_create_session(session_id, engine=ENGINE_OWN)
        session.set_provider(provider)
        session.set_mode(mode, project_name or "", knowledge or "")
        session.autonomy_mode = autonomy_mode
        session.add_user_message(message, attachments)
        async for chunk in session.run_stream():
            yield chunk

    def clear_session(self, session_id: str) -> None:
        from autolink_hub.agent.agent import clear_session
        clear_session(session_id, engine=ENGINE_OWN)

    def list_tools(self) -> list[dict]:
        from autolink_hub.agent.tools import get_tool_definitions
        return get_tool_definitions()

    async def execute_tool(self, name: str, arguments: dict) -> dict:
        from autolink_hub.agent.tools import execute_tool
        return await execute_tool(name, arguments)

    def list_skills(self) -> list[dict]:
        from autolink_hub.skills.engine import get_skills_engine
        return get_skills_engine().list_skills()

    def get_skill(self, name: str) -> Optional[dict]:
        from autolink_hub.skills.engine import get_skills_engine
        skill = get_skills_engine().get_skill(name)
        if skill is None:
            return None
        return {
            "name": skill.name,
            "enabled": skill.enabled,
            "use_count": skill.use_count,
            "last_used": skill.last_used,
            "content": skill.content,
        }

    def get_memory_prompt(self, project_name: str = "") -> str:
        from autolink_hub.memory.engine import get_memory_engine
        return get_memory_engine().get_memory_prompt(project_name)


# ============================================================
# HermesAgentProvider：NousResearch/hermes-agent 适配（探测降级）
# ============================================================

def hermes_available() -> bool:
    """探测 Hermes 运行时是否已安装（importlib.find_spec，不真实导入/安装）"""
    for mod in HERMES_MODULES:
        if importlib.util.find_spec(mod) is not None:
            return True
    return False


class HermesAgentProvider(AgentProvider):
    """Hermes 适配器（NousResearch/hermes-agent）

    - 未安装：构造即抛 AgentNotAvailableError（友好提示 pip install + 官网）
    - 已安装：惰性 import hermes，映射对话 / 工具 / 技能 / 记忆
      （Hermes 原生 MEMORY.md / USER.md / SKILL.md；工具复用 AutoLink 白名单直调 cli.execute）

    适配契约（期望的 hermes 模块接口）：
      - hermes.stream_chat(messages, system_prompt, tools) -> 文本 chunk 异步/同步迭代器
      - hermes.chat(messages, system_prompt, tools) -> str（同步回退）
    """

    @property
    def engine_name(self) -> str:
        return ENGINE_HERMES

    def __init__(self):
        if not hermes_available():
            raise AgentNotAvailableError(HERMES_INSTALL_HINT)
        self._hermes: Optional[object] = None
        # Hermes 会话历史（进程内内存态；切换引擎保留，clear_session 清理）
        self._sessions: dict[str, list[dict]] = {}

    # ---- 探测 / 加载 ----

    def _load(self) -> object:
        """惰性加载 hermes 模块（探测已确认可用，双模块名回退）"""
        if self._hermes is None:
            try:
                import hermes  # noqa: E402  # 探测确认可用后真实导入
            except ImportError:
                import hermes_agent as hermes  # noqa: E402
            self._hermes = hermes
        return self._hermes

    def _history(self, session_id: str) -> list[dict]:
        return self._sessions.setdefault(session_id, [])

    # ---- 会话 ----

    async def stream_chat(
        self,
        session_id: str,
        message: str,
        mode: str = "general",
        provider: Optional[str] = None,
        attachments: Optional[list[dict]] = None,
        autonomy_mode: str = "semi_auto",
        project_name: Optional[str] = None,
        knowledge: Optional[str] = None,
    ) -> AsyncIterator[str]:
        """流式对话：委托 Hermes 运行时（messages 历史 + system_prompt + AutoLink 工具）"""
        hermes = self._load()
        history = self._history(session_id)
        content = message
        if attachments:
            file_list = "\n".join(
                f"- {a.get('name')} ({a.get('type')}) — {a.get('path')}" for a in attachments
            )
            content = (
                "用户上传了以下附件（如需解析请调用 parse_file 工具，参数 path=附件路径）：\n"
                f"{file_list}\n\n用户消息：{content}"
            )
        history.append({"role": "user", "content": content})
        system_prompt = self._build_system_prompt(mode, project_name or "", knowledge or "")
        tools = self.list_tools()

        stream_fn = getattr(hermes, "stream_chat", None)
        if stream_fn is None:
            # Hermes 仅提供同步/非流式 chat 时回退
            chat_fn = getattr(hermes, "chat", None)
            if chat_fn is None:
                yield f"\n\n> Hermes 运行时缺少 stream_chat/chat 接口，请升级 hermes-agent。\n\n"
                return
            reply = chat_fn(messages=list(history), system_prompt=system_prompt, tools=tools)
            if hasattr(reply, "__await__"):
                reply = await reply
            text = reply if isinstance(reply, str) else str(getattr(reply, "content", "") or "")
            history.append({"role": "assistant", "content": text})
            for piece in _chunk_text(text):
                yield piece
            return

        try:
            stream = stream_fn(messages=list(history), system_prompt=system_prompt, tools=tools)
            parts: list[str] = []
            async for chunk in _to_async_iter(stream):
                text = chunk if isinstance(chunk, str) else str(getattr(chunk, "content", "") or "")
                if not text:
                    continue
                parts.append(text)
                yield text
            history.append({"role": "assistant", "content": "".join(parts)})
        except Exception as e:  # noqa: BLE001
            logger.error(f"Hermes stream_chat error: {e}")
            yield f"\n\n> Hermes 调用失败: {e}\n\n"

    def clear_session(self, session_id: str) -> None:
        self._sessions.pop(session_id, None)

    def _build_system_prompt(self, mode: str, project_name: str, knowledge: str = "") -> str:
        """组装 Hermes 系统提示：基础身份 + 模式 + 记忆 + 知识库上下文（5.0.5-505-c）"""
        parts = [HERMES_BASE_PROMPT]
        mode_prompt = {
            "template": "当前处于模板帮助模式。请重点帮助用户查看、创建和使用场景模板。",
            "config": "当前处于配置问答模式。请重点帮助用户校验设计配置并解释校验结果。",
            "general": "当前处于通用助手模式。请自由回答用户的问题。",
        }.get(mode or "general")
        if mode_prompt:
            parts.append(mode_prompt)
        memory = self.get_memory_prompt(project_name)
        if memory:
            parts.append(memory)
        try:
            from autolink_hub.knowledge.engine import get_knowledge_engine
            kctx = get_knowledge_engine().get_knowledge_prompt(knowledge or project_name, project_name)
            if kctx:
                parts.append(kctx)
        except Exception:  # noqa: BLE001
            pass
        return "\n\n".join(parts)

    # ---- 工具（复用 AutoLink 白名单，直调 cli.execute 同进程）----

    def list_tools(self) -> list[dict]:
        from autolink_hub.agent.tools import get_tool_definitions
        return get_tool_definitions()

    async def execute_tool(self, name: str, arguments: dict) -> dict:
        from autolink_hub.agent.tools import execute_tool
        return await execute_tool(name, arguments)

    # ---- 技能（Hermes 原生 SKILL.md）----

    @staticmethod
    def _hermes_workdir() -> Path:
        """Hermes 原生工作目录：优先 $AUTOLINK_USER_DATA/hermes，兜底 ~/.hermes"""
        user_data = os.environ.get("AUTOLINK_USER_DATA", "")
        if user_data:
            return Path(user_data) / "hermes"
        return Path.home() / ".hermes"

    def _read_native_file(self, name: str) -> str:
        """读取 Hermes 原生文件（MEMORY.md / USER.md / SKILL.md），不存在返回空串"""
        path = self._hermes_workdir() / name
        try:
            if path.exists():
                return path.read_text(encoding="utf-8").strip()
        except OSError:
            pass
        return ""

    def list_skills(self) -> list[dict]:
        """Hermes 原生技能：SKILL.md（单文件技能清单，后续扩展多技能目录）"""
        content = self._read_native_file("SKILL.md")
        if not content:
            return []
        return [{
            "name": "SKILL.md",
            "enabled": True,
            "use_count": 0,
            "last_used": "",
            "content": content,
        }]

    def get_skill(self, name: str) -> Optional[dict]:
        for s in self.list_skills():
            if s["name"] == name or s["name"].lower() == name.lower():
                return s
        return None

    # ---- 记忆（Hermes 原生 MEMORY.md / USER.md）----

    def get_memory_prompt(self, project_name: str = "") -> str:
        """Hermes 原生记忆：USER.md（用户画像）+ MEMORY.md（长期记忆）"""
        parts = []
        user_md = self._read_native_file("USER.md")
        if user_md:
            parts.append("## 用户画像\n" + user_md)
        memory_md = self._read_native_file("MEMORY.md")
        if memory_md:
            parts.append("## 长期记忆\n" + memory_md)
        return "\n\n".join(parts)


# ============================================================
# 引擎注册表 / 路由
# ============================================================

_providers: dict[str, AgentProvider] = {}


def get_own_provider() -> OwnAgentProvider:
    """自有引擎单例"""
    if ENGINE_OWN not in _providers:
        _providers[ENGINE_OWN] = OwnAgentProvider()
    return _providers[ENGINE_OWN]  # type: ignore[return-value]


def get_hermes_provider() -> HermesAgentProvider:
    """Hermes 引擎单例（未安装构造即抛 AgentNotAvailableError）"""
    if ENGINE_HERMES not in _providers:
        _providers[ENGINE_HERMES] = HermesAgentProvider()
    return _providers[ENGINE_HERMES]  # type: ignore[return-value]


def resolve_engine(mode: Optional[str] = None) -> str:
    """解析引擎模式为实际引擎：own/hermes 原样返回；auto=hermes 可用则 hermes 否则 own"""
    from autolink_hub.config import get_ai_engine
    m = (mode or get_ai_engine() or ENGINE_OWN).strip().lower()
    if m == ENGINE_HERMES:
        return ENGINE_HERMES
    if m == ENGINE_AUTO:
        return ENGINE_HERMES if hermes_available() else ENGINE_OWN
    return ENGINE_OWN


def get_engine(mode: Optional[str] = None) -> AgentProvider:
    """按引擎模式返回 AgentProvider（路由注册表）

    - own → OwnAgentProvider
    - hermes → HermesAgentProvider（未安装抛 AgentNotAvailableError）
    - auto → hermes 可用且启用则 hermes，否则 own
    """
    resolved = resolve_engine(mode)
    if resolved == ENGINE_HERMES:
        return get_hermes_provider()
    return get_own_provider()


def engine_availability() -> dict:
    """各引擎可用性（供前端提示：hermes 未安装展示安装指引）"""
    installed = hermes_available()
    return {
        "own": {"available": True, "name": "自有引擎"},
        "hermes": {
            "available": installed,
            "name": "Hermes",
            "install_hint": "" if installed else HERMES_INSTALL_HINT,
            "official_url": HERMES_OFFICIAL_URL,
        },
    }


def reset_provider_registry() -> None:
    """清空引擎注册表（测试隔离用）"""
    _providers.clear()


# ============================================================
# 工具函数
# ============================================================

async def _to_async_iter(stream) -> AsyncIterator:
    """把同步/异步迭代器统一为异步迭代器（Hermes 流式适配）"""
    if hasattr(stream, "__aiter__"):
        async for item in stream:
            yield item
    else:
        for item in stream:
            yield item


def _chunk_text(text: str, size: int = 120) -> list[str]:
    """把完整回复切分为 SSE 流式 chunk（每 chunk 定长）"""
    if not text:
        return []
    return [text[i:i + size] for i in range(0, len(text), size)]
