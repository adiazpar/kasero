'use client'

import { useEffect } from 'react'
import { useRouter } from '@/lib/next-navigation-shim'
import { useAuth } from '@/contexts/auth-context'
import { useBusiness } from '@/contexts/business-context'
// Deep import (not the '@/components/ui' barrel) so this shared guard
// never drags the whole ui barrel (TabContainer -> framer-motion) into
// its importer's chunk.
import { PageSpinner } from '@/components/ui/PageSpinner'

/**
 * ContentGuard - Protects page content while allowing the layout shell to render.
 * Shows a spinner during auth or business loading.
 * Redirects to / (EntryPage) if not authenticated.
 * Business access validation is handled by BusinessContext.
 */
export function ContentGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const { user, isLoading: authLoading } = useAuth()
  const { business, isLoading: businessLoading, error: businessError } = useBusiness()

  useEffect(() => {
    if (authLoading) return

    if (!user) {
      router.replace('/')
      return
    }
  }, [user, authLoading, router])

  // Show spinner only when we genuinely lack data. Once `business` is in
  // hand, a businessLoading=true means BusinessContext is *refreshing* in
  // the background (e.g. after useUpdateBusiness PATCHes the business and
  // awaits validateAccess). Replacing the tree with a spinner there
  // unmounts every page-scoped modal mid-flow — the user taps Save in a
  // manage edit modal, this guard remounts ManageView, and the modal's
  // open-state (held as ManageView local useState) resets to false.
  // The user perceives that as the modal vanishing with no dismiss.
  if (authLoading || (businessLoading && !business)) {
    return (
      <PageSpinner />
    )
  }

  // No user - waiting for redirect
  if (!user) {
    return (
      <PageSpinner />
    )
  }

  // Business error - BusinessContext handles redirect
  if (businessError) {
    return (
      <PageSpinner />
    )
  }

  // No business context (e.g. during route transition through hub)
  if (!business) {
    return null
  }

  // Render children
  return <>{children}</>
}
