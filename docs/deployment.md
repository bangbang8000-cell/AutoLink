# AutoLink V2.4 部署指南

## 环境准备

### Windows
```powershell
# 1. 安装 Node.js (>= 22)
winget install OpenJS.NodeJS.LTS

# 2. 安装 Python (>= 3.10)
winget install Python.Python.3.12

# 3. 安装 Python 依赖
pip install openpyxl pandas

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
pip3 install openpyxl pandas

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
pip3 install openpyxl pandas

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
# 输出: release/AutoLink-Setup-2.4.1-win.exe
```

### macOS (DMG)
```bash
npm run dist:mac
# 输出: release/AutoLink-2.4.1-mac-x64.dmg / AutoLink-2.4.1-mac-arm64.dmg
```

### Linux (AppImage + DEB)
```bash
npm run dist:linux
# 输出: release/AutoLink-2.4.1-linux.AppImage / .deb
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
- 默认使用系统 `python` 命令
- 需要 `openpyxl` 和 `pandas` 依赖
- 支持 5 种 action：
  - `design`：生成拓扑（含 PUE/收敛比估算）
  - `validate`：拓扑校验
  - `export`：导出 Excel（连接表/布线表/BOM/设备清单）
  - `estimate`：参数化 PUE/收敛比重新估算
  - `report`：生成完整报告数据

## 打包资源说明

V2.4 安装包内置以下资源（通过 `extraResources` 打包）：

| 资源 | 位置 | 说明 |
|------|------|------|
| 后端引擎 | `resourcesPath/backend` | Python 引擎与算法 |
| 模板 | `resourcesPath/template` | 11 套场景模板 |
| 设备库 | `resourcesPath/template/device_library` | 109+ 款设备 JSON |
| 光模块库 | `resourcesPath/template/device_library/optical_modules` | 30 款光模块 |

首次启动时，应用会在 `userData/workspace` 目录自动创建 3 个示例项目。

## 设计流程

1. 在**项目浏览器**中创建或选择一个项目（或使用内置示例）
2. 进入**拓扑设计**面板，配置网络参数（GPU 数量 / 交换机端口 / 网络速度等）
3. 点击「生成拓扑」调用 Python 引擎计算
4. 查看设计摘要（Leaf/Spine 数量、总交换机数、收敛比）
5. 查看 **PUE 估算**面板（能耗分解、达标判断、参数调整）
6. 切换到**拓扑可视化**查看网络拓扑图（react-flow 渲染，支持拖拽/缩放/小地图）
7. 在**机柜规划**中分配设备上架位置
8. 在**工作台**中选择输出类型并渲染导出：
   - 连接表（Excel）
   - 布线指导表（Excel，含光模块型号与成本）
   - BOM 成本估算（Excel）
   - 设备清单（Excel）
   - 报告视图（内置，可折叠查看）

## CI/CD 自动构建

### 触发 CI 检查
向 `main` 分支推送代码或创建 PR 自动运行：
- TypeScript 类型检查
- ESLint 代码检查
- Vite 前端构建
- 后端 pytest 测试

### 触发 Release 构建
```bash
# 打 tag 并推送
git tag v2.4.1
git push origin v2.4.1
```

GitHub Actions 自动构建三平台安装包并发布到 Releases 页面：
- **Windows**：NSIS `.exe` 安装包
- **macOS**：DMG（x64 + arm64）
- **Linux**：AppImage + DEB

构建矩阵配置见 [.github/workflows/build.yml](../.github/workflows/build.yml)。

## 常见问题

**Q: Python 引擎报错 "No module named 'openpyxl'"**
```bash
pip install openpyxl pandas
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
确保 Python 已添加到系统 PATH 环境变量，或在用户目录创建 `.autolinkrc` 指定路径。

**Q: 安装后看不到设备库或模板**
V2.4 安装包已内置所有资源。若从源码运行，确保 `template/` 目录完整。打包后资源位于 `resourcesPath/` 下，应用会自动定位。

**Q: PUE 估算面板不显示**
PUE 估算在生成拓扑后自动显示。若未显示，检查设计摘要是否生成成功（后端 `estimation` 字段）。

**Q: react-flow 拓扑图加载白屏**
确保依赖已正确安装：`npm install @xyflow/react`。V2.4 使用 react-flow 12.x 替代 ECharts 拓扑渲染。
