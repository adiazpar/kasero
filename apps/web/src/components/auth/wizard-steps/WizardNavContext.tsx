import { createContext, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useSearchParams } from '@/lib/next-navigation-shim'

export type WizardStep = 'email' | 'verify' | 'name'

export interface WizardNav {
  current: WizardStep
  goTo: (step: WizardStep) => void

  email: string
  setEmail: (v: string) => void

  isNewUser: boolean | null
  setIsNewUser: (v: boolean) => void

  name: string
  setName: (v: string) => void
}

const WizardNavContext = createContext<WizardNav | null>(null)

interface ProviderProps {
  children: ReactNode
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function WizardNavProvider({ children }: ProviderProps) {
  // EntryPage hands off via /auth?email={x}&step=verify after a
  // successful OTP send. Honor those params so the wizard resumes at
  // the verify step with the email pre-filled. Anything else (or no
  // params) starts at the email step.
  const searchParams = useSearchParams()
  const initialEmail = useMemo(() => {
    const raw = searchParams.get('email')
    return raw && EMAIL_RE.test(raw.trim()) ? raw.trim() : ''
  }, [searchParams])
  const initialStep = useMemo<WizardStep>(() => {
    const stepParam = searchParams.get('step')
    if (stepParam === 'verify' && initialEmail) return 'verify'
    return 'email'
  }, [searchParams, initialEmail])

  const [current, setCurrent] = useState<WizardStep>(initialStep)
  const [email, setEmail] = useState(initialEmail)
  const [isNewUser, setIsNewUser] = useState<boolean | null>(null)
  const [name, setName] = useState('')

  const value = useMemo<WizardNav>(
    () => ({
      current,
      goTo: (step) => setCurrent(step),
      email,
      setEmail,
      isNewUser,
      setIsNewUser,
      name,
      setName,
    }),
    [current, email, isNewUser, name],
  )

  return <WizardNavContext.Provider value={value}>{children}</WizardNavContext.Provider>
}

export function useWizardNav(): WizardNav {
  const ctx = useContext(WizardNavContext)
  if (!ctx) {
    throw new Error('useWizardNav must be used inside <WizardNavProvider>')
  }
  return ctx
}
