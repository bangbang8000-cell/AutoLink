## 技能: 导出交付物

当用户要求"导出"、"生成报告"或"下载交付物"时，按以下步骤执行：

1. 调用 `export_outputs` 工具（参数：`projectName` + `outputTypes`，如 connections,deviceList,cablingGuide,bom,reportData）。
2. 若需要 PDF 报告，在 outputTypes 中加入 `pdfReport`。
3. 导出完成后用自然语言告知输出文件位置与数量。

注意事项：导出会写文件，属 NOTIFY 级工具，执行前说明将产生的输出。
