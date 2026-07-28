"""
AutoLink V2.1 — 设备库加载器
从 template/device_library/ 目录加载设备 JSON 文件，构建索引。
"""

import os
import json
from typing import Dict, List, Optional, Any
from dataclasses import dataclass, field


@dataclass
class InterfaceModel:
    network_type: str  # 'param' | 'storage' | 'biz' | 'oob'
    port_count: int
    port_speed: str
    port_type: str
    cable_type: str
    downlink_prefix: str = "NIC"
    uplink_prefix: str = "NIC"
    port_numbering: str = "sequential"


@dataclass
class DeviceProfile:
    vendor: str
    model: str
    description: str = ""
    power_watts: int = 0
    weight_kg: int = 0
    u_height: int = 1
    depth_mm: int = 800
    cooling: str = "air"
    name_prefix: str = ""
    interface_models: List[InterfaceModel] = field(default_factory=list)
    port_count: Optional[int] = None
    port_speed: Optional[str] = None
    port_type: Optional[str] = None
    downlink_prefix: Optional[str] = None
    uplink_prefix: Optional[str] = None

    def is_server(self) -> bool:
        return len(self.interface_models) > 0

    def is_switch(self) -> bool:
        return not self.is_server()


@dataclass
class LibraryDevice(DeviceProfile):
    id: str = ""
    category: str = ""
    tags: List[str] = field(default_factory=list)
    applicable_networks: List[str] = field(default_factory=list)
    source: str = "builtin"
    verified: bool = True
    datasheet_url: Optional[str] = None
    added_at: str = ""
    updated_at: str = ""


