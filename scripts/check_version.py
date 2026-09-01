"""AutoLink 版本单源校验入口（4.0.0-F0-2 / 40-d，CI 门禁）

等价 `python scripts/sync_version.py --check`：
校验 version.json 单源与 package.json / package-lock.json / VERSION 一致。
仅用 Python 标准库，无需 npm ci / pip install。

用法：
  python scripts/check_version.py
退出码：0 = 一致；1 = 不一致/异常（CI 失败）。
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sync_version import run_check  # noqa: E402

if __name__ == '__main__':
    sys.exit(run_check())
