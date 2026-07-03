import { useIntl } from 'react-intl'
import { getUserInitials } from '@kasero/shared/auth'
import type { UserRole } from '@kasero/shared/types'
import type { TeamMember } from '@/hooks/useTeamManagement'

interface MemberRemoveBodyProps {
  member: TeamMember
}

/**
 * Confirm-removal body. Oxblood-tinted hero (eyebrow + title), a small
 * specimen card showing exactly which member the action targets
 * (avatar + name + role chip). Confirm + back navigation are owned by
 * MemberModal.
 */
export function MemberRemoveBody({ member }: MemberRemoveBodyProps) {
  const t = useIntl()

  const roleLabels: Record<UserRole, string> = {
    owner: t.formatMessage({ id: 'team.role_owner' }),
    partner: t.formatMessage({ id: 'team.role_partner' }),
    employee: t.formatMessage({ id: 'team.role_employee' }),
  }

  return (
    <div className="pm-shell">
      <header className="pm-hero">
        <span className="pm-hero__eyebrow pm-hero__eyebrow--danger">
          {t.formatMessage({ id: 'team.member_v2.eyebrow_remove' })}
        </span>
        <h1 className="pm-hero__title pm-hero__title--danger">
          {t.formatMessage(
            { id: 'team.member_v2.title_remove' },
            {
              // User-entered content — interpolate verbatim.
              name: member.name,
              em: (chunks) => <em key="em">{chunks}</em>,
            },
          )}
        </h1>
        <p className="pm-hero__subtitle">
          {t.formatMessage(
            { id: 'team.member_v2.subtitle_remove' },
            { name: member.name },
          )}
        </p>
      </header>

      {/* Specimen — small avatar + name + role chip making the
          destructive action target unambiguous. */}
      <div className="tm-member__specimen">
        <div className="tm-member__specimen-avatar">
          {member.avatar ? (
            <img src={member.avatar} alt="" />
          ) : (
            getUserInitials(member.name)
          )}
        </div>
        <div className="tm-member__specimen-body">
          <span className="tm-member__specimen-name">{member.name}</span>
          <span className="tm-member__specimen-role">
            {roleLabels[member.role]}
          </span>
        </div>
      </div>
    </div>
  )
}
