"""AutoLink AI Hub（v3.1.1-T5-1 移植 MagicCommander ai_hub，非 HTTP）

架构（v3.1.1 AIHUB 对话框架）：
  - 以 Python 模块形式随 engine.py 加载，不启动独立 FastAPI 服务
  - `ai:chat` 注册为 engine action，流式回复经 engine 的 emit_event 通道
  - LLM 工具调用经 autolink-cli 执行层（cli.execute），自动获得审计轨迹
  - secrets 落 $AUTOLINK_USER_DATA/ai_secrets.json（与 cli 审计路径同源）

子模块：
  - config    Provider 目录 + secrets 管理（autolink 化，无 pydantic 依赖）
  - llm       9 厂商 OpenAI 兼容 Provider（原样移植 MC provider.py）
  - agent     run_stream 工具调用循环 + validator/recovery/context/schemas
  - memory    用户画像/项目历史/操作习惯（JSON 持久化）
  - skills    可复用多步流程（md 注入 system prompt）
  - prompts   场景化 prompt 加载与缓存
"""
