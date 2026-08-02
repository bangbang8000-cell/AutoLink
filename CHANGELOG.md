# CHANGELOG

## [2.9.6] - 2026-08-02

### 模板可视化编辑（项目模板生命周期打通 · 第三阶段）

v2.9.6 是 v2.9.4~2.9.9「项目模板生命周期打通」系列第三阶段：将模板编辑从纯 INI 文本升级为可视化表单，支持规模/网络/选型/机柜全量编辑，JSON+INI 双文件同步（PRD 见 `docs/v2.9/v2.9.4-2.9.9_项目模板生命周期_PRD.md`）。

#### 后端：JSON→INI 反向序列化（T1/T2）
- `migration.project_config_to_ini`：project_config.json 全字段映射回模板 `[DEFAULT]` 段 INI（与 designer `_load_common_ini_config` 键一一对应）；含 `[rack]` 段（冷却/GPU 独占）与 `[scale_up]` 段（非空才输出）
- 存储合并：全闪+混闪 → `additional_storage_servers` 单键（往返按 1/2 拆分，总量一致）
- 网络开关 → `oob_enabled`/`biz_enabled` 布尔
- 新增 engine action `project_config_to_ini`：`validate_config` 校验通过后返回 INI，失败返回具体错误
- `template:update` 扩展 `projectConfig` 字段：JSON.parse + 后端校验 → 写回 `project_config.json` + 同步生成 `network_config.ini`；校验失败明确抛错

#### 前端：EditTemplateModal v2 表单化（T3/T4/T5）
- 重构为可视化表单：基本信息（名称/描述/场景/标签）+ 规模设置（GPU/全闪/混闪/通算数量、网卡/交换机口数、速率、协议 IB/RoCE/UEC、下行模式与 4 网下行数）+ 网络类型（4 Toggle）+ 选型设置（按网络分组，复用 `DeviceLibraryPicker`）+ 机柜设置（42U/49U、功率预设、散热方式、GPU 独占、命名前缀）
- JSON 原文兜底折叠面板：手动编辑 JSON 时以 JSON 为准保存（保存前语法校验），可"从表单重新生成"
- 保存失败（含后端校验失败）保持弹窗打开并展示具体错误
- `ParamProtocol` 类型扩展 UEC；`WizardStepDevices` 存储默认表补 UEC 键

#### 内置模板编辑策略（T6）
- 内置模板仍不可编辑（toast 提示），行为不变

#### i18n 与测试（T7）
- 新增 5 语言 `common.template.editForm.*`（37 keys）
- `test_migration.py` 新增 8 个用例：往返一致性/rack/scale_up/存储合并/网络开关/空 scale_up/action 校验（合法/非法/非字典）

#### 版本与回归
- 版本号 2.9.5 → 2.9.6（package.json / VERSION / package-lock.json）
- 全量回归：pytest 560 passed（+8）、vitest 345 passed、tsc 0 error、eslint 0 error（37 个既有 warning）、模板验证 16/16 通过

## [2.9.5] - 2026-08-02

### 从模板创建项目（项目模板生命周期打通 · 第二阶段）

v2.9.5 是 v2.9.4~2.9.9「项目模板生命周期打通」系列第二阶段：打通"模板 → 项目"完整链路——模板右键入口、向导预加载、后端双路径查找、前端死代码清理（PRD 见 `docs/v2.9/v2.9.4-2.9.9_项目模板生命周期_PRD.md`）。

#### 后端：project:create 模板支持（T1）
- 模板目录双路径查找：用户模板（user-templates）优先，其次内置模板（template/），均未找到时明确抛错
- 从模板创建项目时全量复制 `project_config.json` + `network_config.ini`（此前只复制 INI）

#### 后端：template:getConfig IPC（T2）
- 新增 `template:getConfig` IPC：返回模板的 project_config.json 内容，供向导预加载

#### 向导：模板配置预加载（T3）
- `wizard.store.loadTemplateConfig`：创建项目向导打开时拉取模板配置并合并（规模/选型/机柜/网络）
- 加载失败或模板无配置时 toast 提示并从头开始（`templateLoadFailed`/`templateNoConfig`）

#### 模板侧边栏：右键"基于此模板创建项目"（T4）
- 模板目录上下文菜单新增"基于此模板创建项目"，一键打开向导并预填模板配置
- 新增 `ui.store.openWizardFromTemplate` + `templateForWizard` 状态

#### 向导基本步骤增强（T5）
- 新增"重置为默认"按钮（`resetConfig`），一键恢复空白向导配置

#### 死代码清理（T6）
- 删除不再使用的 `CreateProjectModal.tsx`（已被向导取代）

#### 前端测试与 i18n（T7/T8）
- `wizard.store.test.ts` 新增 `loadTemplateConfig`/`resetConfig` 用例
- 新增 5 语言 key：`common.explorer.contextMenu.createFromTemplate`、`common.templateLoadFailed`/`templateNoConfig`、`project.resetToDefault`

#### 版本与回归
- 版本号 2.9.4 → 2.9.5（package.json / VERSION / package-lock.json）
- 全量回归：pytest 552 passed、vitest 345 passed、tsc 0 error、eslint 0 error（36 个既有 warning）、模板验证 16/16 通过

## [2.9.4] - 2026-08-02

### 模板数据模型与库治理（项目模板生命周期打通 · 第一阶段）

v2.9.4 是 v2.9.4~2.9.9「项目模板生命周期打通」系列第一阶段：为每个内置模板补齐 `project_config.json`（规模/选型/机柜/网络的唯一权威载体），并升级模板生成与验证脚本，为"从模板创建项目"打好数据地基（PRD 见 `docs/v2.9/v2.9.4-2.9.9_项目模板生命周期_PRD.md`）。

#### 迁移引擎支持模板 INI（T1）
- `migration.ini_to_project_config` 支持 `[DEFAULT]` 段（模板风格），兼容旧 `[topology]` 段
- 新增映射：`additional_storage_servers`（拆分为全闪/混闪）、`additional_compute_servers`、`rail_mode`/`rail_count`/`param_protocol`/`biz_chassis_threshold`
- `[rack]` 段支持 `cooling_method`/`gpu_dedicated`（V2.9.1 rack_config 扩展）；存储数量为 0 时正确拆分为 0+0

#### 模板预生成脚本（T2）
- 新建 `scripts/prepare_templates.py`：INI → JSON 批量生成 + 按模板语义覆盖 GPU 选型 + 校验（validate_config + 设备库解析）；幂等，`--force` 覆盖，`--check` dry-run

#### 选型规则收敛（T3）
- `_get_default_device_refs` 补充 `gpu_server` 与 designer 别名键（`param_switch`/`storage_switch`/`storage_server`）
- 参数交换机按协议+速率选型（IB/UEC/RoCE × 200G/400G/800G），与 `designer._auto_select_param_switch` 一致
- `designer._load_project_config` 新增别名收敛：向导键名（`param_leaf_switch`/`all_flash_storage_server`）自动映射为 designer 键名

#### 内置模板库治理（T4）
- 16 个内置模板全部生成并人工校准 `project_config.json`（GPU 选型：H100/L20/GB300 NVL72/MLU590/昇腾 910C/海光 K100/B200 等）
- 11 个模板补充 `[rack]` 段机柜配置（功率上限 8K~18KW、液冷-H100-256 为 cold_plate、GPU 独占）
- `template.json` 增加 `templateVersion: 2`；修复 cambricon_mlu_cluster 缺失的 template.json

#### 模板验证升级（T5）
- `validate_templates.py` 升级：project_config.json 完整性、device_refs 全量解析、INI/JSON 设计拓扑等价、机柜功率/U 位/上架检查
- 全量结果：`prepare_templates.py` 16/16 OK，`validate_templates.py` 16/16 通过

#### 版本与回归（T7）
- 版本号 2.9.3 → 2.9.4（package.json / VERSION / package-lock.json）
- 全量回归：pytest 552 passed（新增 12 个迁移/别名用例）、vitest 341 passed、tsc 0 error、eslint 0 error（37 个既有 warning）

