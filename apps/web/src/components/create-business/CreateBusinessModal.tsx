import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { ModalShell } from '@/components/ui'
import type { UseCreateBusinessReturn } from '@/hooks'
import { NameStep } from './steps/NameStep'
import { LocaleStep } from './steps/LocaleStep'
import { LogoStep } from './steps/LogoStep'
import { SuccessStep } from './steps/SuccessStep'

// ---------------------------------------------------------------------------
// Step-stack nav context — steps call nav.push('next-key') / nav.pop() to
// move between steps. The previous IonNav-based version registered each
// step's <IonPage> against the surrounding IonRouterOutlet's StackManager
// from inside the IonModal portal, which corrupted the outlet's view-stack
// tracking and surfaced as wrong-page-under-correct-URL after the next
// push+pop in the outer outlet. See .claude/docs/modal-system.md rule 5
// and the order-modal / product-modal references.
// ---------------------------------------------------------------------------

export type CreateBusinessStep = 'name' | 'locale' | 'logo' | 'success'

export interface CreateBusinessNav {
  push: (step: CreateBusinessStep) => void
  pop: () => void
  /** Total entries in the back stack. Steps render the back chevron only
   *  when depth > 1; depth === 1 is the root (close X only). */
  depth: number
}

export const CreateBusinessNavContext = createContext<CreateBusinessNav | null>(null)

export function useCreateBusinessNav(): CreateBusinessNav {
  const ctx = useContext(CreateBusinessNavContext)
  if (!ctx) throw new Error('useCreateBusinessNav must be used inside CreateBusinessModal')
  return ctx
}

// ---------------------------------------------------------------------------
// createBusiness prop context — all form state and actions live here.
// ---------------------------------------------------------------------------

export const CreateBusinessContext = createContext<UseCreateBusinessReturn | null>(null)

export function useCreateBusinessCtx(): UseCreateBusinessReturn {
  const ctx = useContext(CreateBusinessContext)
  if (!ctx) throw new Error('useCreateBusinessCtx must be used inside CreateBusinessModal')
  return ctx
}

// ---------------------------------------------------------------------------
// Modal root
// ---------------------------------------------------------------------------

const INITIAL_STACK: CreateBusinessStep[] = ['name']

interface CreateBusinessModalProps {
  createBusiness: UseCreateBusinessReturn
}

export function CreateBusinessModal({ createBusiness }: CreateBusinessModalProps) {
  const { isOpen, handleClose, handleExitComplete } = createBusiness
  const [stack, setStack] = useState<CreateBusinessStep[]>(INITIAL_STACK)

  // Reset the stack to the root every time the modal opens. The same modal
  // component is reused across consecutive create-business flows.
  useEffect(() => {
    if (isOpen) setStack(INITIAL_STACK)
  }, [isOpen])

  // Combine close + exit-complete so ModalShell's single onClose covers both.
  // IonModal fires onDidDismiss (mapped to onClose) after the dismiss animation,
  // so state reset happens at the right moment.
  const onClose = useCallback(() => {
    handleClose()
    handleExitComplete()
  }, [handleClose, handleExitComplete])

  const push = useCallback((step: CreateBusinessStep) => {
    setStack((s) => [...s, step])
  }, [])
  const pop = useCallback(() => {
    setStack((s) => (s.length > 1 ? s.slice(0, -1) : s))
  }, [])

  const nav: CreateBusinessNav = useMemo(
    () => ({ push, pop, depth: stack.length }),
    [push, pop, stack.length],
  )

  const current = stack[stack.length - 1]

  return (
    <CreateBusinessContext.Provider value={createBusiness}>
      <CreateBusinessNavContext.Provider value={nav}>
        <ModalShell isOpen={isOpen} onClose={onClose} rawContent>
          {current === 'name' && <NameStep />}
          {current === 'locale' && <LocaleStep />}
          {current === 'logo' && <LogoStep />}
          {current === 'success' && <SuccessStep />}
        </ModalShell>
      </CreateBusinessNavContext.Provider>
    </CreateBusinessContext.Provider>
  )
}
