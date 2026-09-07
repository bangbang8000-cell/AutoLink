"""5.1.3-513-b/c：写入语义层（L2 语义校验闸门 + L3 幂等/暂存语义，AutoLink）。

编译态写入工具（create/update/import/delete/save/apply/repair）须满足：
- L2 语义校验：写入结果结构完整、无 error 标记；必要时可附加校验报告
- L3 幂等：同 projectId+planHash 重复提交返回"已存在"而非重复写入
- L3 暂存/提交：写入先落在临时区，校验通过才视为已提交（语义标记）
"""
from typing import Any

_WRITE_TOOL_PREFIXES = (
    "create_", "update_", "import_", "delete_", "save_", "apply_", "repair_", "optimize_",
)
_NON_WRITE_PREFIXES = ("list_", "get_", "query_", "validate_", "check_", "analyze_", "export_", "preview_", "dry_run_")
_VALIDATE_REQUIRED_PREFIXES = ("create_", "update_", "import_", "apply_", "repair_")
_IDEMPOTENT_KEYS = ("projectId", "project_id", "planHash", "plan_hash", "name")


def is_write_tool(name: str) -> bool:
    """判断工具是否写入类（编译态需要 L2/L3 语义）。"""
    if any(name.startswith(p) for p in _NON_WRITE_PREFIXES):
        return False
    return any(name.startswith(p) for p in _WRITE_TOOL_PREFIXES)


def requires_l2_validation(name: str) -> bool:
    """是否必须过 L2 语义校验（核心写入工具）。"""
    return any(name.startswith(p) for p in _VALIDATE_REQUIRED_PREFIXES)


def idempotency_key(arguments: dict[str, Any]) -> str | None:
    """从入参提取幂等键（projectId + planHash 组合，优先 projectId）。"""
    args = arguments or {}
    keys = []
    for k in ("projectId", "project_id"):
        v = args.get(k)
        if isinstance(v, str) and v:
            keys.append(f"id={v}")
    for k in ("planHash", "plan_hash"):
        v = args.get(k)
        if isinstance(v, str) and v:
            keys.append(f"hash={v}")
    name = args.get("name")
    if isinstance(name, str) and name and not keys:
        keys.append(f"name={name}")
    return ";".join(keys) if keys else None


def check_idempotent(records: dict[str, Any], tool: str, arguments: dict[str, Any]) -> dict[str, Any] | None:
    """L3 幂等检查：若该 (tool, key) 已提交，返回"已存在"结构化响应；否则 None。

    5.1.5-515-a：标记可携带已提交结果（{"result": ...}），重放请求返回原始结果，
    保证"幂等重放"语义 —— 相同请求重复提交不再重复写入，且结果确定一致。
    兼容旧标记（True）—— 仅返回"已存在"消息，无重放结果。
    """
    key = idempotency_key(arguments)
    if not key:
        return None
    marker = f"{tool}:{key}"
    if marker not in records:
        return None
    stored = records[marker]
    replay = stored.get("result") if isinstance(stored, dict) else None
    return {
        "success": True,
        "idempotent": True,
        "result": {
            "message": "已存在（幂等：相同请求已处理，未重复写入）",
            "idempotency_key": key,
            "replay": replay,
        },
    }


def validate_result(tool: str, result: dict[str, Any]) -> dict[str, Any]:
    """L2 语义校验：写入结果结构完整、无 error 标记。"""
    if not isinstance(result, dict):
        return {"success": False, "error": f"工具 {tool} 返回结构非法（非对象）"}
    if result.get("success") is False:
        return {"success": False, "error": result.get("error", f"工具 {tool} 执行失败")}
    status = result.get("result", {})
    if isinstance(status, dict) and status.get("status") == "error":
        return {"success": False, "error": status.get("error") or status.get("message") or f"工具 {tool} 业务失败"}
    return {"success": True, "result": result.get("result")}
