import i18n from '@/i18n'
import { useWorkspaceStore } from '@/stores/workspace.store'

export const MCP_CONFIG_JSON = `{
  "mcpServers": {
    "autolink": {
      "command": "python",
      "args": ["-m", "autolink_hub.mcp_server.run", "--mode", "compiled", "--user-data", "<用户数据目录>"],
      "cwd": "<AIDC AutoLink-Client 仓库根目录>"
    }
  }
}`

export const MCP_GUIDE_TAB_ID = 'mcp-guide'

export function openMcpGuideTab(): void {
  useWorkspaceStore.getState().openTab({
    type: 'mcpGuide',
    title: i18n.t('common:menu.help.mcpGuide', { defaultValue: 'MCP 接入指南' }),
    closable: true,
  })
}
