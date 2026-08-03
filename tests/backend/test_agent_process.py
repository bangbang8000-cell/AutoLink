"""V3.0.0-T0-6: Python 持久 Agent 进程协议测试

覆盖：
  - 子进程持久循环：一次启动多次请求（进程不退出）
  - requestId 分发与结果回传
  - 流式事件行 {type:'event'} 与结果行的顺序
  - 未知 action / 非法 JSON 的错误行
  - EOF 后进程正常退出（兼容旧一次性管道调用）
"""
import os
import json
import sys
import subprocess

import pytest

from engine import register_action, emit_event

# 本文件位于 tests/backend/，上溯两层到项目根，再进入 backend/
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
ENGINE_PATH = os.path.join(PROJECT_ROOT, 'backend', 'engine.py')


@pytest.fixture(scope='module')
def persistent_proc():
    """启动持久 engine 子进程，测试后关闭"""
    p = subprocess.Popen(
        [sys.executable, ENGINE_PATH],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        text=True, encoding='utf-8', errors='replace',
    )
    yield p
    try:
        p.stdin.close()
        p.wait(timeout=10)
    except Exception:
        p.kill()


def _send(proc, action, params=None, request_id=''):
    proc.stdin.write(json.dumps({
        'action': action, 'params': params or {}, 'requestId': request_id,
    }, ensure_ascii=False) + '\n')
    proc.stdin.flush()
    return proc.stdout.readline().strip()


def test_persistent_roundtrip_and_request_id(persistent_proc):
    """一次启动多次请求，requestId 逐行回传，进程不退出"""
    p = persistent_proc
    # 请求 1
    line = _send(p, 'unknown', request_id='a-1')
    r1 = json.loads(line)
    assert r1['type'] == 'result' and r1['success'] is False
    assert r1['requestId'] == 'a-1'
    assert '未知 action' in r1['error']
    # 请求 2（进程仍存活 → 持久）
    line = _send(p, 'unknown', request_id='a-2')
    r2 = json.loads(line)
    assert r2['requestId'] == 'a-2'
    assert p.poll() is None


def test_stream_protocol_emit():
    """V3.0.0-T0-6: emit_event 输出 {type:'event'} 行，与 result 顺序正确"""
    from engine import main
    import io

    @register_action('__t0_6_stream')
    def _stream_handler(params):
        emit_event(params.get('request_id', ''), '第一块')
        emit_event(params.get('request_id', ''), '第二块')
        return {'done': True}

    old_stdin, old_stdout = sys.stdin, sys.stdout
    try:
        req = json.dumps({"action": "__t0_6_stream", "params": {"request_id": "rid-9"},
                          "requestId": "rid-9"}, ensure_ascii=False)
        sys.stdin = io.StringIO(req + "\n")
        sys.stdout = io.StringIO()
        main()
        lines = [json.loads(l) for l in sys.stdout.getvalue().strip().split("\n")]
    finally:
        sys.stdin, sys.stdout = old_stdin, old_stdout

    assert len(lines) == 3
    assert [l["type"] for l in lines] == ["event", "event", "result"]
    assert lines[0]["requestId"] == "rid-9"
    assert lines[0]["chunk"] == "第一块"
    assert lines[1]["chunk"] == "第二块"
    assert lines[2]["data"] == {"done": True}


def test_eof_graceful_exit():
    """EOF（stdin 关闭）后进程正常退出（兼容旧一次性管道调用）"""
    p = subprocess.Popen(
        [sys.executable, ENGINE_PATH],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        text=True, encoding='utf-8', errors='replace',
    )
    p.stdin.write(json.dumps({"action": "unknown", "params": {}, "requestId": "e-1"}) + "\n")
    p.stdin.flush()
    line = p.stdout.readline().strip()
    r = json.loads(line)
    assert r["type"] == "result" and r["requestId"] == "e-1"
    p.stdin.close()
    code = p.wait(timeout=10)
    assert code == 0


def test_invalid_json_line(persistent_proc):
    """非法 JSON 行 → {type:'error'}，进程继续存活"""
    p = persistent_proc
    p.stdin.write("this is {not json\n")
    p.stdin.flush()
    line = p.stdout.readline().strip()
    r = json.loads(line)
    assert r["type"] == "error"
    assert "JSON 解析失败" in r["error"]
    assert p.poll() is None
