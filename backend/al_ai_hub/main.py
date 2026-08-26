"""AutoLink AI Hub 独立进程主入口（M3b：复制改造 MC ai_hub/main.py，复用 autolink_hub）

FastAPI + SSE，由 Electron 主进程作为子进程启动（默认端口 18722，区别于 MC 18721）。
复用 autolink_hub（agent/tools/memory/provider/config），不重复实现领域逻辑。
"""
import argparse
import logging
import os
import sys

# 先注入用户数据目录（autolink_hub.config 在 import 时读取 AUTOLINK_USER_DATA）
logging.basicConfig(
    level=logging.INFO,
    format="[AL_AI_HUB] %(asctime)s %(levelname)s %(message)s",
    stream=sys.stderr,  # stderr，避免污染 stdout 就绪信号协议
)
logger = logging.getLogger(__name__)


def create_app(auth_token: str = "") -> "FastAPI":
    """构建 FastAPI 应用（含可选本地鉴权中间件），供 main() 与测试复用"""
    from fastapi import FastAPI, Request
    from fastapi.responses import JSONResponse
    from al_ai_hub.api.chat import router as chat_router

    app = FastAPI(title="AutoLink AI Hub", version="1.0.0")

    # 本地鉴权：配置了 auth_token 时所有 /api/* 请求必须携带 X-AL-Auth-Token 头
    if auth_token:
        @app.middleware("http")
        async def require_auth_token(request: Request, call_next):
            token = request.headers.get("X-AL-Auth-Token", "")
            if token != auth_token:
                return JSONResponse({"detail": "Unauthorized"}, status_code=401)
            return await call_next(request)

    app.include_router(chat_router)
    return app


def main() -> None:
    parser = argparse.ArgumentParser(description="AutoLink AI Hub Server")
    parser.add_argument("--port", type=int, default=18722, help="Server port")
    parser.add_argument("--host", type=str, default="127.0.0.1", help="Server host")
    parser.add_argument("--user-data", type=str, default="", help="AUTOLINK_USER_DATA 目录")
    parser.add_argument("--auth-token", type=str, default="",
                        help="本地鉴权 token（请求需带 X-AL-Auth-Token 头）")
    args = parser.parse_args()

    if args.user_data:
        os.environ["AUTOLINK_USER_DATA"] = args.user_data

    # 初始化 AI Hub（apply_secrets + init_tools + init_providers + memory.init_dir，幂等）
    from autolink_hub.hub import init_hub
    init_hub(args.user_data)

    # 打印就绪信号（Electron 主进程通过此信号判断启动成功）
    print(f"AL_AI_HUB_READY port={args.port}", flush=True)

    app = create_app(args.auth_token)

    import uvicorn
    uvicorn.run(app, host=args.host, port=args.port, log_level="info", log_config=None)


if __name__ == "__main__":
    main()
