"""AutoLink AI Hub Prompt 管理模块（v3.1.1-T5-1.3，移植 MC ai_hub/prompts/loader.py）

从 autolink_hub/prompts/ 目录加载场景化提示词，支持缓存与热更新
"""
from pathlib import Path
from typing import Optional

# Prompt 文件目录
PROMPTS_DIR = Path(__file__).parent

# 缓存
_cache: dict[str, str] = {}

# T6-2: system prompt 缓存（键: (mode, project_name, version)），命中不重建
_system_prompt_cache: dict[tuple, str] = {}
_cache_version = 0


def invalidate_system_prompt_cache() -> None:
    """T6-2: 使 system prompt 缓存失效（prompts/skills/memory 内容变更时调用）"""
    global _cache_version
    _cache_version += 1
    _system_prompt_cache.clear()


def load_prompt(name: str) -> str:
    """加载指定名称的 prompt 文件"""
    if name in _cache:
        return _cache[name]

    file_path = PROMPTS_DIR / f"{name}.md"
    if file_path.exists():
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                content = f.read().strip()
            _cache[name] = content
            return content
        except Exception:
            pass

    # 返回默认提示词
    return _get_default_prompt(name)


def get_system_prompt(mode: Optional[str] = None, project_name: str = "") -> str:
    """获取完整的系统提示词（基础 + planner + skills + tools + mode + context + memory）

    T6-2: 按 (mode, project_name, version) 缓存，prompts/skills/memory 变更时失效重建。
    """
    key = (mode, project_name, _cache_version)
    if key in _system_prompt_cache:
        return _system_prompt_cache[key]

    base = load_prompt("system")
    tools = load_prompt("mc-tools")

    from autolink_hub.agent.planner import get_planner_prompt
    planner = get_planner_prompt()

    from autolink_hub.skills.engine import get_skills_engine
    skills_prompt = get_skills_engine().get_skills_prompt()

    parts = [base, planner, tools, skills_prompt]

    if mode and mode in ("template", "config", "general"):
        mode_prompt = load_prompt(mode)
        if mode_prompt:
            parts.append(mode_prompt)

    from autolink_hub.memory.engine import get_memory_engine
    memory_prompt = get_memory_engine().get_memory_prompt(project_name)
    if memory_prompt:
        parts.append(memory_prompt)

    result = "\n\n".join(parts)
    _system_prompt_cache[key] = result
    return result


def reload_prompts() -> None:
    """重新加载所有 prompt（用于热更新）"""
    _cache.clear()
    invalidate_system_prompt_cache()


def _get_default_prompt(name: str) -> str:
    """获取默认提示词"""
    defaults = {
        "system": "你是 AutoLink 的 AI 助手，专门帮助用户进行 AI 数据中心网络规划（拓扑设计/设备选型/机房布局）。使用中文回复。",
        "template": "当前处于模板帮助模式。请重点帮助用户查看、创建和使用场景模板。",
        "config": "当前处于配置问答模式。请重点帮助用户校验设计配置并解释校验结果。",
        "general": "当前处于通用助手模式。请自由回答用户的问题。",
    }
    return defaults.get(name, "")
