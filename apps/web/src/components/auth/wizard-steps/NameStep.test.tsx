import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { IonApp } from '@ionic/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import enUS from '../../../i18n/messages/en-US.json'
import { WizardNavProvider, useWizardNav } from './WizardNavContext'
import { NameStep } from './NameStep'

// Stub the auth context. Each test overrides setName as needed.
vi.mock('@/contexts/auth-context', () => ({
  useAuth: vi.fn(() => ({
    setName: vi.fn().mockResolvedValue({ success: true }),
  })),
}))

// Stub the auth-gate context. NameStep calls playEntry after a
// successful submit; the test only cares that setName ran, so a no-op
// promise resolver is sufficient.
vi.mock('@/contexts/auth-gate-context', () => ({
  useAuthGate: vi.fn(() => ({
    playEntry: vi.fn().mockResolvedValue(undefined),
  })),
}))

import { useAuth } from '@/contexts/auth-context'

// Mark the wizard as new-user so the NameStep's defensive
// router.replace('/') guard doesn't fire during the test.
function Seed() {
  const nav = useWizardNav()
  if (nav.isNewUser !== true) nav.setIsNewUser(true)
  return null
}

const wrap = (node: ReactNode) => (
  <IntlProvider locale="en" messages={enUS as Record<string, string>}>
    <MemoryRouter initialEntries={['/auth']}>
      <IonApp>
        <WizardNavProvider>
          <Seed />
          {node}
        </WizardNavProvider>
      </IonApp>
    </MemoryRouter>
  </IntlProvider>
)

describe('NameStep', () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReturnValue({
      setName: vi.fn().mockResolvedValue({ success: true }),
    } as never)
  })
  afterEach(() => vi.restoreAllMocks())

  it('renders the title and helper line', () => {
    render(wrap(<NameStep />))
    expect(screen.getByText('What should we call you?')).toBeDefined()
    expect(screen.getByText("We'll keep things friendly.")).toBeDefined()
  })

  it('disables Continue when name is fewer than 2 characters', () => {
    render(wrap(<NameStep />))
    const button = screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)

    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'A' } })
    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Al' } })
    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('calls setName with the trimmed name on submit', async () => {
    const setName = vi.fn().mockResolvedValue({ success: true })
    vi.mocked(useAuth).mockReturnValue({ setName } as never)

    render(wrap(<NameStep />))
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: '  Alex  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() => expect(setName).toHaveBeenCalledWith('Alex'))
  })

  it('renders the connection-error fallback when setName fails without a message', async () => {
    const setName = vi.fn().mockResolvedValue({ success: false })
    vi.mocked(useAuth).mockReturnValue({ setName } as never)

    render(wrap(<NameStep />))
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Alex' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() => {
      expect(setName).toHaveBeenCalled()
      expect(screen.getByRole('alert')).toBeDefined()
    })
  })
})
