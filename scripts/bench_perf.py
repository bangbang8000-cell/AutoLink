"""V3.2.2-R11.3: 关键路径性能基准（PRD §6.1 达标检查）

本地可复现地测量两条关键路径：
  场景 A —— 2048 GPU 设计：NetworkDesignerV2 构建 + 连接生成（拓扑渲染数据），达标 ≤30s
  场景 B —— 225 柜机房落位：room_optimizer 约束满足 + 多目标优化，达标 ≤5s

用法：
  python scripts/bench_perf.py [--rounds 3]

输出平均/最小/最大耗时 + 达标判断（FAIL 时退出码 1，供 CI/人工门禁）。
"""
import argparse
import os
import statistics
import sys
import tempfile
import time

# 让 backend 可导入（脚本位于 scripts/，后端在 backend/）
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend"))
# 基准期间审计落临时目录，避免污染用户数据
os.environ.setdefault("AUTOLINK_AUDIT_PATH", os.path.join(tempfile.gettempdir(), "autolink-bench-audit.jsonl"))
os.environ.setdefault("AUTOLINK_USER_DATA", tempfile.mkdtemp())

from designer import NetworkDesignerV2  # noqa: E402
from room import RoomMatrix  # noqa: E402
from room_optimizer import optimize  # noqa: E402

# PRD §6.1 达标阈值
DESIGN_LIMIT_S = 30.0
ROOM_LIMIT_S = 5.0


def _write_ini(dirpath, content: str) -> str:
    ini = os.path.join(dirpath, "bench.ini")
    with open(ini, "w", encoding="utf-8") as f:
        f.write(content)
    return ini


def bench_design_2048(rounds: int):
    """场景 A：2048 台服务器 3 层组网（64 口交换机、8 网卡/服务器）"""
    with tempfile.TemporaryDirectory() as tmpdir:
        ini = _write_ini(tmpdir, """[DEFAULT]
num_servers = 2048
param_switch_ports = 64
param_ports_per_server = 8
param_speed = 400G
storage_ports_per_server = 1
storage_switch_ports = 48
storage_speed = 200G
oob_enabled = False
biz_enabled = False
""")
        init_samples, conn_samples, total_samples = [], [], []
        for _ in range(rounds):
            t0 = time.perf_counter()
            designer = NetworkDesignerV2(ini)
            t1 = time.perf_counter()
            designer.generate_connections()
            t2 = time.perf_counter()
            init_samples.append(t1 - t0)
            conn_samples.append(t2 - t1)
            total_samples.append(t2 - t0)

        total_avg = statistics.mean(total_samples)
        ok = total_avg <= DESIGN_LIMIT_S
        print(f"[场景A] 2048 GPU 设计/渲染（rounds={rounds}）  达标阈值 ≤{DESIGN_LIMIT_S}s")
        print(f"  构建     avg={statistics.mean(init_samples):.2f} min={min(init_samples):.2f} max={max(init_samples):.2f} s")
        print(f"  连接生成 avg={statistics.mean(conn_samples):.2f} min={min(conn_samples):.2f} max={max(conn_samples):.2f} s")
        print(f"  合计     avg={total_avg:.2f} min={min(total_samples):.2f} max={max(total_samples):.2f} s")
        print(f"  拓扑规模 servers={len(designer.servers)} param_leaves={len(designer.param_leaves)} "
              f"param_spines={len(designer.param_spines)}")
        print(f"  结果: {'PASS' if ok else 'FAIL'}")
        return ok


def bench_room_225(rounds: int):
    """场景 B：225 柜落位（15x15 矩阵，gpu/network/storage 混合）"""
    matrix = RoomMatrix(rows=list("ABCDEFGHIJKLMNO"), cols=list(range(1, 16)), name="基准机房")
    params = {
        "matrix": matrix.to_dict(),
        "counts": {"gpu": 120, "network": 60, "storage": 45},
        "objectives": {"power_balance": 1.0, "thermal_zones": 1.0,
                       "network_locality": 1.0, "shortest_cable": 1.0},
    }
    samples = []
    placed = 0
    for _ in range(rounds):
        t0 = time.perf_counter()
        res = optimize(params)
        samples.append(time.perf_counter() - t0)
        if res.get("success"):
            placed = len(res["placements"])
        if not res.get("success"):
            print(f"  [场景B] 落位失败: {res.get('error') or res.get('issues')}")
            return False

    avg = statistics.mean(samples)
    ok = avg <= ROOM_LIMIT_S and placed == 225
    print(f"[场景B] 225 柜机房落位（rounds={rounds}）  达标阈值 ≤{ROOM_LIMIT_S}s")
    print(f"  耗时     avg={avg:.2f} min={min(samples):.2f} max={max(samples):.2f} s")
    print(f"  放置数   {placed}/225")
    print(f"  结果: {'PASS' if ok else 'FAIL'}")
    return ok


def main():
    parser = argparse.ArgumentParser(description="AutoLink 关键路径性能基准（2048 GPU 设计 + 225 柜落位）")
    parser.add_argument("--rounds", type=int, default=3, help="每场景重复次数（默认 3）")
    args = parser.parse_args()

    print("===== AutoLink 性能基准（PRD §6.1）=====")
    ok_design = bench_design_2048(args.rounds)
    print()
    ok_room = bench_room_225(args.rounds)
    print()
    if ok_design and ok_room:
        print("===== 全部达标 =====")
        return 0
    print("===== 存在未达标项（需关键路径优化）=====")
    return 1


if __name__ == "__main__":
    sys.exit(main())
