'use client'

import { useIntl } from 'react-intl'
import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { Camera, X, Trash2 } from 'lucide-react'
import { IonButton, IonSpinner } from '@ionic/react'
import { ModalShell } from '@/components/ui/modal-shell'
import { AuthField } from '@/components/auth'
import { PhoneInput } from '@/components/PhoneInput'
import { LottiePlayerDynamic as LottiePlayer } from '@/components/animations'
import { useAuth } from '@/contexts/auth-context'
import { useApiMessage } from '@/hooks/useApiMessage'
import { ApiError } from '@/lib/api-client'
import { authClient } from '@/lib/auth-client'
import { fileToBase64, MAX_UPLOAD_SIZE } from '@/lib/storage-client'
import { getUserInitials } from '@kasero/shared/auth'

export interface EditProfileModalProps {
  isOpen: boolean
  onClose: () => void
  onExitComplete?: () => void
}

export function EditProfileModal({ isOpen, onClose, onExitComplete }: EditProfileModalProps) {
  const intl = useIntl()
  const { user, refreshUser } = useAuth()
  const translateApiMessage = useApiMessage()

  const [name, setName] = useState(user?.name ?? '')
  const [avatar, setAvatar] = useState<string | null>(user?.avatar ?? null)
  const [phone, setPhone] = useState<string | null>(user?.phoneNumber ?? null)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Step state: 'form' → 'success'
  const [step, setStep] = useState<'form' | 'success'>('form')

  // Sync local state when the user loads or after refreshUser()
  useEffect(() => {
    if (user) {
      setName(user.name)
      setAvatar(user.avatar ?? null)
      setPhone(user.phoneNumber ?? null)
    }
  }, [user])

  // Reset to form step after the dismissal animation plays so the form
  // doesn't flash back into view while the modal is still sliding away.
  useEffect(() => {
    if (!isOpen) {
      const t = setTimeout(() => {
        setStep('form')
        setError('')
        setIsSaving(false)
        onExitComplete?.()
      }, 250)
      return () => clearTimeout(t)
    }
  }, [isOpen, onExitComplete])

  const hasChanges =
    user !== null &&
    (name.trim() !== user.name ||
      (avatar ?? null) !== (user.avatar ?? null) ||
      (phone ?? null) !== (user.phoneNumber ?? null))
  const isValid = name.trim().length >= 2

  const handleFilePick = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      if (!file) return
      event.target.value = ''

      if (!/^image\/(png|jpe?g|webp|gif)$/i.test(file.type)) {
        setError(intl.formatMessage({ id: 'account.profile_avatar_invalid_type' }))
        return
      }
      if (file.size > MAX_UPLOAD_SIZE) {
        setError(intl.formatMessage({ id: 'account.profile_avatar_too_large' }))
        return
      }
      try {
        const dataUrl = await fileToBase64(file)
        setAvatar(dataUrl)
        setError('')
      } catch (err) {
        console.error('Avatar read error:', err)
        setError(intl.formatMessage({ id: 'common.error' }))
      }
    },
    [intl],
  )

  const handleRemoveAvatar = () => {
    setAvatar(null)
    setError('')
  }

  const handleSave = useCallback(async () => {
    if (!isValid || !hasChanges || isSaving) return
    setIsSaving(true)
    setError('')
    try {
      // better-auth's update-user endpoint maps `image` → `avatar` via the
      // server-side `user.fields` config and handles the `phoneNumber`
      // additionalField directly. Passing an empty string clears the stored
      // value on the server (the schema treats it as a nullable field).
      const result = await authClient.updateUser({
        name: name.trim(),
        image: avatar ?? '',
        phoneNumber: phone ?? '',
      })
      if (result.error) {
        setError(
          result.error.message ?? intl.formatMessage({ id: 'common.error' }),
        )
        return
      }
      await refreshUser()
      setStep('success')
    } catch (err) {
      if (err instanceof ApiError) {
        setError(
          err.envelope
            ? translateApiMessage(err.envelope)
            : intl.formatMessage({ id: 'common.error' }),
        )
        return
      }
      console.error('Profile save error:', err)
      setError(intl.formatMessage({ id: 'common.error' }))
    } finally {
      setIsSaving(false)
    }
  }, [
    isValid,
    hasChanges,
    isSaving,
    name,
    avatar,
    phone,
    refreshUser,
    translateApiMessage,
    intl,
  ])

  const successHeading = useMemo(() => {
    const full = intl.formatMessage({ id: 'account.profile_saved_heading_v2' })
    const emphasis = intl.formatMessage({ id: 'account.profile_saved_heading_v2_emphasis' })
    const idx = full.indexOf(emphasis)
    if (!emphasis || idx === -1) return full
    return (
      <>
        {full.slice(0, idx)}
        <em>{emphasis}</em>
        {full.slice(idx + emphasis.length)}
      </>
    )
  }, [intl])

  const titleNode = useMemo(() => {
    const full = intl.formatMessage({ id: 'account.profile_hero_title' })
    const emphasis = intl.formatMessage({ id: 'account.profile_hero_title_emphasis' })
    const idx = full.indexOf(emphasis)
    if (!emphasis || idx === -1) return full
    return (
      <>
        {full.slice(0, idx)}
        <em>{emphasis}</em>
        {full.slice(idx + emphasis.length)}
      </>
    )
  }, [intl])

  const saveButton = (
    <IonButton
      expand="block"
      onClick={handleSave}
      disabled={!isValid || !hasChanges || isSaving}
      className="flex-1"
      data-haptic
    >
      {isSaving ? <IonSpinner name="crescent" /> : intl.formatMessage({ id: 'common.save' })}
    </IonButton>
  )

  const doneButton = (
    <IonButton expand="block" onClick={onClose} className="flex-1">
      {intl.formatMessage({ id: 'common.done' })}
    </IonButton>
  )

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      title={step === 'form' ? intl.formatMessage({ id: 'account.profile_modal_title' }) : undefined}
      chromeless={step === 'success'}
      footer={step === 'form' ? saveButton : doneButton}
      noSwipeDismiss
    >
      {step === 'form' && (
        <>
          {error && <div className="modal-error">{error}</div>}

          <header className="modal-hero">
            <div className="modal-hero__eyebrow">
              {intl.formatMessage({ id: 'account.profile_hero_eyebrow' })}
            </div>
            <h1 className="modal-hero__title">{titleNode}</h1>
            <p className="modal-hero__subtitle">
              {intl.formatMessage({ id: 'account.profile_hero_subtitle' })}
            </p>
          </header>

          {/* Avatar seal + small mono actions */}
          <div className="edit-profile__seal-block">
            <div className="edit-profile__seal">
              {avatar ? (
                <>
                  <img src={avatar} alt="" />
                  <button
                    type="button"
                    onClick={handleRemoveAvatar}
                    className="edit-profile__seal-clear"
                    aria-label={intl.formatMessage({ id: 'account.profile_avatar_remove' })}
                  >
                    <X />
                  </button>
                </>
              ) : (
                <span className="edit-profile__seal-initials">
                  {getUserInitials(name || user?.name || '')}
                </span>
              )}
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={handleFilePick}
            />

            <div className="edit-profile__actions">
              <button
                type="button"
                className="edit-profile__action"
                onClick={() => fileInputRef.current?.click()}
              >
                <Camera />
                {avatar
                  ? intl.formatMessage({ id: 'account.profile_avatar_change' })
                  : intl.formatMessage({ id: 'account.profile_avatar_upload' })}
              </button>
              {avatar && (
                <button
                  type="button"
                  className="edit-profile__action"
                  onClick={handleRemoveAvatar}
                >
                  <Trash2 />
                  {intl.formatMessage({ id: 'account.profile_avatar_remove' })}
                </button>
              )}
            </div>

            <p className="edit-profile__hint">
              {intl.formatMessage({ id: 'account.profile_avatar_hint' })}
            </p>
          </div>

          <div className="edit-profile__form">
            <AuthField
              label={intl.formatMessage({ id: 'account.profile_name_label' })}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              required
              minLength={2}
            />

            <div className="edit-profile__sealed">
              <span className="edit-profile__sealed-label">
                {intl.formatMessage({ id: 'account.profile_email_label' })}
              </span>
              <span className="edit-profile__sealed-value">
                {user?.email ?? ''}
              </span>
              <span className="edit-profile__sealed-tag">
                {intl.formatMessage({ id: 'account.profile_email_locked_tag' })}
              </span>
            </div>

            <PhoneInput value={phone} onChange={setPhone} />
          </div>
        </>
      )}

      {step === 'success' && (
        <div className="edit-profile__success">
          <div style={{ width: 160, height: 160 }}>
            <LottiePlayer
              src="/animations/success.json"
              loop={false}
              autoplay={true}
              delay={300}
              style={{ width: 160, height: 160 }}
            />
          </div>
          <p className="edit-profile__success-heading">{successHeading}</p>
          <p className="edit-profile__success-desc">
            {intl.formatMessage({ id: 'account.profile_saved_description' })}
          </p>
        </div>
      )}
    </ModalShell>
  )
}
