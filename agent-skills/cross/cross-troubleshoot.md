---
name: "cross-troubleshoot"
description: "MC-AL 双端的故障排查总入口：工具找不到、调用被拒、结果不对、渲染失败、跨端断裂。当用户报「XX 工具调不了」「权限不对」「结果不对」「连不上」「渲染失败」「以前能用现在不能」时使用。含分层排查树、加载顺序（先查已知缺陷再查新问题）、以及不要误报的边缘情况。"
---

# 双端故障排查

## 一、⚠️ 排查总原则

> **先查「已知缺陷 / 已知设计」清单，再当新问题查。**

双端有大量**已成文的已知问题**（权限表登记缺失、有意不对称、缺陷 P-5/P-6/P-7…）。
一上来就当新 bug 排查，会重复劳动且结论错误。

**排查顺序**：

```
① 是已知设计吗？   → §2「其实是设计」
② 是已知缺陷吗？   → §3「确实是缺陷」
③ 都不是           → §4 分层排查树
```

## 二、⚠️ 第 ① 步：「其实是设计」清单

| 现象 | 真相 |
|---|---|
| INI 与 JSON 算出的数不同 | **有意不对称**（5.3.0 裁定），勿修 |
| 8 卡服务器只算 1 柜 | **正确**（默认 1 柜 1 台） |
| `apply_config_preset` 没被编译态屏蔽 | 锚定匹配，`preset` ≠ `reset`，**正常** |
| MC `designer.py` 对 scale-up GPU 链路按无序设备对去重 | **故意**，勿改 |
| `undo_render` 只能撤一次 | **设计如此** |
| `disable_skill` 没删技能 | **正确**，只控制进上下文 |
| MC `read_file` 编译态可用 | **MC 的设计**（AL 不可用） |
| MC `export_project` 是 auto | 只打包不写项目文件 |
| 技能数量与旧文档不符 | 以**实测**为准 |

## 三、⚠️ 第 ② 步：「确实是缺陷」清单

### 算法 / 口径类

| 缺陷 | 表现 | 影响 |
|---|---|---|
| **二层判据** | `k²/(2p)` 写成 `k/(2p)` → 台数**差一半** | 256/1024/1250 台被误判三层 |
| **P-5** | QM9700 的 breakout 把**参数网也降到 200G** | 参数网速率算错 |
| **P-6** | `storage_ports_per_server` 单值 | 建链/层级/容量三处不同源 |
| **P-7** | 拓扑边不带 breakout | 图与连接表口径不一致 |
| **键名耦合** | 生产者写 `上联需求总数`，消费者读 `需求上联总数` | `.get(...,0)` **恒读 0 → 静默放行** |
| **速率单位** | `'1.6T'` 被读成 `1`（T 未 ×1000） | 四份解析实现都可能有 |

### 数据 / 档案类

| 缺陷 | 表现 |
|---|---|
| **B300 档案** | 描述 2×400G vs 字段 8×800G → 以**字段 8×800G** 为准 |
| **Q3400 描述** | 写 NDR，应为 **XDR** |
| **MC 设备库仅 13 台** | 无 H200 / B300 / Q3400 / Spectrum-X |
| **`switches/storage/`** | 5 台全以太，**无 IB 存储交换机**（AL + MC 都有此缺） |
| **`project_single.py:423`** | MC 无条件产全部角色 j2 |

### 权限登记类（**双端同源**）

| 缺陷 | 清单 |
|---|---|
| **AL 未登记 14 个** | `add_knowledge` / `agent_feedback` / `audit_query` / `list_knowledge` / `search_knowledge` / `task_*`×5 / `template_export` / `template_import` / `project_export` / `project_import` |
| **AL 死条目 3 个** | `get_project_info` / `list_project_files` / `list_templates`（**未注册**） |
| **MC 未登记 10 个** | `run_cli` / `list_dir` / `read_source` / `audit_query` / `agent_feedback` / `task_*`×5 |

**症状**：明明只读的工具却要求确认 / 调用返回「工具不存在」。

## 四、第 ③ 步：分层排查树

### 4.1 工具找不到

```
工具不在列表里
├─ 是源码态工具？(run_cli/read_file/list_dir/read_source)
│   └─ 是 → 检查 --mode 是否 source
├─ 在编译态被屏蔽？(名字命中 delete_/remove_/clear_/purge_/drop_)
│   └─ 是 → 正常，破坏性工具编译态不暴露
├─ 在「死条目」里？
│   └─ AL:get_project_info/list_project_files/list_templates → 未注册，用替代
├─ 域被隐藏？(cli/filesystem 仅源码态)
│   └─ 是 → 切 source 模式
└─ 都不是 → 检查 Server 是否启动成功 / 是不是挂错了 Server
```

