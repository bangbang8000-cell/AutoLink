"""AutoLink AI Hub Chat API（M3b：复制改造 MC ai_hub/api/chat.py，SSE 流式）

复用 autolink_hub 的 agent/llm/config/hub，端口 18722。
"""
import json
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from autolink_hub.agent.agent import get_or_create_session, clear_session
from autolink_hub.llm.provider import registry
from autolink_hub.config import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/chat", tags=["chat"])


class ChatRequest(BaseModel):
    session_id: str
    message: str
    mode: str = "general"  # template | config | general
    provider: Optional[str] = None
    attachments: Optional[list[dict]] = None
    autonomy_mode: str = "semi_auto"
    project_name: Optional[str] = None


class ProviderInfo(BaseModel):
    key: str
    name: str
    model: str
    models: list[str] = []
    enabled: bool
    is_default: bool


class ProviderListResponse(BaseModel):
    providers: list[ProviderInfo]
    default: str


class HealthResponse(BaseModel):
    status: str
    version: str
    providers: list[ProviderInfo]


def _provider_summaries() -> list[dict]:
    """AI-3：Provider 摘要（含 key 与已持久化 models，供前端水合下拉）"""
    from autolink_hub.config import PROVIDER_CATALOG, get_provider_persisted_models

    result = []
    for p in registry.list_providers():
        key = p["key"]
        catalog = PROVIDER_CATALOG.get(key, {})
        persisted = get_provider_persisted_models(key)
        models = persisted if persisted else (p.get("models") or catalog.get("models", []))
        result.append({
            "key": key,
            "name": p["name"],
            "model": p["model"],
            "models": models,
            "enabled": p["enabled"],
            "is_default": p["is_default"],
        })
    return result


@router.get("/health", response_model=HealthResponse)
async def health_check():
    """健康检查接口"""
    return HealthResponse(
        status="ok",
        version="1.0.0",
        providers=[ProviderInfo(**p) for p in _provider_summaries()],
    )


@router.get("/providers", response_model=ProviderListResponse)
async def list_providers():
    """获取可用 Provider 列表（含 key 与已持久化 models，供前端水合下拉）"""
    return ProviderListResponse(
        providers=[ProviderInfo(**p) for p in _provider_summaries()],
        default=settings.default_provider,
    )


@router.post("/send")
async def send_message(req: ChatRequest):
    """发送消息，SSE 流式响应"""
    provider = registry.get(req.provider)
    if not provider:
        raise HTTPException(
            status_code=400,
            detail=f"Provider '{req.provider or settings.default_provider}' 不可用，请先配置 API Key",
        )

    session = get_or_create_session(req.session_id)
    session.set_provider(req.provider)
    session.set_mode(req.mode, req.project_name or "")
    session.autonomy_mode = req.autonomy_mode
    session.add_user_message(req.message, req.attachments)

    async def event_generator():
        try:
            async for chunk in session.run_stream():
                yield {
                    "event": "message",
                    "data": json.dumps({"content": chunk}, ensure_ascii=False),
                }
        except Exception as e:  # noqa: BLE001
            logger.error(f"SSE error: {e}")
            yield {
                "event": "error",
                "data": json.dumps({"error": str(e)}, ensure_ascii=False),
            }
        finally:
            yield {
                "event": "done",
                "data": json.dumps({"status": "completed"}, ensure_ascii=False),
            }

    return EventSourceResponse(event_generator())


class SaveSkillRequest(BaseModel):
    name: str
    content: str


@router.post("/skill/save")
async def save_skill(req: SaveSkillRequest):
    """保存 Skill"""
    from autolink_hub.skills.engine import get_skills_engine
    engine = get_skills_engine()
    skill = engine.save_skill(req.name, req.content)
    return {"status": "ok", "name": skill.name}


@router.post("/clear")
async def clear_chat(session_id: str):
    """清除会话"""
    clear_session(session_id)
    return {"status": "ok"}


class ConfigProvidersRequest(BaseModel):
    provider: str
    api_key: str
    model: Optional[str] = None
    base_url: Optional[str] = None
    models: Optional[list[str]] = None


class SetDefaultRequest(BaseModel):
    provider: str


class TestConnectionRequest(BaseModel):
    provider: str
    api_key: str
    base_url: str
    model: str


class FetchModelsRequest(BaseModel):
    base_url: str
    api_key: str


@router.post("/config")
async def configure_provider(req: ConfigProvidersRequest):
    """配置 Provider 的 API Key（复用 autolink_hub.hub.configure_provider，diff 幂等）"""
    from autolink_hub.hub import configure_provider as hub_configure
    # M2 同构：先持久化基础配置，再回写模型列表（AI-3：避免 hub_configure 覆盖时丢失已拉取模型）
    result = hub_configure(req.provider, req.api_key, req.model or "", req.base_url or "")
    if req.models:
        from autolink_hub.config import load_secrets, save_secrets
        secrets = load_secrets()
        entry = secrets.get(req.provider, {})
        if not isinstance(entry, dict):
            entry = {}
        entry["models"] = req.models
        secrets[req.provider] = entry
        save_secrets(secrets)
    return result


@router.post("/config/default")
async def set_default_provider(req: SetDefaultRequest):
    """设置默认 Provider"""
    from autolink_hub.hub import set_default_provider as hub_set_default
    return hub_set_default(req.provider)


@router.post("/test")
async def test_connection(req: TestConnectionRequest):
    """测试 Provider 连接"""
    from autolink_hub.hub import test_connection as hub_test
    return await hub_test(req.provider, req.api_key, req.base_url, req.model)


@router.post("/models")
async def fetch_models(req: FetchModelsRequest):
    """获取可用模型列表"""
    from autolink_hub.hub import fetch_models as hub_fetch
    return await hub_fetch(req.base_url, req.api_key)
