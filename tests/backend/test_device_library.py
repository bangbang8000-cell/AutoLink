"""
测试 backend/device_library.py - 设备库加载器
"""
import pytest
import os
import json
import tempfile

from device_library import DeviceLibrary, LibraryDevice, InterfaceModel, get_device_library

# 真实设备库根路径(用于 T7/T8 修正后的回归校验)
_REAL_LIB_PATH = os.path.abspath(
    os.path.join(os.path.dirname(__file__), '..', '..', 'template', 'device_library')
)


class TestDeviceLibrary:
    """DeviceLibrary 测试"""

    def setup_method(self):
        """每个测试前创建临时设备库"""
        self.tmpdir = tempfile.mkdtemp()
        self.lib_path = self.tmpdir

        # 创建设备库索引
        self.index = {
            "categories": [
                {
                    "id": "gpu_servers",
                    "name": "GPU Servers",
                    "device_ids": ["h100_sxm"]
                }
            ]
        }
        with open(os.path.join(self.lib_path, "library_index.json"), "w", encoding="utf-8") as f:
            json.dump(self.index, f, ensure_ascii=False)

        # 创建分类目录和设备文件
        os.makedirs(os.path.join(self.lib_path, "gpu_servers"))
        self.device_data = {
            "id": "h100_sxm",
            "vendor": "NVIDIA",
            "model": "H100-SXM",
            "category": "gpu_servers",
            "description": "NVIDIA H100 SXM GPU Server",
            "power_watts": 700,
            "u_height": 4,
            "name_prefix": "GPU",
            "interface_models": [
                {
                    "network_type": "param",
                    "port_count": 8,
                    "port_speed": "400G",
                    "port_type": "QSFP",
                    "cable_type": "MPO",
                    "downlink_prefix": "参数网卡",
                }
            ],
            "tags": ["GPU", "H100"],
            "applicable_networks": ["param"],
            "source": "builtin",
            "verified": True,
        }
        with open(os.path.join(self.lib_path, "gpu_servers", "h100_sxm.json"), "w", encoding="utf-8") as f:
            json.dump(self.device_data, f, ensure_ascii=False)

    def teardown_method(self):
        """清理临时目录"""
        import shutil
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_load_devices(self):
        """加载设备库"""
        lib = DeviceLibrary(self.lib_path)
        lib.load()

        assert len(lib.devices) == 1
        assert "h100_sxm" in lib.devices
        assert lib.devices["h100_sxm"].vendor == "NVIDIA"
        assert lib.devices["h100_sxm"].power_watts == 700

    def test_load_nonexistent_index(self):
        """索引文件不存在"""
        lib = DeviceLibrary("/nonexistent/path")
        lib.load()
        assert len(lib.devices) == 0

    def test_get_device(self):
        """获取单个设备"""
        lib = DeviceLibrary(self.lib_path)
        device = lib.get("h100_sxm")
        assert device is not None
        assert device.id == "h100_sxm"
        assert device.vendor == "NVIDIA"

    def test_get_nonexistent_device(self):
        """获取不存在的设备"""
        lib = DeviceLibrary(self.lib_path)
        device = lib.get("nonexistent")
        assert device is None

    def test_get_by_category(self):
        """按分类获取设备"""
        lib = DeviceLibrary(self.lib_path)
        devices = lib.get_by_category("gpu_servers")
        assert len(devices) == 1
        assert devices[0].id == "h100_sxm"

    def test_get_all(self):
        """获取所有设备"""
        lib = DeviceLibrary(self.lib_path)
        devices = lib.get_all()
        assert len(devices) == 1

    def test_is_server(self):
        """判断是否为服务器"""
        lib = DeviceLibrary(self.lib_path)
        device = lib.get("h100_sxm")
        assert device.is_server() is True
        assert device.is_switch() is False

    def test_interface_models(self):
        """接口模型解析"""
        lib = DeviceLibrary(self.lib_path)
        device = lib.get("h100_sxm")
        assert len(device.interface_models) == 1
        assert device.interface_models[0].network_type == "param"
        assert device.interface_models[0].port_count == 8
        assert device.interface_models[0].port_speed == "400G"

    def test_resolve_ref(self):
        """解析设备引用"""
        lib = DeviceLibrary(self.lib_path)
        ref = {"library_id": "h100_sxm"}
        device = lib.resolve_ref(ref)
        assert device is not None
        assert device.id == "h100_sxm"

    def test_resolve_ref_with_overrides(self):
        """解析带覆盖的设备引用"""
        lib = DeviceLibrary(self.lib_path)
        ref = {
            "library_id": "h100_sxm",
            "overrides": {"power_watts": 800, "u_height": 5}
        }
        device = lib.resolve_ref(ref)
        assert device is not None
        assert device.power_watts == 800
        assert device.u_height == 5

    def test_resolve_nonexistent_ref(self):
        """解析不存在的设备引用"""
        lib = DeviceLibrary(self.lib_path)
        ref = {"library_id": "nonexistent"}
        device = lib.resolve_ref(ref)
        assert device is None

    def test_missing_device_file(self):
        """设备文件缺失时跳过"""
        # 删除设备文件
        os.remove(os.path.join(self.lib_path, "gpu_servers", "h100_sxm.json"))
        lib = DeviceLibrary(self.lib_path)
        lib.load()
        assert len(lib.devices) == 0

    def test_category_ordering(self):
        """分类顺序保持"""
        lib = DeviceLibrary(self.lib_path)
        lib.load()
        assert "gpu_servers" in lib.categories

    def test_idempotent_load(self):
        """重复加载不重复"""
        lib = DeviceLibrary(self.lib_path)
        lib.load()
        lib.load()
        assert len(lib.devices) == 1

    def test_nested_category_path_mapping(self):
        """嵌套分类目录路径映射（categoryPathMap 一致性）"""
        # 创建设备库索引，使用扁平ID但实际目录是嵌套的
        index = {
            "categories": [
                {
                    "id": "storage_servers_all_flash",
                    "name": "全闪存储",
                    "device_ids": ["test_flash"]
                },
                {
                    "id": "switches_param",
                    "name": "参数网交换机",
                    "device_ids": ["test_param_switch"]
                }
            ]
        }
        with open(os.path.join(self.lib_path, "library_index.json"), "w", encoding="utf-8") as f:
            json.dump(index, f, ensure_ascii=False)

        # 创建嵌套目录结构 (必须与 categoryPathMap 一致)
        os.makedirs(os.path.join(self.lib_path, "storage_servers", "all_flash"))
        os.makedirs(os.path.join(self.lib_path, "switches", "param"))

        flash_device = {
            "id": "test_flash", "vendor": "TestVendor", "model": "Flash-1",
            "category": "storage_servers_all_flash", "power_watts": 500, "u_height": 4,
            "name_prefix": "STOR", "tags": [], "applicable_networks": ["storage"],
            "source": "builtin", "verified": True,
        }
        switch_device = {
            "id": "test_param_switch", "vendor": "TestVendor", "model": "Switch-1",
            "category": "switches_param", "power_watts": 200, "u_height": 1,
            "name_prefix": "PARAM", "port_count": 64, "port_speed": "400G",
            "port_type": "QSFP", "downlink_prefix": "Eth", "tags": [],
            "applicable_networks": ["param"], "source": "builtin", "verified": True,
        }

        with open(os.path.join(self.lib_path, "storage_servers", "all_flash", "test_flash.json"), "w", encoding="utf-8") as f:
            json.dump(flash_device, f, ensure_ascii=False)
        with open(os.path.join(self.lib_path, "switches", "param", "test_param_switch.json"), "w", encoding="utf-8") as f:
            json.dump(switch_device, f, ensure_ascii=False)

        lib = DeviceLibrary(self.lib_path)
        lib.load()

        # 验证嵌套目录中的设备被正确加载
        assert len(lib.devices) == 2
        assert "test_flash" in lib.devices
        assert "test_param_switch" in lib.devices
        assert lib.devices["test_flash"].category == "storage_servers_all_flash"
        assert lib.devices["test_param_switch"].category == "switches_param"

        # 验证按分类获取
        flash_devices = lib.get_by_category("storage_servers_all_flash")
        assert len(flash_devices) == 1
        assert flash_devices[0].id == "test_flash"

        switch_devices = lib.get_by_category("switches_param")
        assert len(switch_devices) == 1
        assert switch_devices[0].id == "test_param_switch"


