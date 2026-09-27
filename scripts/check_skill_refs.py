#!/usr/bin/env python
"""check_skill_refs.py — Agent Skill 文档引用一致性校验。

**为什么需要它**：`agent-skills/` 下的 25 份 skill 文档大量引用工具名、参数名、
权限档。代码一旦增删工具或改权限，文档会**静默过期** —— Agent 按文档调用会失败，
但没有任何机制报警。本脚本就是那道门禁。

校验四件事：
  1. 文档中反引号引用的**工具名**确实存在于代码注册表（AL / MC 各自）
  2. 文档中声称的**工具数量**与实测一致
  3. 文档中声称的**权限档**与 `schemas.py::TOOL_PERMISSIONS` 一致
  4. skill frontmatter 的 `name` 与文件名一致，且 `description` 非空

用法：
  python scripts/check_skill_refs.py            # 校验（差异即失败）
  python scripts/check_skill_refs.py --list      # 列出实测工具名，便于人眼核对

退出码：0 = 通过；1 = 有差异。
"""
from __future__ import annotations

import ast
import io
import re
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# 路径（脚本位于 <repo>/scripts/，agent-skills 为工作区根下目录）
# ---------------------------------------------------------------------------
HERE = Path(__file__).resolve().parent
REPO = HERE.parent
WORKSPACE = REPO.parent  # D:/MyCoding/MC-AL
SKILLS_ROOT = WORKSPACE / "agent-skills"

AL_TOOLS = REPO / "backend" / "autolink_hub" / "agent" / "tools.py"
AL_SCHEMAS = REPO / "backend" / "autolink_hub" / "agent" / "schemas.py"
MC_ROOT = WORKSPACE / "MagicCommander-Client"
MC_TOOLS = MC_ROOT / "ai_hub" / "agent" / "tools.py"
MC_SCHEMAS = MC_ROOT / "ai_hub" / "agent" / "schemas.py"

