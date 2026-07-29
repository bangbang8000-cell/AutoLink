# PRD：项目与模板生命周期管理完善（V2.4.1）

## 1. 背景与目标

### 1.1 背景
AutoLink V2.4 已实现基础的项目/模板管理（新建、删除、另存为模板、清空输出），但在实际使用中仍存在以下痛点：

- **项目复制需手动重建**：相似配置的项目无法快速克隆
- **项目重命名不支持**：创建后名称固定，无法修正命名错误
- **项目无法打包分享**：交付方案需手动打包 output 目录
- **模板不可编辑**：修改模板需删除后重建
- **模板无法跨环境共享**：团队协作时模板需手动复制文件
- **项目列表无搜索筛选**：项目多时难以快速定位
- **批量操作能力不足**：仅支持多选删除，无批量导出

### 1.2 目标
完善项目与模板的完整生命周期管理，覆盖创建、复制、重命名、导出、导入、搜索、批量操作等场景，提升工程师的日常使用效率。

### 1.3 范围
- **本次范围**：项目复制、重命名、导出/导入 ZIP、模板编辑、搜索筛选、批量操作
- **本次不做**：云端项目同步（V3.0）、项目版本历史（V3.0）、多用户协作（V3.0）

---

## 2. 现状评估

### 2.1 已实现能力

| 功能 | 后端 IPC | 前端 UI | 状态 |
|------|---------|---------|------|
| 项目列表 | `project:list` | FileExplorer | ✅ |
| 空项目创建 | `project:create` | CreateProjectModal | ✅ |
| 从模板创建项目 | `project:create` | CreateProjectModal | ✅ |
| 向导创建项目 | `project:createWithConfig` | CreateProjectWizardModal | ✅ |
| 项目删除 | `project:delete` | ConfirmDeleteDialog | ✅ |
| 项目配置读写 | `project:getConfigFile` / `saveConfigFile` | DesignTab | ✅ |
| 项目结构查看 | `project:getStructure` | FileExplorer | ✅ |
| 输出文件查看 | `project:listOutputFiles` / `listOutputBatches` | FileExplorer | ✅ |
| 输出文件删除 | `project:deleteOutputFile` / `deleteOutputBatch` | FileExplorer | ✅ |
| 清空输出 | `project:clearOutput` | ConfirmDeleteDialog | ✅ |
| 模板列表 | `template:list` | FileExplorer | ✅ |
| 项目另存为模板 | `template:create` | FileExplorer | ✅ |
| 模板删除 | `template:delete` | ConfirmDeleteDialog | ✅ |
| 模板结构查看 | `template:getStructure` | FileExplorer | ✅ |

### 2.2 缺失能力

| 功能 | 优先级 | 说明 |
|------|--------|------|
| 项目复制 | P0 | 基于现有项目克隆，含配置和输出 |
| 项目重命名 | P0 | 修改项目名称，保留所有数据 |
| 项目导出 ZIP | P0 | 打包项目配置+输出为 ZIP，便于分享 |
| 项目导入 ZIP | P0 | 从 ZIP 恢复项目 |
| 模板编辑 | P1 | 修改已有模板的配置和元信息 |
| 模板导出/导入 | P1 | 模板跨环境共享 |
| 项目搜索筛选 | P1 | 按名称、场景、标签筛选 |
| 批量项目导出 | P2 | 多选项目批量导出 ZIP |
| 项目收藏置顶 | P2 | 已有 favoriteProjects 状态，需 UI 暴露 |

---

## 3. 功能需求

### 3.1 项目复制（P0）

**用户故事**：作为网络工程师，我希望基于现有项目快速克隆一个副本，以便在相似配置上做调整而不用从头创建。

**功能描述**：
- 在 FileExplorer 项目右键菜单中增加"复制项目"选项
- 复制时弹出输入框，默认名称为 `{原项目名}_副本`
- 复制范围：`network_config.ini`、`project_config.json`、`project.json`、`output/` 目录
- 复制后自动选中新项目并刷新列表

**IPC 接口**：
```
project:duplicate(sourceName: string, targetName: string) => Promise<void>
```

