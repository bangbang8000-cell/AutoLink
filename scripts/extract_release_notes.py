"""AutoLink Release 说明提取工具（v3.0.2）

从 CHANGELOG.md 提取指定版本段落，作为 GitHub Release 页面的说明文档：
  - 输入版本号（支持 v 前缀，如 v3.0.2 / 3.0.2）
  - 输出该版本 `## [x.y.z]` 段落内容（不含版本标题行）到 stdout
  - 找不到版本或段落为空时退出码非 0（CI 发布步骤失败）

用法：
  python scripts/extract_release_notes.py v3.0.2 CHANGELOG.md > release_notes.md
"""
import re
import sys


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


def main() -> int:
    if len(sys.argv) < 2:
        print('用法: python scripts/extract_release_notes.py <version> [changelog_path]', file=sys.stderr)
        return 2
    version = sys.argv[1]
    changelog_path = sys.argv[2] if len(sys.argv) > 2 else 'CHANGELOG.md'
    try:
        print(extract_release_notes(version, changelog_path))
        return 0
    except LookupError as e:
        print(f'错误: {e}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
