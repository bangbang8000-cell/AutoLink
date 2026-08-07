import { useEffect, useState, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useCloudStore } from '@/stores/cloud.store'
import { useUIStore } from '@/stores/ui.store'
import { LogOut, ExternalLink, Edit3, Mail, MapPin, Globe, Check, KeyRound, Copy, Loader2, Eye, EyeOff } from 'lucide-react'
import clsx from 'clsx'

interface UserProfileViewProps {
  onClose: () => void
}

export function UserProfileView({ onClose }: UserProfileViewProps) {
  const { t } = useTranslation('cloud')
  const isDark = useUIStore((s) => s.isDark)
  const username = useCloudStore((s) => s.username)
  const userProfile = useCloudStore((s) => s.userProfile)
  const baseUrl = useCloudStore((s) => s.baseUrl)
  const logout = useCloudStore((s) => s.logout)
  const fetchUserProfile = useCloudStore((s) => s.fetchUserProfile)
  const updateUserProfile = useCloudStore((s) => s.updateUserProfile)

  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState('')
  const [editBio, setEditBio] = useState('')
  const [saving, setSaving] = useState(false)
  const [showCredentials, setShowCredentials] = useState(false)
  const [giteaCreds, setGiteaCreds] = useState<{ username: string; password: string } | null>(null)
  const [credsLoading, setCredsLoading] = useState(false)
  const [credsError, setCredsError] = useState('')
  const [copied, setCopied] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [profileLoading, setProfileLoading] = useState(true)
  const clipboardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setProfileLoading(true)
    fetchUserProfile().finally(() => setProfileLoading(false))
  }, [fetchUserProfile])

  const displayName = userProfile?.full_name || username || 'Unknown'
  const email = userProfile?.email || ''
  const bio = userProfile?.bio || ''
  const location = userProfile?.location || ''
  const website = userProfile?.website || ''
  const bindings = userProfile?.bindings || []

  const handleLogout = () => {
    logout()
    onClose()
  }

  const handleResetGiteaPassword = async () => {
    setCredsLoading(true)
    setCredsError('')
    try {
      const { user } = await import('@/api/cloud')
      const creds = await user.giteaCredentials()
      setGiteaCreds(creds)
      setShowCredentials(true)
    } catch (err) {
      setCredsError((err as Error).message)
    } finally {
      setCredsLoading(false)
    }
  }

  const handleCopyPassword = () => {
    if (giteaCreds?.password) {
      navigator.clipboard.writeText(giteaCreds.password)
      setCopied(true)
      if (clipboardTimerRef.current) clearTimeout(clipboardTimerRef.current)
      clipboardTimerRef.current = setTimeout(() => {
        navigator.clipboard.writeText('').catch(() => {})
        setCopied(false)
      }, 30000)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const handleOpenPlatform = () => {
    window.open(`${baseUrl.replace(/\/+$/, '')}/repo`, '_blank')
  }

  const handleStartEdit = () => {
    setEditName(userProfile?.full_name || '')
    setEditBio(userProfile?.bio || '')
    setEditing(true)
  }

  const handleSaveEdit = async () => {
    setSaving(true)
    try {
      await updateUserProfile({ full_name: editName, bio: editBio })
      setEditing(false)
    } catch { /* 错误由上层提示 */ } finally {
      setSaving(false)
    }
  }

  const panelClass = clsx(
    'absolute right-0 top-full mt-1 w-64 rounded-lg shadow-lg z-50 overflow-hidden',
    isDark ? 'bg-app-surface border border-gray-700' : 'bg-white border border-gray-200',
  )
  const dimText = clsx(isDark ? 'text-gray-400' : 'text-gray-500')

  if (editing) {
    return (
      <div className={panelClass}>
        <div className="px-4 py-3 border-b border-gray-700">
          <div className="text-sm font-medium mb-3">{t('profile.edit')}</div>
          <div className="space-y-2">
            <div>
              <label className={clsx('text-xs', dimText)}>{t('profile.fullName')}</label>
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className={clsx(
                  'w-full mt-1 px-2 py-1 text-sm rounded border',
                  isDark ? 'bg-gray-700 border-gray-600 text-gray-200' : 'bg-white border-gray-300 text-gray-900',
                )}
              />
            </div>
            <div>
              <label className={clsx('text-xs', dimText)}>{t('profile.bio')}</label>
              <textarea
                value={editBio}
                onChange={(e) => setEditBio(e.target.value)}
                rows={2}
                className={clsx(
                  'w-full mt-1 px-2 py-1 text-sm rounded border resize-none',
                  isDark ? 'bg-gray-700 border-gray-600 text-gray-200' : 'bg-white border-gray-300 text-gray-900',
                )}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-3">
            <button
              onClick={() => setEditing(false)}
              className={clsx(
                'px-2 py-1 text-xs rounded',
                isDark ? 'text-gray-400 hover:bg-gray-700' : 'text-gray-600 hover:bg-gray-100',
              )}
            >
              {t('cancel')}
            </button>
            <button
              onClick={handleSaveEdit}
              disabled={saving}
              className={clsx(
                'px-2 py-1 text-xs rounded bg-primary-600 text-white hover:bg-primary-700',
                saving && 'opacity-50',
              )}
            >
              {saving ? t('saving') : t('save')}
            </button>
          </div>
        </div>
        <div className="fixed inset-0 z-[-1]" onClick={onClose} />
      </div>
    )
  }

  return (
    <div className={panelClass}>
      {/* 用户信息头部 */}
      <div className="px-4 py-3 border-b border-gray-700">
        {profileLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 size={18} className="animate-spin text-gray-400" />
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3">
              <div className={clsx(
                'w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium shrink-0',
                'bg-primary-600 text-white',
              )}>
                {displayName?.[0]?.toUpperCase() || '?'}
              </div>
              <div className="min-w-0 flex-1">
                <div className={clsx('text-sm font-medium truncate', isDark ? 'text-gray-200' : 'text-gray-900')}>
                  {displayName}
                </div>
                <div className={clsx('text-xs', isDark ? 'text-gray-500' : 'text-gray-400')}>
                  @{username || 'unknown'}
                </div>
              </div>
            </div>
            {bio && (
              <div className={clsx('text-xs mt-2', dimText)}>
                {bio}
              </div>
            )}
          </>
        )}
      </div>

      {/* 详细信息 */}
      {(email || location || website) && (
        <div className="px-4 py-2 space-y-1.5 border-b border-gray-700">
          {email && (
            <div className={clsx('flex items-center gap-2 text-xs', dimText)}>
              <Mail size={12} />
              <span className="truncate">{email}</span>
            </div>
          )}
          {location && (
            <div className={clsx('flex items-center gap-2 text-xs', dimText)}>
              <MapPin size={12} />
              <span>{location}</span>
            </div>
          )}
          {website && (
            <div className={clsx('flex items-center gap-2 text-xs', dimText)}>
              <Globe size={12} />
              <span className="truncate">{website}</span>
            </div>
          )}
        </div>
      )}

      {/* 绑定账号 */}
      {bindings.length > 0 && (
        <div className="px-4 py-2 border-b border-gray-700">
          <div className={clsx('text-xs font-medium mb-1.5', dimText)}>
            {t('profile.bindings')}
          </div>
          {bindings.map((b) => (
            <div key={b.platform} className="flex items-center gap-2 text-xs mb-1">
              <span className={clsx(isDark ? 'text-gray-300' : 'text-gray-700')}>
                {b.platform === 'feishu' ? 'Feishu' : b.platform === 'qq' ? 'QQ' : b.platform === 'wechat' ? 'WeChat' : b.platform}
              </span>
              <Check size={12} className="text-success-500" />
              {b.nickname && (
                <span className={clsx(isDark ? 'text-gray-500' : 'text-gray-400')}>
                  {b.nickname}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 菜单项 */}
      <div className="py-1">
        <button
          onClick={handleStartEdit}
          className={clsx(
            'w-full flex items-center gap-3 px-4 py-2 text-sm transition-colors',
            isDark ? 'text-gray-300 hover:bg-gray-700' : 'text-gray-700 hover:bg-gray-100',
          )}
        >
          <Edit3 size={14} />
          {t('profile.edit')}
        </button>

        <button
          onClick={handleOpenPlatform}
          className={clsx(
            'w-full flex items-center gap-3 px-4 py-2 text-sm transition-colors',
            isDark ? 'text-gray-300 hover:bg-gray-700' : 'text-gray-700 hover:bg-gray-100',
          )}
        >
          <ExternalLink size={14} />
          {t('profile.openPlatform')}
        </button>

        <button
          onClick={handleResetGiteaPassword}
          disabled={credsLoading}
          className={clsx(
            'w-full flex items-center gap-3 px-4 py-2 text-sm transition-colors',
            isDark ? 'text-gray-300 hover:bg-gray-700' : 'text-gray-700 hover:bg-gray-100',
            credsLoading && 'opacity-50',
          )}
        >
          <KeyRound size={14} />
          {credsLoading ? t('loading') : t('profile.showGiteaCreds')}
        </button>

        {credsError && (
          <div className="px-4 py-1 text-xs text-error-500">{credsError}</div>
        )}

        {showCredentials && giteaCreds && (
          <div className={clsx(
            'mx-4 mb-2 p-2 rounded text-xs space-y-1.5',
            isDark ? 'bg-gray-700' : 'bg-gray-100',
          )}>
            <div className={clsx(isDark ? 'text-gray-300' : 'text-gray-700')}>
              {t('profile.username')}: <span className="font-mono font-medium">{giteaCreds.username}</span>
            </div>
            <div className="flex items-center gap-1">
              <span className={clsx(isDark ? 'text-gray-300' : 'text-gray-700')}>
                {t('profile.password')}:{' '}
                <span className="font-mono font-medium">
                  {showPassword ? giteaCreds.password : '•'.repeat(Math.min(giteaCreds.password.length, 16))}
                </span>
              </span>
              <button
                onClick={() => setShowPassword(!showPassword)}
                className={clsx(
                  'p-0.5 rounded transition-colors',
                  isDark ? 'hover:bg-gray-600 text-gray-400' : 'hover:bg-gray-200 text-gray-500',
                )}
                title={showPassword ? t('profile.hidePassword') : t('profile.showPassword')}
              >
                {showPassword ? <EyeOff size={12} /> : <Eye size={12} />}
              </button>
              <button
                onClick={handleCopyPassword}
                className={clsx(
                  'p-0.5 rounded transition-colors',
                  isDark ? 'hover:bg-gray-600 text-gray-400' : 'hover:bg-gray-200 text-gray-500',
                )}
                title={t('profile.copyPassword')}
              >
                {copied ? <Check size={12} className="text-success-500" /> : <Copy size={12} />}
              </button>
            </div>
            <div className={clsx('text-[10px]', isDark ? 'text-gray-500' : 'text-gray-400')}>
              {t('profile.clipboardHint')}
            </div>
          </div>
        )}

        <div className={clsx('my-1 border-t', isDark ? 'border-gray-700' : 'border-gray-200')} />

        <button
          onClick={handleLogout}
          className={clsx(
            'w-full flex items-center gap-3 px-4 py-2 text-sm transition-colors',
            isDark ? 'text-error-400 hover:bg-gray-700' : 'text-error-600 hover:bg-gray-100',
          )}
        >
          <LogOut size={14} />
          {t('profile.logout')}
        </button>
      </div>

      {/* 点击外部关闭 */}
      <div className="fixed inset-0 z-[-1]" onClick={onClose} />
    </div>
  )
}