## [2.9.3] - 2026-08-02

### 能力补强收口（3.0 前收官 · 第三阶段）

v2.9.3 是 3.0 前收官最后阶段：Scale-Up 双栈转正、校验硬规则扩到 19 条、PDF 报告修复完善、端口前缀解析补齐、UEC/模板一致性治理（PRD 见 `docs/v2.9/v2.9.1-2.9.3_质量与体验_PRD.md`）。

#### Scale-Up 配置层（T1）
- JSON 顶层 `scale_up` 段 + INI `[scale_up]` section，`bandwidth` 兼容旧命名 `bandwidth_per_link_gbps`
- 旧配置缺失该段 → `scale_up_config=None` 不报错；INI→JSON 迁移保留 scale_up
- `project_config.validate_config` 新增可选 scale_up 校验（protocol 枚举 + 数值类型）

#### Scale-Up 生成层（T2）
- designer 主流程接入：GPU 以 `NetworkObject(obj_type='scaleup_gpu', network_type='scale_up', domain_id, protocol)` 纳入体系
- 域内全对等边双向挂接 Connection，`scale_up_connections` 按无向 pair 去重

#### Scale-Up 机柜层（T3）
- RackAllocator 新增 `CABINET_TYPE_SCALEUP`，GPU 节点 1 台/柜独占，域内柜号相邻
- engine 输出 scale_up 节点（domainId/protocol/networkType）与 summary.scaleUp

#### Scale-Up 前端与报告（T4）
- TopologyTab/RackTab 消费 scale_up 数据：拓扑边渲染、机柜类型 scaleup（琥珀色）
- 报告概览/架构/机柜章节含 Scale-Up 汇总

#### 校验硬规则 V016-V019（T5）
- V016 服务器网卡容量、V017 光模块封装/距离匹配、V018 Pod/域规模、V019 整机房功率，规则数 15→19

#### PDF 报告修复与完善（T6）
- 项目名称取 meta.name（修 bug）、机柜表全量渲染（repeatRows=1）、BOM 按型号聚合
- 新增设备清单/收敛比章节，收敛比读 estimation 计算值（非硬编码）

#### 端口前缀解析补齐（T7）
- `_resolve_device_port_prefixes` 实现 storage/oob/biz 命名前缀（接口模型驱动 + 默认值兜底）
- `_wire_storage` / OOB / 业务网连线端口按对应前缀命名

#### UEC/模板一致性（T8）
- `validate_config` 接受 UEC 协议（IB/RoCE/UEC），与 designer 自动选型一致
- ualink_1_0_1024 / cloudmatrix_384 / NVL72-单架 三模板补 scale_up 配置（名实相符：UALink 1024 / UB 384 / NVLink 72 单域）

#### 版本与回归（T9）
- 版本号 2.9.2 → 2.9.3（package.json / VERSION / package-lock.json）
- 全量回归：pytest（新增 15 个用例）、tsc、eslint、vitest 全绿

## [2.9.2] - 2026-08-02

### 体验精细打磨（3.0 前收官 · 第二阶段）

v2.9.2 聚焦使用体验的精细打磨：统一空态/弹窗/组件、工作区 Tab 项目隔离与未保存确认、长操作真实进度反馈、表单校验完善、首次引导与无障碍（PRD 见 `docs/v2.9/v2.9.1-2.9.3_质量与体验_PRD.md`）。

#### EmptyState 统一落地（T1）
- RackTab/Topology3DTab/OutputTab/ProjectListPanel/DataCenterTab/FileViewerTab 无数据场景统一 `ui/EmptyState`（图标 + 标题 + 描述 + 可选操作）
- 删除 ProjectOverviewTab 本地 EmptyState 副本，改为复用 ui 组件

#### 弹窗统一 ui/Modal（T2）
- DeviceImportModal / DeviceExportModal / ImportCabinetsModal 统一走 `ui/Modal`（ESC 关闭 / 焦点陷阱 / 滚动锁定 / aria-labelledby）
- 导入解析失败、导出失败在弹窗内展示错误；导出增加 try/catch 与 exporting 状态

#### ui/ 组件库业务落地（T3）
- DataCenterTab 布局参数、DeviceLibraryTab 搜索/厂商筛选、DesignTab 数字输入与开关全部切换为 `ui/Input`、`ui/Select`、`ui/NumberInput`、`ui/Toggle`

#### 工作区 Tab 项目隔离 + 未保存确认（T4）
- Tab 状态携带 `projectName`（persist 版本 v1→v2），切换项目自动清理旧项目 Tab，删除项目清理其持久化 Tab
- Design/Rack Tab 配置变更标记 `dirty`，关闭时弹确认（标题 + 文案 + 仍要关闭）
- Tab 栏无障碍：`role=tab` / `aria-selected` / 键盘 Enter 激活 / 关闭按钮 `aria-label`，dirty 圆点指示
- OutputTab 错误信息 i18n 化（`fileViewer.loadFailed`）

#### loading 真实化（T5）
- DeviceImportModal / FileViewerTab / OutputTab Excel 解析改分片（`parseWorkbookChunked`）+ 真实进度条
- TopologyTab / DataCenterTab PNG 导出按钮转圈 + 禁用（导出中防重复点击）

#### 表单校验完善（T6）
- ProjectWizard 分步校验：名称必填/长度/去重、网络必选、设备必选、机柜功率上限按散热方式联动校验，按钮下方 inline 错误
- WizardStepBasic 名称错误态（红框 + 文案 + maxLength=50 + 重名提示）
- WizardStepDevices 服务器数量上限（≤2048）红框提示
- WizardStepRack 切换散热方式自动收敛功率上限

#### 首次引导 + 无障碍（T7）
- 首启 3 步 OnboardingModal（创建项目 → 配置设计 → 可视化与交付），看过一次不再弹出
- 搜索清除 / 导出按钮补 `aria-label`

#### i18n 与版本（T8）
- 新增 key：dirty 关闭确认、解析进度、wizard 校验、onboarding 引导，5 语言同步补齐
- 版本号 2.9.1 → 2.9.2（package.json / VERSION / package-lock.json）

## [2.9.1] - 2026-08-02

### 质量工程闭环（3.0 前收官 · 第一阶段）

v2.9.1 是 3.0 前"质量工程闭环"首个子版本，聚焦工程质量与性能基线（PRD 见 `docs/v2.9/v2.9.1-2.9.3_质量与体验_PRD.md`）。

#### 死代码清理与重复合并（T1/T2）
- 删除 `src/components/sidebar/` 下 7 个零引用死文件（Explorer/Output/Design/DeviceLibrary/Rack/Topology/Workbench Panel）
- `handlers.ts` 两处 `walkDir` 文件树遍历合并为公共函数，project/template 结构查询共用
- `template:getFile` 复用通用路径防护 `sanitizeUnderBase`
- `project-io.service.ts` `importProjectZip`/`importTemplateZip` 抽取公共 `extractZipCommon`（安全校验→命名冲突后缀→白名单解压→元数据同步）

#### 错误反馈补齐（T3）
- 拓扑保存/机柜布局保存/项目列表刷新失败均有 toast 提示（design.store / rack.store / project.store）
- 设备 Excel 导入解析失败在弹窗内红色错误提示（parseError），切换 Tab 清空
- 存储数量字段双 schema 兼容替代 `as any`

#### any 类型治理（T4）
- 修复 10+ 处 `catch (e: any)` / 强转链：MenuBar、AboutDialog、WorkspaceView、CreateProjectWizard、WorkbenchActionCard、Topology3DTab、ImportCabinetsModal、exportTopology、preload、WizardStepDevices 等
- `eslint no-explicit-any` 恢复 **error**（`src/test/**` 测试 mock 数据豁免）
- eslint 从 10 errors → **0 errors**

