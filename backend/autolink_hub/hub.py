"""AutoLink AI Hub 服务入口（v3.1.1-T5-1.5）

engine 启动时调用 init_hub()：apply_secrets → init_tools → init_providers → memory.init_dir。
ai:* action（T5-3）复用这里的管理函数（configure/set_default/test/models）。
"""
import logging
from pathlib import Path

import httpx

from autolink_hub.config import settings, apply_secrets, save_secrets, load_secrets
from autolink_hub.llm.provider import init_providers, registry
from autolink_hub.agent.tools import init_tools
from autolink_hub.memory.engine import get_memory_engine

logger = logging.getLogger(__name__)

_hub_initialized = False


def init_hub(user_data_dir: str = "") -> None:
    """初始化 AI Hub（幂等）"""
    global _hub_initialized
    if _hub_initialized:
        return
    if user_data_dir:
        settings.user_data_dir = user_data_dir
    apply_secrets()
    init_tools()
    init_providers()
    try:
        base = settings.user_data_dir or str(Path.home() / ".autolink")
        get_memory_engine().init_dir(base)
    except Exception as e:
        logger.warning(f"memory init failed: {e}")
    # 5.0.5-505-b: 初始化知识库目录（<user_data>/knowledge/，幂等）
    try:
        from autolink_hub.knowledge.engine import get_knowledge_engine
        get_knowledge_engine().init_dir(base)
    except Exception as e:
        logger.warning(f"knowledge init failed: {e}")
    # 5.0.3-503-c: 初始化时同步已配置的 MCP server 工具（惰性；未装 mcp SDK 静默跳过）
    try:
        from autolink_hub.mcp.manager import get_mcp_manager, mcp_available
        if mcp_available():
            get_mcp_manager().sync_all_blocking()
    except Exception as e:
        logger.warning(f"MCP sync failed: {e}")
    _hub_initialized = True


# ============================================================
# Provider 管理（ai:* action 复用，前端 SettingsPanel AI Tab 调用）
# ============================================================

def configure_provider(provider: str, api_key: str, model: str = "", base_url: str = "") -> dict:
    """保存 Provider 配置（BYO-Key）并热重载

    T6-1: diff 更新——配置无变化时跳过写文件与 init_providers（幂等），
    返回 changed 字段供前端判断（连续对话不再全量重建）。
    """
    secrets = load_secrets()
    new_cfg = {
        "api_key": api_key,
        "model": model or "",
        "base_url": base_url or "",
    }
    existing = secrets.get(provider, {})
    changed = not (
        (existing.get("api_key", "") or "") == new_cfg["api_key"]
        and (existing.get("model", "") or "") == new_cfg["model"]
        and (existing.get("base_url", "") or "") == new_cfg["base_url"]
    )
    if not changed:
        return {"status": "ok", "provider": provider, "changed": False}
    secrets[provider] = new_cfg
    save_secrets(secrets)
    apply_secrets()
    init_providers()
    return {"status": "ok", "provider": provider, "changed": True}


def set_default_provider(provider: str) -> dict:
    """设置默认 Provider（T6-1：未变化跳过重载，幂等）"""
    secrets = load_secrets()
    if secrets.get("default_provider") == provider and settings.default_provider == provider:
        return {"status": "ok", "default_provider": provider, "changed": False}
    secrets["default_provider"] = provider
    save_secrets(secrets)
    apply_secrets()
    init_providers()
    return {"status": "ok", "default_provider": provider, "changed": True}


async def test_connection(provider: str, api_key: str, base_url: str, model: str) -> dict:
    """测试 Provider 连接（httpx 直连 OpenAI 兼容端点）"""
    try:
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        base_url = (base_url or "").rstrip("/")

        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                f"{base_url}/chat/completions",
                headers=headers,
                json={
                    "model": model,
                    "messages": [{"role": "user", "content": "Hi"}],
                    "max_tokens": 5,
                },
            )
            if resp.status_code == 200:
                return {"status": "ok", "message": f"连接成功！模型 {model} 响应正常"}
            detail = ""
            try:
                detail = resp.json().get("error", {}).get("message", resp.text[:200])
            except Exception:
                detail = resp.text[:200]
            return {"status": "error", "message": f"HTTP {resp.status_code}: {detail}"}
    except httpx.ConnectError:
        return {"status": "error", "message": f"无法连接到 {base_url}，请检查 Base URL 是否正确"}
    except httpx.TimeoutException:
        return {"status": "error", "message": "连接超时，请检查网络或 Base URL"}
    except Exception as e:
        return {"status": "error", "message": str(e)}


async def fetch_models(base_url: str, api_key: str) -> dict:
    """获取可用模型列表"""
    try:
        headers = {"Authorization": f"Bearer {api_key}"}
        base_url = (base_url or "").rstrip("/")

        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(f"{base_url}/models", headers=headers)
            if resp.status_code == 200:
                data = resp.json()
                models = sorted(m["id"] for m in data.get("data", []))
                return {"status": "ok", "models": models}
            return {"status": "error", "models": [], "message": f"HTTP {resp.status_code}"}
    except Exception as e:
        return {"status": "error", "models": [], "message": str(e)}


def list_providers() -> list[dict]:
    """可用 Provider 列表（含 enabled / is_default）"""
    return registry.list_providers()
