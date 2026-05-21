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
import { PriceKeypadStep } from '@/components/ui'
import { useProductForm } from '@/contexts/product-form-context'
import { useProductNav, useProductOnClose } from './ProductNavContext'
import { WizardProgress } from './WizardProgress'

interface PriceStepProps {
  mode: 'forward' | 'edit'
}

/**
 * Wizard step 2 of 4: price. Reuses the cash-counting keypad from the
 * Open Session / Close Session flow so the price field gets the same
 * always-visible-keypad ergonomics. No system keyboard pop-up, no
 * jumpy layout when the keyboard dismisses, big display-serif glyphs
 * the user can read at counter distance.
 */
export function PriceStep({ mode }: PriceStepProps) {
  const t = useIntl()
  const nav = useProductNav()
  const onClose = useProductOnClose()
  const { price, setPrice, editingProduct } = useProductForm()

  const numericPrice = parseFloat(price)
  const isValid = !isNaN(numericPrice) && numericPrice > 0
  const hasFieldChange =
    mode !== 'edit' || !editingProduct || numericPrice !== editingProduct.price

  const handleContinue = () => {
    if (!isValid || !hasFieldChange) return
    if (mode === 'edit') {
      nav.pop()
    } else {
      nav.push('category-stock-forward')
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
            {t.formatMessage({ id: 'productForm.price_label' })}
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

      <IonContent className="pm-content modal-content--no-scroll">
        <div className="keypad-shell">
          <WizardProgress current={2} total={4} />
          <header className="pm-hero pm-hero--keypad">
            <h1 className="pm-hero__title">
              {t.formatMessage(
                { id: 'productAddEdit.step_price_title' },
                { em: (chunks) => <em>{chunks}</em> },
              )}
            </h1>
          </header>
          <PriceKeypadStep
            value={price}
            onValueChange={setPrice}
            amountLabel={t.formatMessage({ id: 'productForm.price_label' })}
            helper={t.formatMessage({ id: 'productAddEdit.step_price_helper' })}
            ariaLabel={t.formatMessage({ id: 'productForm.price_label' })}
          />
        </div>
      </IonContent>

      <IonFooter className="pm-footer">
        <IonToolbar>
          <div className="modal-footer">
            <IonButton
              onClick={handleContinue}
              disabled={!isValid || !hasFieldChange}
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
