"""
测试 backend/room.py - 机房矩阵数据层（V3.0.4-T3-1）

覆盖：RoomMatrix（225 柜矩阵/占位/类型/上架/序列化往返/结构校验）、
RoomConstraints（占位阻止/类型域/功率上限）、持久化（save/load/validate）、
engine action（room:create / room:validate）。
"""
import json

import pytest

from room import (
    ROOM_TYPE_COMBINED,
    ROOM_TYPE_COMPUTE,
    ROOM_TYPE_EMPTY,
    ROOM_TYPE_GPU,
    ROOM_TYPE_NETWORK,
    ROOM_TYPE_STORAGE,
    PLACEHOLDER_AC,
    PLACEHOLDER_PILLAR,
    DEVICE_TYPE_GPU,
    DEVICE_TYPE_NETWORK,
    DEVICE_TYPE_STORAGE,
    DEVICE_TYPE_COMPUTE,
    RoomCell,
    RoomMatrix,
    RoomConstraints,
    create_default_room,
    save_room_layout,
    load_room_layout,
    validate_room_layout,
    LAYOUT_FILENAME,
)

# 默认 15×15 = 225 柜（A~O × 1~15）
ROWS_225 = [chr(ord('A') + i) for i in range(15)]
COLS_225 = list(range(1, 16))


class TestRoomMatrix:
    """机房矩阵模型"""

    def test_default_225_cells(self):
        """A15~O15 = 225 柜矩阵可定义"""
        m = create_default_room(ROWS_225, COLS_225, name='AIDC-1')
        assert m.size == 225
        assert m.name == 'AIDC-1'
        assert m.rows == ROWS_225
        assert m.cols == COLS_225

    def test_position_naming(self):
        """位置命名：行 + 列（A1 / A15 / O15）"""
        m = create_default_room(ROWS_225, COLS_225)
        assert m.get_position('A1').position == 'A1'
        assert m.get_position('A15').position == 'A15'
        assert m.get_position('O15').position == 'O15'
        # 全量位置唯一且覆盖 225 个命名
        positions = list(m.cells.keys())
        assert len(set(positions)) == 225

    def test_cell_defaults(self):
        """默认单元：empty 类型、无占位、可放置"""
        m = create_default_room(['A', 'B'], [1, 2])
        cell = m.get_position('A1')
        assert cell.type == ROOM_TYPE_EMPTY
        assert cell.placeholder is None
        assert cell.cabinet_id is None
        assert cell.is_available()

    def test_set_placeholder(self):
        """空调/柱子占位标记后不可放置设备"""
        m = create_default_room(ROWS_225, COLS_225)
        m.set_placeholder('A8', PLACEHOLDER_AC)
        m.set_placeholder('B8', PLACEHOLDER_PILLAR)
        assert not m.get_position('A8').is_available()
        assert not m.get_position('B8').is_available()
        # 占位位置禁止上架
        with pytest.raises(ValueError):
            m.place_cabinet('A8', 101)
        # 清除占位后可上架
        m.set_placeholder('A8', None)
        assert m.get_position('A8').is_available()

    def test_place_and_remove_cabinet(self):
        """上架/下架机柜 + 位置反查"""
        m = create_default_room(['A', 'B'], [1, 2])
        m.place_cabinet('A1', 5)
        assert m.get_position('A1').cabinet_id == 5
        assert m.cabinet_position(5) == 'A1'
        m.remove_cabinet('A1')
        assert m.get_position('A1').cabinet_id is None
        assert m.cabinet_position(5) is None

    def test_set_type(self):
        """机柜类型标记"""
        m = create_default_room(['A'], [1])
        m.set_type('A1', ROOM_TYPE_GPU)
        assert m.get_position('A1').type == ROOM_TYPE_GPU

    def test_unknown_position(self):
        """未知位置：查询返回 None，编辑操作抛 KeyError"""
        m = create_default_room(['A'], [1])
        assert m.get_position('Z99') is None
        with pytest.raises(KeyError):
            m.set_type('Z99', ROOM_TYPE_GPU)

    def test_to_from_dict_roundtrip(self):
        """to_dict / from_dict 往返一致"""
        m = create_default_room(ROWS_225, COLS_225, name='机房A')
        m.set_placeholder('A8', PLACEHOLDER_AC)
        m.set_placeholder('B8', PLACEHOLDER_PILLAR)
        m.set_type('A1', ROOM_TYPE_GPU)
        m.set_type('C3', ROOM_TYPE_STORAGE)
        m.place_cabinet('A1', 7)
        m2 = RoomMatrix.from_dict(m.to_dict())
        assert m2.name == m.name
        assert m2.rows == m.rows
        assert m2.cols == m.cols
        assert m2.size == m.size
        assert m2.get_position('A8').placeholder == PLACEHOLDER_AC
        assert m2.get_position('B8').placeholder == PLACEHOLDER_PILLAR
        assert m2.get_position('A1').type == ROOM_TYPE_GPU
        assert m2.get_position('A1').cabinet_id == 7

    def test_custom_naming_rule(self):
        """自定义命名规则（非字母行名）"""
        m = create_default_room(['1F', '2F', '3F'], [1, 2, 3])
        assert m.size == 9
        assert m.get_position('2F2').position == '2F2'

    def test_validate_ok_and_bad(self):
        """结构校验：合法矩阵无错误，非法矩阵报错"""
        m = create_default_room(['A', 'B'], [1, 2])
        assert m.validate() == []
        m.set_placeholder('A1', 'invalid_placeholder')
        assert m.validate() != []
        m.set_placeholder('A1', None)
        m.set_type('A1', 'invalid_type')
        assert m.validate() != []


