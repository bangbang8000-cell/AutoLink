# 测试数据资产清单（4.6.0 / F6-2）

> AL 质量与测试体系 —— 测试数据资产目录。样例项目/规划/设计快照/渲染基线，可被 **pytest** 与 **vitest** 复用。

## 目录结构

```
tests/fixtures/
├── README.md                     # 本清单文档
├── manifest.json                 # 机器可读清单（前端 vitest 消费，结构断言）
└── projects/                     # 样例项目配置（与 template/ 同构，可被 NetworkDesignerV2 直接消费）
    ├── 64_h100/                   # 64 台 H100 单 POD 规划（四网）
    ├── 128_h100_multi_rack/       # 128 GPU 多机柜规划
    ├── combined_network_gb300/    # GB300 NVL72 三合一融合网
    ├── storage_disabled/          # 存储网络关闭场景
    ├── supernode_384/             # 384 NPU 华为超节点
    └── zcube_512/                 # 512 GPU ZCube 扁平二部图
```

## 资产清单

| 资产 ID | 场景 | 配置路径 | 消费方 |
| --- | --- | --- | --- |
| `64_h100` | 64 台 H100 规划（RoCE 400G 四网） | `projects/64_h100/project_config.json` | pytest `test_quality_fixtures.py` |
| `128_h100_multi_rack` | 128 GPU 多机柜 | `projects/128_h100_multi_rack/project_config.json` | pytest `test_quality_fixtures.py` |
| `combined_network_gb300` | GB300 NVL72 三合一融合网 | `projects/combined_network_gb300/project_config.json` | pytest `test_quality_fixtures.py` |
| `storage_disabled` | 存储网络关闭 | `projects/storage_disabled/project_config.json` | pytest `test_quality_fixtures.py` |
| `supernode_384` | 384 NPU 华为超节点 | `projects/supernode_384/project_config.json` | pytest `test_quality_fixtures.py` |
| `zcube_512` | 512 GPU ZCube | `projects/zcube_512/project_config.json` | pytest `test_quality_fixtures.py` |

## 复用方式

- **pytest**：`tests/backend/test_quality_fixtures.py` 遍历 `projects/*/project_config.json`，
  交给 `NetworkDesignerV2` 生成拓扑并断言有效性/规模（Q-2 资产可复用验收）。
- **vitest**：`src/test/quality-data-assets.test.ts` 通过 `node:fs` 读取
  `tests/fixtures/manifest.json`，断言清单与磁盘目录一一对应（Q-2 双端复用）。
- **门禁**：`scripts/test_report.py` 聚合测试结果时也会引用本目录作为回归样例。

## 约束

- 样例仅作测试数据，不应被 `electron/**` / `backend/**` 业务逻辑依赖。
- 新增样例需同步更新 `manifest.json` 与上方表格。