class TestRealLibrary6850Classification:
    """T7/T8: 真实设备库 6850/ce6860 分类回归校验"""

    @pytest.fixture
    def real_lib(self):
        """加载真实设备库(load 幂等,实例级足够)"""
        lib = DeviceLibrary(_REAL_LIB_PATH)
        lib.load()
        return lib

    # ---------- T7: h3c_s6850_56hf 数据纠正 ----------

    def test_6850_exists_in_library(self, real_lib):
        """h3c_s6850_56hf 应存在于设备库"""
        device = real_lib.get('h3c_s6850_56hf')
        assert device is not None, "h3c_s6850_56hf 不在设备库中"

    def test_6850_classified_as_biz_switch(self, real_lib):
        """h3c_s6850_56hf 应分类为 switches_biz (而非 switches_storage)"""
        device = real_lib.get('h3c_s6850_56hf')
        assert device.category == 'switches_biz', (
            f"6850 分类错误:期望 switches_biz,实际 {device.category}"
        )

    def test_6850_port_speed_is_25g(self, real_lib):
        """h3c_s6850_56hf 端口速率应为 25G (而非 200G)"""
        device = real_lib.get('h3c_s6850_56hf')
        assert device.port_speed == '25G', (
            f"6850 port_speed 错误:期望 25G,实际 {device.port_speed}"
        )

    def test_6850_port_type_is_sfp28(self, real_lib):
        """h3c_s6850_56hf 端口类型应为 SFP28"""
        device = real_lib.get('h3c_s6850_56hf')
        assert device.port_type == 'SFP28'

    def test_6850_is_switch_not_server(self, real_lib):
        """h3c_s6850_56hf 应被识别为交换机 (非服务器)"""
        device = real_lib.get('h3c_s6850_56hf')
        assert device.is_switch() is True
        assert device.is_server() is False

    def test_6850_applicable_networks_is_biz(self, real_lib):
        """h3c_s6850_56hf applicable_networks 应包含 biz"""
        device = real_lib.get('h3c_s6850_56hf')
        assert 'biz' in device.applicable_networks

    def test_6850_physical_file_in_biz_directory(self):
        """h3c_s6850_56hf 物理文件应在 switches/biz/ 目录下 (而非 storage/)"""
        biz_path = os.path.join(_REAL_LIB_PATH, 'switches', 'biz', 'h3c_s6850_56hf.json')
        storage_path = os.path.join(_REAL_LIB_PATH, 'switches', 'storage', 'h3c_s6850_56hf.json')
        assert os.path.exists(biz_path), "6850 应位于 switches/biz/ 目录"
        assert not os.path.exists(storage_path), "6850 不应残留在 switches/storage/ 目录"

    def test_6850_listed_in_biz_category_index(self, real_lib):
        """h3c_s6850_56hf 应在 switches_biz 分类的设备列表中"""
        biz_devices = real_lib.get_by_category('switches_biz')
        biz_ids = [d.id for d in biz_devices]
        assert 'h3c_s6850_56hf' in biz_ids

    def test_6850_not_in_storage_category_index(self, real_lib):
        """h3c_s6850_56hf 不应在 switches_storage 分类的设备列表中"""
        storage_devices = real_lib.get_by_category('switches_storage')
        storage_ids = [d.id for d in storage_devices]
        assert 'h3c_s6850_56hf' not in storage_ids

    # ---------- T7: huawei_ce6860_48s6cq 分类修正 ----------

    def test_ce6860_classified_as_biz_switch(self, real_lib):
        """huawei_ce6860_48s6cq 应分类为 switches_biz (而非 switches_storage)"""
        device = real_lib.get('huawei_ce6860_48s6cq')
        assert device is not None
        assert device.category == 'switches_biz', (
            f"ce6860 分类错误:期望 switches_biz,实际 {device.category}"
        )

    def test_ce6860_physical_file_in_biz_directory(self):
        """huawei_ce6860_48s6cq 物理文件应在 switches/biz/ 目录下"""
        biz_path = os.path.join(_REAL_LIB_PATH, 'switches', 'biz', 'huawei_ce6860_48s6cq.json')
        storage_path = os.path.join(_REAL_LIB_PATH, 'switches', 'storage', 'huawei_ce6860_48s6cq.json')
        assert os.path.exists(biz_path), "ce6860 应位于 switches/biz/ 目录"
        assert not os.path.exists(storage_path), "ce6860 不应残留在 switches/storage/ 目录"

    # ---------- T8: 一致性校验 ----------

    def test_all_biz_switches_have_port_speed(self, real_lib):
        """T8: 所有业务交换机应有 port_speed 字段"""
        biz_devices = real_lib.get_by_category('switches_biz')
        for device in biz_devices:
            assert device.port_speed, f"业务交换机 {device.id} 缺少 port_speed"

    def test_all_biz_switches_have_port_type(self, real_lib):
        """T8: 所有业务交换机应有 port_type 字段"""
        biz_devices = real_lib.get_by_category('switches_biz')
        for device in biz_devices:
            assert device.port_type, f"业务交换机 {device.id} 缺少 port_type"

    def test_all_storage_switches_have_port_speed(self, real_lib):
        """T8: 所有存储交换机应有 port_speed 字段"""
        storage_devices = real_lib.get_by_category('switches_storage')
        for device in storage_devices:
            assert device.port_speed, f"存储交换机 {device.id} 缺少 port_speed"

    def test_no_device_in_multiple_switch_categories(self, real_lib):
        """T8: 同一设备不应同时出现在多个交换机分类中"""
        switch_categories = ['switches_param', 'switches_storage', 'switches_biz', 'switches_oob']
        device_categories = {}  # device_id -> [categories]
        for cat_id in switch_categories:
            for device in real_lib.get_by_category(cat_id):
                device_categories.setdefault(device.id, []).append(cat_id)
        for dev_id, cats in device_categories.items():
            assert len(cats) == 1, f"设备 {dev_id} 同时出现在多个交换机分类: {cats}"


