'use client'

import { useIntl } from 'react-intl'
import { useEffect, useId, useRef, useState } from 'react'
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode'
import { X } from 'lucide-react'
import { isBarcodeFormat } from '@kasero/shared/barcodes'
import type { BarcodeFormat } from '@kasero/shared/types'

// Keep this in sync with the formats list in useBarcodeScan.tsx. Both paths
// (file-based and live) should accept the same symbologies.
const SUPPORTED_FORMATS = [
  Html5QrcodeSupportedFormats.CODABAR,
  Html5QrcodeSupportedFormats.CODE_39,
  Html5QrcodeSupportedFormats.CODE_93,
  Html5QrcodeSupportedFormats.CODE_128,
  Html5QrcodeSupportedFormats.ITF,
  Html5QrcodeSupportedFormats.EAN_13,
  Html5QrcodeSupportedFormats.EAN_8,
  Html5QrcodeSupportedFormats.UPC_A,
  Html5QrcodeSupportedFormats.UPC_E,
  Html5QrcodeSupportedFormats.UPC_EAN_EXTENSION,
]

export interface LiveBarcodeScanResult {
  value: string
  format: BarcodeFormat | null
}

export interface LiveBarcodeScannerProps {
  onResult: (result: LiveBarcodeScanResult) => void | Promise<void>
  onCancel: () => void
  onError: (message: string) => void
  /**
   * Optional escape hatch: if provided, the overlay shows a "Choose file
   * instead" link that dismisses the live camera and switches to the
   * file picker path.
   */
  onSwitchToFilePicker?: () => void
}

/**
 * Full-screen live camera barcode scanner.
 *
 * Mounts a `Html5Qrcode` instance, opens the device's rear camera via
 * getUserMedia, and continuously decodes frames until one succeeds. On
 * decode, calls `onResult` once and stops the stream. On cancel, calls
 * `onCancel`. On camera failure (permission denied, no camera, etc.) shows
 * an inline error and calls `onError`.
 *
 * Visual chrome — Modern Mercantile cinema-dark viewfinder. Mono uppercase
 * caption strip up top, terracotta corner brackets + horizontal laser line
 * sweeping the frame, italic Fraunces hint at the bottom.
 */
