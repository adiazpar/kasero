import { useIntl } from 'react-intl'
import type { InviteRole } from '@kasero/shared/types'
import type { InviteDuration } from '@kasero/shared/auth'
import { DurationPicker } from '../DurationPicker'
import { RoleSelectionContent } from '../RoleSelectionContent'

interface InviteRoleBodyProps {
  selectedRole: InviteRole
  setSelectedRole: (role: InviteRole) => void
  selectedDuration: InviteDuration
  setSelectedDuration: (d: InviteDuration) => void
}

/**
 * Step 1 body of the invite-creation flow. Body-only — chrome (header,
 * IonContent, footer) is owned by InviteModal so the whole modal stays
 * a single ModalShell with no inner IonNav / IonPage stack.
 *
 * Body order is Role first (it gates the next screen — partners route
 * through a warning surface), then Duration. Both rely on supporting
 * components (RoleSelectionContent, DurationPicker) styled via the
 * .tm-invite__* vocabulary in styles/team-invite-modal.css.
 */
export function InviteRoleBody({
  selectedRole,
  setSelectedRole,
  selectedDuration,
  setSelectedDuration,
}: InviteRoleBodyProps) {
  const t = useIntl()

  return (
    <div className="pm-shell">
      <header className="pm-hero">
        <span className="pm-hero__eyebrow">
          {t.formatMessage({ id: 'team.invite_v2.eyebrow_step1' })}
        </span>
        <h1 className="pm-hero__title">
          {t.formatMessage(
            { id: 'team.invite_v2.title_step1' },
            { em: (chunks) => <em key="em">{chunks}</em> },
          )}
        </h1>
        <p className="pm-hero__subtitle">
          {t.formatMessage({ id: 'team.invite_v2.subtitle_step1' })}
        </p>
      </header>

      {/* Role section first — it gates whether a warning is shown
          before the code is generated. */}
      <section>
        <span className="tm-invite__section-label">
          {t.formatMessage({ id: 'team.invite_v2.section_role' })}
        </span>
        <RoleSelectionContent
          selectedRole={selectedRole}
          setSelectedRole={setSelectedRole}
        />
      </section>

      <section>
        <span className="tm-invite__section-label">
          {t.formatMessage({ id: 'team.invite_v2.section_duration' })}
        </span>
        <DurationPicker
          selected={selectedDuration}
          onSelect={setSelectedDuration}
        />
      </section>
    </div>
  )
}