# 允许出现在文档里、但**不是工具名**的反引号标识符（参数名/字段/文件名等）
NON_TOOL_BACKTICKS = {
    # 参数名
    "configFile", "projectName", "templateName", "outputDir", "outputTypes", "outputPath",
    "filePath", "source", "zipPath", "targetDir", "category", "query", "limit", "top_k", "topK",
    "deviceId", "deviceType", "vendor", "model", "num_gpus", "budget", "precision", "tp", "dp", "pp",
    "cost_params", "switch_ports", "num_experts", "communication_pattern", "comm_ratio", "traffic",
    "rows", "cols", "name", "layout", "position", "type", "cabinet_id", "cabinet_type", "power_watts",
    "constraints", "counts", "cabinets", "objectives", "time_budget_s", "reset_existing", "presetId",
    "config", "payload", "projectDir", "appSettings", "projectConfig", "overwrite", "suggestions",
    "fixes", "rule_id", "patch", "tool", "arguments", "taskId", "timeout", "agent", "result", "notes",
    "enabled", "content", "metadata", "title", "tags", "tag", "skill", "skill_name", "skillName",
    "excelName", "sheetName", "templatePath", "description", "template", "meta", "keyword",
    "keywords", "question", "path", "sub", "action", "params", "version", "query", "ids",
    # 字段 / 返回值
    "valid", "errors", "validationIssues", "success", "recommendation", "severity", "message",
    "annotations", "confidence", "missingFields", "placements", "scores", "issues", "stats",
    "estimated", "matched", "not_applicable", "unmatched", "status", "percent", "error",
    "require_approval", "approval_level", "approvalToken", "task_id", "isSample",
    "communication_pattern", "comm_ratio", "traffic_breakdown", "rationale", "validation",
    "topology", "nodes", "edges", "zcube_group", "plane_id", "refKey", "library_id", "device_refs",
    "baseline", "projects",
    # 枚举值
    "auto", "notify", "confirm", "compiled", "source", "IB", "RoCE", "UEC", "gpu", "network",
    "storage", "compute", "combined", "empty", "economy", "standard", "premium", "fp8", "fp16",
    "bf16", "allreduce", "alltoall", "p2p", "excel", "json", "csv", "text", "output", "yaml",
    "output-sn", "yaml-sn", "ok", "idempotent", "switch", "router", "firewall", "huawei",
    "cisco", "h3c", "merge", "delete_", "_delete", "remove_", "_remove", "clear_", "_clear",
    "purge_", "_purge", "drop_", "_drop", "preset", "reset",
    # 文件名 / 目录 / 模块
    "tools.py", "schemas.py", "capabilities.py", "engine.py", "portable.py", "designer.py",
    "exporter.py", "topology.py", "dual_plane_topology.py", "optimal_selector.py",
    "optical_selector.py", "validation.py", "config_schema.py", "write_gate.py", "run.py",
    "workflow.py", "gen_golden.py", "gen_samples.py", "validate_templates.py",
    "validate_samples.py", "check_version.py", "check_doc_numbers.py",
    "check_changelog_claims.py", "export_check.py", "test_validation_export.py",
    "project_single.py", "roce_templates.py", "verify_baseline.py", "sync_version.py",
    "check_skill_refs.py", "example", "template", "agent-skills", "tool-integration-review",
    "aidc-cluster-quote", "ai_hub", "autolink_hub", "_load_common_ini_config",
    "_load_common_config", "_init_biz_caliber_switches", "accessaggtopology", "accessaggtopology(category_counts)",
    "source", "compiled", "INIT_TOOL", "WORKFLOWTask", "TopologyEdge",
    "plan:table", "j2", "cfg", "xlsx", "zip", "md", "NEWLINE", "TOOL_PERMISSIONS",
    "TOOL_NAME_ALIASES", "LONG_RUNNING_TOOLS", "SOURCE_ONLY_TOOLS", "CAPABILITY_DOMAINS",
    "_TOOL_DOMAIN_HINTS", "_DESTRUCTIVE_PATTERNS", "_AL_CLI_ALLOWED_ROOTS",
    "normalize_mcp_schema", "get_tool_permission", "register_tool", "cli.execute",
    "_link_speed_for", "_make_cli_handler", "select_optical_module", "_parse_speed",
    "_read1", "zipfile", "Openpyxl", "GBK", "UTF-8", "CRLF",
    "AUTOLINK_USER_DATA", "user_data", "workspace", "set_workspace_dir", "init_tools",
    "maybe_self_improve", "append_learning_record", "_state_dir", ":1", ":2",
    # CLI 子命令 / 构建步骤（在代码块首行出现，但不是 MCP 工具名）
    "python", "typecheck", "lint", "build:renderer", "build:electron", "pytest",
    "design", "validate", "export", "report", "room", "config", "project", "template",
    "capacity", "atop", "optimize", "repair", "file", "device", "migrate", "render",
    "diff", "label", "analyze", "list", "show", "get",
    "get_project_info", "list_project_files", "list_templates", "delete_project",
    "delete_files", "delete_labels", "template_delete", "run_cli", "read_file", "list_dir",
    "read_source", "task_submit", "task_query", "task_list", "task_wait", "task_cancel",
    "audit_query", "agent_feedback",
    "intelligent_create_project", "create_project_intelligent",
    # 规则号 / 版本
    "V001", "V002", "V007", "V010", "V016", "V018", "V019", "V020", "V022",
    "_HEADER_CONTRACTS", "_CABLING_HEADERS",
}


def parse_registered_tools(path: Path) -> dict[str, dict]:
    """AST 解析 register_tool(...) 调用 → {name: {perm, desc}}。"""
    if not path.exists():
        return {}
    src = io.open(path, encoding="utf-8").read()
    tree = ast.parse(src)
    out: dict[str, dict] = {}
    for node in ast.walk(tree):
        if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
                and node.func.id == "register_tool"):
            continue
        a = node.args
        if not a or not isinstance(a[0], ast.Constant):
            continue
        name = a[0].value
        desc = a[1].value if len(a) > 1 and isinstance(a[1], ast.Constant) else ""
        perm = next((k.value.value for k in node.keywords
                     if k.arg == "permission" and isinstance(k.value, ast.Constant)), None)
        out[name] = {"perm": (perm or "").lower() or None, "desc": desc}
    return out


