import {
  IonBackButton,
  IonButtons,
  IonHeader,
  IonTitle,
  IonToolbar,
} from '@ionic/react'
import { useIntl } from 'react-intl'

import { useBusiness } from '@/contexts/business-context'
import { UserMenu } from '@/components/layout/user-menu'

interface BusinessHeaderProps {
  /**
   * Title override. When omitted, the toolbar shows the active business
   * name — that's the right wayfinding for top-level business tabs
   * (Home / Sales / Products / Manage), since the bottom IonTabBar
   * already indicates which tab is active. Drilldowns (Team list,
   * Provider detail) pass an explicit title so the toolbar reads as a
   * stack frame, not as the business root.
   */
  title?: string
  /**
   * Back-navigation target. Defaults to `/` (the user-level Hub home).
   * Drilldowns override with `/:businessId/manage` (or wherever they
   * reasonably came from) so the back chevron pops one level inside
   * the business stack instead of leaving it.
   */
  backHref?: string
  /**
   * Label rendered next to the back chevron. Defaults to "Hub". Pass
   * the manage / providers / team label for drilldowns (or omit if you
   * want the chevron alone).
   */
  backLabel?: string
}

/**
 * Persistent business-level header. Sits at the top of every page
 * inside the per-business shell (the four tabs and their drilldowns).
 *
 * Three affordances, always present:
 *   - Back-target (start slot): `IonBackButton` peels back to the
 *     parent in the business stack, defaulting to the Hub home.
 *   - Title (center): the business name by default; explicit prop for
 *     drilldown stack frames.
 *   - Hamburger (end slot): opens the user-menu sheet (same content as
 *     the avatar trigger on the Hub — see `<UserMenu>`).
 *
 * The component is intentionally tiny — visual chrome (padding, border,
 * --background) is inherited from the existing ion-toolbar theme bridge
 * in ionic-theme.css. No new CSS lives here.
 */
export function BusinessHeader({ title, backHref, backLabel }: BusinessHeaderProps) {
  const intl = useIntl()
  const { business } = useBusiness()
  const resolvedTitle = title ?? business?.name ?? ''
  const resolvedBackHref = backHref ?? '/'
  const resolvedBackLabel =
    backLabel ?? intl.formatMessage({ id: 'navigation.hub' })

  return (
    <IonHeader>
      <IonToolbar>
        <IonButtons slot="start">
          <IonBackButton defaultHref={resolvedBackHref} text={resolvedBackLabel} />
        </IonButtons>
        <IonTitle>{resolvedTitle}</IonTitle>
        <IonButtons slot="end">
          <UserMenu trigger="hamburger" />
        </IonButtons>
      </IonToolbar>
    </IonHeader>
  )
}
