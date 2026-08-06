"""V3.1.4-T8-3: 机房矩阵编辑 action 测试（room:set-type / room:place / room:create 落盘）

覆盖：类型标记（成功/非法/位置不存在/无矩阵/缺参数/别名）、上架（成功/占位/类型域/功率/
冲突/移动/移除）、创建落盘、room:optimize 按 project 读矩阵。
"""
import os

from cli import execute
from room import LAYOUT_FILENAME, save_room_layout, create_default_room


def setup_project(tmp_path, project='P', rows=('A', 'B', 'C'), cols=(1, 2, 3)):
    """在临时工作区创建项目 + 默认矩阵，返回矩阵"""
    ws = os.path.join(str(tmp_path), 'workspace')
    proj_dir = os.path.join(ws, project)
    os.makedirs(proj_dir, exist_ok=True)
    matrix = create_default_room(list(rows), list(cols), name='机房A')
    save_room_layout(os.path.join(proj_dir, LAYOUT_FILENAME), matrix)
    return matrix


class TestRoomSetType:
    def test_mark_and_persist(self, tmp_path, monkeypatch):
        monkeypatch.setenv('AUTOLINK_USER_DATA', str(tmp_path))
        setup_project(tmp_path)
        res = execute('room:set-type', {'project': 'P', 'position': 'A1', 'type': 'network'})
        assert res['success'] is True
        # 落盘验证：重读文件
        from room import load_room_layout
        matrix = load_room_layout(os.path.join(str(tmp_path), 'workspace', 'P', LAYOUT_FILENAME))
        assert matrix.cells['A1'].type == 'network'

    def test_project_name_alias(self, tmp_path, monkeypatch):
        monkeypatch.setenv('AUTOLINK_USER_DATA', str(tmp_path))
        setup_project(tmp_path)
        res = execute('room:set-type', {'projectName': 'P', 'position': 'B2', 'type': 'gpu'})
        assert res['success'] is True

    def test_invalid_type(self, tmp_path, monkeypatch):
        monkeypatch.setenv('AUTOLINK_USER_DATA', str(tmp_path))
        setup_project(tmp_path)
        res = execute('room:set-type', {'project': 'P', 'position': 'A1', 'type': 'quantum'})
        assert res['success'] is False
        assert '类型非法' in res['error']

    def test_missing_project(self, tmp_path, monkeypatch):
        monkeypatch.setenv('AUTOLINK_USER_DATA', str(tmp_path))
        res = execute('room:set-type', {'position': 'A1', 'type': 'gpu'})
        assert res['success'] is False
        assert 'project' in res['error']

    def test_position_missing_in_matrix(self, tmp_path, monkeypatch):
        monkeypatch.setenv('AUTOLINK_USER_DATA', str(tmp_path))
        setup_project(tmp_path)
        res = execute('room:set-type', {'project': 'P', 'position': 'Z9', 'type': 'gpu'})
        assert res['success'] is False
        assert '位置不存在' in res['error']

    def test_project_without_layout(self, tmp_path, monkeypatch):
        monkeypatch.setenv('AUTOLINK_USER_DATA', str(tmp_path))
        os.makedirs(os.path.join(str(tmp_path), 'workspace', 'Q'), exist_ok=True)
        res = execute('room:set-type', {'project': 'Q', 'position': 'A1', 'type': 'gpu'})
        assert res['success'] is False
        assert LAYOUT_FILENAME in res['error']