#### 测试补缺（T5）
- 新建 `test_ub_topology.py`（25 用例）：UBConfig 默认值/域划分/全对等连接数/端口命名/统计/engine schema 兼容
- `test_validation.py` 追加 V011（PUE≤1.3 合规）/V012（OCP 冷板接口）/V013（信创比例≥50%）正反例（9 用例）
- `test_scaleup_and_plugin.py` 追加 biz/oob 插件 generate_topology 用例
- `test_designer_integration.py` 追加超大-2048（3-tier）集成用例：16 Pod×128 台、三层 Core 存在、拓扑自检通过

#### 性能优化（T6）
- `topology.py`：Leaf/Spine 查找从 O(n) 线性扫描改为 name→对象 dict 索引，消除 2048 台场景约 840 万次无效迭代
- `rack_allocation.py`：按机柜类型分桶索引 + U 位满柜惰性移除，`_find_fit_cabinet` 不再全量扫描
- **2048 台全流程设计耗时 1.29s → 0.51s**（含拓扑自检，目标 <2s）

#### 模板验证扩展（T7）
- `validate_templates.py` 自动发现并覆盖**全部 16 模板**（原 7 个），新增机柜分配/功率超限/U 位重叠/上架覆盖率检查
- **修复存储网络连接 bug**：`_wire_storage` 每台服务器固定生成 1 条存储连接，`storage_ports_per_server=2` 时只连一半（cambricon/cloudmatrix/hygon/ualink/uec 5 模板受影响）→ 按端口数生成多条并轮转分配 Leaf，16/16 模板通过

#### 回归
- tsc 0 errors、eslint 0 errors、vitest 335 passed、pytest 495 passed、16/16 模板验证通过

## [2.9.0] - 2026-08-02

### 机柜规划与上架逻辑重构

v2.9.0 系列让机柜规划从"简单轮转"升级为"物理约束装箱"，贴近真实机房上架规则（PRD 见 `docs/v2.9/v2.9.X_PRD.md`）。

#### 机柜核心算法（v2.9.0）
- **多约束装箱算法**: 新建 `backend/rack_allocation.py`，功率 + U 位双约束 + 设备类型区分（GPU/通算/存储/网络）；GPU 高功率（≥50% 上限）独占机柜，128×DGX H100（10.2KW）在 12/16KW 柜自动 **1 台/柜**；通算/存储 15 台/柜；网络设备按网段聚柜
- **交换机机柜分配**: param/storage/oob/biz 交换机全部参与上架（网络柜），拓扑连线机柜字段补齐，oob/biz 分配后回填连接机柜信息
- **机柜功率汇总含交换机**: `_calculate_power_summary` 遍历全部设备，输出每柜 type/设备数/功率/利用率/超限标记
- **V002 校验升级**: 阈值取 `min(散热方式上限, power_limit_per_rack)`，6000W 柜不再等 15000W 才报警
- **功率密度联动**: 机柜数含网络柜，密度估算与分配一致

#### 机柜配置与报告（v2.9.1）
- `rack_config` 扩展：`cooling_method`（air/cold_plate/immersion）、`gpu_dedicated`（独占开关）、`power_preset`（功率预设）
- `WizardStepRack` 增强：功率预设快速按钮（6/12/16/30/60KW）、散热方式选择、GPU 独占开关
- 报告/PDF 新增"机柜规划"章节（柜号/类型/设备数/功率/利用率/超限），功率密度与散热配置一致性提示

#### 前端机柜体验（v2.9.2）
- `rack.store` 重构：`initFromTopology` 优先后端分配并按类型分类（gpu/storage/compute/network），`loadRackLayout` 无布局回退空状态（不再虚构 4 柜）
- 机柜类型着色：机架视图类型徽章 + 机房平面图类型角标（GPU 红/网络蓝/存储绿/通算黄）
- i18n：新增 rack 命名空间 5 语言 + key 完整性测试

#### 双栈与智能分组（v2.9.3）
- Scale-Up 域聚柜验证：GPU 服务器组（域）输入有序 → 柜号连续
- 新校验规则 **V014**（GPU 高功率柜多台共柜告警）、**V015**（机柜利用率 <30% 提示）
- 修复 `scripts/test_export.py` TypeError（`library.get(profile)` 传入不可哈希的 LibraryDevice → 改传 `profile.id`）
- 回归测试: tsc 0 errors、eslint 0 errors、vitest 335 passed、pytest 456 passed

## [2.8.0] - 2026-08-02

### 体验与性能

v2.8.0 系列聚焦文件加载、拓扑持久化与交互编辑三大体验升级，按 v2.8.0~v2.8.3 四个子版本交付（PRD 见 `docs/v2.8/v2.8.X_PRD.md`）。

#### v2.8.0 文件加载与查看
- **Excel 一次性加载**: 新增 `ExcelTable` 统一组件 + 模块级缓存（`excel-cache.ts`，容量 50），FileViewerTab 一次解析全部 sheet，切 sheet 纯状态切换零重载
- **图片乱码修复**: 图片文件（png/jpg/gif/webp/svg）走 `getFileBinary` + MIME 归一渲染 `<img>`，不再按 UTF-8 文本读入 `<pre>`（`file-type.ts`）
- **输出目录体验**: `listOutputFiles` type 小写归一、`listOutputBatches` 新增虚拟 `[根目录]` 批次（根目录文件如导出的拓扑 PNG 可见），根目录批次常展开且不可删除

#### v2.8.1 拓扑持久化与可加载
- **拓扑布局落盘**: topology.json schema 升级 v2（新增 `layout` 字段），保存布局写回项目输出文件，重新生成时保留已保存布局（过滤失效节点）
- **原始拓扑可编辑**: 项目列表点击 topology.json 直接打开拓扑视图，继续编辑并可再次保存；新增 `removeTopologyNodes`/`restoreTopology` 删除与恢复
- **未保存指示器**: 工具栏显示布局"已保存/未保存"状态，重置布局同步清理落盘文件

#### v2.8.2 拓扑交互增强
- **框选拖动**: 多选节点可整体拖动调整位置（selectionOnDrag），支持 Delete/Backspace 删除选中节点（撤销可恢复）、Esc 取消选区/退出框选、Space 临时平移
- **悬浮信息**: 网元悬浮显示 id/类型/组/Pod/机柜/U位/功率/连接数（NodeToolbar）；链路悬浮高亮 + 详情面板（源端/目标端/速率/网络类型/缆型/描述）
- **链路标签**: 边标签显示开关（缩放 <0.5 自动隐藏），对齐工具栏（左/右/上/下按选区边界对齐）
- **撤销/重做升级**: 完整拓扑快照（positions+nodes+edges）替代纯位置快照，删除节点可恢复
- **性能优化**: hover 仅目标节点新建对象，其余复用引用

#### v2.8.3 文案与一致性
- **i18n key 补全**: 5 语言（zh-CN/en/zh-TW/ja/ko）补齐 `menu.visualization`、`update.releaseNotes`、`menu.deviceLibrary`、`design.exportPdf`、PUE 估算、`workbench.cablingGuide/bom` 等缺失 key，修复编程 ID 泄漏
- **topology.json 重写**: 新增 40+ key（viewTitle/nodes/connections/saveLayout/edgeLabels/alignLeft/nodeDetail 等），拓扑视图全面接入 i18n
- **防回归测试**: 新增"i18n key 完整性（以 zh-CN 为基准）"测试（77 用例），4 语言缺失 key 将直接失败
- 回归测试: tsc 0 errors、eslint 0 errors、vitest 330 passed

## [2.7.7] - 2026-08-02

### 修复

- **更新检查误报修复**: 当 `app.getVersion()` 返回无法解析的值（如 "unknown"/空字符串）时，原 `compareVersions` 会误判为"线上有新版本"导致即使线上版本 = 当前版本仍触发更新提示。现统一使用严格比较 `isVersionNewer()`，线上版本 ≤ 当前版本或当前版本无效时一律不触发更新
- 新增 `electron/utils/version.ts` 版本比较工具，主路径（electron-updater）与 fallback 通道统一复用
- fallback 通道仅在确认有新版本时缓存下载信息，避免污染后续下载路径
- 新增 10 个单元测试（`src/test/update-version.test.ts`）覆盖相等/大于/小于/无效版本场景
- 回归测试: tsc 0 errors、eslint 0 errors、vitest 323 passed、pytest 424 passed

