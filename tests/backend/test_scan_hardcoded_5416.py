"""5.4.16-F5416-6：硬编码中文扫描门禁契约测试。"""
import importlib.util
import json
import os
import sys

_REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(_REPO, "scripts"))
import scan_hardcoded_cn as sc  # noqa: E402


def _mk(repo, rel, content):
    p = os.path.join(repo, *rel.split("/"))
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        f.write(content)


class TestScanHardcodedCn:
    def test_detects_hardcoded_cn(self, tmp_path):
        _mk(str(tmp_path), "src/components/Foo.tsx",
            "export function Foo() {\n  return <span>开始渲染</span>\n}\n")
        hits = sc.scan_files(str(tmp_path))
        assert os.path.join("src", "components", "Foo.tsx") in hits

    def test_ignores_t_calls_and_comments(self, tmp_path):
        _mk(str(tmp_path), "src/components/Bar.tsx",
            "import { useTranslation } from 'react-i18next'\n"
            "export const a = () => t('渲染完成') // 注释中文\n"
            "// 整行注释\n"
            "export const b = 'no cjk here'\n")
        hits = sc.scan_files(str(tmp_path))
        assert "src/components/Bar.tsx" not in hits

    def test_gate_fails_on_new_file(self, tmp_path, monkeypatch):
        _mk(str(tmp_path), "src/components/Ok.tsx", "export const x = 1\n")
        monkeypatch.setattr(sc, "REPO", str(tmp_path))
        sc.save_baseline(set(sc.scan_files(str(tmp_path))))
        # 新增硬编码中文文件 → 门禁红
        _mk(str(tmp_path), "src/components/New.tsx",
            "export const New = () => '新增中文'\n")
        monkeypatch.setattr(sc, "BASELINE", os.path.join(str(tmp_path), "tests", "hardcoded_cn_baseline.json"))
        assert sc.main([]) == 1

    def test_gate_passes_when_unchanged(self, tmp_path, monkeypatch):
        _mk(str(tmp_path), "src/components/Ok.tsx", "export const x = 1\n")
        monkeypatch.setattr(sc, "REPO", str(tmp_path))
        monkeypatch.setattr(sc, "BASELINE", os.path.join(str(tmp_path), "tests", "hardcoded_cn_baseline.json"))
        sc.save_baseline(set(sc.scan_files(str(tmp_path))))
        assert sc.main([]) == 0

    def test_update_baseline_records_files(self, tmp_path, monkeypatch):
        _mk(str(tmp_path), "src/components/Cn.tsx", "export const a = '中文'\n")
        monkeypatch.setattr(sc, "REPO", str(tmp_path))
        monkeypatch.setattr(sc, "BASELINE", os.path.join(str(tmp_path), "tests", "hardcoded_cn_baseline.json"))
        assert sc.main(["--update-baseline"]) == 0
        data = json.load(open(sc.BASELINE, encoding="utf-8"))
        assert os.path.join("src", "components", "Cn.tsx") in data["files"]