class TestRoomPlace:
    def test_place_and_persist(self, tmp_path, monkeypatch):
        monkeypatch.setenv('AUTOLINK_USER_DATA', str(tmp_path))
        setup_project(tmp_path)
        res = execute('room:place', {'project': 'P', 'position': 'A1', 'cabinet_id': 5})
        assert res['success'] is True
        from room import load_room_layout
        matrix = load_room_layout(os.path.join(str(tmp_path), 'workspace', 'P', LAYOUT_FILENAME))
        assert matrix.cells['A1'].cabinet_id == 5

    def test_placeholder_rejected(self, tmp_path, monkeypatch):
        monkeypatch.setenv('AUTOLINK_USER_DATA', str(tmp_path))
        m = setup_project(tmp_path)
        m.set_placeholder('A1', 'ac')
        from room import save_room_layout
        save_room_layout(os.path.join(str(tmp_path), 'workspace', 'P', LAYOUT_FILENAME), m)
        res = execute('room:place', {'project': 'P', 'position': 'A1', 'cabinet_id': 5})
        assert res['success'] is False
        assert '占位' in res['error']

    def test_type_domain_rejected(self, tmp_path, monkeypatch):
        monkeypatch.setenv('AUTOLINK_USER_DATA', str(tmp_path))
        m = setup_project(tmp_path)
        m.set_type('A1', 'gpu')
        from room import save_room_layout
        save_room_layout(os.path.join(str(tmp_path), 'workspace', 'P', LAYOUT_FILENAME), m)
        res = execute('room:place', {'project': 'P', 'position': 'A1', 'cabinet_id': 5,
                                     'cabinet_type': 'network'})
        assert res['success'] is False
        assert '不允许放置' in res['error']

    def test_power_limit_rejected(self, tmp_path, monkeypatch):
        monkeypatch.setenv('AUTOLINK_USER_DATA', str(tmp_path))
        setup_project(tmp_path)
        res = execute('room:place', {'project': 'P', 'position': 'A1', 'cabinet_id': 5,
                                     'power_watts': 9000})
        assert res['success'] is False
        assert '功率' in res['error']

    def test_power_limit_ok_with_constraints(self, tmp_path, monkeypatch):
        monkeypatch.setenv('AUTOLINK_USER_DATA', str(tmp_path))
        setup_project(tmp_path)
        res = execute('room:place', {'project': 'P', 'position': 'A1', 'cabinet_id': 5,
                                     'power_watts': 50000, 'constraints': {'powerLimitPerRack': 60000}})
        assert res['success'] is True

    def test_cell_occupied_rejected(self, tmp_path, monkeypatch):
        monkeypatch.setenv('AUTOLINK_USER_DATA', str(tmp_path))
        m = setup_project(tmp_path)
        m.place_cabinet('A1', 7)
        from room import save_room_layout
        save_room_layout(os.path.join(str(tmp_path), 'workspace', 'P', LAYOUT_FILENAME), m)
        res = execute('room:place', {'project': 'P', 'position': 'A1', 'cabinet_id': 5})
        assert res['success'] is False
        assert '已被机柜' in res['error']

    def test_move_semantics_clears_old_position(self, tmp_path, monkeypatch):
        monkeypatch.setenv('AUTOLINK_USER_DATA', str(tmp_path))
        m = setup_project(tmp_path)
        m.place_cabinet('A1', 5)
        from room import save_room_layout
        save_room_layout(os.path.join(str(tmp_path), 'workspace', 'P', LAYOUT_FILENAME), m)
        res = execute('room:place', {'project': 'P', 'position': 'B2', 'cabinet_id': 5})
        assert res['success'] is True
        from room import load_room_layout
        matrix = load_room_layout(os.path.join(str(tmp_path), 'workspace', 'P', LAYOUT_FILENAME))
        assert matrix.cells['A1'].cabinet_id is None
        assert matrix.cells['B2'].cabinet_id == 5

    def test_remove_cabinet(self, tmp_path, monkeypatch):
        monkeypatch.setenv('AUTOLINK_USER_DATA', str(tmp_path))
        m = setup_project(tmp_path)
        m.place_cabinet('A1', 5)
        from room import save_room_layout
        save_room_layout(os.path.join(str(tmp_path), 'workspace', 'P', LAYOUT_FILENAME), m)
        res = execute('room:place', {'project': 'P', 'position': 'A1', 'cabinet_id': 0})
        assert res['success'] is True
        from room import load_room_layout
        matrix = load_room_layout(os.path.join(str(tmp_path), 'workspace', 'P', LAYOUT_FILENAME))
        assert matrix.cells['A1'].cabinet_id is None

    def test_invalid_cabinet_id(self, tmp_path, monkeypatch):
        monkeypatch.setenv('AUTOLINK_USER_DATA', str(tmp_path))
        setup_project(tmp_path)
        res = execute('room:place', {'project': 'P', 'position': 'A1', 'cabinet_id': 'abc'})
        assert res['success'] is False
        assert 'cabinet_id 非法' in res['error']

    def test_missing_args(self, tmp_path, monkeypatch):
        monkeypatch.setenv('AUTOLINK_USER_DATA', str(tmp_path))
        res = execute('room:place', {'position': 'A1', 'cabinet_id': 5})
        assert res['success'] is False
        assert 'project' in res['error']


class TestRoomCreatePersist:
    def test_create_with_project_persists(self, tmp_path, monkeypatch):
        monkeypatch.setenv('AUTOLINK_USER_DATA', str(tmp_path))
        res = execute('room:create', {'rows': ['A', 'B', 'C'], 'cols': [1, 2, 3], 'project': 'P'})
        assert res['success'] is True
        from room import load_room_layout
        matrix = load_room_layout(os.path.join(str(tmp_path), 'workspace', 'P', LAYOUT_FILENAME))
        assert len(matrix.cells) == 9

    def test_create_with_project_name_alias(self, tmp_path, monkeypatch):
        monkeypatch.setenv('AUTOLINK_USER_DATA', str(tmp_path))
        res = execute('room:create', {'rows': ['A', 'B'], 'cols': [1, 2], 'projectName': 'P'})
        assert res['success'] is True

    def test_create_without_project_returns_matrix(self, tmp_path, monkeypatch):
        monkeypatch.setenv('AUTOLINK_USER_DATA', str(tmp_path))
        res = execute('room:create', {'rows': ['A', 'B'], 'cols': [1, 2]})
        # 前端兼容：不传 project 返回矩阵 dict（无 success 字段）
        assert 'rows' in res and 'cells' in res


class TestRoomOptimizeWithProject:
    def test_optimize_reads_project_layout(self, tmp_path, monkeypatch):
        monkeypatch.setenv('AUTOLINK_USER_DATA', str(tmp_path))
        setup_project(tmp_path)
        res = execute('room:optimize', {'project': 'P', 'counts': {'gpu': 5}})
        assert res['success'] is True
        assert res['stats']['placed'] == 5

    def test_optimize_accepts_project_name_alias(self, tmp_path, monkeypatch):
        monkeypatch.setenv('AUTOLINK_USER_DATA', str(tmp_path))
        setup_project(tmp_path)
        res = execute('room:optimize', {'projectName': 'P', 'counts': {'network': 4}})
        assert res['success'] is True
        assert res['stats']['placed'] == 4

    def test_optimize_project_without_layout(self, tmp_path, monkeypatch):
        monkeypatch.setenv('AUTOLINK_USER_DATA', str(tmp_path))
        res = execute('room:optimize', {'project': 'Q', 'counts': {'gpu': 1}})
        assert res['success'] is False
        assert LAYOUT_FILENAME in res['issues'][0]
