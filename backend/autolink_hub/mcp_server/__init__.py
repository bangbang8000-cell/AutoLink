"""5.1.1-511-a：Agent Connect MCP Server 框架（AutoLink）。

AutoLink 将自身能力封装为标准 MCP Server（stdio），供外部 AI Agent
（Claude/Codex/Trae/VS Code 等）查询、创建、更新、渲染
项目/模板/设备库/机房规划/输出。与 `autolink_hub/mcp/`（MCP Client）角色相反。

双场景：
  - compiled（产品使用态）：只暴露白名单能力域，不修改程序本体
  - source（开发态）：追加 CLI 透传与文件系统（读源码）
"""
