# -*- coding: utf-8 -*-
"""V5.4.3-W3: al-hwlist/1.0 硬件清单五页式写表层（openpyxl 自研版式）

工作簿结构（对标反馈方四方案终版硬件清单，零价格契约）：
  设计汇总 / 组网清单（简版）/ 组网清单（契约版）/ 组网示意图 / 设计口径

约定：
  - 备件数量 = CEILING(配置数量 × 备件率, 1)——Excel 公式可独立复算（非硬编码）
  - 分项小计/合计为 SUM 公式；量纲隔离（台/个/根不相加，仅供行数与档位核对）
  - 全簿禁绝金额字段（由 hwlist.check_no_price 在数据层自检兜底）
"""
import datetime

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

SCHEMA_VER = 'al-hwlist/1.0'

# ---- 极简版式（自研，不依赖反馈方 xlsx_style） ----
_C_TITLE = '1F4E79'
_C_HEAD = '2E75B6'
_C_BAND = 'D6E4F0'
_C_ZEBRA = 'F2F7FB'
_THIN = Side(style='thin', color='B0B0B0')
BD = Border(left=_THIN, right=_THIN, top=_THIN, bottom=_THIN)
F_TITLE = Font(name='微软雅黑', size=13, bold=True, color='FFFFFF')
F_SUB = Font(name='微软雅黑', size=9, color='595959')
F_HEAD = Font(name='微软雅黑', size=10, bold=True, color='FFFFFF')
F_BODY = Font(name='微软雅黑', size=10)
F_BODY_B = Font(name='微软雅黑', size=10, bold=True)
F_NOTE = Font(name='微软雅黑', size=9, color='404040')
CT = Alignment(horizontal='center', vertical='center', wrap_text=True)
LT = Alignment(horizontal='left', vertical='center', wrap_text=True)
FMT_INT = '0'
FMT_PCT = '0%'

HW_COLS_SIMPLE = ['序号', '分类', '设备名称', '型号 / 规格', '配置数量', '单位', '数量口径']
HW_COLS_CONTRACT = ['序号', '分类', '设备名称', '型号 / 规格', '设备ID（稳定主键）', '行类型',
                    '配置数量', '单位', '备件率', '备件数量', '合计数量', '数量口径']
W_SIMPLE = {1: 5, 2: 16, 3: 26, 4: 30, 5: 10, 6: 6, 7: 60}
W_CONTRACT = {1: 5, 2: 14, 3: 24, 4: 26, 5: 30, 6: 12, 7: 10, 8: 6, 9: 8, 10: 9, 11: 10, 12: 46}
W_SUMMARY = {1: 5, 2: 30, 3: 10, 4: 14, 5: 14, 6: 14}
HW_LT_CN = {'hardware': '硬件整机', 'optic_module': '光模块', 'cable': '线缆跳线',
            'license': '授权/网管费用', 'software': '软件', 'service': '服务'}


def _stamp():
    return datetime.datetime.now().astimezone().isoformat(timespec='seconds')


def _title(ws, text, nc, subtitle, widths, note=None):
    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=nc)
    c = ws.cell(1, 1, text)
    c.font = F_TITLE
    c.fill = PatternFill('solid', fgColor=_C_TITLE)
    c.alignment = CT
    ws.row_dimensions[1].height = 26
    ws.merge_cells(start_row=2, start_column=1, end_row=2, end_column=nc)
    c2 = ws.cell(2, 2 - 1, subtitle)
    c2.font = F_SUB
    c2.alignment = LT
    ws.row_dimensions[2].height = 30
    r = 3
    if note:
        ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=nc)
        c3 = ws.cell(r, 1, note)
        c3.font = F_NOTE
        c3.alignment = LT
        r += 1
    for col, w in (widths or {}).items():
        ws.column_dimensions[get_column_letter(col)].width = w
    return r


def _header(ws, r, cols):
    for i, name in enumerate(cols, 1):
        c = ws.cell(r, i, name)
        c.font = F_HEAD
        c.fill = PatternFill('solid', fgColor=_C_HEAD)
        c.alignment = CT
        c.border = BD
    ws.row_dimensions[r].height = 20
    return r + 1


def _row(ws, r, vals, spec_cols=(), zebra=False):
    for i, v in enumerate(vals, 1):
        c = ws.cell(r, i, v)
        c.font = F_BODY_B if i in spec_cols else F_BODY
        c.border = BD
        c.alignment = CT if not isinstance(v, str) or len(str(v)) < 24 else LT
        if zebra:
            c.fill = PatternFill('solid', fgColor=_C_ZEBRA)
    return r + 1


