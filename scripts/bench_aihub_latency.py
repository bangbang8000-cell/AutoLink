"""V3.1.2-T6-8: AIHUB 响应延迟基准（mock LLM，排除网络）

本地可复现地测量对话链路关键延迟指标：
  TTFT —— 发送消息到首个文本 chunk 到达的耗时（首字延迟）
  TTA  —— 工具调用场景：发送到检出完整 tool call（T6-5 流式早停）并开始执行的耗时
  吞吐 —— 流式输出速率（字符/s，排除首字等待）

用法：
  python scripts/bench_aihub_latency.py [--rounds 20]

输出平均/中位数/最小/最大；TTA 依赖 T6-5 早停（v3.1.1 需等 LLM 完整输出后
才执行工具，本基准体现早停收益）。
"""
import argparse
import asyncio
import os
import statistics
import sys
import tempfile
import time

# 让 backend 可导入（脚本位于 scripts/，后端在 backend/）
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend"))
# 基准期间审计落临时目录，避免污染用户数据
os.environ.setdefault("AUTOLINK_AUDIT_PATH", os.path.join(tempfile.gettempdir(), "autolink-bench-audit.jsonl"))

from autolink_hub.agent.agent import AgentSession  # noqa: E402
from autolink_hub.agent.tools import init_tools  # noqa: E402


class BenchProvider:
    """mock LLM：首 token 延迟 + 逐 token 间隔，可配置每轮响应"""

    def __init__(self, first_token_delay=0.15, token_interval=0.02, responses=None):
        self._first = first_token_delay
        self._interval = token_interval
        self._responses = list(responses) if responses else None
        self.last_reasoning_content = ""

    @property
    def provider_name(self):
        return "bench"

    async def chat_stream(self, messages, system_prompt="", **kwargs):
        await asyncio.sleep(self._first)
        chunks = self._responses.pop(0) if self._responses else ["（基准响应）"]
        for chunk in chunks:
            yield chunk
            if self._interval:
                await asyncio.sleep(self._interval)


async def _measure(session, tta_marker=None):
    """消费 run_stream，返回 (全文, TTFT, TTA, 总耗时)"""
    parts = []
    start = time.perf_counter()
    ttft = None
    tta = None
    async for c in session.run_stream(max_tool_rounds=3):
        now = time.perf_counter()
        if ttft is None and c.strip():
            ttft = now - start
        parts.append(c)
        if tta_marker and tta_marker in c and tta is None:
            tta = now - start
    elapsed = time.perf_counter() - start
    return "".join(parts), ttft, tta, elapsed


def _summary(values, unit="s"):
    return (f"avg={statistics.mean(values):.4f} med={statistics.median(values):.4f} "
            f"min={min(values):.4f} max={max(values):.4f} {unit}")


def run_benchmark(rounds=20, first_token_delay=0.15):
    init_tools()

    ttft_samples = []
    tta_samples = []
    throughput_samples = []

    # 场景 1：纯文本流式回复（测 TTFT + 吞吐）
    text_tokens = ["这是基准回复，"] * 40
    for _ in range(rounds):
        session = AgentSession()
        session.session_id = "bench-text"
        session.provider = BenchProvider(first_token_delay=first_token_delay,
                                         responses=[list(text_tokens)])
        session.add_user_message("请回答一句话")
        text, ttft, _tta, elapsed = asyncio.run(_measure(session))
        ttft_samples.append(ttft)
        stream_seconds = max(elapsed - ttft, 1e-6)
        throughput_samples.append(len(text) / stream_seconds)

    # 场景 2：工具调用（测 TTA）。工具调用在第 16 个 chunk 完整闭合，
    # 尾部还有 19 个 chunk —— v3.1.2 早停（消费 16 个即执行）；
    # v3.1.1 无早停（消费全部 30 个后才解析执行），TTA 差异即早停收益。
    tool_chunks = (["分析配置 schema 中…"] * 10
                   + ['```tool_call\n{"name": "list_config_schema", "arguments": {}}\n```']
                   + ["（工具已调用，继续输出说明）"] * 19)
    for _ in range(rounds):
        session = AgentSession()
        session.session_id = "bench-tool"
        session.provider = BenchProvider(first_token_delay=first_token_delay,
                                         responses=[list(tool_chunks), []])
        session.add_user_message("列出配置 schema")
        text, _ttft, tta, _elapsed = asyncio.run(_measure(session, tta_marker="正在调用工具"))
        tta_samples.append(tta)
        if "正在调用工具" not in text:
            raise RuntimeError("工具场景未触发工具执行，基准无效")

    # 场景 3：Provider 配置同步（T6-1）——每次对话发送前的固定链路开销。
    # v3.1.2 相同配置 diff 跳过（仅首次重建）；v3.1.1 每次全量重建。
    from autolink_hub.hub import configure_provider
    os.environ.setdefault("AUTOLINK_USER_DATA", tempfile.mkdtemp())
    configure_provider("deepseek", "sk-bench", "deepseek-chat", "")
    cfg_start = time.perf_counter()
    for _ in range(rounds):
        configure_provider("deepseek", "sk-bench", "deepseek-chat", "")
    cfg_elapsed = time.perf_counter() - cfg_start

    print(f"===== AIHUB 响应延迟基准（mock LLM，rounds={rounds}, first_token={first_token_delay}s）=====")
    print(f"TTFT  首字延迟           {_summary(ttft_samples)}")
    print(f"TTA   工具执行前延迟     {_summary(tta_samples)}")
    print(f"吞吐  流式输出(字符/s)   avg={statistics.mean(throughput_samples):.1f} "
          f"med={statistics.median(throughput_samples):.1f}")
    print(f"配置同步 {rounds} 次相同配置   {cfg_elapsed*1000:.1f} ms "
          f"（v3.1.2 diff 跳过≈0；v3.1.1 每次全量重建）")
    print("对比：v3.1.2 工具在第 16 个 chunk 早停；v3.1.1 需消费全部 30 个 chunk 后解析执行。")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="AIHUB 响应延迟基准")
    parser.add_argument("--rounds", type=int, default=20, help="每场景重复次数（默认 20）")
    parser.add_argument("--first-token-delay", type=float, default=0.15,
                        help="mock 首 token 延迟秒（默认 0.15）")
    args = parser.parse_args()
    run_benchmark(rounds=args.rounds, first_token_delay=args.first_token_delay)