**实现要点**：
- 后端：递归复制项目目录到新目录
- 前端：弹窗输入新名称，调用 IPC，刷新列表，toast 提示成功

### 3.2 项目重命名（P0）

**用户故事**：作为网络工程师，我希望能重命名项目，以修正创建时的命名错误。

**功能描述**：
- 在项目右键菜单中增加"重命名"选项
- 弹出输入框，预填当前名称
- 重命名后自动刷新列表，保持选中状态
- 名称冲突时提示错误

**IPC 接口**：
```
project:rename(oldName: string, newName: string) => Promise<void>
```

**实现要点**：
- 后端：`fs.rename(oldDir, newDir)`
- 前端：弹窗输入新名称，调用 IPC，刷新列表
- 边界：新名称合法性校验（sanitizeName）、重名检测

### 3.3 项目导出 ZIP（P0）

**用户故事**：作为售前工程师，我希望能将完整方案打包成 ZIP 文件，发送给客户或同事评审。

**功能描述**：
- 在项目右键菜单中增加"导出为 ZIP"选项
- 弹出系统保存对话框，默认文件名 `{项目名}_AutoLink_{日期}.zip`
- ZIP 内容：`network_config.ini`、`project_config.json`、`project.json`、`output/` 全部文件
- 导出完成后 toast 提示，可选"打开所在文件夹"

**IPC 接口**：
```
project:exportZip(projectName: string, zipPath: string) => Promise<void>
```

**实现要点**：
- 后端：使用 Node.js 内置 `zlib` 或引入 `archiver` 库打包
- 前端：通过 `dialog.showSaveDialog` 选择保存路径
- 性能：大文件（100MB+）导出时显示进度

### 3.4 项目导入 ZIP（P0）

**用户故事**：作为网络工程师，我希望能从同事分享的 ZIP 文件导入项目，快速恢复方案。

**功能描述**：
- 在项目列表顶部增加"导入项目"按钮
- 弹出系统打开对话框，选择 `.zip` 文件
- 解压后自动创建项目，名称为 ZIP 文件名（去除后缀）
- 若项目名已存在，追加 `_导入` 后缀
- 导入后自动选中新项目并刷新列表

**IPC 接口**：
```
project:importZip(zipPath: string, projectName?: string) => Promise<{projectName: string}>
```

**实现要点**：
- 后端：使用 `adm-zip` 或 `extract-zip` 解压到 workspace
- 安全校验：验证 ZIP 内容是否为合法 AutoLink 项目（含 network_config.ini 或 project_config.json）
- 边界：超时处理、磁盘空间检查

### 3.5 模板编辑（P1）

**用户故事**：作为网络工程师，我希望能直接修改已有模板的配置，而不用删除后重建。

**功能描述**：
- 在模板右键菜单中增加"编辑模板"选项
- 打开模板编辑弹窗，可修改：名称、描述、场景、标签、配置内容
- 保存后刷新模板列表
- 内置模板不可编辑（只读），仅用户创建的模板可编辑

**IPC 接口**：
```
template:update(templateName: string, updates: { name?: string; description?: string; scenario?: string; tags?: string[]; configContent?: string }) => Promise<void>
```

**实现要点**：
- 后端：读取模板 `template.json` 和 `network_config.ini`，合并更新
- 前端：复用 CreateProjectWizardModal 的简化版，仅编辑元信息+配置
- 边界：内置模板标记 `isBuiltin`，UI 禁用编辑按钮

### 3.6 模板导出/导入（P1）

**用户故事**：作为团队负责人，我希望能将团队沉淀的模板导出分享，新成员可以导入使用。

**功能描述**：
- 模板右键菜单增加"导出模板"和"导入模板"
- 导出：将模板目录打包为 `{模板名}.autolink-template.zip`
- 导入：从 `.autolink-template.zip` 恢复模板
- 导入时若模板名冲突，追加 `_导入` 后缀

**IPC 接口**：
```
template:exportZip(templateName: string, zipPath: string) => Promise<void>
template:importZip(zipPath: string, templateName?: string) => Promise<{templateName: string}>
```

