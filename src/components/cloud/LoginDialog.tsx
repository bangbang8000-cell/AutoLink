import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useCloudStore } from '@/stores/cloud.store'
import { Modal } from '@/components/ui/Modal'
import { useToastStore } from '@/stores/toast.store'
import { auth, type LoginPlatform, type AuthHealth } from '@/api/cloud'
import QRCode from 'qrcode'
import { Loader2 } from 'lucide-react'
import clsx from 'clsx'

interface LoginDialogProps {
  open: boolean
  onClose: () => void
}

const PLATFORM_LABELS: Record<LoginPlatform, string> = {
  feishu: 'cloud:loginDialog.feishu',
  qq: 'cloud:loginDialog.qq',
  wechat: 'cloud:loginDialog.wechat',
}

const PLATFORM_ICONS: Record<LoginPlatform, string> = {
  feishu: '🕊️',
  qq: '🐧',
  wechat: '💬',
}

export function LoginDialog({ open, onClose }: LoginDialogProps) {
  const { t } = useTranslation('cloud')
  const startLogin = useCloudStore((s) => s.startLogin)
  const pollLogin = useCloudStore((s) => s.pollLogin)
  const cancelLogin = useCloudStore((s) => s.cancelLogin)
  const loggedIn = useCloudStore((s) => s.loggedIn)
  const addToast = useToastStore((s) => s.addToast)

  const [stage, setStage] = useState<'choose' | 'loading' | 'scanning' | 'done' | 'error'>('choose')
  const [platform, setPlatform] = useState<LoginPlatform>('feishu')
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [authHealth, setAuthHealth] = useState<AuthHealth | null>(null)
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // 打开时拉取登录方式可用性；关闭时清理轮询
  useEffect(() => {
    if (open) {
      setStage('choose')
      setErrorMsg('')
      setQrDataUrl(null)
      auth.health().then(setAuthHealth).catch(() => setAuthHealth(null))
    }
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current)
    }
  }, [open])

  const isPlatformAvailable = (p: LoginPlatform): boolean => {
    if (!authHealth) return false
    return authHealth[p]?.configured === true
  }

  const beginLogin = async (selectedPlatform: LoginPlatform) => {
    setPlatform(selectedPlatform)
    setStage('loading')
    setErrorMsg('')
    setQrDataUrl(null)

    try {
      const { authUrl } = await startLogin(selectedPlatform)
      const dataUrl = await QRCode.toDataURL(authUrl, {
        width: 256,
        margin: 1,
        color: { dark: '#111827', light: '#ffffff' },
      })
      setQrDataUrl(dataUrl)
      setStage('scanning')

      pollingRef.current = setInterval(async () => {
        try {
          const result = await pollLogin()
          if (result === 'confirmed') {
            setStage('done')
            if (pollingRef.current) clearInterval(pollingRef.current)
            addToast('success', t('loginDialog.loggedIn'))
            setTimeout(() => onClose(), 1000)
          } else if (result === 'expired') {
            setStage('error')
            setErrorMsg(t('loginDialog.expired'))
            if (pollingRef.current) clearInterval(pollingRef.current)
          }
        } catch (err) {
          setStage('error')
          setErrorMsg((err as Error).message)
          if (pollingRef.current) clearInterval(pollingRef.current)
        }
      }, 2000)
    } catch (err) {
      setStage('error')
      setErrorMsg((err as Error).message)
    }
  }

  const handleClose = () => {
    if (pollingRef.current) clearInterval(pollingRef.current)
    cancelLogin()
    onClose()
  }

  const handleRetry = () => {
    if (pollingRef.current) clearInterval(pollingRef.current)
    beginLogin(platform)
  }

  const handleBack = () => {
    if (pollingRef.current) clearInterval(pollingRef.current)
    cancelLogin()
    setStage('choose')
    setQrDataUrl(null)
    setErrorMsg('')
  }

  return (
    <Modal open={open} onClose={handleClose} title={t('loginDialog.title')} width={420}>
      <div className="flex flex-col items-center gap-4 min-w-[300px]">
        {loggedIn && (
          <div className="text-center py-2">
            <div className="text-success-500 text-4xl mb-2">✓</div>
            <p className="text-sm text-gray-600 dark:text-gray-300">{t('loginDialog.loggedIn')}</p>
          </div>
        )}

        {!loggedIn && stage === 'choose' && (
          <div className="flex flex-col gap-3 w-full">
            <p className="text-sm text-gray-500 dark:text-gray-400 text-center">
              {t('loginDialog.selectPlatform')}
            </p>
            {(Object.keys(PLATFORM_LABELS) as LoginPlatform[]).map((p) => {
              const available = isPlatformAvailable(p)
              return (
                <button
                  key={p}
                  onClick={() => available && beginLogin(p)}
                  disabled={!available}
                  className={clsx(
                    'flex items-center gap-3 px-4 py-3 rounded-lg border transition-colors text-left',
                    available
                      ? 'border-gray-200 dark:border-gray-600 hover:border-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/10'
                      : 'border-gray-200 dark:border-gray-700 opacity-40 cursor-not-allowed',
                  )}
                  title={!available ? t('loginDialog.unavailable') : undefined}
                >
                  <span className="text-xl">{PLATFORM_ICONS[p]}</span>
                  <div>
                    <div className="text-sm font-medium text-gray-700 dark:text-gray-200">
                      {t(PLATFORM_LABELS[p])}
                      {!available && (
                        <span className="text-[10px] text-gray-400 ml-1">({t('loginDialog.unavailable')})</span>
                      )}
                    </div>
                    <div className="text-xs text-gray-400 dark:text-gray-500">
                      {available
                        ? t('loginDialog.scanHint', { platform: t(PLATFORM_LABELS[p]) })
                        : t('loginDialog.unavailable')}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        )}

        {!loggedIn && stage === 'loading' && (
          <div className="flex flex-col items-center gap-3 py-4">
            <Loader2 size={28} className="animate-spin text-primary-500" />
            <span className="text-sm text-gray-400">{t('loginDialog.waiting')}</span>
          </div>
        )}

        {!loggedIn && stage === 'scanning' && qrDataUrl && (
          <>
            <img src={qrDataUrl} alt="QR Code" className="rounded-lg border border-gray-200 dark:border-gray-600" />
            <p className="text-sm text-gray-600 dark:text-gray-300 text-center">
              {t('loginDialog.scanHint', { platform: t(PLATFORM_LABELS[platform]) })}
            </p>
            <button
              onClick={handleBack}
              className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
            >
              {t('loginDialog.cancel')}
            </button>
          </>
        )}

        {!loggedIn && stage === 'done' && (
          <div className="text-center">
            <div className="text-success-500 text-4xl mb-2">✓</div>
            <p className="text-sm text-gray-600 dark:text-gray-300">{t('loginDialog.loggedIn')}</p>
          </div>
        )}

        {!loggedIn && stage === 'error' && (
          <div className="text-center">
            <div className="text-error-500 text-sm mb-2 break-all">{errorMsg}</div>
            <div className="flex gap-2 justify-center">
              <button
                onClick={handleBack}
                className="px-4 py-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-md text-sm transition-colors"
              >
                {t('loginDialog.cancel')}
              </button>
              <button
                onClick={handleRetry}
                className="px-4 py-2 bg-primary-600 hover:bg-primary-500 text-white rounded-md text-sm transition-colors"
              >
                {t('loginDialog.regenerate')}
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
