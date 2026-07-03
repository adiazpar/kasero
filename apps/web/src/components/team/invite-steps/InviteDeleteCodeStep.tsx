import { useIntl } from 'react-intl'

interface InviteDeleteCodeBodyProps {
  newCode: string | null
}

/**
 * Revoke-confirm body. Oxblood eyebrow, Fraunces italic title with
 * em-pivot on "invite", then a Fraunces subtitle explaining the
 * consequences. The code being revoked is shown as a dimmed,
 * dashed-frame specimen so the user has the chance to spot a wrong
 * pick before tapping the destructive pill.
 *
 * Delete confirm + back navigation are owned by InviteModal.
 */
export function InviteDeleteCodeBody({ newCode }: InviteDeleteCodeBodyProps) {
  const t = useIntl()

  return (
    <div className="pm-shell">
      <header className="pm-hero">
        <span className="pm-hero__eyebrow pm-hero__eyebrow--danger">
          {t.formatMessage({ id: 'team.invite_v2.eyebrow_delete' })}
        </span>
        <h1 className="pm-hero__title pm-hero__title--danger">
          {t.formatMessage(
            { id: 'team.invite_v2.title_delete' },
            { em: (chunks) => <em key="em">{chunks}</em> },
          )}
        </h1>
        <p className="pm-hero__subtitle">
          {t.formatMessage({ id: 'team.invite_v2.subtitle_delete' })}
        </p>
      </header>

      {newCode && (
        <div className="tm-invite__specimen">
          <span className="tm-invite__specimen-label">
            {t.formatMessage({ id: 'team.invite_v2.delete_specimen_label' })}
          </span>
          <code className="tm-invite__specimen-value">{newCode}</code>
        </div>
      )}
    </div>
  )
}