## [2.7.6] - 2026-08-02

### 双栈与标准

v2.7.6 支持 Scale-Up/Scale-Out 双栈规划，预置 UEC/UALink 新标准，预研插件化架构与 3D 可视化，完成 10 项任务。

#### 双栈拓扑规划 (T1-T5)
- **T1**: Scale-Up 拓扑规划（`backend/scaleup_topology.py`），支持 NVLink / UALink / UB 三种协议的 Pod 内全对等互联
- **T2**: Scale-Out 拓扑规划扩展，`param_protocol` 新增 UEC（Ultra Ethernet Consortium）支持，自动选型 CPO/硅光交换机
- **T3**: UEC 1.0 拓扑模板（`template/uec_1_0_cluster/`），1024 GPU 集群，RoCE 400G Scale-Out
- **T4**: UALink 1.0 拓扑模板（`template/ualink_1_0_1024/`），1024 GPU Pod，Scale-Up 全对等互联 + Scale-Out RoCE 400G
- **T5**: 双栈联合视图，拓扑视图支持 Scale-Up 网络类型（琥珀色连线 + GPU 节点可视化）

#### 插件化架构 (T6-T8)
- **T6**: 网络类型插件化接口（`backend/network_plugin.py`），定义 `NetworkPlugin` 抽象接口，内置 param/storage/biz/oob/scale_up 5 个插件
- **T7**: `engine.py` action 注册表化，action 处理改为 decorator 注册（`@register_action`），新增 action 无需改主逻辑
- **T8**: 设备库 category 动态化，从 `library_index.json` 动态读取目录（优先 `category.directory` 字段），新增 category 无需改代码

#### 预研 (T9-T10)
- **T9**: 3D 可视化 PoC（`src/components/workspace/tabs/Topology3DTab.tsx`），基于 react-three-fiber，分层摆放 + 彩色连接 + OrbitControls
- **T10**: AI 辅助容量规划预研文档（`docs/v2.7/ai_capacity_planning_research.md`），调研 MoE/长上下文/FP8 训练负载反推带宽与收敛比

#### 其他
- 新增 `src/three-fiber.d.ts` 类型兼容声明，解决 @react-three/fiber v8 与 React 19 的 JSX 命名空间冲突
- 新增测试 `tests/backend/test_scaleup_and_plugin.py`（26 用例），覆盖 Scale-Up 拓扑与插件化扩展性
- 回归测试: tsc 0 errors、eslint 0 errors、vitest 313 passed、pytest 424 passed

## [2.7.5] - 2026-08-02

### 国产生态与信创

v2.7.5 构建国产算力生态壁垒，支持昇腾/海光/寒武纪国产设备，完成 9 项任务。

#### CloudMatrix 超节点 (T1-T3)
- **T1**: 昇腾 CloudMatrix 384 超节点拓扑模板（384 颗 910C NPU + 192 颗鲲鹏 CPU）
- **T2**: UB 统一总线拓扑算法（`backend/ub_topology.py`），全对等互联，单卡 2800Gbps
- **T3**: 昇腾 910C NPU 设备库完善，含 UB 总线接口参数

#### 国产设备模板 (T4-T6)
- **T4**: 海光 DCU 集群拓扑模板（64 台 K100，RoCE 200G）
- **T5**: 寒武纪 MLU 集群拓扑模板（128 台 MLU590，RoCE 200G）
- **T6**: 国产交换机生态完善，新增新华三 51.2T CPO 硅光交换机、锐捷 1.6T 交换机

#### 信创校验与报告 (T7-T9)
- **T7**: 信创比例校验规则 V013，统计国产设备占比，<30% INFO、<50% WARNING
- **T8**: 信创合规报告导出（`export_compliance_report`），含设备清单与占比统计
- **T9**: 国产设备库分类标签，设备增加 `origin`/`lead_time` 字段，`library_index.json` 更新

#### 设备库扩展
- `DeviceProfile` 新增 `origin`（国产/进口/混合）和 `lead_time`（供货周期）字段
- 设备库总数从 114 增至 117（新增 ascend_910c、h3c_s12500r_cpo_51_2t、ruijie_s6910_32oc2vs_1_6t）

## [2.7.4] - 2026-08-02

### 专业能力增强

v2.7.4 增强光模块/液冷/PUE/PDF 的专业度，对标行业最新标准，完成 11 项任务。

#### 光模块多技术路线 (T1-T3)
- **T1**: 光模块库补充 1.6T 多路线（硅光/LPO/EML/薄膜铌酸锂 TFLN），新增 4 款 1.6T 模块
- **T2**: 光模块选型支持 MMF/SMF 严格匹配，新增 `fiber_type` 参数与 `_SPEC_FIBER_MAP` 映射表
- **T3**: BOM 清单支持成本/功耗/供货周期权衡，`OpticalSelection` 扩展 `power_w`/`lead_time_weeks`/`unit_cost_lo/hi` 字段

#### 液冷与 PUE 增强 (T4-T6)
- **T4**: 液冷模型增加 OCP 冷板标准接口校验规则 V012，校验冷却液类型（PG25/PG40/FC3283/water）
- **T5**: PUE 模型增强，新增湿度修正、UPS 冗余损耗（N/N+1/2N）、冷热通道隔离参数
- **T6**: 新增校验规则 V011，PUE > 1.3 时报合规警告（区别于 V003 的 1.25 优化目标）

#### PDF 报告增强 (T7-T8)
- **T7**: PDF 报告增加图表（功率分布柱状图、光模块成本饼图），使用 matplotlib 动态生成
- **T8**: PDF 报告增加页眉（项目名+版本）、页脚（页码）、目录

#### 设备清单与算法优化 (T9-T11)
- **T9**: `generate_device_list` 从 device_library 拉取 vendor/model 填充设备清单
- **T10**: 收敛比计算增加 Spine fanout，提供 Leaf 级和全局两级收敛比（3-tier CLOS）
- **T11**: Excel 美化算法优化，从 8 次遍历减少到 2 次（单次遍历 + 预计算合并区域），万级连接导出 ≤ 5s

#### 设备库扩展
- 设备 schema 新增 `tech_route`（技术路线）、`origin`（国产/进口）、`lead_time`（供货周期）字段

## [2.7.3] - 2026-08-02

### 体验与性能

v2.7.3 修复前端体验痛点，优化大规模拓扑性能，完成 15 项任务。

#### 快捷键与布局 (T1-T5)
- **T1**: 全局快捷键注册，`src/utils/shortcuts.ts` 集中管理快捷键映射表
- **T2**: ShortcutsDialog 从 shortcuts.ts 自动生成，对话框列出的快捷键全部可用
- **T3**: ContextMenu 边界检测，靠近右/下边缘时菜单自动调整位置
- **T4**: ResizableAppLayout 迁移 react-resizable-panels，支持 a11y、键盘、持久化
- **T5**: app/edge token 亮色补全，亮色模式下色调统一

#### 性能优化 (T6-T8)
- **T6**: 拓扑布局算法迁移 Web Worker，2048 节点布局不阻塞主线程
- **T7**: TopologyTab 引用稳定化，`React.memo` + 自定义 `areEqual` 避免全量重渲染
- **T8**: Tab 懒加载，首屏仅加载当前 Tab 代码

#### UI 组件库 (T9-T11)
- **T9**: UI 组件库导出补齐 Modal/ContextMenu/Toggle/SettingsRow
- **T10**: 新增 Tooltip/Dropdown/Tabs 组件
- **T11**: 处理哑设置项 fontSize/compactMode/animations，接入 CSS 变量

