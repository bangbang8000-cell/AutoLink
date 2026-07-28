"""
测试 backend/device_library.py - 设备库加载器
"""
import pytest
import os
import json
import tempfile

from device_library import DeviceLibrary, LibraryDevice, InterfaceModel, get_device_library


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