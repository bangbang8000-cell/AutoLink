"""AutoLink Release 说明提取工具（v3.0.2 / 4.0.0-F0-2-40-d 适配单源）

从 CHANGELOG.md 提取指定版本段落，作为 GitHub Release 页面的说明文档：
  - 版本号默认从 version.json 单源读取（与 package.json/VERSION 保持一致，F0-2）
  - 支持 v 前缀（v3.0.2 / 3.0.2）
  - 显式传入版本号时校验与单源一致（防错版发布），--allow-mismatch 可放行历史段落抽取
  - 找不到版本或段落为空时退出码非 0（CI 发布步骤失败）

用法：
  python scripts/extract_release_notes.py                       # 版本取 version.json 单源
  python scripts/extract_release_notes.py v3.0.2 CHANGELOG.md   # 显式版本（校验单源一致）
  python scripts/extract_release_notes.py --allow-mismatch v3.0.2
"""
import argparse
import json
import os
import re
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read_single_source_version(root=None):
    """从 version.json 读取单源版本号（去 v 前缀）。"""
    root = root or REPO_ROOT
    path = os.path.join(root, 'version.json')
    if not os.path.exists(path):
        raise LookupError(f'版本单源文件不存在: {path}（请先同步 version.json）')
    with open(path, encoding='utf-8') as f:
        data = json.load(f)
    version = data.get('version')
    if not version:
        raise LookupError(f'版本单源缺少 version 字段: {path}')
    return version[1:] if version.startswith(('v', 'V')) else version


def extract_release_notes(version: str, changelog_path: str) -> str:
    """返回 version 对应的 CHANGELOG 段落（去掉版本标题行）。"""
    with open(changelog_path, encoding='utf-8') as f:
        lines = f.read().splitlines()

    ver = version[1:] if version.startswith(('v', 'V')) else version
    pattern = re.compile(r'^## \[\s*' + re.escape(ver) + r'\s*\]')

    start = None
    for i, line in enumerate(lines):
        if pattern.match(line):
            start = i
            break
    if start is None:
        raise LookupError(f'CHANGELOG 中未找到版本 [{ver}] 的段落：{changelog_path}')

    end = len(lines)
    for j in range(start + 1, len(lines)):
        if re.match(r'^## \[', lines[j]):
            end = j
            break

    body = '\n'.join(lines[start + 1:end]).strip()
    if not body:
        raise LookupError(f'CHANGELOG 中版本 [{ver}] 的段落内容为空：{changelog_path}')
    return body


def _normalize(version: str) -> str:
    return version[1:] if version.startswith(('v', 'V')) else version


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        description='从 CHANGELOG.md 提取版本段落作为 Release 说明（版本默认取 version.json 单源）')
    parser.add_argument('version', nargs='?', help='目标版本号（缺省读 version.json 单源）')
    parser.add_argument('changelog', nargs='?', default=None, help='CHANGELOG 路径（默认 CHANGELOG.md）')
    parser.add_argument('--allow-mismatch', action='store_true',
                        help='允许显式版本与单源不一致（抽取历史段落时使用）')
    parser.add_argument('--root', metavar='DIR', default=None, help='仓库根目录（默认自动探测，测试用）')
    args = parser.parse_args(argv)

    root = os.path.abspath(args.root) if args.root else REPO_ROOT
    changelog_path = args.changelog or os.path.join(root, 'CHANGELOG.md')

    try:
        single = read_single_source_version(root)
    except LookupError as e:
        print(f'错误: {e}', file=sys.stderr)
        return 1

    if args.version:
        version = _normalize(args.version)
        if not args.allow_mismatch and version != single:
            print(
                f'错误: 版本 [{version}] 与单源 version.json [{single}] 不一致（版本/发布单源要求一致）；'
                f'如需抽取历史段落请加 --allow-mismatch',
                file=sys.stderr,
            )
            return 1
    else:
        version = single

    try:
        print(extract_release_notes(version, changelog_path))
        return 0
    except LookupError as e:
        print(f'错误: {e}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