### 3.7 项目搜索筛选（P1）

**用户故事**：作为网络工程师，当项目数量较多时，我希望能快速搜索定位。

**功能描述**：
- 项目列表顶部增加搜索框
- 支持按项目名称模糊匹配
- 搜索结果实时过滤，清空搜索框恢复全部列表
- 支持按场景标签筛选（下拉选择标签）

**实现要点**：
- 纯前端实现，基于 `projects` 状态过滤
- 搜索框使用 `lucide-react` 的 `Search` 图标
- 防抖 300ms

### 3.8 批量项目导出（P2）

**用户故事**：作为团队负责人，我希望能批量导出多个项目用于交付。

**功能描述**：
- 在多选模式下，底部操作栏增加"批量导出"按钮
- 弹出选择目录对话框
- 每个项目导出为独立 ZIP，命名为 `{项目名}_AutoLink_{日期}.zip`
- 导出完成后 toast 显示成功数量

**IPC 接口**：
```
project:batchExportZip(projectNames: string[], targetDir: string) => Promise<{success: string[], failed: {name: string, error: string}[]}>
```

### 3.9 项目收藏置顶（P2）

**用户故事**：作为网络工程师，我希望能将常用项目置顶，快速访问。

**功能描述**：
- 项目项增加星标按钮（已存储 favoriteProjects，仅需 UI）
- 已收藏项目在列表中置顶显示
- 收藏区与普通区分隔显示

**实现要点**：
- `project.store.ts` 已有 `favoriteProjects` 和 `toggleFavorite`
- 前端 FileExplorer 渲染时按收藏状态排序
- 星标图标使用 `lucide-react` 的 `Star` / `StarOff`

---

## 4. 非功能需求

### 4.1 性能
- 项目复制/导出在 100MB 项目内应在 3s 内完成
- 搜索筛选在 100+ 项目时应在 100ms 内响应
- ZIP 操作不阻塞 UI，显示进度

### 4.2 安全
- 导入 ZIP 时校验文件路径，防止路径遍历攻击（`..` 检测）
- 导入 ZIP 文件大小限制 500MB
- 项目/模板名称仍需 sanitizeName 校验

### 4.3 兼容性
- 导出的 ZIP 格式向后兼容，V2.4 导出的项目可在未来版本导入
- 导入时自动识别配置格式（INI 或 JSON）

### 4.4 国际化
- 所有新增文案支持 5 种语言（zh-CN / en / ja / ko / zh-TW）
- 错误提示信息完整翻译

---

## 5. 数据模型

### 5.1 项目元信息（project.json）
```json
{
  "name": "H100-100台方案",
  "description": "100台H100 GPU训练集群",
  "createdAt": "2026-07-29T10:00:00Z",
  "updatedAt": "2026-07-29T10:00:00Z",
  "version": 1,
  "demo": false,
  "scenario": "H100训练",
  "tags": ["H100", "100台"]
}
```

### 5.2 模板元信息（template.json）
```json
{
  "name": "H100-128台方案",
  "description": "128台H100 GPU（4组Rail-Optimized）",
  "scenario": "Rail-Optimized",
  "tags": ["H100", "128台", "Rail"],
  "createdAt": "2026-07-26T00:00:00Z",
  "updatedAt": "2026-07-29T10:00:00Z",
  "isBuiltin": false,
  "sourceProject": "原项目名"
}
```

### 5.3 ZIP 包结构
```
{项目名}_AutoLink_20260729.zip
├── project.json              # 项目元信息
├── network_config.ini        # INI 配置
├── project_config.json       # JSON 配置（如有）
└── output/                   # 输出文件目录
    ├── AI智算网络_*.xlsx
    ├── 设备清单_*.xlsx
    └── ...
```

---

## 6. UI/UX 设计

