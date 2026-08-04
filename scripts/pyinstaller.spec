# -*- mode: python ; coding: utf-8 -*-
"""AutoLink V3.0.0-T0-7: 后端 PyInstaller 打包配置

构建:  pyinstaller scripts/pyinstaller.spec
产出:  dist/backend-dist/
  - engine(.exe)           持久 Agent 入口（stdin/stdout NDJSON）
  - _internal/             运行时依赖（Python + pandas/matplotlib 等）
  - template/              设备库等内置数据（device_library.py 按 __file__ 相对路径定位）

python.service.ts 探测顺序: backend-dist/engine(.exe) → python engine.py
"""
import os

# SPECPATH = scripts/（PyInstaller 注入的 spec 所在目录）
project_root = os.path.dirname(SPECPATH)

backend_dir = os.path.join(project_root, 'backend')
template_dir = os.path.join(project_root, 'template')

a = Analysis(
    [os.path.join(backend_dir, 'engine.py')],
    pathex=[backend_dir],
    binaries=[],
    # 设备库运行时按 __file__ 向上两级找 template/device_library
    # 打包后 __file__=backend-dist/_internal/device_library.py → backend-dist/template/
    datas=[
        (template_dir, 'template'),
    ],
    hiddenimports=[
        # exporter.py 函数内延迟导入的图表库（静态分析可捕获，这里显式声明兜底）
        'matplotlib',
        'matplotlib.backends.backend_agg',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='engine',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,   # 持久 stdio 进程
    disable_windowed_traceback=False,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name='backend-dist',
)
