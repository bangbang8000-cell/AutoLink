# AutoLink V2.6 部署指南

## 环境准备

### Windows
```powershell
# 1. 安装 Node.js (>= 22)
winget install OpenJS.NodeJS.LTS

# 2. 安装 Python (>= 3.10)
winget install Python.Python.3.12

# 3. 安装 Python 依赖
pip install openpyxl pandas reportlab

# 4. 克隆仓库
git clone https://github.com/bangbang8000-cell/AutoLink.git
cd AutoLink
npm install
```

### macOS
```bash
# 1. 安装 Node.js
brew install node

# 2. 安装 Python
brew install python@3.12

# 3. 安装 Python 依赖
pip3 install openpyxl pandas reportlab

# 4. 克隆仓库
git clone https://github.com/bangbang8000-cell/AutoLink.git
cd AutoLink
npm install
```

### Linux (Ubuntu/Debian)
```bash
# 1. 安装 Node.js
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# 2. 安装 Python
sudo apt-get install -y python3 python3-pip

# 3. 安装 Python 依赖
pip3 install openpyxl pandas reportlab

# 4. 克隆仓库
git clone https://github.com/bangbang8000-cell/AutoLink.git
cd AutoLink
npm install
```

## 开发模式

```bash
# 启动开发环境 (Vite HMR + Electron)
npm run dev:all

# 仅前端 (浏览器访问 http://localhost:5173)
npm run dev
```

## 构建安装包

### Windows (NSIS 安装包)
```bash
npm run dist:win
# 输出: release/AutoLink-Setup-2.6.3-win.exe
```

### macOS (DMG)
```bash
npm run dist:mac
# 输出: release/AutoLink-2.6.3-mac-x64.dmg / AutoLink-2.6.3-mac-arm64.dmg
```

### Linux (AppImage + DEB)
```bash
npm run dist:linux
# 输出: release/AutoLink-2.6.3-linux.AppImage / .deb
```

## 生产部署

### 方式一：从安装包安装（推荐）