#### FileExplorer 拆分与优化 (T12-T15)
- **T12**: 设备库列表虚拟化（@tanstack/react-virtual），500+ 设备滚动流畅
- **T13**: FileExplorer 拆分为 ProjectListPanel/FileTreePanel/SettingsPanel/TemplateSaveDialog
- **T14**: 原生 prompt() 替换为 RenameProjectModal（复用组件）
- **T15**: Toast 优化，容器位置调整 + 悬停暂停计时

## [2.7.2] - 2026-08-02

### 算法可用性

v2.7.2 让 validation 引擎与 Rail-Optimized 算法真正生效,统一配置格式,完成 12 项任务。

#### 校验引擎接入 (T1-T3)
- **T1**: `validation.py` 接入 `engine.handle_design`,替换简化版校验为 10 条规则结构化校验 (V001-V010)
- **T2**: 修复 V004/V005/V009 字段映射,与 engine.py 的 edge schema 对齐 (`a_port_type` → `speed`, `network_type` 改为英文枚举)
- **T3**: 前端 `ValidationPanel.tsx` 重写,按规则 ID 分组展示,支持折叠/展开,错误优先

#### Rail-Optimized 拓扑修复 (T4-T5)
- **T4**: 修复 `rail_topology.py` 连接生成,光模块型号 (`a_module`/`z_module`) 使用 `network_speed` 变量,端口名改用计数器
- **T5**: 服务器分配改为交错模式 (`idx % rail_count`),符合 NVIDIA SuperPOD 规范,单 Rail 故障不集中

#### 配置统一与持久化 (T6-T7)
- **T6**: `design:generate` 改为合并更新 `project_config.json`,保留 `rail_mode`/`param_protocol` 等扩展字段
- **T7**: `DesignConfig` 接口补充 `rail_mode`/`rail_count`/`param_protocol` 字段,DesignTab UI 增加配置控件

#### 设备选型与网络增强 (T8-T9)
- **T8**: `designer.py` 根据 `param_protocol` (IB/RoCE) 自动选择参数网交换机 (IB→NVIDIA Quantum, RoCE→H3C S9820)
- **T9**: 存储网放开 3-tier 限制,根据服务器数量自动判断是否升级为 3-tier 拓扑

#### 项目迁移与端口适配 (T10-T12)
- **T10**: 项目加载时自动检测 V2.0 INI 格式并迁移为 V2.1 JSON 格式
- **T11**: OOB/业务网下联口数从设备档案 `port_count` 读取,覆盖硬编码 48/32
- **T12**: 业务网框式阈值参数化,`biz_chassis_threshold`/`biz_chassis_frames_map` 可配置,移除硬编码 128/512/1024 → 4/8/18

#### Bug 修复(回归测试发现)
- 修复 INI 模式缺少 `biz_chassis_threshold` 属性导致 33 个测试失败
- 修复 `LibraryDevice` 无 `port_prefix` 属性问题 (改用 `name_prefix`)
- 补充缺失的 `_calc_biz_chassis_frames` 方法

#### 测试统计
- 前端:304 passed (15 files)
- 后端:398 passed
- TypeScript:0 errors
- ESLint:0 errors (78 warnings)

---

## [2.7.1] - 2026-08-01

### 质量基线

v2.7.1 建立质量门禁,补齐核心算法测试,修复 VERSION 同步问题。

#### CI 质量门禁
- CI 增加 vitest(前端) + pytest(后端) 测试步骤,PR 全绿方可合并
- CI 增加 VERSION 文件与 package.json version 一致性校验
- CI 增加 ruff(Python lint) + mypy(类型检查) 步骤

#### 后端算法测试补齐(94 用例)
- 新建 `test_validation.py`:覆盖 V001-V010 共 10 条校验规则,每条 ≥1 正例 + ≥1 反例
- 新建 `test_estimation.py`:覆盖 PUE 估算(风冷/冷板/浸没 + 温度/自然冷/负载率)、收敛比(4 种网络类型)、机柜密度(5 档)
- 新建 `test_optical_selector.py`:覆盖速率解析、距离估算、规格推荐、选型逻辑、价格估算

#### 前端 Store 测试补齐(108 用例)
- explorer.store(15)、render.store(16)、toast.store(10)、ui.store(17)、wizard.store(20)、workspace.store(20)、ProjectContext(10)
- 覆盖状态变更、action 调用、persist 中间件、边界情况

#### Bug 修复
- VERSION 文件从 2.6.9 同步至 2.7.1

#### 测试统计
- 前端:304 passed(15 files)
- 后端:393 passed
- TypeScript:0 errors
- ESLint:0 errors

---

## [2.7.0] - 2026-08-01

### 三项核心修复

#### 1. 暗色模式拖拽分隔线颜色修复
- **问题**：暗色模式下中栏（文件浏览器）与工作区之间的垂直拖拽分隔线显示为白色，视觉突兀
- **根因**：`ResizableAppLayout.tsx` 使用 `dark:bg-edge-default` 类，但 Tailwind 的 `edge.DEFAULT` 生成的类名是 `bg-edge`（无后缀），`bg-edge-default` 是无效类，导致暗色模式下未覆盖亮色的 `bg-gray-200`
- **修复**：`dark:bg-edge-default` → `dark:bg-edge`（渲染为 `#484F58` 暗灰，与水平分隔线一致）

#### 2. 项目浏览器目录显示修复
- **问题**：应用重启后，项目浏览器中已展开的目录/子目录无法正确显示对应文件，点击无响应
- **根因**：`explorer.store.ts` 持久化了 `expandedProjects`（展开状态）但不持久化 `projectStructures`（结构缓存）。重启后项目显示为"已展开"但结构缓存为空，而 `toggleProjectExpand` 的条件 `!currently && !projectStructures[name]` 因 `currently===true` 跳过了结构拉取
- **修复**：
  - `toggleProjectExpand` 条件改为 `!projectStructures[projectName]`（不依赖当前展开状态）
  - 新增 `useEffect`：组件挂载时自动为所有"已展开但无结构缓存"的项目拉取结构

#### 3. 自动更新下载重构
- **问题**：检查到新版本后点击下载无反应或失败，原实现回退到打开浏览器而非真正下载
- **根因**：国内网络下 `electron-updater.checkForUpdates()` 失败后走 fallback 通道，但 fallback 只解析了 version 未解析下载信息；`downloadUpdate()` 因 electron-updater 内部无 `updateInfo` 缓存而抛错
- **修复**（`update.service.ts` 重构）：
  - **增强 fallback 检查**：解析 `latest.yml` 的 `path` 字段（当前平台安装包文件名），构造下载 URL 并缓存
  - **平台适配**：新增 `getPlatformYmlName()`，Windows/macOS/Linux 分别请求 `latest.yml`/`latest-mac.yml`/`latest-linux.yml`
  - **正向直接下载**：新增 `downloadInstallerFile()`，用 Electron net 模块直接下载安装包到本地下载目录，手动处理 GitHub 的 302 重定向，实时发送下载进度
  - **多级 fallback**：electron-updater 下载 → 直接下载安装包 → 打开浏览器
  - **安装支持**：`quitAndInstall()` 检测直接下载场景，打开本地安装包并退出应用

### 涉及文件
- `src/components/layout/ResizableAppLayout.tsx`：拖拽线颜色修复
- `src/components/layout/FileExplorer.tsx`：项目浏览器结构缓存恢复
- `electron/services/update.service.ts`：自动更新下载逻辑重构
- `README.md`：版本号更新至 2.7.0，自动更新章节重写
- `docs/deployment.md`：版本号更新至 2.7.0，自动更新机制章节重写，新增下载失败 FAQ
- `package.json`：版本号 2.6.9 → 2.7.0

### 回归测试
- TypeScript typecheck：0 errors
- ESLint：0 errors（7 warnings 为历史遗留）

---

## [2.6.5] - 2026-07-31

### 更新检查机制修复

