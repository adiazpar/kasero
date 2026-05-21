'use client'

import { useIntl } from 'react-intl'
import { IonItem, IonLabel, IonList, IonNote } from '@ionic/react'
import { PackageX } from 'lucide-react'
import { GroupLabel } from '@/components/ui'

interface AlertsSectionProps {
  lowStockCount: number
  onLowStockClick: () => void
}

export function AlertsSection({
  lowStockCount,
  onLowStockClick,
}: AlertsSectionProps) {
  const intl = useIntl()

  if (lowStockCount === 0) {
    return null
  }

  return (
    <>
      <GroupLabel>
        {intl.formatMessage({ id: 'home.section_needs_attention' })}
      </GroupLabel>
      <IonList inset lines="full" className="account-list home-alerts">
        {lowStockCount > 0 ? (
          <IonItem button detail onClick={onLowStockClick}>
            <PackageX slot="start" className="home-alerts__icon home-alerts__icon--warn w-5 h-5" />
            <IonLabel>
              <h3>{intl.formatMessage({ id: 'home.row_low_stock' })}</h3>
            </IonLabel>
            <IonNote slot="end">
              {intl.formatMessage(
                { id: 'home.row_low_stock_count' },
                { count: lowStockCount },
              )}
            </IonNote>
          </IonItem>
        ) : null}
      </IonList>
    </>
  )
}
