/* 4.1 F1-1: 启动无闪变主题初始化脚本。
 * 在 React 挂载前同步应用持久化主题(light/dark/system/high-contrast)与品牌色,
 * 避免首帧闪变。判定逻辑须与 src/utils/theme.ts resolveTheme 保持一致。
 * 独立文件而非内联脚本: 生产 CSP script-src 'self' 禁止 inline,该文件为 'self' 合法。
 * 持久化键与 zustand persist(name: 'autolink-ui-state') 一致。
 */
(function () {
  try {
    var raw = localStorage.getItem('autolink-ui-state')
    var state = null
    if (raw) {
      try { state = JSON.parse(raw).state || null } catch (e) { /* ignore */ }
    }
    var theme = (state && state.theme) || 'system'
    var dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
    var root = document.documentElement
    if (dark) root.classList.add('dark')
    if (theme === 'high-contrast') root.classList.add('high-contrast')
    if (state && state.accent) root.setAttribute('data-accent', state.accent)
  } catch (e) { /* ignore */ }
})()