def _band(ws, r, nc, text):
    ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=nc)
    c = ws.cell(r, 1, text)
    c.font = F_BODY_B
    c.fill = PatternFill('solid', fgColor=_C_BAND)
    c.alignment = LT
    c.border = BD
    return r + 1


def _setup_print(ws, repeat_rows=None):
    ws.freeze_panes = ws.freeze_panes or None


def write_hw_list(ws, lines, title, variant='contract'):
    """组网清单（简版/契约版）。返回 (header_row, 小计行列表 [(net, row)])"""
    contract = (variant == 'contract')
    cols = HW_COLS_CONTRACT if contract else HW_COLS_SIMPLE
    nc = len(cols)
    r = _title(
        ws, f'{title} · 组网清单（{"契约版" if contract else "简版"}）', nc,
        ('**本清单不含任何价格**；数量为唯一事实源，价格由下游价格库按「设备ID」join。'
         if contract else
         '**本清单不含任何价格**，是数量视图，供内部与现场核对。')
        + f'格式版本 {SCHEMA_VER} ｜ 生成时间 {_stamp()}',
        W_CONTRACT if contract else W_SIMPLE,
        note=('备件率默认值（D4 拍板）：交换机整机 3% / 服务器 1% / 光模块与线缆 5% / '
              '授权与软件 0% / GPU 整机不备件；可用 ratio_map 参数覆盖。' if contract else None))
    r = _header(ws, r, cols)
    hdr = r - 1
    subtotal_rows = []
    last_net, seq, sec_start = None, 0, r

    def _flush():
        nonlocal r
        tip = '含该分项全部明细；各行单位不同，数量合计仅供行数与档位核对'
        if contract:
            for col, formula in ((7, f'=SUM(G{sec_start}:G{r - 1})'),
                                 (10, f'=SUM(J{sec_start}:J{r - 1})'),
                                 (11, f'=SUM(K{sec_start}:K{r - 1})')):
                c = ws.cell(r, col, formula)
                c.font = F_BODY_B
                c.number_format = FMT_INT
                c.border = BD
            ws.cell(r, 1, '小计').font = F_BODY_B
            ws.cell(r, 3, f'{seq} 项')
            ws.cell(r, nc, tip)
        else:
            c = ws.cell(r, 5, f'=SUM(E{sec_start}:E{r - 1})')
            c.font = F_BODY_B
            c.number_format = FMT_INT
            c.border = BD
            ws.cell(r, 1, '小计').font = F_BODY_B
            ws.cell(r, 3, f'{seq} 项')
            ws.cell(r, nc, tip)
        subtotal_rows.append((last_net, r))
        r += 1

    for ln in lines:
        if ln['network_profile'] != last_net:
            if last_net is not None:
                _flush()
            last_net, seq, sec_start = ln['network_profile'], 0, r
        seq += 1
        if contract:
            vals = [seq, '', ln['name'], ln['model'], ln['device_id'], ln['line_type'],
                    ln['qty'], ln['unit'], ln['spare_ratio'],
                    f'=CEILING(G{r}*I{r},1)', f'=G{r}+J{r}', ln['qty_basis']]
        else:
            vals = [seq, '', ln['name'], ln['model'], ln['qty'], ln['unit'], ln['qty_basis']]
        r = _row(ws, r, vals, spec_cols=(4, 5, 12) if contract else (4, 7), zebra=(seq % 2 == 0))
        ws.cell(r - 1, 7 if contract else 5).number_format = FMT_INT
        if contract:
            ws.cell(r - 1, 9).number_format = FMT_PCT
            ws.cell(r - 1, 10).number_format = FMT_INT
            ws.cell(r - 1, 11).number_format = FMT_INT
    if last_net is not None:
        _flush()

    # 合计 + 分类列纵向合并
    if subtotal_rows:
        if contract:
            ws.cell(r, 3, '合计（数量清单 · 不含价格）').font = F_BODY_B
            ws.cell(r, 7, '=' + '+'.join(f'G{sr}' for _, sr in subtotal_rows))
            ws.cell(r, 11, '=' + '+'.join(f'K{sr}' for _, sr in subtotal_rows))
            ws.cell(r, 7).number_format = FMT_INT
            ws.cell(r, 11).number_format = FMT_INT
        else:
            ws.cell(r, 3, '合计（数量清单 · 不含价格）').font = F_BODY_B
            ws.cell(r, 5, '=' + '+'.join(f'E{sr}' for _, sr in subtotal_rows))
            ws.cell(r, 5).number_format = FMT_INT
        r += 1
        start = hdr + 1
        for name, srow in subtotal_rows:
            end = srow - 1
            if end >= start:
                ws.merge_cells(start_row=start, start_column=2, end_row=end, end_column=2)
                cc = ws.cell(start, 2, name)
                cc.alignment = CT
                cc.font = F_BODY_B
            start = srow + 1
    ws.freeze_panes = f'A{hdr + 1}'
    return hdr, subtotal_rows


