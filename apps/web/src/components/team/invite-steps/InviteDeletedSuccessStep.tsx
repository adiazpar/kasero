import { useIntl } from 'react-intl'
import { CheckCircle2 } from 'lucide-react'

/**
 * Terminal step body: the invite has been revoked. The footer Done
 * button (owned by InviteModal) is the only path forward.
 *
 * Visual: oxblood-tinted seal circle (a soft confirmation, not a
 * celebration — this is a destructive action), mono "DONE" stamp,
 * Fraunces italic "Revoked." title, short caption.
 */
export function InviteDeletedSuccessBody() {
  const t = useIntl()

  return (
    <div className="tm-invite__seal">
      <span className="tm-invite__seal-circle" aria-hidden="true">
        <CheckCircle2 size={44} strokeWidth={1.4} />
      </span>

      <span className="tm-invite__seal-stamp">
        {t.formatMessage({ id: 'team.invite_v2.eyebrow_deleted' })}
      </span>

      <h2 className="pm-hero__title pm-hero__title--danger" style={{ textAlign: 'center' }}>
        {t.formatMessage(
          { id: 'team.invite_v2.title_deleted' },
          { em: (chunks) => <em key="em">{chunks}</em> },
        )}
      </h2>

      <p className="pm-hero__subtitle" style={{ textAlign: 'center', margin: 0 }}>
        {t.formatMessage({ id: 'team.invite_v2.subtitle_deleted' })}
      </p>
    </div>
  )
}