#### 问题根因
v2.6.3 及之前版本的 `checkForUpdates` 在网络失败或 electron-updater 模块异常时,catch 吞掉错误并返回 `{ updateAvailable: false }`,前端显示"已是最新版本",误导用户以为没有新版本,实际是检查失败(国内 GitHub Releases 访问超时)。

#### 修复方案
- **备用更新检查通道**:新增 `checkLatestYmlFallback`,使用 Electron `net` 模块(走 Chromium 网络栈)直接请求 `releases/latest/download/latest.yml` 并解析版本号。当 electron-updater 主路径失败时自动启用
- **错误信息透传**:`checkForUpdates` 返回类型增加 `error?: string` 字段,前端可区分"无更新"与"检查失败"
- **15 秒超时**:备用通道设置 15 秒超时,避免长时间挂起
- **版本比较修正**:主路径增加 `compareVersions` 比较,避免 electron-updater 在 dev 模式下误报
- **手动下载入口**:检查失败时 UI 显示"手动下载"按钮,一键打开 GitHub Releases 页面
- **新增 IPC**:`app:open-releases-page` 打开浏览器跳转 Releases
- **5 语言 i18n**:新增 `update.manualDownload` key(手动下载/Manual Download/手動ダウンロード/수동 다운로드/手動下載)

#### 涉及文件
- `electron/services/update.service.ts`:新增备用检查通道 + 错误透传 + openReleasesPage
- `electron/ipc/handlers.ts`:新增 `app:open-releases-page` IPC
- `electron/preload.ts`:暴露 `openReleasesPage` API
- `src/types/electron.d.ts`:更新 checkUpdate 返回类型
- `src/components/layout/UpdatePopover.tsx`:区分"无更新"与"检查失败",添加手动下载按钮
- `src/i18n/resources/*/common.json`:5 语言补充 manualDownload

### 回归测试
- TypeScript typecheck:0 errors
- 前端 vitest:196/196 通过

---

## [2.6.4] - 2026-07-31

### v2.6.3 收尾:文档补齐与 U3 组件抽取

- **U3 收尾**:抽取 `ui/Toggle.tsx` 和 `ui/SettingsRow.tsx` 通用组件,迁移 FileExplorer 内联定义(`Toggle`/`ToggleMini`/`SettingsSection`/`SettingsRow`/`INPUT_CLASS`)
- **CHANGELOG**:补齐 v2.5.0-v2.6.3 全部变更记录
- **README**:更新至 V2.6 功能说明(拓扑持久化/自动更新/本地用户指南/PDF 报告/设备库一致性校验)
- **deployment.md**:重写为 V2.6 版本(自动更新机制/数据持久化/reportlab 依赖/V2.6 常见问题)
- **user_guide.md**:新增第 11 章「自动更新」,项目结构补充 topology.json/rack_layout.json,输出类型补充 PDF 报告,设置补充「重置工作区」,常见问题补充 Q8-Q10
- **v2.6.3 PRD**:状态更新为已完成,验收清单全部勾选

### 回归测试
- TypeScript typecheck:0 errors
- ESLint:0 errors(78 warnings 为历史遗留)
- 前端 vitest:196/196 通过
- 后端 pytest:299/299 通过

---

## [2.6.3] - 2026-07-31

### UI 系统优化（U1-U9 全部完成）

#### P0 用户关注点
- **U1 项目浏览器信息密度增强**：项目项卡片化（状态点 + 名称 + 文件数 + 时间 + 收藏）；输出文件按扩展名显示类型图标（xlsx/csv/png/json 等）；模板项卡片化（描述 + 标签 + 内置徽章）
- **U2 关于界面排版优化**：4 区块内边距统一（px-6 / px-4）；字号梯度从 5 种收敛到 3 种；快捷链接图标统一 12px；版权走 i18n（`about.copyright`）；AboutSettings 版本号动态获取
- **U3 设置界面优化**：删除死代码 `SettingsPanel.tsx`；控件宽度统一（select w-32 / input w-20）；抽象 `ui/Toggle.tsx` + `ui/SettingsRow.tsx` + `INPUT_CLASS` 常量；快捷键列表以 MenuBar ShortcutsDialog 为权威源
- **U4 全局字体体系统一**：tailwind.config.js 新增 `text-2xs`(10px)/`text-3xs`(9px) token；中文字体堆栈配置 PingFang SC / Microsoft YaHei / Hiragino Sans GB / Source Han Sans CN；全项目迁移 `text-[10px]`/`text-[11px]`/`text-[9px]`/`text-[8px]` 任意值类（248 处 → 0）；修复 `gray-750`/`gray-850` 无效颜色类

#### P1 结构性优化
- **U5 颜色体系统一**：启用语义色板 success/error/warning/info 替换 green/red/amber/blue 基础色（333 处）；新建 `constants/topology-colors.ts` 统一 TopologyNodes 与 exportTopology 节点色常量
- **U6 通用 Modal 组件**：新建 `ui/Modal.tsx`（ESC 关闭/遮罩关闭/焦点陷阱/body 滚动锁定可配置）；迁移 ConfirmDeleteDialog / RenameProjectModal / CreateProjectWizardModal / AboutDialog / EditTemplateModal / ShortcutsDialog
- **U7 通用 ContextMenu 组件**：新建 `ui/ContextMenu.tsx`（统一 z-index / 点击外部关闭 / 分隔线 / 禁用态 / 危险态 / 图标支持）；迁移 FileExplorer + WorkspaceView 右键菜单
- **U8 i18n 补全**：App.tsx Tab 标题、18 处 toast 消息、ConfirmDeleteDialog、ErrorBoundary、WorkspaceErrorBoundary、LogPanel 全部走 i18n（5 语言对齐）
- **U9 删除死代码**：`SettingsPanel.tsx` / `WorkspaceWelcome.tsx` / `WorkspaceTabBar.tsx` 全部删除

### 回归测试
- TypeScript typecheck：0 errors
- ESLint：0 errors（78 warnings 为历史遗留）
- 前端 vitest：196/196 通过
- 后端 pytest：299/299 通过

---

## [2.6.2] - 2026-07-31

### 核心功能修复与持久化

#### T1 更新功能致命 bug 修复
- **根因**：`electron-updater` 错误放在 `devDependencies`，打包后 asar 内模块缺失，`import('electron-updater')` 静默失败导致更新功能完全失效
- **修复**：将 `electron-updater` 移到 `dependencies`；`update.service.ts` 增加 dev 模式 `forceDevRunConfig` 支持
- **验证**：打包后 app.asar 内包含 electron-updater 模块

#### T2 关于页面软件栈修复
- `handlers.ts` 使用 `app.getAppPath()` 替代 `__dirname/../..` 读取 package.json（修复打包后路径失效）
- 依赖读取合并 `dependencies` + `devDependencies`（修复 typescript/vite 显示 `-`）
- Python 检测增加 `py --version`（Windows py launcher）回退

#### T3 关于页面产品简介
- AboutDialog 新增 `app.description` 段落
- 5 语言 common.json 补充 `app.description` key

#### T4 菜单栏 Logo
- Header.tsx 在 MenuBar 前插入 Logo（macOS 自动避让红绿灯按钮）

#### T5 编辑菜单扩充
- Edit 菜单从 1 项扩充为 9 项：撤销/重做/剪切/复制/粘贴/全选/查找/首选项
- 调用 Clipboard API 与 `document.execCommand` 实现基础功能

#### T6 拓扑数据按项目持久化（核心）
- 新增 `project:saveFile` IPC（白名单：`topology.json` / `rack_layout.json` / `network_config.ini`）
- `design.store` 改为读写项目根目录 `topology.json`；加载失败清空 store（不残留上个项目）
- `rack.store` 改为保存 `rack_layout.json` 到项目根目录；防抖 500ms 自动保存
- `project.store.selectProject` 统一加载入口：异步加载 config + topology + rack layout
- 项目导出 ZIP 白名单纳入 `topology.json` / `rack_layout.json`

