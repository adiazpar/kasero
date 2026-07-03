import { useIntl } from 'react-intl'
import type { TeamMember } from '@/hooks/useTeamManagement'

interface MemberRoleChangeBodyProps {
  member: TeamMember
}

/**
 * Body of the regular role-flip surface. Reached when direction is
 * partner -> employee (a demotion). Promotion to partner takes the
 * dedicated MemberPartnerWarningStep instead, which is the loud, oxblood
 * variant of this same surface.
 *
 * Confirm + back navigation are owned by MemberModal.
 */
export function MemberRoleChangeBody({ member }: MemberRoleChangeBodyProps) {
  const t = useIntl()

  // We only land here for the demote path (partner -> employee). The
  // promote path routes through MemberPartnerWarningStep instead.
  const isDemoting = member.role === 'partner'

  const titleKey = isDemoting
    ? 'team.member_v2.title_demote_to_employee'
    : 'team.member_v2.title_promote_to_partner'
  const subtitleKey = isDemoting
    ? 'team.member_v2.subtitle_demote_to_employee'
    : 'team.member_v2.subtitle_promote_to_partner'
  const fromRoleKey = isDemoting ? 'team.role_partner' : 'team.role_employee'
  const toRoleKey = isDemoting ? 'team.role_employee' : 'team.role_partner'

  return (
    <div className="pm-shell">
      <header className="pm-hero">
        <span className="pm-hero__eyebrow">
          {t.formatMessage({ id: 'team.member_v2.eyebrow_role_change' })}
        </span>
        <h1 className="pm-hero__title">
          {t.formatMessage(
            { id: titleKey },
            {
              // User-entered content — interpolate verbatim.
              name: member.name,
              em: (chunks) => <em key="em">{chunks}</em>,
            },
          )}
        </h1>
        <p className="pm-hero__subtitle">
          {t.formatMessage({ id: subtitleKey })}
        </p>
      </header>

      {/* Direction ledger — current role on the left, new role on the
          right of a single mono row, mirroring the details-step
          direction stamp but in dotted-leader form. */}
      <div className="pm-review__ledger" role="list">
        <div className="pm-review-row" role="listitem">
          <span className="pm-review-row__label">
            {t.formatMessage({ id: 'team.member_v2.role_from_label' })}
          </span>
          <span className="pm-review-row__leader" aria-hidden="true" />
          <span className="pm-review-row__value pm-review-row__value--mono">
            {t.formatMessage({ id: fromRoleKey })}
          </span>
        </div>
        <div className="pm-review-row" role="listitem">
          <span className="pm-review-row__label">
            {t.formatMessage({ id: 'team.member_v2.role_to_label' })}
          </span>
          <span className="pm-review-row__leader" aria-hidden="true" />
          <span className="pm-review-row__value pm-review-row__value--mono">
            {t.formatMessage({ id: toRoleKey })}
          </span>
        </div>
      </div>

      {/* Brief consequence ledger — what the new role can / cannot do. */}
      <div className="tm-member__consequences">
        <span className="tm-member__consequences-eyebrow">
          {t.formatMessage({
            id: isDemoting
              ? 'team.member_v2.demote_consequences_eyebrow'
              : 'team.member_v2.promote_consequences_eyebrow',
          })}
        </span>
        <ul className="tm-member__consequences-list">
          {isDemoting ? (
            <>
              <li className="tm-member__consequences-bullet">
                {t.formatMessage({ id: 'team.member_v2.demote_consequence_one' })}
              </li>
              <li className="tm-member__consequences-bullet">
                {t.formatMessage({ id: 'team.member_v2.demote_consequence_two' })}
              </li>
              <li className="tm-member__consequences-bullet tm-member__consequences-bullet--exception">
                {t.formatMessage({ id: 'team.member_v2.demote_consequence_keep' })}
              </li>
            </>
          ) : (
            <>
              <li className="tm-member__consequences-bullet">
                {t.formatMessage({ id: 'team.member_v2.partner_grant_products' })}
              </li>
              <li className="tm-member__consequences-bullet">
                {t.formatMessage({ id: 'team.member_v2.partner_grant_team' })}
              </li>
              <li className="tm-member__consequences-bullet">
                {t.formatMessage({ id: 'team.member_v2.partner_grant_cash' })}
              </li>
            </>
          )}
        </ul>
      </div>
    </div>
  )
}
