import { useIntl } from 'react-intl'

/**
 * Partner-promotion consequence body. Shown only when the user picks
 * "partner" on the role step, before the code is generated. Lays out
 * exactly what a partner can — and cannot — do, in a small ledger
 * styled with oxblood/danger tokens so the gravity reads.
 *
 * The "off-limits" final row renders as Fraunces italic so it stands
 * out as the reassurance line in an otherwise cautionary list.
 *
 * Confirm + back navigation are owned by InviteModal.
 */
export function InvitePartnerWarningBody() {
  const t = useIntl()

  return (
    <div className="pm-shell">
      <header className="pm-hero">
        <span className="pm-hero__eyebrow pm-hero__eyebrow--danger">
          {t.formatMessage({ id: 'team.invite_v2.eyebrow_partner_warning' })}
        </span>
        <h1 className="pm-hero__title pm-hero__title--danger">
          {t.formatMessage(
            { id: 'team.invite_v2.title_partner_warning' },
            { em: (chunks) => <em key="em">{chunks}</em> },
          )}
        </h1>
        <p className="pm-hero__subtitle">
          {t.formatMessage({ id: 'team.invite_v2.subtitle_partner_warning' })}
        </p>
      </header>

      <ul className="tm-invite__warning-list">
        <li className="tm-invite__warning-row">
          <span className="tm-invite__warning-tick" aria-hidden="true" />
          <span className="tm-invite__warning-text">
            {t.formatMessage({ id: 'team.invite_v2.partner_bullet_products' })}
          </span>
        </li>
        <li className="tm-invite__warning-row">
          <span className="tm-invite__warning-tick" aria-hidden="true" />
          <span className="tm-invite__warning-text">
            {t.formatMessage({ id: 'team.invite_v2.partner_bullet_team' })}
          </span>
        </li>
        <li className="tm-invite__warning-row">
          <span className="tm-invite__warning-tick" aria-hidden="true" />
          <span className="tm-invite__warning-text">
            {t.formatMessage({ id: 'team.invite_v2.partner_bullet_sessions' })}
          </span>
        </li>
        <li className="tm-invite__warning-row tm-invite__warning-row--off-limits">
          <span className="tm-invite__warning-tick" aria-hidden="true" />
          <span className="tm-invite__warning-text">
            {t.formatMessage({ id: 'team.invite_v2.partner_bullet_off_limits' })}
          </span>
        </li>
      </ul>
    </div>
  )
}