### 测试验证
- TypeScript typecheck：0 errors
- 前端 vitest：196/196 通过
- 后端 pytest：299/299 通过
- CI 三平台构建成功（run id: 30614761805）

---

## [2.6.1] - 2026-07-31

### 体验完善与死代码清理

#### R12 全局 ErrorBoundary
- App.tsx 最外层加 ErrorBoundary 包裹整个 render 树
- 各 Modal 独立 ErrorBoundary，避免组件崩溃导致白屏
- Workspace 组件均包裹 WorkspaceErrorBoundary

#### R13 workspace.store 持久化校验
- 加载持久化 tabs 时通过 `project:list` 校验项目存在性，无效 tabs 自动过滤
- `reopenLastClosedClosed` 同步校验
- Tab 状态持久化在 localStorage，可通过「Reset Workspace」按钮重置

#### R14-R15 死代码清理与拆分
- 删除 `sidebar/` 目录 9 个未引用文件
- 删除 `WorkspaceTabBar.tsx` / `WorkspaceWelcome.tsx`
- FileExplorer.tsx 从 1736 行按模块拆分为 6 个 Explorer 子组件
- TopologyTab.tsx 从 855 行按职责拆分为 hooks + 子组件

#### R16 TopologyTab 暗色模式适配
- 使用 MutationObserver 追踪 dark mode 变化
- ECharts 配色方案随主题切换

#### R17-R18 MenuBar i18n 与快捷键单一数据源
- MenuBar 全部菜单名/菜单项/Toast/ShortcutsDialog 走 i18n（5 语言）
- AboutDialog 快捷键链接复用 ShortcutsDialog 单一数据源
- 菜单栏语言随 UI 语言切换同步更新

---

## [2.6.0] - 2026-07-30

### 紧急缺陷修复（用户反馈 8 项 + P0 隐藏 bug）

#### R1 多语言机制修复
- `device` 命名空间 4 语言（en/ja/ko/zh-TW）补齐
- `i18n/index.ts` 启动时从 `ui.store` 读取持久化 language，修复刷新后语言错位
- 关键硬编码中文（SettingsPanel/FileExplorer 右键菜单/WorkspaceView 卡片）i18n 化

#### R3 关于弹窗内容修正
- 软件栈补充 Python 后端版本（11 项）
- 快捷键链接改为打开本地弹窗（非跳转浏览器）
- 版权信息动态年份、Logo 尺寸修正为 96px
- 移除 `t()` 调用的第二参数回退文案

#### R4 向导对话框滚动机制
- CreateProjectWizardModal 模态添加 `overflow-hidden`
- Header/步骤指示器/底部按钮栏加 `shrink-0`
- 800px 屏幕下底部按钮始终可见

#### R5 设备选型 IB/RoCE 联动
- `migration.py` 存储交换机按 `protocol` 分流（IB → NVIDIA Quantum，RoCE → 华为 CE6881）
- `WizardStepDevices.tsx` `STORAGE_DEFAULTS_BY_PROTOCOL` 区分协议
- 协议切换联动纳入 `storage_leaf_switch`
- 设备库补充 IB 存储交换机型号（NVIDIA SN5600/SN4700）

#### R6 设备库数据纠正
- 修正 `h3c_s6850_56hf.json`：从错误的 200G 存储交换机改为 25G 业务交换机（category/port_speed/port_type/description/tags 全字段修正，物理文件移目录）
- 修正 `library_index.json` 中 `huawei_ce6860_48s6cq` 归属（switches_storage → switches_biz）
- `device_library.py` 加载时加一致性校验（category 字段与目录一致）
- 业务交换机默认选型从 10G 改为 25G，与 `biz_port_speed='25G'` 对齐

#### R7 一键渲染修复
- `handleQuickRender` 改为跳转工作台 + toast 提示（方案 A）
- `OutputTab.tsx` 修复 `getFileBinary` 调用参数（从 useProjectStore 取 projectName，路径加 `output/` 前缀）

#### R8 项目浏览器文件树展开
- "全部项目" TreeItem 改为可展开，调 `project:getStructure` 拉取目录树递归渲染
- 新增"输入文件" Section（network_config.ini / project_config.json / project.json）
- 展开状态提升到 `explorer.store`，关闭侧栏再开状态保留

#### R9-R11 P0 隐藏 bug 修复
- preload 暴露 `dialog.openDirectory`（此前完全未实现）
- `getFileBinary` 返回类型统一为 `Promise<string | null>`（base64）
- `device-library:export` 返回类型对齐
- `versions` 类型补 chromium 字段
- `shell:openPath`/`showItemInFolder` 移除 `sanitizePath` 限制（修复导出 ZIP 打开目录被拦截）
- 根目录 5 个重复 Python 文件清理

### 测试验证
- 前端 vitest：196/196 通过
- 后端 pytest：299/299 通过

---

## [2.5.0] - 2026-07-30

### V2.4 系列延续与质量验收

- 完成 V2.4 PRD 验收与质量评估（完成度 65% → 验收通过）
- Logo 设计规范文档化（[docs/v2.5/logo_specification.md](docs/v2.5/logo_specification.md)）
- 启动加载动画优化（粒子背景 + 旋转环 + 进度条）
- 更新机制完善：版本号动态化、首次启动自动检测更新并 toast 通知、Release Notes 折叠展示、下载进度条优化
- 项目复制/重命名/导出导入 ZIP（含安全校验：路径遍历检测、文件白名单、名称冲突自动追加 _导入）
- 批量项目导出（工具栏按钮）
- 模板编辑功能（名称/描述/场景/标签/配置内容，内置模板不可编辑）
- 模板导入导出 ZIP
- 项目搜索筛选 + 收藏置顶（星标按钮，hover 显示）
- 5 种语言 i18n 文案补齐

### 测试验证
- 后端 pytest：267/267 通过
- TypeScript typecheck：无错误

---

## [2.4.6] - 2026-07-30

### 补齐半成品功能（V2.4 PRD 完成度 48% → 65%）

#### Phase J1: Rail-Optimized 架构集成
- NetworkObject 新增 `rail_id`/`rail_role` 字段（NVIDIA SuperPOD 8-Rail 标准）
- rail_topology.py 传递 Rail 字段到 Leaf/Spine
- designer.py 新增 `rail_mode` 配置开关（standard / rail_optimized）
- 新增 `_create_rail_optimized_switches` 和 `_wire_rail_optimized` 方法
- engine.py 输出 `railMode`/`railCount`/`railId`/`railRole` 字段
- 新增 9 个 Rail-Optimized 单元测试 + 集成测试

#### Phase J2: 规则校验前端
- engine.py 新增 `validationIssues` 结构化问题列表输出
- design.store.ts 新增 `ValidationIssue` 类型和 `validationIssues` 状态
- 新建 ValidationPanel.tsx 组件：问题列表 + 严重程度图标 + 修复建议
- DesignTab.tsx 集成 ValidationPanel 替换原布尔值显示
- 5 种语言 i18n 文案更新（zh-CN/en/zh-TW/ja/ko）

#### Phase J3: PDF 报告生成
- 新增 reportlab 依赖
- exporter.py 新增 `export_pdf_report` 函数：6 章节 PDF（概览/架构/功耗/光模块/成本/校验）
- 中文字体自动检测（Windows 微软雅黑 / Linux 文泉驿 / fallback Helvetica）
- engine.py 新增 `pdfReport` 导出类型
- ReportViewPanel.tsx 新增"导出 PDF"按钮
- 新增 3 个 PDF 生成测试

#### Phase J4: 液冷配置面板
- 确认 PUEEstimatePanel 已完整实现液冷配置：
  - 散热方式选择（风冷 / 冷板液冷 / 浸没式液冷）
  - 室外温度、负载率、UPS 效率、自然冷开关

#### Phase J5: cluster_512 模板
- 新增"中型-512"模板：512 H100 GPU + 48 存储 + 24 通算
- 三层 Fat-Tree 400G，4 POD × 128 GPU/POD