def write_hw_summary(ws, lines, title, scale_rows, stat, warn_extra=None):
    """设计汇总：规模与数量（无任何价格）"""
    nc = 6
    r = _title(ws, f'{title} · 设计汇总', nc,
               '本页只讲**规模与数量**；**金额一律不出现在本清单内**，价格由下游价格库按「设备ID」join。'
               f'清单共 {stat["row_count"]} 行 / {len(stat["by_network"])} 个分项 / '
               f'{stat["device_id_count"]} 个唯一设备ID（含备件行）。', W_SUMMARY)
    r = _band(ws, r, nc, '一、项目规模')
    for k, v in scale_rows:
        ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=2)
        c1 = ws.cell(r, 1, k)
        c1.font = F_BODY_B
        c1.alignment = CT
        c1.border = BD
        ws.cell(r, 2).border = BD
        ws.merge_cells(start_row=r, start_column=3, end_row=r, end_column=nc)
        c2 = ws.cell(r, 3, v)
        c2.font = F_BODY
        c2.alignment = LT
        for col in range(3, nc + 1):
            ws.cell(r, col).border = BD
        r += 1
    r += 1
    r = _band(ws, r, nc, '二、分项数量汇总（各行单位不同，数量合计仅供行数与档位核对）')
    r = _header(ws, r, ['序号', '分项（网络平面）', '项数', '配置数量', '备件数量', '合计数量'])
    for i, n in enumerate(stat['by_network'], 1):
        r = _row(ws, r, [i, n['name'], n['row_count'], n['qty'], n['spare'], n['total']],
                 zebra=(i % 2 == 0))
    r += 1
    r = _band(ws, r, nc, '三、按单位汇总（台 / 个 / 根 属不同量纲，不可直接相加）')
    r = _header(ws, r, ['序号', '单位', '项数', '配置数量', '备件数量', '合计数量'])
    for i, (u, v) in enumerate(stat['by_unit'].items(), 1):
        r = _row(ws, r, [i, u, v['n'], v['qty'], v['spare'], v['total']], zebra=(i % 2 == 0))
    r += 1
    r = _band(ws, r, nc, '四、按行类型汇总（下游按行类型套备件率 / 维保基数）')
    r = _header(ws, r, ['序号', '行类型', '中文名', '项数', '配置数量', '备件数量'])
    for i, (t, v) in enumerate(stat['by_line_type'].items(), 1):
        r = _row(ws, r, [i, t, HW_LT_CN.get(t, t), v['n'], v['qty'], v['spare']], zebra=(i % 2 == 0))
    r += 1
    r = _band(ws, r, nc, '五、口径告警')
    if warn_extra:
        for w in warn_extra:
            ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=nc)
            ws.cell(r, 1, f'⚠ {w}').font = F_NOTE
            r += 1
    else:
        ws.cell(r, 1, '无告警：全部设备均命中稳定 ID，数量口径完整').font = F_NOTE
        r += 1


def write_hw_topology(ws, lines, title):
    """组网示意图（清单事实版）：按网络平面列设备与数量，不做拓扑推导"""
    nc = 6
    r = _title(ws, f'{title} · 组网示意图', nc,
               '按**网络平面**呈现「设备与数量」——设备与模块/线缆分列，数量为清单合计；'
               '精确拓扑请以「数量口径」列与「设计口径」页为准。', W_SUMMARY)
    order, groups = [], {}
    for ln in lines:
        k = ln['network_profile']
        if k not in groups:
            order.append(k)
            groups[k] = []
        groups[k].append(ln)
    idx = '一二三四五六七八九十'
    for i, k in enumerate(order, 1):
        g = groups[k]
        r = _band(ws, r, nc, f'{idx[i - 1]}、{k}')
        hw = [x for x in g if x['line_type'] == 'hardware']
        md = [x for x in g if x['line_type'] in ('optic_module', 'cable')]
        if hw:
            ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=nc)
            ws.cell(r, 1, '设备：' + ' ｜ '.join(
                f"{x['name']} ×{x['qty']}{x['unit']}" for x in hw)).font = F_BODY
            r += 1
        if md:
            ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=nc)
            ws.cell(r, 1, '模块与线缆：' + ' ｜ '.join(
                f"{x['name']} ×{x['qty']}{x['unit']}" for x in md)).font = F_BODY
            r += 1
        ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=nc)
        ws.cell(r, 1, f"合计：配置 {sum(x['qty'] for x in g)} ／ 备件 {sum(x['spare_qty'] for x in g)}"
                      f"（各行单位不同，仅供行数与档位核对）").font = F_NOTE
        r += 2


