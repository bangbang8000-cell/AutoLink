"""
AutoLink V2.1 — 设备库加载器
从 template/device_library/ 目录加载设备 JSON 文件，构建索引。
"""

import os
import sys
import json
from typing import Dict, List, Optional, Any
from dataclasses import dataclass, field

# H1：旧 id → 新 id 迁移别名（设备库纠错重命名后，旧配置兼容解析）
LEGACY_ALIASES: Dict[str, str] = {
    'h3c_s9850_64h': 'h3c_s9850_32h',
    'h3c_s6805_48p': 'h3c_s6805_56hf_g',
    'h3c_s5820v2_24p': 'h3c_s5820v2_52qf',
    'ruijie_s6910_32oc2vs_1_6t': 'ruijie_rg_s6910_32oc2vs_1_6t',
}


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
    # V3.0.1-T1-6: 双口网卡标记（dual-port：每卡 2 口，口1→平面A、口2→平面B）
    dual_port: bool = False


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
    # V2.4 新增字段（可选，向后兼容）
    cooling_method: str = "air"  # 'air' | 'cold_plate' | 'immersion'
    rail_compatible: bool = False
    spectrum_x: bool = False
    nvlink_domain: Optional[int] = None
    rdma_type: Optional[str] = None  # 'IB' | 'RoCEv2' | 'both'
    gpu_count: Optional[int] = None
    gpu_memory_gb: Optional[int] = None
    gpu_model: Optional[str] = None
    price_range: Optional[str] = None
    eol_date: Optional[str] = None
    # V2.4 光模块字段（仅 optical_modules 类别使用）
    speed: Optional[str] = None          # '100G' | '200G' | '400G' | '800G' | '1600G'
    form_factor: Optional[str] = None    # 'QSFP28' | 'QSFP56' | 'QSFP-DD' | 'OSFP' | 'OSFP-XD'
    spec: Optional[str] = None           # 'DAC' | 'AOC' | 'SR4' | 'SR8' | 'DR4' | 'DR8' | 'FR4' | 'LR4' | 'CWDM4'
    distance_m: Optional[int] = None     # 支持距离（米）
    fiber_type: Optional[str] = None     # 'copper' | 'MMF' | 'SMF'
    vendors: List[str] = field(default_factory=list)
    # V2.7.4 光模块技术路线字段（可选，向后兼容）
    tech_route: Optional[str] = None     # '硅光' | 'LPO' | 'EML' | '薄膜铌酸锂' | None(传统可插拔)
    # V2.7.5 信创字段（可选，向后兼容）
    origin: Optional[str] = None         # 'domestic' | 'imported' | 'mixed' (国产/进口/混合)
    lead_time: Optional[str] = None      # 供货周期，如 '8-12周'
    # V3.0.2-T2-11: 端口 1 分 2 扇出（breakout）能力（可选，缺省 = 1:1 物理口）
    # 例: {"physical_speed": "800G", "logical_speed": "400G", "count": 2, "cable": "MPO-1x2"}
    # 交换机口用: 物理 1 个高速口 → 逻辑 count 个低速口（如 Q3200 800G→2×400G）
    # 光模块用: 1 根分裂线缆，input_speed 物理速率 → output_speed 逻辑速率
    breakout: Optional[Dict[str, Any]] = None

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
        """加载设备库索引和所有设备文件

        V2.7.6-T8: category 从 library_index.json 动态读取, 不硬编码
          - 优先使用 category 中的 "directory" 字段 (相对 library_path 的子目录)
          - 缺省时 fallback 到 category_id 本身 (扁平目录结构)
          - 同时保留 _LEGACY_CATEGORY_PATHS 作为旧索引的向后兼容回退
        """
        if self._loaded:
            return

        index_path = os.path.join(self.library_path, "library_index.json")
        if not os.path.exists(index_path):
            print(f"[DeviceLibrary] Index not found: {index_path}")
            self._loaded = True
            return

        with open(index_path, "r", encoding="utf-8") as f:
            index = json.load(f)

        # V2.7.6-T8: 旧索引向后兼容映射 (新索引应在 category 中声明 "directory" 字段)
        _LEGACY_CATEGORY_PATHS = {
            "gpu_servers": "gpu_servers",
            "compute_servers": "compute_servers",
            "storage_servers_all_flash": "storage_servers/all_flash",
            "storage_servers_hybrid_flash": "storage_servers/hybrid_flash",
            "storage_servers_parallel_fs": "storage_servers/parallel_fs",
            "switches_param": "switches/param",
            "switches_storage": "switches/storage",
            "switches_biz": "switches/biz",
            "switches_oob": "switches/oob",
            "optical_modules": "optical_modules",
            "custom": "custom",
        }

        for cat in index.get("categories", []):
            cat_id = cat["id"]
            self.categories[cat_id] = []
            # V2.7.6-T8: 优先使用 category 中声明的 directory 字段
            # 缺省时按 _LEGACY_CATEGORY_PATHS 回退, 再缺省则使用 cat_id 本身
            cat_dir = cat.get("directory") or _LEGACY_CATEGORY_PATHS.get(cat_id, cat_id)

            for device_id in cat.get("device_ids", []):
                device_file = os.path.join(self.library_path, cat_dir, f"{device_id}.json")
                if os.path.exists(device_file):
                    try:
                        device = self._load_device(device_file)
                        # T8: 一致性校验 — category 字段须与索引分类一致
                        if device.category and device.category != cat_id:
                            print(f"[DeviceLibrary] WARN: {device_id} category='{device.category}' "
                                  f"但索引分类='{cat_id}',以索引为准")
                            device.category = cat_id
                        # T8: 交换机须有 port_speed/port_type；光模块用 speed/form_factor（V2.4 独立字段，不走交换机语义）
                        if device.is_switch() and not device.interface_models:
                            if device.category == 'optical_modules':
                                if not getattr(device, 'speed', None):
                                    print(f"[DeviceLibrary] WARN: 光模块 {device_id} 缺少 speed")
                                if not getattr(device, 'form_factor', None):
                                    print(f"[DeviceLibrary] WARN: 光模块 {device_id} 缺少 form_factor")
                            else:
                                if not device.port_speed:
                                    print(f"[DeviceLibrary] WARN: 交换机 {device_id} 缺少 port_speed")
                                if not device.port_type:
                                    print(f"[DeviceLibrary] WARN: 交换机 {device_id} 缺少 port_type")
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
                # V3.0.1-T1-6: 双口网卡标记
                dual_port=bool(im.get("dual_port", False)),
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
            # V2.4 新增字段
            cooling_method=data.get("cooling_method", "air"),
            rail_compatible=data.get("rail_compatible", False),
            spectrum_x=data.get("spectrum_x", False),
            nvlink_domain=data.get("nvlink_domain"),
            rdma_type=data.get("rdma_type"),
            gpu_count=data.get("gpu_count"),
            gpu_memory_gb=data.get("gpu_memory_gb"),
            gpu_model=data.get("gpu_model"),
            price_range=data.get("price_range"),
            eol_date=data.get("eol_date"),
            # V2.4 光模块字段
            speed=data.get("speed"),
            form_factor=data.get("form_factor"),
            spec=data.get("spec"),
            distance_m=data.get("distance_m"),
            fiber_type=data.get("fiber_type"),
            vendors=data.get("vendors", []),
            # V2.7.4 光模块技术路线
            tech_route=data.get("tech_route"),
            # V2.7.5 信创字段
            origin=data.get("origin"),
            lead_time=data.get("lead_time"),
            # V3.0.2-T2-11: 端口 1 分 2 扇出（breakout）能力
            breakout=data.get("breakout"),
        )

    def get(self, device_id: str) -> Optional[LibraryDevice]:
        """获取指定设备（H1：旧 id 经 LEGACY_ALIASES 迁移解析）"""
        self.load()
        device_id = LEGACY_ALIASES.get(device_id, device_id)
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
        library_id = LEGACY_ALIASES.get(ref.get("library_id", ""), ref.get("library_id", ""))
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
            # V2.4 新增字段
            cooling_method=overrides.get("cooling_method", device.cooling_method),
            rail_compatible=overrides.get("rail_compatible", device.rail_compatible),
            spectrum_x=overrides.get("spectrum_x", device.spectrum_x),
            nvlink_domain=overrides.get("nvlink_domain", device.nvlink_domain),
            rdma_type=overrides.get("rdma_type", device.rdma_type),
            gpu_count=overrides.get("gpu_count", device.gpu_count),
            gpu_memory_gb=overrides.get("gpu_memory_gb", device.gpu_memory_gb),
            gpu_model=overrides.get("gpu_model", device.gpu_model),
            price_range=overrides.get("price_range", device.price_range),
            eol_date=overrides.get("eol_date", device.eol_date),
            # V2.4 光模块字段
            speed=getattr(device, 'speed', None),
            form_factor=getattr(device, 'form_factor', None),
            spec=getattr(device, 'spec', None),
            distance_m=getattr(device, 'distance_m', None),
            fiber_type=getattr(device, 'fiber_type', None),
            vendors=getattr(device, 'vendors', []),
            # V2.7.4-V2.7.5 新增字段
            tech_route=getattr(device, 'tech_route', None),
            origin=getattr(device, 'origin', None),
            lead_time=getattr(device, 'lead_time', None),
            # V3.0.2-T2-11: 端口 1 分 2 扇出（breakout）能力
            breakout=overrides.get("breakout", getattr(device, 'breakout', None)),
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
            # V3.0.0-T0-7: PyInstaller 打包后数据随 spec datas 落在 sys._MEIPASS(_internal) 下
            if getattr(sys, '_MEIPASS', None):
                base_dir = sys._MEIPASS
            else:
                base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            library_path = os.path.join(base_dir, "template", "device_library")
        _library_instance = DeviceLibrary(library_path)
        _library_instance.load()
    return _library_instance