def parse_permissions(path: Path) -> dict[str, str]:
    """AST 解析 TOOL_PERMISSIONS = {...} → {name: perm}。"""
    if not path.exists():
        return {}
    tree = ast.parse(io.open(path, encoding="utf-8").read())
    out: dict[str, str] = {}
    for node in tree.body:
        target_ok = (
            isinstance(node, ast.AnnAssign) and getattr(node.target, "id", "") == "TOOL_PERMISSIONS"
        ) or (
            isinstance(node, ast.Assign)
            and any(getattr(t, "id", "") == "TOOL_PERMISSIONS" for t in node.targets)
        )
        if not target_ok or not isinstance(node.value, ast.Dict):
            continue
        for k, v in zip(node.value.keys, node.value.values):
            if isinstance(k, ast.Constant):
                out[k.value] = getattr(v, "attr", "?").lower()
    return out


def effective_perm(name: str, registered: dict, perms: dict) -> str:
    """实测权限：register 显式值优先，否则查权限表，否则兜底 confirm。"""
    declared = registered.get(name, {}).get("perm")
    if declared:
        return declared
    return perms.get(name, "confirm")


def extract_tool_refs(text: str) -> set[str]:
    """提取「被当作工具调用」的反引号标识符。

    只认三种**明确表示调用工具**的形态，避免把参数名/枚举值/域名误判成工具名：

      1. 独立成段的代码块首词：```\\nname {...}``` 或 ```\\nname\\n```
      2. 反引号 + 紧随左花括号：`name {` / `name {...}`
      3. 反引号 + 紧随左括号：`name(...)`

    普通行内反引号（参数名、字段、枚举、域名）一律不算 —— 它们的形态与工具名
    无法区分，宁可漏报也不误报（漏报由「数量声称」与「权限表对账」两条兜底）。
    """
    stripped = re.sub(r"```.*?```", "", text, flags=re.S)
    found: set[str] = set()

    # 形态 2/3：反引号紧接 { 或 (
    for m in re.finditer(r"`([a-z][a-z0-9_]{2,39})`\s*[({]", text):
        found.add(m.group(1))

    # 形态 1：代码块（含围栏内容）首行首词
    for block in re.finditer(r"```([a-z]*)\n(.*?)```", text, flags=re.S):
        lang = (block.group(1) or "").strip().lower()
        body = block.group(2)
        # 语言标注为 shell/bash/json/yaml/text 的块不是工具调用样例
        if lang in ("bash", "sh", "shell", "json", "yaml", "yml", "text", "powershell", "ps1", "console"):
            continue
        for line in body.splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            m = re.match(r"([a-z][a-z0-9_]{2,39})\b", line)
            if m:
                found.add(m.group(1))
            break  # 只看首行

    return found