### 测试验证
- 后端 pytest：267/267 通过（含新增 12 个测试）
- TypeScript typecheck：无错误
- 累计完成率：65%

## [2.4.5] - 2026-07-29

### 拓扑布局四象限分区 + 服务器组垂直居中
- 重构布局算法：服务器区中心化 + 四象限网络设备分区（OOB 左上 / 业务 右上 / 参数 左下 / 存储 右下）
- 服务器区"概念宽度"自适应容纳网络设备区，网络设备始终在服务器区 X 范围内（需求8：服务器左右无网络设备）
- 左右半区对称分配（以中心为界），确保左半区在中心左侧、右半区在中心右侧
- 服务器节点在概念宽度内居中排列
- 服务器组垂直居中：动态计算 verticalGap，使上方间距 ≈ 下方间距（差值 ≤ 20px）
- topRegionHeight 包含 Y_AGG 顶部边距，消除计算偏差
- layoutBottomRegion 使用动态 verticalGap，确保底部间距与顶部间距相等
- 16:9 比例自适应（容差 ±15%）
- 布局版本号升级到 v4，自动清除旧 localStorage 布局数据
- POD 背景框改为轻量细虚线样式，减少视觉干扰

### 测试覆盖
- 新增 AC10 服务器组垂直居中测试（上方间距 ≈ 下方间距，差值 ≤ 20px）
- 27 个前端布局测试全部通过（含四象限分区 AC2/AC3/AC4/AC6/AC7/AC9/AC10 + E2E H100-100台 217节点）
- 255 个后端 pytest 全部通过
- TypeScript typecheck 无错误

## [2.4.1] - 2026-07-29

### 项目与模板生命周期管理完善
- 新增项目复制功能（右键菜单 → 复制项目，自动追加 _副本 后缀）
- 新增项目重命名功能（右键菜单 → 重命名）
- 新增项目导出/导入 ZIP（含安全校验：路径遍历检测、文件白名单、名称冲突自动追加 _导入）
- 新增批量项目导出（工具栏按钮，选择目录后批量打包）
- 新增模板编辑功能（名称/描述/场景/标签/配置内容，内置模板不可编辑）
- 新增模板导出/导入 ZIP
- 新增项目搜索筛选 + 收藏置顶（星标按钮，hover 显示）
- 新增 5 种语言 i18n 文案（zh-CN/en/ja/ko/zh-TW）
- 优化 TemplateSection 标题栏，hover 显示导入按钮
- 优化 Section 组件支持右侧操作按钮

### 应用图标与启动动画
- 新应用图标：网络拓扑"A"形设计，蓝青色渐变（build/logo.svg）
- 新启动加载动画：粒子背景 + 旋转环 + 进度条 + 三点加载指示器（public/splash.html）
- 启动时主窗口隐藏，加载完成后显示

### 更新机制完善
- 版本号动态化（从 package.json 读取，不再硬编码）
- 启动时自动检测更新并 toast 通知（仅首次提示）
- Release Notes 折叠展示（点击展开/收起）
- 下载进度条 + 错误提示优化

## [2.4.0] - 2026-07-29

### Phase A: 数据资产扩展
- 设备库从 56 款扩展至 109+ 款
- 新增光模块库（30 款，100G-1.6T 全速率覆盖）
- 新增并行文件系统存储节点（BeeGFS、IBM Scale、WekaIO、DDN、VAST）
- 新增国产化 GPU（华为昇腾 910B、海光 K100 AI、寒武纪 MLU590）
- 新增 7 套智算场景模板（SuperPOD-256、NVL72、L20-推理等）

### Phase B: 后端引擎
- Rail-Optimized 拓扑算法（NVIDIA SuperPOD 8-Rail 架构）
- PUE 估算模型（风冷 / 冷板液冷 / 浸没式液冷）
- 收敛比计算（参数网 / 存储网 / 业务网）
- 规则校验引擎（10 条核心规则）
- 光模块智能选型器

### Phase C: 后端导出
- 布线指导表导出（含光模块型号、长度估算、成本）
- BOM 成本估算导出
- 报告数据生成（概览/架构/功耗/光模块/成本/校验）

### Phase D: 前端智能专业能力对接
- PUE 估算结果展示组件（能耗分解、达标判断、参数化重新估算）
- 报告数据可视化展示组件（可折叠，按需加载）
- 新增 cablingGuide / bom 导出选项

### 可视化重构（P0 重点）
- 拓扑渲染引擎从 ECharts 迁移至 react-flow
- 分层 × 分区 × 分组三维防重叠布局
- 节点拖拽、框选、缩放、小地图
- 参数网/存储网/业务网/OOB 功能分区

### 打包与部署
- 修复打包后模板路径（`resourcesPath/template`）
- 安装包内置 11 套场景模板 + 109+ 款设备库
- 首次启动自动创建 3 个示例项目
- 三平台 CI 矩阵（Windows NSIS / macOS DMG x64+arm64 / Linux AppImage+DEB）

---

## [2.3.0] - 2026-07-29

### 设计系统
- 新增 Tailwind 语义色系：`success`、`error`、`warning`、`info`
- 新增暗色模式自定义滚动条样式
- 新增 CSS Design Tokens（`--color-surface`、`--radius-*`、`--font-size-base`）
- 新增 `prefers-reduced-motion` 适配
- 新增共享 UI 组件库（`Button`、`Input`、`Select`、`EmptyState`、`SectionCard`、`FormSection`、`NumberInput`）

### 缺陷修复
- 修复 Toast 无最大条数限制（最多 5 条）
- 向导创建项目失败现在会显示错误 Toast
- 错误边界合并为通用组件，支持重试时强制重新挂载
- 修正 `app:getVersion` 从 `package.json` 动态读取版本号
- 移除 `handlers.ts` 中 `categoryPathMap` 三处重复定义，提取为模块常量
- 移除菜单中无功能的"撤销/重做"项

### 交互优化
- 新增 `Ctrl+S` 快捷键触发保存配置
- 新增 Tab 右键菜单（关闭 / 关闭其他 / 关闭右侧 / 关闭全部）
- 新增首次使用引导（"新建项目 / 打开 Demo"按钮）
- Resizable 面板拖拽手柄始终可见（`bg-gray-200`）
- ActivityBar 选中态增强（`bg-primary-100 dark:bg-primary-900/40`）

---

## [2.2.0] - 2026-07-29

### Bug 修复
- 修复 `rack.store` 中 `initFromTopology` 设备丢失 bug
- 修复 ActivityBar 切换后高亮不更新的问题
- 修复 4 个 P0 设备数据错误（端口速率/类型/品类）

### 功能增强
- MenuBar 全部 24 个菜单项关联功能回调
- ActivityBar 新增设备库入口（Cpu 图标，Ctrl+Shift+L）
- 侧边栏新增 DeviceLibExplorer（7 个设备分类）
- 设备库侧边栏与工作区 Tab 联动过滤

### 拓扑优化
- 节点改为矩形，服务器 `100×26` 横条、交换机 `72-96×32-44`
- 层级重排：业务/OOB 在上 → 服务器居中 → 参数/存储在下
- 服务器按连接的 param_leaf 自动分组，组间 80px 间隔
- 水平间距从 90 增至 120

### 机柜规划
- RackTab 新增左侧待分配设备列表 + 点击 U 位放置交互
- 设备冲突红色高亮、功率不足提示

---

## [2.1.0] - 2026-07-28

### 功能
- 设备库系统：50+ 设备 JSON 配置，按品类分类
- 项目向导：5 步创建（基本信息 → 网络 → 设备 → 机柜 → 确认）
- 机柜规划：42U/49U 可视化，功率监控，Excel 导出
- 拓扑可视化：ECharts 渲染，多网络过滤，布局保存/恢复

---

## [2.0.0] - 2026-07-27

### 初始版本
- Electron + React + Python 架构
- Activity + Tab 双导航系统
- Fat-Tree 拓扑自动计算（二层/三层）
- 连接表导出
- 5 种语言国际化
