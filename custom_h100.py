"""
AutoLink - 定制连线方案: 100台H100 + 14台存储 + 20台管理服务器
按128台组网设计，分区分组优先，多余端口留空

拓扑规格:
  参数网络(64口交换机): 32 Leaf + 16 Spine, 4组×25台GPU
  存储网络(40口交换机): 7 Leaf + 3 Spine, 每Leaf 20台GPU
  业务网络(48口交换机): 6组MLAG对 + 2台盒式汇聚
"""

import sys
sys.path.insert(0, '.')
from models import NetworkObject, Connection
from exporter import apply_excel_formatting
import pandas as pd
import re
import datetime


def _extract_number(s):
    if isinstance(s, (int, float)):
        return int(s)
    if not isinstance(s, str):
        return 0
    m = re.search(r'\d+', s)
    return int(m.group()) if m else 0


def _get_switch_type_weight(name):
    if "接入" in name: return 1
    if "汇聚" in name: return 2
    if "Leaf" in name: return 1
    if "Spine" in name: return 2
    if "Core" in name: return 3
    return 4


class CustomWiring:
    def __init__(self):
        self.servers = []
        self.param_leaves = []
        self.param_spines = []
        self.storage_leaves = []
        self.storage_spines = []
        self.biz_access = []
        self.biz_agg = []
        self.oob_access = []
        self.oob_agg = []
        self.server_groups = {}
        self.switch_groups = {}
        self.podid_map = {}

        self._build()

    def _build(self):
        self._create_all_servers()
        self._create_param_switches()
        self._create_storage_switches()
        self._create_biz_switches()
        self._create_oob_switches()
        self._wire_param()
        self._wire_storage()
        self._wire_biz()
        self._wire_oob()

    # ========== 服务器创建 ==========
    def _create_all_servers(self):
        # 100台 H100 GPU 服务器: 4组 × 25台
        for grp in range(1, 5):
            for i in range(1, 26):
                idx = (grp - 1) * 25 + i
                s = NetworkObject(name=f"GPU服务器_{idx}", obj_type='server',
                                  group=f"H100组{grp}", podid=f"pod-h100-{grp}")
                self.servers.append(s)
                self.server_groups[s.name] = s.group
                self.podid_map[s.name] = s.podid

        # 14台存储服务器
        for i in range(1, 15):
            s = NetworkObject(name=f"存储服务器_{i}", obj_type='server',
                              group="存储服务器组", podid="pod-storage")
            self.servers.append(s)
            self.server_groups[s.name] = s.group
            self.podid_map[s.name] = s.podid

        # 20台管理服务器
        for i in range(1, 21):
            s = NetworkObject(name=f"管理服务器_{i}", obj_type='server',
                              group="管理服务器组", podid="pod-mgmt")
            self.servers.append(s)
            self.server_groups[s.name] = s.group
            self.podid_map[s.name] = s.podid

    # ========== 参数网络 ==========
    def _create_param_switches(self):
        # 32 Leaf: 4组 × 8台 (命名: 参数Leaf_G组号_序号)
        for grp in range(1, 5):
            for idx in range(1, 9):
                sw = NetworkObject(name=f"参数Leaf_G{grp}_{idx}",
                                   obj_type='param_leaf',
                                   group=f"参数Leaf组{grp}",
                                   max_ports=64,
                                   podid=f"pod-h100-{grp}")
                self.param_leaves.append(sw)
                self.switch_groups[sw.name] = sw.group
                self.podid_map[sw.name] = sw.podid

        # 16 Spine
        for i in range(1, 17):
            sw = NetworkObject(name=f"参数Spine_{i}",
                               obj_type='param_spine',
                               group="参数Spine组",
                               max_ports=64,
                               podid="superpod")
            self.param_spines.append(sw)
            self.switch_groups[sw.name] = sw.group
            self.podid_map[sw.name] = sw.podid

    def _wire_param(self):
        # Leaf端口: 1-25下联(服务器), 26-32空, 33-64上联(Spine)
        for leaf in self.param_leaves:
            leaf.downlink_counter = 1
            leaf.downlink_limit = 25
            leaf.uplink_counter = 33
            leaf.uplink_limit = 64

        for spine in self.param_spines:
            spine.downlink_counter = 1
            spine.downlink_limit = 32
            spine.uplink_counter = 33
            spine.uplink_limit = 64

        # Server→Leaf: 每组25台, 8 Leaf
        for server in self.servers[:100]:  # GPU only
            idx = int(server.name.split('_')[1])
            grp = (idx - 1) // 25 + 1
            idx_in_grp = (idx - 1) % 25 + 1

            for nic in range(1, 9):
                leaf_name = f"参数Leaf_G{grp}_{nic}"
                leaf = next((l for l in self.param_leaves if l.name == leaf_name), None)
                if not leaf:
                    continue

                srv_port = f"参数网卡{nic}"
                lf_port = f"端口{idx_in_grp}"  # 服务器1→端口1, ..., 服务器25→端口25
                leaf.downlink_counter = max(leaf.downlink_counter, idx_in_grp + 1)

                self._add_pair(server, srv_port, "400G", leaf, lf_port, "400G",
                               "MPO", f"服务器到参数Leaf")

        # Leaf→Spine: 每个Leaf连全部16台Spine, 每Spine 2口 (33-64全用)
        # Spine收敛: 32Leaf×2口=64/Spine, Spine下行32口 → 2:1收敛
        for li, leaf in enumerate(self.param_leaves):
            port_offset = 33
            for si in range(16):
                for p in range(2):  # 每Spine 2口
                    spine = self.param_spines[si]
                    lf_port = f"端口{port_offset}"
                    sp_port = f"端口{1 + (li * 2) + p}"
                    port_offset += 1

                    # 限制spine端口不超32
                    actual_sp_port = ((li * 2) + p) % 32 + 1
                    self._add_pair(leaf, lf_port, "400G", spine, f"端口{actual_sp_port}", "400G",
                                   "MPO", f"参数Leaf到Spine",
                                   spine_downlink_offset=actual_sp_port)

    # ========== 存储网络 ==========
    def _create_storage_switches(self):
        # 8 Leaf + 4 Spine (40口交换机, 下联20/上联20)
        for i in range(1, 9):
            sw = NetworkObject(name=f"存储Leaf_{i}",
                               obj_type='storage_leaf',
                               group="存储Leaf组",
                               max_ports=40,
                               podid=f"pod-storage-leaf-{i}")
            self.storage_leaves.append(sw)
            self.switch_groups[sw.name] = sw.group
            self.podid_map[sw.name] = sw.podid

        # 4 Spine
        for i in range(1, 5):
            sw = NetworkObject(name=f"存储Spine_{i}",
                               obj_type='storage_spine',
                               group="存储Spine组",
                               max_ports=40,
                               podid="superpod")
            self.storage_spines.append(sw)
            self.switch_groups[sw.name] = sw.group
            self.podid_map[sw.name] = sw.podid

    def _wire_storage(self):
        for leaf in self.storage_leaves:
            leaf.downlink_counter = 1
            leaf.downlink_limit = 20
            leaf.uplink_counter = 21
            leaf.uplink_limit = 40

        for spine in self.storage_spines:
            spine.downlink_counter = 1
            spine.downlink_limit = 20
            spine.uplink_counter = 21
            spine.uplink_limit = 40

        # GPU→Storage Leaf: 全部服务器分配到8个Leaf
        # 布局: Leaf1-4各15台H100, Leaf5-6各10台H100+7台存储, Leaf7-8各10台H100+10台通算
        # 每Leaf最多20端口, 均不超限
        leaf_assignments = [
            # (leaf_idx, h100_start, h100_count, extra_servers_start, extra_count)
            (1, 1, 15, None, 0),
            (2, 16, 15, None, 0),
            (3, 31, 15, None, 0),
            (4, 46, 15, None, 0),
            (5, 61, 10, 100, 7),    # 存储服务器 1-7
            (6, 71, 10, 107, 7),    # 存储服务器 8-14
            (7, 81, 10, 114, 10),   # 通算服务器 1-10
            (8, 91, 10, 124, 10),   # 通算服务器 11-20
        ]

        for leaf_idx, h100_start, h100_count, extra_start, extra_count in leaf_assignments:
            leaf = self.storage_leaves[leaf_idx - 1]
            port = 1

            # H100 GPU
            for i in range(h100_count):
                server = self.servers[h100_start - 1 + i]
                srv_port = "存储网卡1"
                lf_port = f"端口{port}"
                port += 1
                self._add_pair(server, srv_port, "200G", leaf, lf_port, "200G",
                               "AOC", "服务器到存储Leaf")

            # 额外服务器 (存储服务器/通算服务器)
            if extra_start is not None:
                for i in range(extra_count):
                    server = self.servers[extra_start + i]
                    srv_port = "存储网卡1"
                    lf_port = f"端口{port}"
                    port += 1
                    self._add_pair(server, srv_port, "200G", leaf, lf_port, "200G",
                                   "AOC", "服务器到存储Leaf")

            leaf.downlink_counter = port

        # Storage Leaf→Spine: 每Leaf连全部4台Spine, 每Spine 5口 (21-40全用)
        # Spine收敛: 8Leaf×5口=40/Spine, Spine下行20口 → 2:1收敛
        for li, leaf in enumerate(self.storage_leaves):
            port_offset = 21
            for si in range(4):
                for p in range(5):  # 每Spine 5口
                    spine = self.storage_spines[si]
                    lf_port = f"端口{port_offset}"
                    port_offset += 1

                    actual_sp_port = ((li * 5) + p) % 20 + 1
                    self._add_pair(leaf, lf_port, "200G", spine, f"端口{actual_sp_port}", "200G",
                                   "AOC", f"存储Leaf到Spine",
                                   spine_downlink_offset=actual_sp_port)

    # ========== 业务网络 ==========
    def _create_biz_switches(self):
        # 6组MLAG接入对: 4组GPU + 1组存储 + 1组管理
        groups = [
            ("GPU组1", 1, 25), ("GPU组2", 2, 25),
            ("GPU组3", 3, 25), ("GPU组4", 4, 25),
            ("存储组", 5, 14), ("管理组", 6, 20)
        ]
        self.biz_group_info = groups

        for gname, gid, count in groups:
            for pair in range(1, 3):  # MLAG双机
                sw = NetworkObject(name=f"业务接入_{gname}_{pair}",
                                   obj_type='biz_access',
                                   group=f"业务接入{gname}",
                                   max_ports=56)  # 48 down + 8 up
                self.biz_access.append(sw)
                self.switch_groups[sw.name] = sw.group
                self.podid_map[sw.name] = f"pod-biz-{gid}"

        # 2台盒式汇聚 32×100G
        for i in range(1, 3):
            sw = NetworkObject(name=f"业务汇聚_{i}",
                               obj_type='biz_agg',
                               group="业务汇聚组",
                               max_ports=32,
                               podid="superpod")
            self.biz_agg.append(sw)
            self.switch_groups[sw.name] = sw.group
            self.podid_map[sw.name] = sw.podid

    def _wire_biz(self):
        # 接入交换机: 端口1-25下联(服务器), 26-48空, 49-56上联(100G→汇聚)
        for sw in self.biz_access:
            sw.downlink_counter = 1
            sw.downlink_limit = 25
            sw.uplink_counter = 49
            sw.uplink_limit = 56

        for sw in self.biz_agg:
            sw.downlink_counter = 1
            sw.downlink_limit = 32

        server_map = {
            "GPU组1": self.servers[0:25],
            "GPU组2": self.servers[25:50],
            "GPU组3": self.servers[50:75],
            "GPU组4": self.servers[75:100],
            "存储组": self.servers[100:114],
            "管理组": self.servers[114:134]
        }

        agg_used = [0, 0]
        for gname, gid, count in self.biz_group_info:
            servers = server_map[gname]
            sw_a = self.biz_access[(gid - 1) * 2]
            sw_b = self.biz_access[(gid - 1) * 2 + 1]

            # 服务器→业务接入 (双上联MLAG)
            for si, server in enumerate(servers):
                for pi, sw in enumerate([sw_a, sw_b], 1):
                    srv_port = f"业务口{pi}"
                    sw_port = f"端口{si + 1}"
                    sw.downlink_counter = max(sw.downlink_counter, si + 2)
                    self._add_pair(server, srv_port, "25G", sw, sw_port, "25G",
                                   "光纤", f"服务器到业务接入")

            # 接入→汇聚: GPU组8×100G/台, 存储/管理组各4×100G (共64口=2×32)
            uplinks_per_sw = 8 if gname.startswith("GPU") else 4
            for sw in [sw_a, sw_b]:
                for up in range(uplinks_per_sw):
                    agg_idx = 0 if agg_used[0] <= agg_used[1] else 1
                    if agg_used[agg_idx] >= 32:
                        agg_idx = 0 if agg_used[0] < 32 else 1
                    if agg_used[agg_idx] >= 32:
                        continue

                    agg = self.biz_agg[agg_idx]
                    sw_port = f"端口{49 + up}"
                    agg_port = f"端口{agg_used[agg_idx] + 1}"
                    agg_used[agg_idx] += 1

                    self._add_pair(sw, sw_port, "100G", agg, agg_port, "100G",
                                   "光纤", f"业务接入到汇聚")

    # ========== OOB带外管理网络 ==========
    def _create_oob_switches(self):
        """48口电+2×10G光接入, 48×10G汇聚"""
        # 接入: 134台/25口 = 6台
        for i in range(1, 7):
            sw = NetworkObject(name=f"OOB接入_{i}",
                               obj_type='oob_access',
                               group="OOB接入组",
                               max_ports=50)  # 48 RJ45 + 2 SFP+
            sw.downlink_counter = 1
            sw.downlink_limit = 25  # 端口26+禁止接服务器
            sw.uplink_counter = 49
            sw.uplink_limit = 50
            self.oob_access.append(sw)
            self.switch_groups[sw.name] = sw.group
            self.podid_map[sw.name] = f"pod-oob-{i}"

        # 汇聚: 1台 48×10G
        for i in range(1, 2):
            sw = NetworkObject(name=f"OOB汇聚_{i}",
                               obj_type='oob_agg',
                               group="OOB汇聚组",
                               max_ports=48)
            sw.downlink_counter = 1
            sw.downlink_limit = 48
            self.oob_agg.append(sw)
            self.switch_groups[sw.name] = sw.group
            self.podid_map[sw.name] = "superpod"

    def _wire_oob(self):
        # 服务器→OOB接入: 每25台一组, 6组
        servers_per_access = 25
        for si, server in enumerate(self.servers):
            access_idx = si // servers_per_access
            if access_idx >= len(self.oob_access):
                break
            sw = self.oob_access[access_idx]
            srv_port = "OOB口1"
            sw_port = f"端口{si % servers_per_access + 1}"
            self._add_pair(server, srv_port, "1G", sw, sw_port, "1G",
                           "网线", "服务器到OOB接入")

        # OOB接入→OOB汇聚: 每接入2×10G
        agg = self.oob_agg[0]
        for sw in self.oob_access:
            for up in range(2):
                sw_port = f"端口{49 + up}"
                agg_port = f"端口{agg.downlink_counter}"
                agg.downlink_counter += 1
                self._add_pair(sw, sw_port, "10G", agg, agg_port, "10G",
                               "光纤", "OOB接入到汇聚")

    # ========== 通用辅助 ==========
    def _add_pair(self, a_dev, a_port, a_mod, z_dev, z_port, z_mod, cable, desc,
                  spine_downlink_offset=None):
        """创建双向连接并自动分配端口号（兼容leaf/spine/custom端口管理）"""
        # 实际端口号更新
        if hasattr(a_dev, 'downlink_counter') and 'Leaf' in a_dev.name:
            if 'Spine' in z_dev.name:
                # Leaf uplink → Spine
                pass  # ports are already assigned
        if hasattr(z_dev, 'downlink_counter'):
            if spine_downlink_offset:
                z_dev.downlink_counter = max(z_dev.downlink_counter, spine_downlink_offset)

        c1 = Connection(a_dev.name, a_port, a_mod, z_dev.name, z_port, z_mod, cable, desc)
        c2 = Connection(z_dev.name, z_port, z_mod, a_dev.name, a_port, a_mod, cable, desc)
        a_dev.add_connection(c1)
        z_dev.add_connection(c2)

    # ========== Excel导出 ==========
    def export(self, filename):
        with pd.ExcelWriter(filename, engine='openpyxl') as writer:
            self._sheet_summary(writer)
            self._sheet_server_view(writer)
            self._sheet_switch_view(writer, '参数网络', self.param_leaves + self.param_spines)
            self._sheet_switch_view(writer, '存储网络', self.storage_leaves + self.storage_spines)
            self._sheet_switch_view(writer, '业务网络', self.biz_access + self.biz_agg)
            self._sheet_switch_view(writer, 'OOB网络', self.oob_access + self.oob_agg)
        apply_excel_formatting(filename)
        print(f"连线表已导出: {filename}")

    def _sheet_summary(self, writer):
        data = [
            ["定制连线方案", ""],
            ["设计时间", pd.Timestamp.now().strftime("%Y-%m-%d %H:%M:%S")],
            ["", ""],
            ["服务器配置", ""],
            ["H100 GPU服务器", "100台 (4组×25台)"],
            ["存储服务器", "14台"],
            ["管理服务器", "20台"],
            ["", ""],
            ["参数网络 (64口交换机)", ""],
            ["Leaf交换机", "32台 (4组×8台)"],
            ["Spine交换机", "16台"],
            ["每Leaf下联", "25端口 (26-32空, 不接服务器)"],
            ["Leaf-Spine连接", "每Leaf连16台Spine, 2口/Spine (33-64全用)"],
            ["网络速度", "400G"],
            ["", ""],
            ["存储网络 (40口交换机)", ""],
            ["Leaf交换机", "8台 (Leaf1-4各15H100, Leaf5-6:10H100+7存储, Leaf7-8:10H100+10通算)"],
            ["Spine交换机", "4台"],
            ["每Leaf下联", "15-20端口使用 (20口上限内)"],
            ["网络速度", "200G"],
            ["", ""],
            ["业务网络 (48口交换机)", ""],
            ["接入交换机", "12台 (6组MLAG对)"],
            ["汇聚交换机", "2台 (32×100G盒式)"],
            ["GPU业务组", "4组×25台, 25G下联"],
            ["存储业务组", "1组×14台, 25G下联"],
            ["管理业务组", "1组×20台, 25G下联"],
            ["", ""],
            ["OOB带外管理网络", ""],
            ["接入交换机", "6台 (48口电+2×10G光)"],
            ["汇聚交换机", "1台 (48×10G光)"],
            ["每接入覆盖", "25台服务器 (端口1-25, 26+空)"],
            ["", ""],
            ["线缆类型", ""],
            ["参数网", "MPO (多模光纤)"],
            ["存储网", "AOC线缆"],
            ["业务网", "光纤"],
            ["OOB网", "网线+光纤"],
        ]
        pd.DataFrame(data, columns=["项目", "值"]).to_excel(writer, sheet_name='设计摘要', index=False)

    def _sheet_server_view(self, writer):
        rows = []
        for server in self.servers:
            grp = self.server_groups.get(server.name, "")
            pid = self.podid_map.get(server.name, "")
            for conn in server.connections:
                if conn.a_device == server.name:
                    rows.append({
                        'podid': pid, '服务器分组': grp,
                        'A端设备': conn.a_device, 'A端接口': conn.a_port, 'A端模块': conn.a_module,
                        'Z端设备': conn.z_device, 'Z端接口': conn.z_port, 'Z端模块': conn.z_module,
                        '线缆类型': conn.cable_type, '描述': conn.description
                    })
        df = pd.DataFrame(rows)
        if not df.empty:
            # 按设备聚合, 同设备内按接口类型排序: 参数→存储→业务
            df['iface_w'] = df['A端接口'].apply(
                lambda p: 1 if '参数' in p else 2 if '存储' in p else 3 if 'OOB' in p else 4)
            df['dev_num'] = df['A端设备'].apply(_extract_number)
            df['port_num'] = df['A端接口'].apply(_extract_number)
            df = df.sort_values(by=['服务器分组', 'dev_num', 'iface_w', 'port_num'])
            df = df.drop(columns=['dev_num', 'iface_w', 'port_num'])
        df.to_excel(writer, sheet_name='服务器连接表', index=False)

    def _sheet_switch_view(self, writer, sheet_name, switches):
        rows = []
        for sw in switches:
            grp = self.switch_groups.get(sw.name, "")
            pid = self.podid_map.get(sw.name, "")
            for conn in sw.connections:
                if conn.a_device == sw.name:
                    rows.append({
                        'podid': pid, '交换机分组': grp,
                        'A端设备': conn.a_device, 'A端接口': conn.a_port, 'A端模块': conn.a_module,
                        'Z端设备': conn.z_device, 'Z端接口': conn.z_port, 'Z端模块': conn.z_module,
                        '线缆类型': conn.cable_type, '描述': conn.description
                    })
        df = pd.DataFrame(rows)
        if not df.empty:
            df['tw'] = df['A端设备'].apply(_get_switch_type_weight)
            df['dn'] = df['A端设备'].apply(_extract_number)
            df['pn'] = df['A端接口'].apply(_extract_number)
            df = df.sort_values(by=['tw', '交换机分组', 'dn', 'A端设备', 'pn'])
            df = df.drop(columns=['tw', 'dn', 'pn'])
        df.to_excel(writer, sheet_name=sheet_name, index=False)

    def print_summary(self):
        print("\n" + "=" * 60)
        print("定制连线方案 - 100台H100 + 14存储 + 20管理")
        print("=" * 60)
        print(f"总服务器: {len(self.servers)}台 (100 H100 + 14 存储 + 20 管理)")
        print(f"\n参数网络: {len(self.param_leaves)} Leaf + {len(self.param_spines)} Spine (64口)")
        print(f"  每组: 8 Leaf × 25台GPU")
        print(f"存储网络: {len(self.storage_leaves)} Leaf + {len(self.storage_spines)} Spine (40口)")
        print(f"  Leaf1-4: 各15台H100 | Leaf5-6: 10H100+7存储 | Leaf7-8: 10H100+10通算")
        print(f"业务网络: {len(self.biz_access)} 接入 + {len(self.biz_agg)} 汇聚 (48口)")
        print(f"  6组MLAG对 (4 GPU + 1 存储 + 1 管理)")
        print(f"OOB网络: {len(self.oob_access)} 接入 + {len(self.oob_agg)} 汇聚 (48口)")
        print(f"  每接入覆盖25台服务器, 每接入2×10G上联")
        print("=" * 60)


if __name__ == "__main__":
    cw = CustomWiring()
    cw.print_summary()

    ts = datetime.datetime.now().strftime("%Y%m%d_%H%M")
    fn = f"H100定制连线表_{ts}.xlsx"
    cw.export(fn)