class DeviceLibrary:
    """设备库加载器"""

    def __init__(self, library_path: str):
        self.library_path = library_path
        self.devices: Dict[str, LibraryDevice] = {}
        self.categories: Dict[str, List[str]] = {}
        self._loaded = False

    def load(self) -> None:
        """加载设备库索引和所有设备文件"""
        if self._loaded:
            return

        index_path = os.path.join(self.library_path, "library_index.json")
        if not os.path.exists(index_path):
            print(f"[DeviceLibrary] Index not found: {index_path}")
            self._loaded = True
            return

        with open(index_path, "r", encoding="utf-8") as f:
            index = json.load(f)

        # Map flat category IDs to nested directory paths (must match Electron handlers.ts)
        category_path_map = {
            "gpu_servers": "gpu_servers",
            "compute_servers": "compute_servers",
            "storage_servers_all_flash": "storage_servers/all_flash",
            "storage_servers_hybrid_flash": "storage_servers/hybrid_flash",
            "switches_param": "switches/param",
            "switches_storage": "switches/storage",
            "switches_biz": "switches/biz",
            "switches_oob": "switches/oob",
            "custom": "custom",
        }

        for cat in index.get("categories", []):
            cat_id = cat["id"]
            self.categories[cat_id] = []
            cat_dir = category_path_map.get(cat_id, cat_id)

            for device_id in cat.get("device_ids", []):
                device_file = os.path.join(self.library_path, cat_dir, f"{device_id}.json")
                if os.path.exists(device_file):
                    try:
                        device = self._load_device(device_file)
                        self.devices[device_id] = device
                        self.categories[cat_id].append(device_id)
                    except Exception as e:
                        print(f"[DeviceLibrary] Failed to load {device_id}: {e}")

        print(f"[DeviceLibrary] Loaded {len(self.devices)} devices from {len(self.categories)} categories")
        self._loaded = True

    def _load_device(self, filepath: str) -> LibraryDevice:
        """从 JSON 文件加载单个设备"""
        with open(filepath, "r", encoding="utf-8") as f:
            data = json.load(f)

        # Parse interface_models
        interface_models = []
        for im in data.get("interface_models", []):
            interface_models.append(InterfaceModel(
                network_type=im.get("network_type", "param"),
                port_count=im.get("port_count", 0),
                port_speed=im.get("port_speed", "400G"),
                port_type=im.get("port_type", "QSFP"),
                cable_type=im.get("cable_type", "MPO"),
                downlink_prefix=im.get("downlink_prefix", "NIC"),
                uplink_prefix=im.get("uplink_prefix", "NIC"),
                port_numbering=im.get("port_numbering", "sequential"),
            ))

        return LibraryDevice(
            id=data.get("id", os.path.splitext(os.path.basename(filepath))[0]),
            vendor=data.get("vendor", ""),
            model=data.get("model", ""),
            category=data.get("category", ""),
            description=data.get("description", ""),
            power_watts=data.get("power_watts", 0),
            weight_kg=data.get("weight_kg", 0),
            u_height=data.get("u_height", 1),
            depth_mm=data.get("depth_mm", 800),
            cooling=data.get("cooling", "air"),
            name_prefix=data.get("name_prefix", ""),
            interface_models=interface_models,
            port_count=data.get("port_count"),
            port_speed=data.get("port_speed"),
            port_type=data.get("port_type"),
            downlink_prefix=data.get("downlink_prefix"),
            uplink_prefix=data.get("uplink_prefix"),
            tags=data.get("tags", []),
            applicable_networks=data.get("applicable_networks", []),
            source=data.get("source", "builtin"),
            verified=data.get("verified", True),
            datasheet_url=data.get("datasheet_url"),
            added_at=data.get("added_at", ""),
            updated_at=data.get("updated_at", ""),
        )

    def get(self, device_id: str) -> Optional[LibraryDevice]:
        """获取指定设备"""
        self.load()
        return self.devices.get(device_id)

    def get_by_category(self, category_id: str) -> List[LibraryDevice]:
        """获取某分类下的所有设备"""
        self.load()
        ids = self.categories.get(category_id, [])
        return [self.devices[i] for i in ids if i in self.devices]

    def get_all(self) -> List[LibraryDevice]:
        """获取所有设备"""
        self.load()
        return list(self.devices.values())

    def get_servers(self) -> List[LibraryDevice]:
        """获取所有服务器设备"""
        return [d for d in self.get_all() if d.is_server()]

    def get_switches(self) -> List[LibraryDevice]:
        """获取所有交换机设备"""
        return [d for d in self.get_all() if d.is_switch()]

    def resolve_ref(self, ref: Dict[str, Any]) -> Optional[LibraryDevice]:
        """
        解析设备引用 (DeviceRef)，返回合并了 overrides 的完整设备参数。
        ref 格式: {"library_id": "xxx", "overrides": {...}}
        """
        self.load()
        library_id = ref.get("library_id", "")
        device = self.devices.get(library_id)
        if not device:
            return None

        overrides = ref.get("overrides", {})
        if not overrides:
            return device

        # 合并 overrides
        merged = LibraryDevice(
            id=device.id,
            vendor=overrides.get("vendor", device.vendor),
            model=overrides.get("model", device.model),
            category=device.category,
            description=overrides.get("description", device.description),
            power_watts=overrides.get("power_watts", device.power_watts),
            weight_kg=overrides.get("weight_kg", device.weight_kg),
            u_height=overrides.get("u_height", device.u_height),
            depth_mm=overrides.get("depth_mm", device.depth_mm),
            cooling=overrides.get("cooling", device.cooling),
            name_prefix=overrides.get("name_prefix", device.name_prefix),
            interface_models=device.interface_models,
            port_count=overrides.get("port_count", device.port_count),
            port_speed=overrides.get("port_speed", device.port_speed),
            port_type=overrides.get("port_type", device.port_type),
            downlink_prefix=overrides.get("downlink_prefix", device.downlink_prefix),
            uplink_prefix=overrides.get("uplink_prefix", device.uplink_prefix),
            tags=device.tags,
            applicable_networks=device.applicable_networks,
            source=device.source,
            verified=device.verified,
            datasheet_url=device.datasheet_url,
            added_at=device.added_at,
            updated_at=device.updated_at,
        )
        return merged


# 全局单例
_library_instance: Optional[DeviceLibrary] = None


def get_device_library(library_path: Optional[str] = None) -> DeviceLibrary:
    """获取设备库全局单例"""
    global _library_instance
    if _library_instance is None:
        if library_path is None:
            # 默认路径: 项目根目录/template/device_library
            base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            library_path = os.path.join(base_dir, "template", "device_library")
        _library_instance = DeviceLibrary(library_path)
        _library_instance.load()
    return _library_instance