export function LiveBarcodeScanner({
  onResult,
  onCancel,
  onError,
  onSwitchToFilePicker,
}: LiveBarcodeScannerProps) {
  const t = useIntl()
  // Sanitize React's useId() into a valid HTML id.
  const reactId = useId().replace(/:/g, '')
  const hostIdRef = useRef(`live-barcode-scanner-${reactId}`)
  const scannerRef = useRef<Html5Qrcode | null>(null)
  // Guard against double-emission: html5-qrcode's onSuccess may fire for
  // multiple consecutive frames seeing the same barcode.
  const emittedRef = useRef(false)
  const [status, setStatus] = useState<'starting' | 'scanning' | 'error'>(
    'starting',
  )
  const [errorMessage, setErrorMessage] = useState('')

  // Stash translated error strings in refs so the async effect can access
  // them without being in its dependency array.
  const errGenericRef = useRef(
    t.formatMessage({ id: 'barcode.scanner_error_generic' }),
  )
  const errPermissionRef = useRef(
    t.formatMessage({ id: 'barcode.scanner_error_permission' }),
  )
  const errNotFoundRef = useRef(
    t.formatMessage({ id: 'barcode.scanner_error_not_found' }),
  )
  const errInUseRef = useRef(
    t.formatMessage({ id: 'barcode.scanner_error_in_use' }),
  )
  useEffect(() => {
    errGenericRef.current = t.formatMessage({
      id: 'barcode.scanner_error_generic',
    })
    errPermissionRef.current = t.formatMessage({
      id: 'barcode.scanner_error_permission',
    })
    errNotFoundRef.current = t.formatMessage({
      id: 'barcode.scanner_error_not_found',
    })
    errInUseRef.current = t.formatMessage({
      id: 'barcode.scanner_error_in_use',
    })
  })

  // Stash callbacks in refs so the start-scanner effect can run exactly
  // once on mount without depending on prop identity.
  const onResultRef = useRef(onResult)
  const onErrorRef = useRef(onError)
  useEffect(() => {
    onResultRef.current = onResult
    onErrorRef.current = onError
  })

  useEffect(() => {
    let cancelled = false

    const start = async () => {
      try {
        const scanner = new Html5Qrcode(hostIdRef.current, {
          verbose: false,
          formatsToSupport: SUPPORTED_FORMATS,
        })
        scannerRef.current = scanner

        await scanner.start(
          { facingMode: 'environment' },
          {
            fps: 10,
            // Intentionally omit `qrbox` — we render our own viewfinder
            // overlay so the library skips drawing its built-in shaded
            // region (which positions inconsistently against the host
            // div).
            aspectRatio: undefined,
          },
          async (decodedText, result) => {
            if (emittedRef.current) return
            emittedRef.current = true

            const formatName = result.result.format?.formatName || null
            const format =
              formatName && isBarcodeFormat(formatName) ? formatName : null

            try {
              await scanner.stop()
            } catch {
              // Camera may already be stopping; safe to ignore.
            }

            try {
              await onResultRef.current({ value: decodedText, format })
            } catch (err) {
              console.error('[LiveBarcodeScanner] onResult threw:', err)
            }
          },
          () => {
            // Per-frame scan failures are normal — do not surface to UI.
          },
        )

        if (!cancelled) {
          setStatus('scanning')
        }
      } catch (err) {
        if (cancelled) return

        const errString =
          err instanceof Error
            ? `${err.name}: ${err.message}`
            : String(err ?? '')
        const combined = errString.toLowerCase()

        let message = errGenericRef.current
        if (
          combined.includes('notallowederror') ||
          combined.includes('permissiondenied') ||
          combined.includes('permission denied')
        ) {
          message = errPermissionRef.current
        } else if (
          combined.includes('notfounderror') ||
          combined.includes('devicesnotfounderror')
        ) {
          message = errNotFoundRef.current
        } else if (
          combined.includes('notreadableerror') ||
          combined.includes('trackstarterror')
        ) {
          message = errInUseRef.current
        }

        console.warn(
          '[LiveBarcodeScanner] Camera could not start:',
          errString,
        )

        setErrorMessage(message)
        setStatus('error')
        onErrorRef.current(message)
      }
    }

    void start()

    return () => {
      cancelled = true
      const scanner = scannerRef.current
      if (scanner) {
        void (async () => {
          try {
            await scanner.stop()
          } catch {
            // ignore
          }
          try {
            await scanner.clear()
          } catch {
            // ignore
          }
        })()
        scannerRef.current = null
      }
    }
  }, [])

  // The overlay sits between the IonHeader (--header-height) and the
  // IonTabBar (--mobile-nav-height) so the header and tab bar remain
  // visible and interactive around the scanner. Safe-area insets are
  // accounted for so notches and home indicators don't overlap content.
  const overlayStyle: React.CSSProperties = {
    top: 'calc(var(--header-height) + env(safe-area-inset-top, 0px) + var(--header-safe-area-extra))',
    bottom: 'calc(var(--mobile-nav-height) + env(safe-area-inset-bottom, 0px) + var(--mobile-nav-safe-area-extra))',
    left: 0,
    right: 0,
  }

  return (
    <div
      className="pm-scanner"
      style={overlayStyle}
      role="dialog"
      aria-modal="true"
      aria-label={t.formatMessage({ id: 'barcode.scanner_aria_label' })}
    >
      {/*
        Video host — html5-qrcode injects nested wrapper divs around a
        <video> element. Force every descendant inside the host to fill
        completely and the video to object-cover so the camera feed
        crops to fill instead of letterboxing.
      */}
      <style>{`
        #${hostIdRef.current},
        #${hostIdRef.current} > div,
        #${hostIdRef.current} > div > div {
          width: 100% !important;
          height: 100% !important;
          min-height: 100% !important;
          max-height: 100% !important;
          padding: 0 !important;
        }
        #${hostIdRef.current} video {
          width: 100% !important;
          height: 100% !important;
          object-fit: cover !important;
          display: block !important;
        }
        #${hostIdRef.current} #qr-shaded-region {
          display: none !important;
        }
      `}</style>
      <div id={hostIdRef.current} className="absolute inset-0" />

      {/* Top bar — mono caption + close X */}
      <div className="pm-scanner__topbar">
        <span className="pm-scanner__caption">
          {t.formatMessage({ id: 'productAddEdit.scanner_caption' })}
        </span>
        <button
          type="button"
          onClick={onCancel}
          className="pm-scanner__close"
          aria-label={t.formatMessage({ id: 'barcode.scanner_cancel_aria' })}
        >
          <X size={18} />
        </button>
      </div>

      {/* Viewfinder — terracotta corner brackets + sweeping laser */}
      {status === 'scanning' && (
        <div className="pm-scanner__viewfinder">
          <div className="pm-scanner__frame">
            <span className="pm-scanner__corner pm-scanner__corner--tl" />
            <span className="pm-scanner__corner pm-scanner__corner--tr" />
            <span className="pm-scanner__corner pm-scanner__corner--bl" />
            <span className="pm-scanner__corner pm-scanner__corner--br" />
            <span className="pm-scanner__laser" />
          </div>
        </div>
      )}

      {/* Bottom bar — italic Fraunces hint + optional file-picker fallback */}
      {status === 'scanning' && (
        <div className="pm-scanner__bottombar">
          <p className="pm-scanner__hint">
            {t.formatMessage(
              { id: 'productAddEdit.scanner_hint' },
              { em: (chunks) => <em key="em">{chunks}</em> },
            )}
          </p>
          {onSwitchToFilePicker && (
            <button
              type="button"
              onClick={onSwitchToFilePicker}
              className="pm-scanner__fallback"
            >
              {t.formatMessage({ id: 'barcode.scanner_choose_file' })}
            </button>
          )}
        </div>
      )}

      {/* Starting */}
      {status === 'starting' && (
        <div className="pm-scanner__overlay">
          <span className="pm-scanner__overlay-eyebrow">
            {t.formatMessage({ id: 'productAddEdit.scanner_starting_eyebrow' })}
          </span>
          <p className="pm-scanner__overlay-message">
            {t.formatMessage({ id: 'barcode.scanner_starting' })}
          </p>
        </div>
      )}

      {/* Error */}
      {status === 'error' && (
        <div className="pm-scanner__overlay pm-scanner__overlay--error">
          <span className="pm-scanner__overlay-eyebrow">
            {t.formatMessage({ id: 'productAddEdit.scanner_error_eyebrow' })}
          </span>
          <p className="pm-scanner__overlay-message">{errorMessage}</p>
          {onSwitchToFilePicker && (
            <button
              type="button"
              onClick={onSwitchToFilePicker}
              className="pm-scanner__fallback"
            >
              {t.formatMessage({ id: 'barcode.scanner_choose_file' })}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