1. 前往 [Releases](https://github.com/bangbang8000-cell/AutoLink/releases) 下载对应平台安装包
2. **Windows**：双击 `.exe` 安装包，按向导安装
3. **macOS**：将 `.app` 拖入 Applications 文件夹
4. **Linux**：`chmod +x AutoLink-*.AppImage && ./AutoLink-*.AppImage` 或 `sudo dpkg -i AutoLink-*.deb`

安装后首次启动会自动创建 3 个示例项目（H100-100台/H100-128台/L20-推理-64），内置 11 套场景模板和 109+ 款设备库。

### 方式二：从源码运行

```bash
npm run build
npm start
```

## Python 引擎说明

AutoLink 通过子进程调用 Python 引擎 (`backend/engine.py`)，通信方式为 JSON stdin/stdout。

- 引擎在 `backend/` 目录下（打包后位于 `resourcesPath/backend`）
- 默认使用系统 `python` 命令，Windows 支持 `py` launcher 回退
- 需要 `openpyxl`、`pandas`、`reportlab` 依赖
- 支持 6 种 action：
  - `design`：生成拓扑（含 PUE/收敛比估算）
  - `validate`：拓扑校验
  - `export`：导出 Excel/PDF（连接表/布线表/BOM/设备清单/PDF 报告）
  - `estimate`：参数化 PUE/收敛比重新估算
  - `report`：生成完整报告数据
  - `pdfReport`：生成 PDF 报告

## 打包资源说明

V2.6 安装包内置以下资源（通过 `extraResources` 打包）：

| 资源 | 位置 | 说明 |
|------|------|------|
| 后端引擎 | `resourcesPath/backend` | Python 引擎与算法 |
| 模板 | `resourcesPath/template` | 11 套场景模板 |
| 设备库 | `resourcesPath/template/device_library` | 109+ 款设备 JSON |
| 光模块库 | `resourcesPath/template/device_library/optical_modules` | 30 款光模块 |
| 用户指南 | `resourcesPath/docs` | Markdown 格式离线用户指南 |
| 品牌资源 | `resourcesPath/branding` | Logo SVG 与设计规范 |

首次启动时，应用会在 `userData/workspace` 目录自动创建 3 个示例项目。

## 自动更新机制

V2.6 修复了 V2.6.0 之前 `electron-updater` 依赖位置错误导致的更新功能失效问题。

- **依赖位置**：`electron-updater` 必须在 `dependencies`（非 `devDependencies`），否则打包后 asar 内模块缺失
- **更新源**：GitHub Releases（配置见 `package.json` 的 `build.publish`）
- **检测时机**：应用启动后自动检测（首次提示，可在设置中关闭）
- **手动检查**：菜单「帮助 → 检查更新」或关于对话框中点击「检查更新」
- **下载安装**：下载进度条显示，下载完成后提示重启安装

## 数据持久化

V2.6.2+ 拓扑与机柜数据按项目持久化：

| 文件 | 位置 | 说明 |
|------|------|------|
| `topology.json` | 项目根目录 | 拓扑节点/边/摘要/校验/估算 |
| `rack_layout.json` | 项目根目录 | 机柜布局（防抖 500ms 自动保存） |
| `network_config.ini` | 项目根目录 | V2.0 格式网络配置（向后兼容） |
| `project_config.json` | 项目根目录 | V2.1+ 格式项目配置（优先读取） |

- 切换项目时自动加载对应拓扑/机柜数据
- 项目导出/导入 ZIP 完整保留拓扑与机柜数据
- 旧项目无 `topology.json` 显示「尚未生成拓扑」

## 设计流程

1. 在**项目浏览器**中创建或选择一个项目（或使用内置示例/从模板创建）
2. 进入**拓扑设计**面板，配置网络参数（GPU 数量 / 交换机端口 / 网络速度等）
3. 点击「生成拓扑」调用 Python 引擎计算
4. 查看设计摘要（Leaf/Spine 数量、总交换机数、收敛比）
5. 查看 **PUE 估算**面板（能耗分解、达标判断、参数调整）
6. 切换到**拓扑可视化**查看网络拓扑图（react-flow 渲染，支持拖拽/缩放/小地图）
7. 在**机柜规划**中分配设备上架位置（自动保存到 `rack_layout.json`）
8. 在**工作台**中选择输出类型并渲染导出：
   - 连接表（Excel）
   - 布线指导表（Excel，含光模块型号与成本）
   - BOM 成本估算（Excel）
   - 设备清单（Excel）
   - PDF 报告（6 章节）
   - 报告视图（内置，可折叠查看）

## CI/CD 自动构建

### 触发 CI 检查
向 `main` 分支推送代码或创建 PR 自动运行：
- TypeScript 类型检查
- ESLint 代码检查
- Vite 前端构建
- 前端 vitest 测试（196 cases）
- 后端 pytest 测试（299 cases）

### 触发 Release 构建
```bash
# 更新 package.json version
# 提交代码（含 [skip ci] 避免触发 Actions 编译）
git commit -m "release: v2.6.3 [skip ci]"
# 打 tag 并推送
git tag v2.6.3
git push origin main v2.6.3
# 手动触发 CI 构建
gh workflow run build.yml --ref v2.6.3
```

GitHub Actions 自动构建三平台安装包并发布到 Releases 页面：
- **Windows**：NSIS `.exe` 安装包
- **macOS**：DMG（x64 + arm64）
- **Linux**：AppImage + DEB

构建矩阵配置见 [.github/workflows/build.yml](../.github/workflows/build.yml)。

## 常见问题

**Q: Python 引擎报错 "No module named 'openpyxl'"**
```bash
pip install openpyxl pandas reportlab
```

**Q: Electron 窗口无法启动**
确保 Node.js >= 22, Electron 28 需要对应版本的 Node。

**Q: npm install 失败**
```bash
# 清除缓存重试
rm -rf node_modules package-lock.json
npm install
```

**Q: 如何在 Windows 上设置 Python 路径**
确保 Python 已添加到系统 PATH 环境变量，应用会依次尝试 `python` / `python3` / `py` 命令。

**Q: 安装后看不到设备库或模板**
V2.6 安装包已内置所有资源。若从源码运行，确保 `template/` 目录完整。打包后资源位于 `resourcesPath/` 下，应用会自动定位。

**Q: PUE 估算面板不显示**
PUE 估算在生成拓扑后自动显示。若未显示，检查设计摘要是否生成成功（后端 `estimation` 字段）。

**Q: react-flow 拓扑图加载白屏**
确保依赖已正确安装：`npm install @xyflow/react`。V2.6 使用 react-flow 12.x 替代 ECharts 拓扑渲染。

**Q: 更新功能提示"已是最新版本"但实际有新版本**
V2.6.2 已修复此问题（`electron-updater` 依赖位置错误）。请确保使用 V2.6.2 及以上版本。旧版本需手动下载最新安装包一次。

**Q: 切换项目后拓扑/机柜数据还是上一个项目的**
V2.6.2+ 已修复此问题，拓扑和机柜数据按项目持久化到 `topology.json` / `rack_layout.json`。请确保使用 V2.6.2 及以上版本。

**Q: 工作区 Tab 状态丢失**
Tab 状态持久化在 localStorage，可通过设置面板「Reset Workspace」按钮重置。V2.6.1+ 加载时会校验项目存在性，无效 tabs 自动过滤。
