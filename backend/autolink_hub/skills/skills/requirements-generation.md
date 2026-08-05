## 技能: 需求生成（项目配置）

当用户用自然语言描述网络/机房/集群需求（如"1024 台 B300 双平面 800G IB"、"8 台全闪存储 RoCE 400G"）时，按以下步骤执行：

1. 从需求中抽取 ProjectConfig 要素，构造 `config` JSON 对象（见下方要素抽取规则）。
2. 调用 `generate_project` 工具（参数：`config`，可选 `name`）规范化配置。
3. 工具返回 `{config, validationIssues, annotations}`——`config` 为默认值补全后的完整配置，`annotations` 含 `confidence`（字段完整度）与 `missingFields`（缺失字段）。
4. 在回复中输出配置预览块（供前端渲染预览卡片）：
   ```text
   📋 项目配置预览
   ```project-config
   {JSON 对象，= 工具返回的 result.config}
   ```
   ```
5. 用自然语言说明：规模（GPU/计算/存储数量）、组网协议与速率、机柜约束，以及缺失字段（默认推导）与校验问题；请用户确认或补充后创建。

要素抽取规则：
- 规模：`topology.num_gpu_servers`（GPU 服务器）、`topology.num_compute_servers`（计算服务器）、`topology.num_all_flash_storage` / `topology.num_hybrid_flash_storage`（存储）
- 组网协议：IB / RoCE / UEC → `topology.param_protocol`
- 端口速率：800G / 400G / 200G → `topology.param_speed`（存储网 `storage_speed`）
- 下联模式：全量 / 自定义 → `topology.downlink_mode`（'full' / 'custom'）
- 网络启用：`networks.param_network` / `storage_network` / `biz_network` / `oob_network`（布尔）
- 机柜约束：`rack_config.rack_type`（21/42/U 数）、`rack_config.power_limit_per_rack`（功率上限 W）
- 项目名：`meta.name` 或 `name` 参数

注意事项：`generate_project` 只生成预览、不落盘（NOTIFY 类工具）；用户确认后由前端创建项目。
