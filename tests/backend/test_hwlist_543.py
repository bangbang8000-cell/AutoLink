# -*- coding: utf-8 -*-
"""V5.4.3-W3: al-hwlist/1.0 硬件清单专项测试

覆盖（PRD §5 / 测试计划 §4）：
  H-T1 行契约完整 + device_id 稳定（同输入两次生成全等）
  H-T2 线缆分光聚合可复算（qty_basis 显式分光系数）
  H-T4 备件公式（CEILING 口径，与 Excel 公式一致）
  H-T5 零价格契约（check_no_price 全簿零命中）
  H-T6 五页完整性（设计汇总/简版/契约版/组网示意图/设计口径）
  H-T7 CLI 接线（EXPORT_TYPES 含 hwlist）
  H-T9 一致性交叉核对（hwlist 光模块数 == bom 光模块数）
"""
import io
import json
import os
import sys
from contextlib import redirect_stdout
from pathlib import Path

import pytest

_BACKEND = Path(__file__).resolve().parents[2] / 'backend'
sys.path.insert(0, str(_BACKEND))

import hwlist                                # noqa: E402
import hwlist_sheets                         # noqa: E402
from designer import NetworkDesignerV2       # noqa: E402
from engine import EXPORT_TYPES              # noqa: E402

_TPL_DIR = Path(__file__).resolve().parents[2] / 'template'
_BASE_TPL = 'H100-128台-RoCE'
REQUIRED_FIELDS = {'network_profile', 'net_key', 'tier', 'line_type', 'device_id',
                   'name', 'model', 'qty', 'unit', 'spare_ratio', 'spare_qty',
                   'total_qty', 'qty_basis', 'speed_gbps', 'note', 'unmatched'}


def _design(tpl=_BASE_TPL):
    p = _TPL_DIR / tpl / 'project_config.json'
    buf = io.StringIO()
    with redirect_stdout(buf):
        return NetworkDesignerV2(str(p))


# ----------------------------------------------------------------------
# H-T1 行契约 + device_id 稳定性
# ----------------------------------------------------------------------
class TestLineContract:
    def test_required_fields_present(self):
        lines = hwlist.build_lines(_design())
        assert lines, '清单行不应为空'
        for ln in lines:
            missing = REQUIRED_FIELDS - set(ln.keys())
            assert not missing, f'缺契约字段: {missing}'
            assert ln['line_type'] in hwlist.LINE_TYPES
            assert ln['device_id'], 'device_id 不得为空'

    def test_device_id_stable_across_runs(self):
        """同输入两次生成 device_id 集合全等（稳定主键契约）"""
        ids1 = {(l['device_id'], l['qty']) for l in hwlist.build_lines(_design())}
        ids2 = {(l['device_id'], l['qty']) for l in hwlist.build_lines(_design())}
        assert ids1 == ids2


# ----------------------------------------------------------------------
# H-T2 线缆分光聚合 / H-T4 备件公式
# ----------------------------------------------------------------------
class TestCableAndSpare:
    def test_cable_rows_have_basis(self):
        lines = hwlist.build_lines(_design())
        cables = [l for l in lines if l['line_type'] == 'cable']
        assert cables, '应有线缆行'
        for c in cables:
            assert c['qty_basis'], '线缆行必须带数量口径'
            assert c['qty'] > 0

    def test_spare_ceiling_formula(self):
        """备件数量 = ceil(qty × ratio)（与 Excel CEILING 同口径）"""
        assert hwlist.spare_qty(10240, 0.05) == 512
        assert hwlist.spare_qty(7, 0.05) == 1          # 0.35 → 1
        assert hwlist.spare_qty(100, 0.0) == 0
        assert hwlist.spare_qty(3, 0.03) == 1          # 0.09 → 1

    def test_spare_ratio_defaults_d4(self):
        """D4 拍板默认：光模块/线缆 5%，整机 3%，服务器 1%，GPU 0%"""
        assert hwlist.spare_ratio('optic_module') == 0.05
        assert hwlist.spare_ratio('cable') == 0.05
        assert hwlist.spare_ratio('hardware') == 0.03
        assert hwlist.spare_ratio('hardware', is_server=True) == 0.01
        assert hwlist.spare_ratio('hardware', is_gpu=True) == 0.0
        assert hwlist.spare_ratio('license') == 0.0

    def test_ratio_map_override(self):
        """D4：ratio_map 参数覆盖优先于默认值"""
        assert hwlist.spare_ratio('cable', ratio_map={'cable': 0.10}) == 0.10


