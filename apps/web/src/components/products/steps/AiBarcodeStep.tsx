import { useIntl } from 'react-intl'
import { useCallback, useEffect } from 'react'
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
import { Plus, ScanLine, RotateCcw } from 'lucide-react'
import { useProductForm } from '@/contexts/product-form-context'
import { useBarcodeScan } from '@/hooks/useBarcodeScan'
import {
  generateInternalProductBarcode,
  getBarcodeFormatLabel,
} from '@kasero/shared/barcodes'
import { BarcodeDisplay } from '../BarcodeDisplay'
import type { BarcodeSource } from '@kasero/shared/types'
import { useProductNav, useAddProductCallbacks } from './ProductNavContext'

export function AiBarcodeStep() {
  const t = useIntl()
  const nav = useProductNav()
  const { onStartAiPipeline, onClose } = useAddProductCallbacks()
  const {
    barcode,
    barcodeFormat,
    barcodeSource,
    setBarcode,
    setBarcodeFormat,
    setBarcodeSource,
    setError,
  } = useProductForm()

  const getBarcodeSourceLabel = (source: BarcodeSource | null): string => {
    switch (source) {
      case 'scanned':
        return t.formatMessage({ id: 'barcode.source_scanned' })
      case 'generated':
        return t.formatMessage({ id: 'barcode.source_generated' })
      case 'manual':
        return t.formatMessage({ id: 'barcode.source_manual' })
      default:
        return t.formatMessage({ id: 'barcode.source_na' })
    }
  }

  // Clear barcode state when this step mounts so user starts fresh.
  useEffect(() => {
    setBarcode('')
    setBarcodeFormat(null)
    setBarcodeSource(null)
    setError('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleClear = useCallback(() => {
    setBarcode('')
    setBarcodeFormat(null)
    setBarcodeSource(null)
  }, [setBarcode, setBarcodeFormat, setBarcodeSource])

  const {
    open: openScanner,
    busy: scanBusy,
    hiddenInput: scanHiddenInput,
  } = useBarcodeScan({
    onResult: ({ value, format }) => {
      setBarcode(value)
      setBarcodeFormat(format)
      setBarcodeSource('scanned')
    },
    onError: (message) => {
      setError(message)
    },
  })

  const handleScanClick = useCallback(() => {
    setError('')
    openScanner()
  }, [openScanner, setError])

  const handleGenerate = useCallback(() => {
    setBarcode(generateInternalProductBarcode())
    setBarcodeFormat('CODE_128')
    setBarcodeSource('generated')
  }, [setBarcode, setBarcodeFormat, setBarcodeSource])

  const hasBarcode = Boolean(barcode.trim())

  function handleContinue() {
    onStartAiPipeline()
    nav.push('analyzing')
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
            {t.formatMessage({ id: 'productForm.ai_step_barcode_title' })}
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
          <header className="pm-hero">
            <span className="pm-hero__eyebrow">
              {t.formatMessage({ id: 'productAddEdit.ai_barcode_eyebrow' })}
            </span>
            <h1 className="pm-hero__title">
              {t.formatMessage(
                { id: 'productAddEdit.ai_barcode_title' },
                { em: (chunks) => <em key="em">{chunks}</em> },
              )}
            </h1>
            <p className="pm-hero__subtitle">
              {t.formatMessage({ id: 'barcode.ai_barcode_intro' })}
            </p>
          </header>

          <div className="pm-barcode">
            <div className="pm-barcode-ledger pm-barcode-ledger--tall">
              <BarcodeDisplay value={barcode} format={barcodeFormat} />
            </div>

            <div className="pm-barcode-meta">
              {hasBarcode ? (
                <div className="pm-barcode-meta__chips">
                  <span className="pm-barcode-chip pm-barcode-chip--brand">
                    {barcodeFormat
                      ? getBarcodeFormatLabel(barcodeFormat)
                      : t.formatMessage({ id: 'barcode.source_na' })}
                  </span>
                  <span className="pm-barcode-chip pm-barcode-chip--ink">
                    {getBarcodeSourceLabel(barcodeSource)}
                  </span>
                </div>
              ) : (
                <span className="pm-barcode-meta__empty">
                  {t.formatMessage({ id: 'barcode.no_barcode' })}
                </span>
              )}
            </div>

            {scanHiddenInput}

            <div className="pm-barcode-actions">
              <button
                type="button"
                onClick={handleScanClick}
                disabled={scanBusy}
                className="pm-action pm-action--brand"
              >
                <span className="pm-action__icon">
                  <ScanLine size={26} strokeWidth={1.6} />
                </span>
                <span className="pm-action__label">
                  {scanBusy
                    ? t.formatMessage({ id: 'barcode.scan_reading' })
                    : t.formatMessage({ id: 'barcode.scan_button' })}
                </span>
              </button>
              <button
                type="button"
                onClick={handleGenerate}
                className="pm-action pm-action--success"
              >
                <span className="pm-action__icon">
                  <Plus size={26} strokeWidth={1.6} />
                </span>
                <span className="pm-action__label">
                  {t.formatMessage({ id: 'barcode.generate_button' })}
                </span>
              </button>
              <button
                type="button"
                onClick={handleClear}
                disabled={!hasBarcode}
                className="pm-action pm-action--danger"
              >
                <span className="pm-action__icon">
                  <RotateCcw size={24} strokeWidth={1.6} />
                </span>
                <span className="pm-action__label">
                  {t.formatMessage({ id: 'barcode.reset_button' })}
                </span>
              </button>
            </div>
          </div>
        </div>
      </IonContent>

      <IonFooter className="pm-footer">
        <IonToolbar>
          <div className="modal-footer">
            <IonButton
              fill={hasBarcode ? 'solid' : 'outline'}
              className={hasBarcode ? undefined : 'pm-ghost-btn'}
              onClick={handleContinue}
            >
              {hasBarcode
                ? t.formatMessage({ id: 'productForm.continue_button' })
                : t.formatMessage({ id: 'productForm.skip_for_now' })}
            </IonButton>
          </div>
        </IonToolbar>
      </IonFooter>
    </>
  )
}