### 6.1 FileExplorer 右键菜单增强
```
项目项右键菜单：
├── 打开                    (已有)
├── ─────────────────
├── 复制项目...             (新增 P0)
├── 重命名...               (新增 P0)
├── ─────────────────
├── 导出为 ZIP...           (新增 P0)
├── 另存为模板...           (已有)
├── ─────────────────
├── 清空输出                (已有)
└── 删除                    (已有)

模板项右键菜单：
├── 基于此模板创建项目      (已有)
├── ─────────────────
├── 编辑模板...             (新增 P1)
├── ─────────────────
├── 导出模板...             (新增 P1)
└── 删除                    (已有)
```

### 6.2 项目列表顶部工具栏
```
┌─────────────────────────────────────────┐
│ [+ 新建] [↓ 导入] [🔍 搜索框____] [⋮]    │
└─────────────────────────────────────────┘
```

### 6.3 批量操作底部栏（多选模式）
```
┌─────────────────────────────────────────┐
│ 已选 3 个项目                            │
│ [批量导出] [批量删除] [取消选择]          │
└─────────────────────────────────────────┘
```

### 6.4 复制/重命名弹窗
- 简洁的单输入框弹窗
- 预填默认值
- 名称校验提示
- 取消/确认按钮

---

## 7. 验收标准

### 7.1 项目复制
- [ ] 右键菜单显示"复制项目"
- [ ] 弹窗预填 `{原名}_副本`
- [ ] 复制后新项目配置和输出完整
- [ ] 名称冲突时提示错误
- [ ] 复制后自动选中新项目

### 7.2 项目重命名
- [ ] 右键菜单显示"重命名"
- [ ] 弹窗预填当前名称
- [ ] 重命名后列表刷新且保持选中
- [ ] 名称冲突时提示错误

### 7.3 项目导出 ZIP
- [ ] 右键菜单显示"导出为 ZIP"
- [ ] 弹出系统保存对话框
- [ ] ZIP 包含配置文件和 output 目录
- [ ] 导出后 toast 提示成功

### 7.4 项目导入 ZIP
- [ ] 顶部工具栏显示"导入"按钮
- [ ] 弹出系统打开对话框
- [ ] 导入后自动创建项目并选中
- [ ] 名称冲突时自动追加 `_导入`
- [ ] 非法 ZIP 提示错误

### 7.5 模板编辑
- [ ] 用户模板右键菜单显示"编辑模板"
- [ ] 内置模板不显示编辑选项
- [ ] 编辑后模板列表刷新

### 7.6 模板导出/导入
- [ ] 模板右键菜单显示"导出模板"
- [ ] 顶部工具栏"导入"支持模板 ZIP
- [ ] 导入冲突时自动追加后缀

### 7.7 项目搜索筛选
- [ ] 搜索框实时过滤项目列表
- [ ] 清空搜索框恢复全部列表
- [ ] 搜索不区分大小写

### 7.8 批量项目导出
- [ ] 多选模式下底部显示"批量导出"按钮
- [ ] 弹出选择目录对话框
- [ ] 每个项目导出为独立 ZIP
- [ ] 完成后显示成功/失败数量

### 7.9 项目收藏置顶
- [ ] 项目项显示星标按钮
- [ ] 点击星标切换收藏状态
- [ ] 收藏项目在列表中置顶

---

## 8. 风险评估

| 风险 | 等级 | 缓解方案 |
|------|------|---------|
| ZIP 解压安全风险 | 中 | 校验文件路径，禁止 `..` 和绝对路径 |
| 大文件导出阻塞 UI | 中 | 异步操作 + 进度提示 |
| 重命名后引用失效 | 低 | 项目名称为目录名，不涉及外部引用 |
| 内置模板误编辑 | 低 | UI 标记 isBuiltin 禁用编辑 |
| 导入非法 ZIP | 中 | 校验 ZIP 内容是否包含合法配置文件 |

---

## 9. 依赖项

### 9.1 新增 npm 依赖
- `archiver`：ZIP 打包（项目导出/模板导出）
- `adm-zip` 或 `extract-zip`：ZIP 解压（项目导入/模板导入）

### 9.2 现有依赖复用
- `zustand`：状态管理（project.store.ts 扩展）
- `lucide-react`：图标（Copy, Edit, Download, Upload, Search, Star）
- `react-i18next`：国际化