class TestRealLibraryProtocolDevices:
    """T5/T6: 真实设备库 IB/RoCE 协议相关设备校验"""

    @pytest.fixture
    def real_lib(self):
        lib = DeviceLibrary(_REAL_LIB_PATH)
        lib.load()
        return lib

    def test_ib_storage_switch_exists(self, real_lib):
        """T6: IB 存储交换机 nvidia_mqm8700_40_200g_ib 应存在"""
        device = real_lib.get('nvidia_mqm8700_40_200g_ib')
        assert device is not None, "IB 存储交换机 nvidia_mqm8700_40_200g_ib 不在库中"

    def test_roce_storage_switch_exists(self, real_lib):
        """T5: RoCE 存储交换机 huawei_ce6881_48s6cq 应存在"""
        device = real_lib.get('huawei_ce6881_48s6cq')
        assert device is not None, "RoCE 存储交换机 huawei_ce6881_48s6cq 不在库中"

    def test_ib_storage_switch_in_param_category(self, real_lib):
        """IB 存储复用的 mqm8700 应在 switches_param 分类(复用参数面 IB 交换机)"""
        device = real_lib.get('nvidia_mqm8700_40_200g_ib')
        assert device.category == 'switches_param'

    def test_roce_storage_switch_in_storage_category(self, real_lib):
        """RoCE 专用存储交换机 ce6881 应在 switches_storage 分类"""
        device = real_lib.get('huawei_ce6881_48s6cq')
        assert device.category == 'switches_storage'

    def test_roce_storage_switch_supports_rocev2(self, real_lib):
        """RoCE 存储交换机 ce6881 应声明支持 RoCEv2"""
        device = real_lib.get('huawei_ce6881_48s6cq')
        assert getattr(device, 'rdma_type', None) == 'RoCEv2' or 'RoCEv2' in device.tags