def write_hw_criteria(ws, lines, title, param_rows=None, warn_extra=None, caliber_notes=None):
    """设计口径：数量口径 / 设备ID 契约 / 项目参数 / 口径声明 / 告警"""
    nc = 6
    r = _title(ws, f'{title} · 设计口径', nc,
               '说明本清单的**数量口径与机器契约**——本页不含任何价格。', W_SUMMARY)
    r = _band(ws, r, nc, '一、数量口径与备件规则')
    for t in ('「配置数量」为设计产出的订货数量，与连接表/设备清单同源，不做二次取整。',
              '「备件数量」= CEILING(配置数量 × 备件率, 1)——向上取整，Excel 内为公式，可独立复算。',
              '「合计数量」= 配置数量 + 备件数量。',
              '备件率默认（D4 拍板）：光模块与线缆 5% ／ 交换机整机 3% ／ 服务器 1% ／ 授权与软件 0%；GPU 整机不备件。',
              '「数量口径」列为可机读推导式，可据以逐行复算。'):
        ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=nc)
        ws.cell(r, 1, t).font = F_NOTE
        r += 1
    r += 1
    r = _band(ws, r, nc, '二、设备ID 与下游价格库对接')
    for t in ('「设备ID」是稳定主键：同设备恒等、与中文展示名解耦，供下游价格库 join。',
              'ID 形如 <平面>_<角色>_<档案ID>，角色取自行类型（dev/mod/cab）。'):
        ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=nc)
        ws.cell(r, 1, t).font = F_NOTE
        r += 1
    r += 1
    r = _band(ws, r, nc, '三、项目参数与口径声明')
    for k, v in list(param_rows or []) + list(caliber_notes or []):
        ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=2)
        c1 = ws.cell(r, 1, k)
        c1.font = F_BODY_B
        c1.alignment = CT
        c1.border = BD
        ws.cell(r, 2).border = BD
        ws.merge_cells(start_row=r, start_column=3, end_row=r, end_column=nc)
        c2 = ws.cell(r, 3, v)
        c2.font = F_BODY
        c2.alignment = LT
        for col in range(3, nc + 1):
            ws.cell(r, col).border = BD
        r += 1
    r += 1
    r = _band(ws, r, nc, '四、输出物与格式版本')
    ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=nc)
    ws.cell(r, 1, f'格式版本 {SCHEMA_VER} ｜ 生成时间 {_stamp()} ｜ 共 {len(lines)} 行').font = F_NOTE
    r += 1
    r = _band(ws, r, nc, '五、口径告警')
    warns = list(warn_extra or [])
    if warns:
        for w in warns:
            ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=nc)
            ws.cell(r, 1, f'⚠ {w}').font = F_NOTE
            r += 1
    else:
        ws.cell(r, 1, '无告警').font = F_NOTE


def build_workbook(lines, title, scale_rows=None, param_rows=None, caliber_notes=None,
                   warn_extra=None, stat=None):
    """组装五页式工作簿并返回（不落盘，落盘由调用方负责）"""
    wb = Workbook()
    wb.remove(wb.active)
    st = stat or {}
    ws1 = wb.create_sheet('设计汇总')
    write_hw_summary(ws1, lines, title, scale_rows or [], st, warn_extra=warn_extra)
    ws2 = wb.create_sheet('组网清单（简版）')
    write_hw_list(ws2, lines, title, variant='simple')
    ws3 = wb.create_sheet('组网清单（契约版）')
    write_hw_list(ws3, lines, title, variant='contract')
    ws4 = wb.create_sheet('组网示意图')
    write_hw_topology(ws4, lines, title)
    ws5 = wb.create_sheet('设计口径')
    write_hw_criteria(ws5, lines, title, param_rows=param_rows,
                      warn_extra=warn_extra, caliber_notes=caliber_notes)
    return wb
