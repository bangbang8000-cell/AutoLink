import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Shield, UserX, UserPlus } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { useCloudStore } from '@/stores/cloud.store'
import { useToastStore } from '@/stores/toast.store'
import { templates as templateApi } from '@/api/cloud'
import type { TemplatePermission } from '@/api/cloud'

interface Props {
  owner: string
  name: string
  onClose: () => void
}

/**
 * V3.3.2-T15-3: 模板权限管理（所有者 / 可编辑 / 只读）
 * - owner：查看共享名单，可授权/撤销 editor/reader
 * - 协作成员：仅查看自己的角色
 */
export function TemplatePermissionDialog({ owner, name, onClose }: Props) {
  const { t } = useTranslation('cloud')
  const addToast = useToastStore((s) => s.addToast)
  const grantTemplatePermission = useCloudStore((s) => s.grantTemplatePermission)
  const revokeTemplatePermission = useCloudStore((s) => s.revokeTemplatePermission)

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [myRole, setMyRole] = useState<string | null>(null)
  const [shared, setShared] = useState<TemplatePermission[]>([])
  const [newUser, setNewUser] = useState('')
  const [newRole, setNewRole] = useState<'editor' | 'reader'>('reader')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await templateApi.permissions(owner, name)
      setMyRole(res.my_role)
      setShared(res.shared)
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [owner, name, addToast])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 打开对话框时异步加载成员/权限列表并更新加载态
    void load()
  }, [load])

  const isOwner = myRole === 'owner'

  const handleGrant = useCallback(async () => {
    const username = newUser.trim()
    if (!username) return
    setSaving(true)
    try {
      await grantTemplatePermission(owner, name, username, newRole)
      addToast('success', t('permissions.granted', { username, role: t(`permissions.role_${newRole}`) }))
      setNewUser('')
      await load()
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }, [newUser, newRole, owner, name, grantTemplatePermission, addToast, t, load])

  const handleRevoke = useCallback(async (username: string) => {
    setSaving(true)
    try {
      await revokeTemplatePermission(owner, name, username)
      addToast('success', t('permissions.revoked', { username }))
      await load()
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }, [owner, name, revokeTemplatePermission, addToast, t, load])

  return (
    <Modal
      open
      onClose={onClose}
      title={t('permissions.title', { name })}
      width={420}
      closeOnEsc
      bodyClassName="p-4"
    >
      <div className="space-y-3">
        {/* 我的角色 */}
        <div className="flex items-center gap-2">
          <Shield size={14} className="text-primary-500" />
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {t('permissions.myRole')}:
          </span>
          <span
            className={`text-xs px-2 py-0.5 rounded ${
              myRole === 'owner'
                ? 'bg-warning-100 dark:bg-warning-900/30 text-warning-700 dark:text-warning-400'
                : myRole === 'editor'
                  ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
            }`}
          >
            {loading ? '...' : t(`permissions.role_${myRole ?? 'reader'}`)}
          </span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 size={18} className="animate-spin text-gray-400" />
          </div>
        ) : (
          <>
            {/* 共享名单 */}
            {isOwner && (
              <>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {t('permissions.sharedList')}
                </div>
                {shared.length === 0 ? (
                  <div className="text-xs text-gray-400 dark:text-gray-500 px-2 py-3 text-center border border-dashed border-gray-200 dark:border-gray-700 rounded">
                    {t('permissions.empty')}
                  </div>
                ) : (
                  <div className="space-y-1.5 max-h-48 overflow-auto">
                    {shared.map((p) => (
                      <div
                        key={p.username}
                        className="flex items-center justify-between px-2.5 py-1.5 rounded bg-gray-50 dark:bg-app-hover"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-xs text-gray-700 dark:text-gray-200 truncate">{p.username}</span>
                          <span
                            className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${
                              p.role === 'editor'
                                ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
                                : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                            }`}
                          >
                            {t(`permissions.role_${p.role}`)}
                          </span>
                        </div>
                        <button
                          onClick={() => handleRevoke(p.username)}
                          disabled={saving}
                          className="p-1 rounded text-gray-400 hover:text-error-500 hover:bg-error-50 dark:hover:bg-error-900/20 disabled:opacity-40"
                          title={t('permissions.revoke')}
                        >
                          <UserX size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* 授权表单 */}
                <div className="pt-2 border-t border-gray-100 dark:border-edge-subtle">
                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-1.5">
                    {t('permissions.grantTitle')}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <input
                      value={newUser}
                      onChange={(e) => setNewUser(e.target.value)}
                      placeholder={t('permissions.usernamePlaceholder')}
                      disabled={saving}
                      className="flex-1 min-w-0 px-2.5 py-1.5 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-app text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-primary-400"
                    />
                    <select
                      value={newRole}
                      onChange={(e) => setNewRole(e.target.value as 'editor' | 'reader')}
                      disabled={saving}
                      className="px-2 py-1.5 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-app text-gray-700 dark:text-gray-200 focus:outline-none"
                    >
                      <option value="reader">{t('permissions.role_reader')}</option>
                      <option value="editor">{t('permissions.role_editor')}</option>
                    </select>
                    <button
                      onClick={handleGrant}
                      disabled={saving || !newUser.trim()}
                      className="px-2.5 py-1.5 text-xs rounded bg-primary-500 hover:bg-primary-600 text-white disabled:opacity-50 flex items-center gap-1 shrink-0"
                    >
                      {saving ? <Loader2 size={12} className="animate-spin" /> : <UserPlus size={12} />}
                      {t('permissions.grant')}
                    </button>
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}
