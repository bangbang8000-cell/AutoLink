"""AutoLink AI Hub 规划器（v3.1.1-T5-1.4，移植 MC ai_hub/agent/planner.py，autolink 化）

把"先规划再执行"的引导语注入 system prompt
"""
import re

PLANNER_PROMPT = """
## 执行规划

执行复杂任务前，先输出简要计划：

📋 执行计划
1. <步骤> — 使用工具: <工具名>
2. <步骤> — 使用工具: <工具名>

随后按计划逐步执行工具，每步完成后向用户简要汇报结果。
"""


def get_planner_prompt() -> str:
    return PLANNER_PROMPT


def parse_plan_from_response(content: str) -> list[dict]:
    """从响应中解析 📋 执行计划块，返回 [{step, description, tool}]"""
    plan = []
    m = re.search(r"📋 执行计划[：:]\s*\n(.*?)(?:\n\n|\Z)", content, re.DOTALL)
    if not m:
        return plan
    for line in m.group(1).splitlines():
        line = line.strip()
        if not line:
            continue
        m2 = re.match(r"(\d+)[.、]\s*(.*?)(?:—|——|-)\s*(?:使用工具[：:]?\s*)?([a-z_]+)", line)
        if m2:
            plan.append({"step": int(m2.group(1)), "description": m2.group(2).strip(),
                          "tool": m2.group(3).strip()})
    return plan