> ⚠️ **两端都挂了才容易混**：AL 的 `validate_design` 和 MC 的 `validate_template` 不在同一端。
> → 先确认**这个工具属于 AL 还是 MC**。

### 4.2 调用被拒

```
调用被拒 / 要求确认
├─ 工具是 confirm 档？ → 正常，取得用户同意 + approvalToken
├─ 工具在「权限登记缺失」清单里？
│   └─ 是 → 兜底 confirm 是已知缺陷，说明后正常放行
├─ enforce 模式缺 approvalToken？ → 补上
└─ 越沙箱路径？ → 直接拒绝，无例外
```

### 4.3 结果不对

**按这个顺序查**（数字类）：

```
1. 单位：台 vs 卡（×8 差异）
2. 速率：'1.6T' 应为 1600
3. 口径路径：JSON 做 port_count−uplinks，INI 不做（有意）
4. 层级判据：k²/(2p)，不是 k/(2p)
5. 三态守恒：matched+not_applicable+unmatched == 连接数？
6. 键名耦合：生产者写 A、消费者读 B → 恒读 0
7. 柜数：1 柜 1 台；按卡数折会虚高 8 倍
8. 分光：按网络角色，不是全局开关
9. 每服务器口数：GPU 1 口 vs 存储 4 口不能同值表达
```

### 4.4 渲染失败（MC）

```
渲染失败
├─ UndefinedError
│   └─ 变量名不一致 → read_excel 拿表头 + read_file 拿变量，逐字比对
├─ 缺行 / 空输出
│   └─ 表头与模板变量名不一致（同上）
├─ 语法错误
│   └─ validate_template
├─ validate_* 全过但 dry_run 报错
│   └─ 100% 变量名不一致（不是语法/数据问题）
└─ 渲染成功但内容错
    └─ 口径类缺陷，查 §3 算法/口径表
```

**排查顺序**：`validate_template` → `validate_excel` → `analyze_project` → `read_excel`

> ⚠️ **只跑前两个会漏掉交叉引用问题** —— `analyze_project` 才是查契约层的。

### 4.5 连不上 / 列表为空

```
连不上 / 工具列表为空
├─ 资产根参数写错？
│   ├─ AL 用 --user-data，MC 用 --workspace  ← 最常见
│   └─ 写错会静默用空路径（列表正常但查不到资产）
├─ 工作目录不对？
│   └─ -m 找不到模块
├─ 资产目录不存在？ → 建目录或用正确路径
└─ 权限表全兜底 confirm？ → 见 §3 权限登记类
```

## 五、⚠️ 不要误报的边界情况

| 现象 | 别报成缺陷 |
|---|---|
| 本地 pytest 上千 errors | 是 **GBK 中文子进程**在 capture setup/teardown，**不是测试失败** |
| `test_sample_assets.py` 挂起 | Py3.13 + openpyxl 已知问题，**必须跳过，只信 CI** |
| vitest `Failed to start forks worker` 但 `Test Files passed` | 同上，非失败 |
| 本地门禁四连全绿但 CI 红 | 「四连」**不含 `validate_templates.py`**（INI 路径唯一端到端门禁） |
| golden 基线红了 | **可能基线编码的正是错计数** → 同批重生成 + 逐条归因 |
| 编译态找不到 `*_delete` | 设计如此 |

## 六、报告缺陷的正确姿势

```
【现象】10000 卡被规划成三层，应该是二层
【触发】AL generate_design，1250 台 H200 + QM9700
【根因】topology.py:14 注释把 leaf 台数当 k/2 ⇒ 公式差一半
【来源】4 个调用点单源：topology.py:65 / designer.py:760 / :790 /
        dual_plane_topology.py:87
【影响】④⑤⑥ 三场景被误判；既有 23 套模板未暴露
【建议】只修二层，4 处单源同改
```

**四要素**：现象 / 触发条件 / 根因（含代码位置）/ 影响面。
> 只说「不对」等于没帮上（方法论 M4：判「缺陷不在我方」须同步给出「那它从哪来」）。

## 七、快速索引

| 症状 | 先看 |
|---|---|
| 工具找不到 | §4.1 |
| 调用被拒 | §4.2 |
| 数字不对 | §4.3 |
| 渲染失败 | §4.4 |
| 连不上 | §4.5 |
| 已知缺陷清单 | §3 |
| 已知设计 | §2 |

**相关 skill**：`al-connect` / `mc-connect` / `cross-hub-guide` / `al-report-explain` / `mc-report-explain`