# ----------------------------------------------------------------------
# H-T5 零价格契约
# ----------------------------------------------------------------------
class TestNoPrice:
    def test_clean_lines_pass(self):
        lines = hwlist.build_lines(_design())
        assert hwlist.check_no_price(lines) == []

    def test_money_laden_text_caught(self):
        lines = [{'device_id': 'x', 'name': 'A', 'model': '', 'qty_basis': '单价 294000/台',
                  'note': '', 'unit': '台'}]
        hits = hwlist.check_no_price(lines)
        assert hits and hits[0][1] == 'qty_basis'

    def test_no_price_word_kept_explanatory(self):
        """「不计价」类说明语属数量口径，不得被清洗丢失"""
        basis = hwlist.clean_basis('整机含 DCU 与网卡均不计价（1280 台 × 8 = 10,240 卡）')
        assert '不计价' in basis


# ----------------------------------------------------------------------
# H-T6 五页完整性 / H-T7 CLI 接线
# ----------------------------------------------------------------------
class TestWorkbookShape:
    def test_five_sheets(self, tmp_path):
        d = _design()
        lines = hwlist.build_lines(d)
        stat = hwlist.summarize(lines)
        wb = hwlist_sheets.build_workbook(lines, '测试', scale_rows=[('规模', '测试')],
                                          stat=stat)
        assert wb.sheetnames == ['设计汇总', '组网清单（简版）', '组网清单（契约版）',
                                 '组网示意图', '设计口径']

    def test_contract_sheet_formulas(self, tmp_path):
        """契约版备件数量/合计数量为 Excel 公式（CEILING/SUM 可独立复算）"""
        d = _design()
        lines = hwlist.build_lines(d)
        stat = hwlist.summarize(lines)
        wb = hwlist_sheets.build_workbook(lines, '测试', stat=stat)
        ws = wb['组网清单（契约版）']
        formulas = [c.value for row in ws.iter_rows() for c in row
                    if isinstance(c.value, str) and c.value.startswith('=')]
        assert any('CEILING' in f for f in formulas), '缺 CEILING 备件公式'
        assert any('SUM' in f for f in formulas), '缺 SUM 小计/合计公式'

    def test_export_types_contains_hwlist(self):
        assert 'hwlist' in EXPORT_TYPES

    def test_export_hwlist_end_to_end(self, tmp_path):
        from exporter import export_hwlist
        d = _design()
        out = str(tmp_path / '硬件清单.xlsx')
        buf = io.StringIO()
        with redirect_stdout(buf):
            lines = export_hwlist(d, out)
        assert os.path.getsize(out) > 0
        assert len(lines) > 0


# ----------------------------------------------------------------------
# H-T9 一致性交叉核对
# ----------------------------------------------------------------------
class TestConsistency:
    def test_module_count_matches_bom(self):
        """hwlist 光模块合计 == bom 光模块合计（同一次解析；未匹配行两侧同口径显式成行）"""
        d = _design()
        lines = hwlist.build_lines(d)
        hw_mods = sum(l['qty'] for l in lines if l['line_type'] == 'optic_module')
        from exporter import export_bom
        buf = io.StringIO()
        with redirect_stdout(buf):
            df = export_bom(d, str(_TPL_DIR / '_tmp_bom_test.xlsx'))
        bom_mods = int(df[df['类别'] == '光模块']['数量'].sum())
        try:
            os.unlink(str(_TPL_DIR / '_tmp_bom_test.xlsx'))
        except OSError:
            pass
        assert hw_mods == bom_mods, f'hwlist {hw_mods} != bom {bom_mods}'

    def test_switch_count_matches_designer(self):
        d = _design()
        lines = hwlist.build_lines(d)
        hw_sw = sum(l['qty'] for l in lines if l['line_type'] == 'hardware'
                    and '交换机' in l['name'])
        expect = (len(d.param_leaves) + len(d.param_spines) + len(d.param_cores)
                  + len(d.storage_leaves) + len(d.storage_spines) + len(d.storage_cores)
                  + len(d.oob_access) + len(d.oob_agg)
                  + len(d.biz_access) + len(d.biz_agg))
        assert hw_sw == expect
