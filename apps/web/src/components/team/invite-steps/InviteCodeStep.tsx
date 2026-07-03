import { useIntl } from 'react-intl'
import { IonSpinner } from '@ionic/react'
import { Copy, CheckCheck, Share2, RefreshCw, Trash2 } from 'lucide-react'
import { useBusinessFormat } from '@/hooks/useBusinessFormat'
import type { InviteRole } from '@kasero/shared/types'

interface InviteCodeBodyProps {
  selectedRole: InviteRole
  newCode: string | null
  newCodeExpiresAt: Date | null
  qrDataUrl: string | null
  isGenerating: boolean
  copyFeedback: string | null
  onCopyCode: (code: string) => void
  onRegenerateCode: () => Promise<void>
  onRevoke: () => void
}

/**
 * Active-code surface body — the visual centerpiece of the flow.
 *
 * Layout:
 *   - Mono "INVITE · ACTIVE" eyebrow + Fraunces "Share this code" title
 *   - Code stamp: dashed top + bottom rules, big tracked JetBrains
 *     Mono code in the middle, role + expiry meta line under it,
 *     animated copy-confirmation toast docked under the stamp when
 *     copyFeedback === newCode.
 *   - Optional QR card under the stamp.
 *   - Action grid: Copy / Share / Regenerate / Revoke. Share row only
 *     renders when navigator.share is available.
 *
 * Done button + revoke push are owned by InviteModal.
 */
export function InviteCodeBody({
  selectedRole,
  newCode,
  newCodeExpiresAt,
  qrDataUrl,
  isGenerating,
  copyFeedback,
  onCopyCode,
  onRegenerateCode,
  onRevoke,
}: InviteCodeBodyProps) {
  const t = useIntl()
  const { formatDate } = useBusinessFormat()

  const roleLabels: Record<InviteRole, string> = {
    partner: t.formatMessage({ id: 'team.role_partner' }),
    employee: t.formatMessage({ id: 'team.role_employee' }),
  }

  const isCopied = !!newCode && copyFeedback === newCode

  // Web Share API is gated to https + secure contexts; render the row
  // only when supported so the ledger doesn't list a dead action.
  const canShare =
    typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  const handleShare = async () => {
    if (!newCode || !canShare) return
    try {
      await navigator.share({ text: newCode })
    } catch {
      // User cancellation or share-sheet failure is non-fatal; the
      // code is still on screen.
    }
  }

  return (
    <div className="pm-shell">
      <header className="pm-hero">
        <span className="pm-hero__eyebrow">
          {t.formatMessage({ id: 'team.invite_v2.eyebrow_step2' })}
        </span>
        <h1 className="pm-hero__title">
          {t.formatMessage(
            { id: 'team.invite_v2.title_step2' },
            { em: (chunks) => <em key="em">{chunks}</em> },
          )}
        </h1>
      </header>

      {/* Code stamp — the value is the only thing shown. Copy
          confirmation lives on the COPY action button itself
          (label + icon flip), so the stamp stays clean. user-select
          on the value lets long-press "select all" grab the code. */}
      {newCode && (
        <div className="tm-invite__code-stamp">
          <code className="tm-invite__code-value">{newCode}</code>

          <span className="tm-invite__code-meta">
            {newCodeExpiresAt
              ? t.formatMessage(
                  { id: 'team.invite_v2.code_meta_format' },
                  {
                    role: roleLabels[selectedRole],
                    date: formatDate(newCodeExpiresAt),
                  },
                )
              : roleLabels[selectedRole]}
          </span>
        </div>
      )}

      {/* Paired QR stub — small hairline frame with mono caption. */}
      {qrDataUrl && (
        <div className="tm-invite__qr-card">
          <span className="tm-invite__qr-caption">
            {t.formatMessage({ id: 'team.invite_v2.code_qr_caption' })}
          </span>
          <span className="tm-invite__qr-frame">
            <img src={qrDataUrl} alt={t.formatMessage({ id: 'team.qr_alt' })} />
          </span>
        </div>
      )}

      {/* Action row — .pm-action tiles (icon-on-top, mono label below)
          shared with the barcode modal. Same pillowed icon container,
          same color-coded variants. Revoke uses --danger. */}
      <div className="tm-invite__actions">
        <button
          type="button"
          onClick={() => newCode && onCopyCode(newCode)}
          disabled={!newCode}
          className={
            isCopied
              ? 'pm-action pm-action--success'
              : 'pm-action pm-action--brand'
          }
          aria-live="polite"
        >
          <span className="pm-action__icon">
            {isCopied ? (
              <CheckCheck size={24} strokeWidth={1.6} />
            ) : (
              <Copy size={24} strokeWidth={1.6} />
            )}
          </span>
          <span className="pm-action__label">
            {isCopied
              ? t.formatMessage({ id: 'team.invite_v2.action_copy_done' })
              : t.formatMessage({ id: 'team.invite_v2.action_copy' })}
          </span>
        </button>

        {canShare && (
          <button
            type="button"
            onClick={handleShare}
            disabled={!newCode}
            className="pm-action pm-action--success"
          >
            <span className="pm-action__icon">
              <Share2 size={24} strokeWidth={1.6} />
            </span>
            <span className="pm-action__label">
              {t.formatMessage({ id: 'team.invite_v2.action_share' })}
            </span>
          </button>
        )}

        <button
          type="button"
          onClick={() => onRegenerateCode()}
          disabled={isGenerating}
          className="pm-action pm-action--warning"
        >
          <span className="pm-action__icon">
            {isGenerating ? (
              <IonSpinner name="crescent" style={{ width: 24, height: 24 }} />
            ) : (
              <RefreshCw size={24} strokeWidth={1.6} />
            )}
          </span>
          <span className="pm-action__label">
            {isGenerating
              ? t.formatMessage({ id: 'team.regenerating' })
              : t.formatMessage({ id: 'team.invite_v2.action_regenerate' })}
          </span>
        </button>

        <button
          type="button"
          onClick={onRevoke}
          className="pm-action pm-action--danger"
        >
          <span className="pm-action__icon">
            <Trash2 size={24} strokeWidth={1.6} />
          </span>
          <span className="pm-action__label">
            {t.formatMessage({ id: 'team.invite_v2.action_revoke' })}
          </span>
        </button>
      </div>
    </div>
  )
}
