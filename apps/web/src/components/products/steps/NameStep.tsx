'use client'

import { useIntl } from 'react-intl'
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonFooter,
  IonButtons,
  IonButton,
  IonIcon,
} from '@ionic/react'
import { close, chevronBack } from 'ionicons/icons'
import Image from '@/lib/Image'
import { ImagePlus } from 'lucide-react'
import { PRESET_ICONS, isPresetIcon, getPresetIcon } from '@/lib/preset-icons'
import { useProductForm } from '@/contexts/product-form-context'
import { useProductNav, useProductOnClose } from './ProductNavContext'
import { WizardProgress } from './WizardProgress'

interface NameStepProps {
  /**
   * `forward` (manual wizard chain): CTA pushes the next step (Price).
   * `edit` (jumped here from Review to revise just this field): CTA pops
   *  back to Review.
   */
  mode: 'forward' | 'edit'
}

/**
 * Wizard step 1 of 4: product name + icon. Name is the catalog identity;
 * the icon picker lives here too because the visual identity decision
 * pairs with the name. Manual + AI paths share this step (AI pre-fills
 * both name and a generated custom icon — the user sees them on the
 * Review step and can tap Name to land here for revision).
 */
export function NameStep({ mode }: NameStepProps) {
  const t = useIntl()
  const nav = useProductNav()
  const onClose = useProductOnClose()
  const {
    name,
    setName,
    iconPreview,
    setIconPreview,
    setGeneratedIconBlob,
    setIconType,
    setPresetEmoji,
    presetEmoji,
    clearIcon,
  } = useProductForm()

  const presetIndex = presetEmoji
    ? PRESET_ICONS.findIndex((p) => p.id === presetEmoji) + 1
    : 0
  const isFormValid = name.trim().length > 0

  const handleContinue = () => {
    if (!isFormValid) return
    if (mode === 'edit') {
      nav.pop()
    } else {
      nav.push('price-forward')
    }
  }

  return (
    <>
      <IonHeader className="pm-header">
        <IonToolbar>
          <IonButtons slot="start">
            <IonButton
              fill="clear"
              onClick={() => nav.pop()}
              aria-label={t.formatMessage({ id: 'common.back' })}
            >
              <IonIcon icon={chevronBack} />
            </IonButton>
          </IonButtons>
          <IonTitle>
            {t.formatMessage({ id: 'productForm.title_add' })}
          </IonTitle>
          <IonButtons slot="end">
            <IonButton
              fill="clear"
              onClick={onClose}
              aria-label={t.formatMessage({ id: 'common.close' })}
            >
              <IonIcon icon={close} />
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent className="pm-content">
        <div className="pm-shell">
          <WizardProgress current={1} total={4} />
          <header className="pm-hero">
            <h1 className="pm-hero__title">
              {t.formatMessage(
                { id: 'productAddEdit.step_name_title' },
                { em: (chunks) => <em key="em">{chunks}</em> },
              )}
            </h1>
          </header>

          {/* Name */}
          <div className="pm-field">
            <label htmlFor="wizard-name" className="pm-field-label">
              {t.formatMessage({ id: 'productForm.name_label' })}{' '}
              <span className="pm-field-label__required">*</span>
            </label>
            <input
              id="wizard-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input"
              placeholder={t.formatMessage({ id: 'productForm.name_placeholder' })}
              autoComplete="off"
              autoFocus
            />
          </div>

          {/* Icon picker — preset rail + tile preview. Custom icons
              come in via the AI pipeline, not from this step. */}
          <div className="pm-field">
            <span className="pm-field-label">
              {t.formatMessage({ id: 'productForm.icon_label' })}
            </span>
            <div className="pm-icon-picker">
              <div className="pm-icon-tile">
                {iconPreview && isPresetIcon(iconPreview) ? (
                  (() => {
                    const p = getPresetIcon(iconPreview)
                    return p ? (
                      <p.icon size={28} className="text-text-primary" />
                    ) : null
                  })()
                ) : iconPreview ? (
                  <Image
                    src={iconPreview}
                    alt=""
                    width={56}
                    height={56}
                    className="object-cover w-full h-full"
                    unoptimized
                  />
                ) : (
                  <ImagePlus size={26} />
                )}
              </div>
              <div className="pm-icon-rail">
                {PRESET_ICONS.map((preset) => {
                  const isSelected = presetEmoji === preset.id
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => {
                        if (isSelected) {
                          clearIcon()
                          return
                        }
                        setIconPreview(preset.id)
                        setGeneratedIconBlob(null)
                        setIconType('preset')
                        setPresetEmoji(preset.id)
                      }}
                      className="pm-icon-rail__button"
                    >
                      <preset.icon size={22} />
                    </button>
                  )
                })}
              </div>
            </div>
            <div className="pm-icon-meta">
              <span className="pm-icon-meta__label">
                {!iconPreview
                  ? t.formatMessage({ id: 'productForm.icon_no_icon' })
                  : presetEmoji
                    ? t.formatMessage(
                        { id: 'productForm.icon_preset' },
                        { number: presetIndex },
                      )
                    : t.formatMessage({ id: 'productForm.icon_custom' })}
              </span>
              <button
                type="button"
                onClick={() => clearIcon()}
                disabled={!iconPreview}
                className="pm-icon-meta__reset"
              >
                {t.formatMessage({ id: 'productForm.icon_reset' })}
              </button>
            </div>
          </div>
        </div>
      </IonContent>

      <IonFooter className="pm-footer">
        <IonToolbar>
          <div className="modal-footer">
            <IonButton
              onClick={handleContinue}
              disabled={!isFormValid}
            >
              {t.formatMessage({
                id: mode === 'edit'
                  ? 'productAddEdit.step_done_cta'
                  : 'productAddEdit.step_continue_cta',
              })}
            </IonButton>
          </div>
        </IonToolbar>
      </IonFooter>
    </>
  )
}