class TestRoomConstraints:
    """上架约束"""

    def test_placeholder_blocks_placement(self):
        """占位（空调/柱子）不可放置设备"""
        cell = RoomCell('A', 8, placeholder=PLACEHOLDER_AC)
        errors = RoomConstraints().validate_placement(cell, DEVICE_TYPE_GPU)
        assert errors and '占位' in errors[0]

    def test_type_domain_enforced(self):
        """机柜类型约束设备域：GPU 柜拒收网络设备"""
        c = RoomConstraints()
        gpu_cell = RoomCell('A', 1, cell_type=ROOM_TYPE_GPU)
        assert c.validate_placement(gpu_cell, DEVICE_TYPE_GPU) == []
        errors = c.validate_placement(gpu_cell, DEVICE_TYPE_NETWORK)
        assert errors and '不允许放置' in errors[0]
        # 存储柜拒收 GPU
        storage_cell = RoomCell('B', 2, cell_type=ROOM_TYPE_STORAGE)
        assert c.validate_placement(storage_cell, DEVICE_TYPE_STORAGE) == []
        assert c.validate_placement(storage_cell, DEVICE_TYPE_GPU) != []

    def test_combined_and_empty_allow_any(self):
        """组合/未标记柜任意设备域"""
        c = RoomConstraints()
        for cell_type in (ROOM_TYPE_COMBINED, ROOM_TYPE_EMPTY):
            cell = RoomCell('A', 1, cell_type=cell_type)
            for dtype in (DEVICE_TYPE_GPU, DEVICE_TYPE_NETWORK,
                          DEVICE_TYPE_STORAGE, DEVICE_TYPE_COMPUTE):
                assert c.validate_placement(cell, dtype) == []

    def test_power_limit(self):
        """功率上限校验"""
        c = RoomConstraints(power_limit_per_rack=6000)
        cell = RoomCell('A', 1, cell_type=ROOM_TYPE_COMBINED)
        assert c.validate_placement(cell, DEVICE_TYPE_GPU, power_watts=5000) == []
        errors = c.validate_placement(cell, DEVICE_TYPE_GPU, power_watts=8000)
        assert errors and '功率' in errors[0]

    def test_none_cell_rejected(self):
        assert RoomConstraints().validate_placement(None, DEVICE_TYPE_GPU)


class TestRoomPersistence:
    """room_layout.json 持久化"""

    def test_save_load_roundtrip(self, tmp_path):
        """保存/读取往返一致"""
        m = create_default_room(ROWS_225, COLS_225, name='225柜机房')
        m.set_placeholder('A8', PLACEHOLDER_AC)
        m.set_type('A1', ROOM_TYPE_GPU)
        m.place_cabinet('A1', 3)
        path = tmp_path / LAYOUT_FILENAME
        save_room_layout(str(path), m)
        m2 = load_room_layout(str(path))
        assert m2.name == '225柜机房'
        assert m2.size == 225
        assert m2.get_position('A8').placeholder == PLACEHOLDER_AC
        assert m2.get_position('A1').type == ROOM_TYPE_GPU
        assert m2.get_position('A1').cabinet_id == 3

    def test_save_creates_dir(self, tmp_path):
        """目标目录不存在时自动创建"""
        path = tmp_path / 'sub' / 'room' / LAYOUT_FILENAME
        save_room_layout(str(path), create_default_room(['A'], [1]))
        assert path.exists()

    def test_load_missing_raises(self, tmp_path):
        with pytest.raises(FileNotFoundError):
            load_room_layout(str(tmp_path / LAYOUT_FILENAME))

    def test_validate_layout_valid(self):
        """合法 layout 校验通过"""
        m = create_default_room(ROWS_225, COLS_225)
        assert validate_room_layout(m.to_dict()) == []

    def test_validate_layout_invalid(self):
        """非法 layout 校验报错"""
        assert validate_room_layout({}) != []
        assert validate_room_layout({'rows': ['A'], 'cols': []}) != []
        assert validate_room_layout({'rows': ['A'], 'cols': [1], 'name': 123}) == []
        # 非法占位类型
        m = create_default_room(['A'], [1])
        m.set_placeholder('A1', 'bogus')
        assert validate_room_layout(m.to_dict()) != []
        # 非 dict
        assert validate_room_layout([1, 2]) != []


class TestRoomActions:
    """engine action（room:create / room:validate）"""

    def test_room_create_action(self):
        from engine import handle_room_create
        result = handle_room_create({'rows': ROWS_225, 'cols': COLS_225, 'name': 'AIDC-1'})
        assert 'error' not in result
        assert result['schemaVersion'] == 1
        assert len(result['cells']) == 225
        assert result['name'] == 'AIDC-1'

    def test_room_create_requires_rows_cols(self):
        from engine import handle_room_create
        assert 'error' in handle_room_create({})
        assert 'error' in handle_room_create({'rows': ['A']})

    def test_room_create_size_limit(self):
        from engine import handle_room_create
        big_rows = [str(i) for i in range(100)]
        big_cols = [str(i) for i in range(100)]
        assert 'error' in handle_room_create({'rows': big_rows, 'cols': big_cols})

    def test_room_validate_action(self):
        from engine import handle_room_validate
        m = create_default_room(['A', 'B'], [1, 2])
        ok = handle_room_validate({'layout': m.to_dict()})
        assert ok['valid'] is True and ok['errors'] == []
        bad = handle_room_validate({'layout': {'rows': [], 'cols': []}})
        assert bad['valid'] is False and bad['errors']
        non_dict = handle_room_validate({'layout': 'oops'})
        assert non_dict['valid'] is False
