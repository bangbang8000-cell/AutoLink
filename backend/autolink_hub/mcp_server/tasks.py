"""5.1.4-514-c：异步任务层 —— 长耗时工具（设计生成/导出）包装为可查询的后台任务（AutoLink）。

设计生成（generate_design）、交付物导出（export_outputs）、项目打包（export_project）等
工具可能耗时数秒到数十秒，同步等待会阻塞 MCP Server 主循环。AsyncTaskManager：

- submit(tool, coro_factory)：提交后立即返回 task_id，任务在专用后台事件循环执行
- query(task_id)：轮询状态（pending/running/done/error）+ 进度 + 结果/错误
- list_tasks()：枚举全部任务；wait(task_id)：同步阻塞等待
- 后台循环常驻 daemon 线程：同步上下文（测试/CLI）与异步上下文（FastMCP handler）均可使用
"""
import asyncio
import logging
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Optional

logger = logging.getLogger(__name__)

TASK_STATUSES = ("pending", "running", "done", "error")
DEFAULT_TTL = 3600.0  # 任务记录保留时长（秒）


@dataclass
class TaskRecord:
    task_id: str
    tool: str
    status: str = "pending"
    result: Any = None
    error: str = ""
    progress_percent: int = 0
    progress_message: str = ""
    created_at: float = field(default_factory=time.time)
    started_at: float = 0.0
    finished_at: float = 0.0
    _future: Any = None


class AsyncTaskManager:
    """后台异步任务管理器。

    长耗时工具提交后立即返回 task_id，由专用事件循环线程执行；
    query() 轮询状态与进度，不阻塞调用方主线程/主循环。
    """

    def __init__(self, max_tasks: int = 256, ttl: float = DEFAULT_TTL):
        self._records: dict[str, TaskRecord] = {}
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._thread: Optional[threading.Thread] = None
        self._lock = threading.Lock()
        self._max_tasks = max_tasks
        self._ttl = ttl

    # -------------------- 生命周期 --------------------

    def _ensure_loop(self) -> asyncio.AbstractEventLoop:
        """惰性启动常驻后台事件循环线程（幂等）。"""
        with self._lock:
            if self._loop is not None and self._loop.is_running():
                return self._loop
            loop = asyncio.new_event_loop()
            thread = threading.Thread(
                target=self._run_loop,
                args=(loop,),
                name="agent-connect-task-loop",
                daemon=True,
            )
            thread.start()
            self._loop = loop
            self._thread = thread
            return loop

    @staticmethod
    def _run_loop(loop: asyncio.AbstractEventLoop) -> None:
        asyncio.set_event_loop(loop)
        loop.run_forever()

    def shutdown(self) -> None:
        """停止后台事件循环线程（测试/退出时调用）。"""
        with self._lock:
            loop, self._loop, self._thread = self._loop, None, None
            if loop is not None and loop.is_running():
                loop.call_soon_threadsafe(loop.stop)

    # -------------------- 提交 --------------------

    def submit(self, tool: str, coro_factory: Callable[[], Awaitable[Any]]) -> str:
        """提交异步任务。coro_factory 为返回 coroutine 的工厂函数。

        立即返回 task_id；任务在后台循环执行，完成后状态为 done/error。
        """
        loop = self._ensure_loop()
        task_id = uuid.uuid4().hex[:16]
        record = TaskRecord(task_id=task_id, tool=tool)
        with self._lock:
            # 超限时淘汰最旧已完成任务，避免无限增长
            if len(self._records) >= self._max_tasks:
                self._evict_locked()
            self._records[task_id] = record
        future = asyncio.run_coroutine_threadsafe(
            self._run(tool, coro_factory, record), loop
        )
        record._future = future
        return task_id

    async def _run(
        self,
        tool: str,
        coro_factory: Callable[[], Awaitable[Any]],
        record: TaskRecord,
    ) -> None:
        record.status = "running"
        record.started_at = time.time()
        try:
            result = await coro_factory()
            record.status = "done"
            record.result = result
        except asyncio.CancelledError:  # 任务被取消
            record.status = "error"
            record.error = "Task cancelled"
        except Exception as e:  # noqa: BLE001 - 任务级兜底，保证状态可达 error
            record.status = "error"
            record.error = f"{type(e).__name__}: {e}"
        finally:
            record.finished_at = time.time()

    def _evict_locked(self) -> None:
        """淘汰最旧的已完成/失败任务（仅在持锁时调用）。"""
        done = [
            r for r in self._records.values() if r.status in ("done", "error")
        ]
        if not done:
            return
        done.sort(key=lambda r: r.created_at)
        victim = done[0]
        self._records.pop(victim.task_id, None)

    # -------------------- 查询 --------------------

    def query(self, task_id: str) -> Optional[dict[str, Any]]:
        """查询任务状态；未知 task_id 返回 None。"""
        with self._lock:
            record = self._records.get(task_id)
        if record is None:
            return None
        return self._snapshot(record)

    def list_tasks(self) -> list[dict[str, Any]]:
        """枚举全部任务（按提交时间升序）。"""
        with self._lock:
            records = sorted(
                self._records.values(), key=lambda r: r.created_at
            )
        return [self._snapshot(r) for r in records]

    def wait(self, task_id: str, timeout: float = 120.0) -> Optional[dict[str, Any]]:
        """同步阻塞等待任务完成；超时返回当前状态。"""
        deadline = time.time() + timeout
        while time.time() < deadline:
            st = self.query(task_id)
            if st is None or st["status"] in ("done", "error"):
                return st
            time.sleep(0.05)
        return self.query(task_id)

    def update_progress(self, task_id: str, percent: int, message: str = "") -> bool:
        """任务执行中更新进度（供长任务回调）。"""
        with self._lock:
            record = self._records.get(task_id)
            if record is None:
                return False
            record.progress_percent = max(0, min(100, int(percent)))
            record.progress_message = message
            return True

    def cancel(self, task_id: str) -> bool:
        """取消任务（pending/running → error=Task cancelled）。

        立即置位 error（后台 _run 的 CancelledError 分支会再次置位，结果一致），
        保证取消后 query 立即返回可观察的终止状态。
        """
        with self._lock:
            record = self._records.get(task_id)
            if record is None or record._future is None:
                return False
            if record.status in ("done", "error"):
                return False
            cancelled = record._future.cancel()
            if cancelled:
                record.status = "error"
                record.error = "Task cancelled"
                record.finished_at = time.time()
            return cancelled

    @staticmethod
    def _snapshot(record: TaskRecord) -> dict[str, Any]:
        return {
            "task_id": record.task_id,
            "tool": record.tool,
            "status": record.status,
            "result": record.result,
            "error": record.error,
            "progress": {
                "percent": record.progress_percent,
                "message": record.progress_message,
            },
            "created_at": record.created_at,
            "started_at": record.started_at,
            "finished_at": record.finished_at,
        }


_task_manager: Optional[AsyncTaskManager] = None
_task_manager_lock = threading.Lock()


def get_task_manager() -> AsyncTaskManager:
    """全局任务管理器单例。"""
    global _task_manager
    with _task_manager_lock:
        if _task_manager is None:
            _task_manager = AsyncTaskManager()
        return _task_manager


def reset_tasks() -> None:
    """测试/重配后重建单例并回收旧后台线程（隔离全局状态）。"""
    global _task_manager
    with _task_manager_lock:
        old = _task_manager
        _task_manager = AsyncTaskManager()
    if old is not None:
        old.shutdown()