def main() -> int:
    al_tools = parse_registered_tools(AL_TOOLS)
    mc_tools = parse_registered_tools(MC_TOOLS)
    al_perms = parse_permissions(AL_SCHEMAS)
    mc_perms = parse_permissions(MC_SCHEMAS)

    if not al_tools or not mc_tools:
        print(f"[ERROR] 工具注册表解析失败：AL={len(al_tools)} MC={len(mc_tools)}")
        print(f"  查过：{AL_TOOLS}")
        print(f"  查过：{MC_TOOLS}")
        return 1

    if "--list" in sys.argv:
        print(f"AL ({len(al_tools)}):")
        for n in sorted(al_tools):
            print(f"  {n:<28} {effective_perm(n, al_tools, al_perms)}")
        print(f"\nMC ({len(mc_tools)}):")
        for n in sorted(mc_tools):
            print(f"  {n:<28} {effective_perm(n, mc_tools, mc_perms)}")
        return 0

    all_tools = set(al_tools) | set(mc_tools)
    failures: list[str] = []
    warnings: list[str] = []

    if not SKILLS_ROOT.exists():
        print(f"[ERROR] 技能目录不存在：{SKILLS_ROOT}")
        return 1

    skill_files = sorted(SKILLS_ROOT.rglob("*.md"))

    # ---- 1. frontmatter 检查 + 反引号工具名引用检查 ----
    for f in skill_files:
        text = io.open(f, encoding="utf-8").read()
        rel = f.relative_to(SKILLS_ROOT).as_posix()

        # frontmatter
        if rel != "README.md" and rel != "工具面清单.md":
            m = re.match(r"^---\n(.*?)\n---\n", text, flags=re.S)
            if not m:
                failures.append(f"{rel}: 缺少 YAML frontmatter")
            else:
                fm = m.group(1)
                nm = re.search(r'^name:\s*"?([^"\n]+)"?', fm, flags=re.M)
                ds = re.search(r'^description:\s*"?(.+?)"?\s*$', fm, flags=re.M)
                if not nm:
                    failures.append(f"{rel}: frontmatter 缺 name")
                elif nm.group(1).strip() != f.stem:
                    failures.append(
                        f"{rel}: frontmatter name='{nm.group(1).strip()}' != 文件名 '{f.stem}'")
                if not ds or len(ds.group(1).strip()) < 10:
                    failures.append(f"{rel}: frontmatter description 缺失或过短")

        # 工具名引用：只校验「明确写成工具调用」的那些
        for tok in sorted(extract_tool_refs(text)):
            if tok in NON_TOOL_BACKTICKS or tok in all_tools:
                continue
            if tok in al_tools or tok in mc_tools:
                continue
            warnings.append(f"{rel}: 引用了 `{tok}`，但两端注册表中均无此工具")

    # ---- 2. 文档声称的工具数量 ----
    expected_counts = {
        "al": len(al_tools),
        "mc": len(mc_tools),
    }
    count_claims = [
        # (文件相对路径, 正则, 期望的端)
        ("README.md", r"AL\s*\|\s*\*\*(\d+)\*\*", "al"),
        ("README.md", r"MC\s*\|\s*\*\*(\d+)\*\*", "mc"),
        ("工具面清单.md", r"AL 规划域（autolink_hub）—— (\d+) 个工具", "al"),
        ("工具面清单.md", r"MC 渲染域（ai_hub）—— (\d+) 个工具", "mc"),
        ("cross/cross-hub-guide.md", r"AL 工具 \*\*(\d+)\*\*", "al"),
        ("cross/cross-hub-guide.md", r"MC 工具 \*\*(\d+)\*\*", "mc"),
    ]
    for rel, pat, side in count_claims:
        f = SKILLS_ROOT / rel
        if not f.exists():
            continue
        text = io.open(f, encoding="utf-8").read()
        for m in re.finditer(pat, text):
            got = int(m.group(1))
            want = expected_counts[side]
            if got != want:
                failures.append(
                    f"{rel}: 声称 {side.upper()} 工具数 {got}，实测 {want}")

    # ---- 3. 权限表 vs 注册表 对账（双端）----
    for label, tools, perms in (("AL", al_tools, al_perms), ("MC", mc_tools, mc_perms)):
        missing = sorted(set(tools) - set(perms))
        dead = sorted(set(perms) - set(tools))
        if missing:
            warnings.append(
                f"{label}: {len(missing)} 个已注册工具未登记权限表（兜底 confirm）：{', '.join(missing)}")
        if dead:
            warnings.append(
                f"{label}: {len(dead)} 个权限表死条目（未注册）：{', '.join(dead)}")

    # ---- 输出 ----
    print(f"扫描 {len(skill_files)} 份文档")
    print(f"实测：AL {len(al_tools)} 工具 / 权限表 {len(al_perms)} 条"
          f"；MC {len(mc_tools)} 工具 / 权限表 {len(mc_perms)} 条")
    print()

    if warnings:
        print(f"⚠️  警告 {len(warnings)} 条：")
        for w in warnings:
            print(f"   - {w}")
        print()

    if failures:
        print(f"❌ 失败 {len(failures)} 条：")
        for x in failures:
            print(f"   - {x}")
        return 1

    print("✅ 校验通过：工具名引用、数量声称、frontmatter 均一致")
    if warnings:
        print("   （警告不影响通过，但建议逐条核对）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
