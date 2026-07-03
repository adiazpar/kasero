import { useIntl } from 'react-intl'
import type { TeamMember } from '@/hooks/useTeamManagement'

interface MemberPartnerWarningBodyProps {
  member: TeamMember
}

/**
 * Promotion warning body, shown only when the proposed direction is
 * employee -> partner (the destructive direction since partners gain
 * manager-level powers). Mirrors the cream paper hero but tints the
 * eyebrow + emphasized name in oxblood so the user knows this is the
 * loud branch of the role-change flow.
 *
 * Confirm + back navigation are owned by MemberModal.
 */
export function MemberPartnerWarningBody({
  member,
}: MemberPartnerWarningBodyProps) {
  const t = useIntl()

  return (
    <div className="pm-shell">
      <header className="pm-hero">
        <span className="pm-hero__eyebrow pm-hero__eyebrow--danger">
          {t.formatMessage({ id: 'team.member_v2.eyebrow_partner_warning' })}
        </span>
        <h1 className="pm-hero__title pm-hero__title--danger">
          {t.formatMessage(
            { id: 'team.member_v2.title_partner_warning' },
            {
              // User-entered content — interpolate verbatim.
              name: member.name,
              em: (chunks) => <em key="em">{chunks}</em>,
            },
          )}
        </h1>
        <p className="pm-hero__subtitle">
          {t.formatMessage({ id: 'team.member_v2.subtitle_partner_warning' })}
        </p>
      </header>

      {/* Consequence ledger — partners gain X, Y, Z; cannot do W. */}
      <div className="tm-member__consequences">
        <span className="tm-member__consequences-eyebrow">
          {t.formatMessage({ id: 'team.member_v2.partner_grants_eyebrow' })}
        </span>
        <ul className="tm-member__consequences-list">
          <li className="tm-member__consequences-bullet">
            {t.formatMessage({ id: 'team.member_v2.partner_grant_products' })}
          </li>
          <li className="tm-member__consequences-bullet">
            {t.formatMessage({ id: 'team.member_v2.partner_grant_team' })}
          </li>
          <li className="tm-member__consequences-bullet">
            {t.formatMessage({ id: 'team.member_v2.partner_grant_cash' })}
          </li>
          <li className="tm-member__consequences-bullet tm-member__consequences-bullet--exception">
            {t.formatMessage({ id: 'team.member_v2.partner_grant_exception' })}
          </li>
        </ul>
      </div>
    </div>
  )
}
