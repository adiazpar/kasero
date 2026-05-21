import { IonContent, IonPage } from '@ionic/react'

import { BusinessHeader } from '@/components/layout'
import { LedgerView } from '@/components/tab-shell/views/LedgerView'

// SalesContext / SalesSessionsContext are mounted above the route in
// BusinessProvidersFromUrl, so an open POS session survives tab switches
// (this page unmounts on tab change but the session state does not).
export function LedgerTab() {
  return (
    <IonPage>
      <BusinessHeader />
      <IonContent>
        <LedgerView />
      </IonContent>
    </IonPage>
  )
}
