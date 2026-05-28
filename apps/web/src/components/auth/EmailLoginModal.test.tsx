import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { IonApp } from '@ionic/react'
import type { ReactNode } from 'react'
import enUS from '../../i18n/messages/en-US.json'

const push = vi.fn()
vi.mock('@/lib/next-navigation-shim', () => ({
  useRouter: () => ({ push }),
}))

const sendOtp = vi.fn()
vi.mock('@/contexts/auth-context', () => ({
  useAuth: () => ({ sendOtp }),
}))

import { EmailLoginModal } from './EmailLoginModal'

const wrap = (node: ReactNode) => (
  <IntlProvider locale="en" messages={enUS as Record<string, string>}>
    <IonApp>{node}</IonApp>
  </IntlProvider>
)

describe('EmailLoginModal', () => {
  beforeEach(() => {
    push.mockReset()
    sendOtp.mockReset()
    sendOtp.mockResolvedValue({ success: true })
  })
  afterEach(() => vi.restoreAllMocks())

  it('sends the OTP and routes to the verify step on valid submit', async () => {
    render(wrap(<EmailLoginModal isOpen={true} onClose={() => {}} />))
    fireEvent.change(screen.getByTestId('email-modal-input'), {
      target: { value: 'user@example.com' },
    })
    fireEvent.click(screen.getByTestId('email-modal-submit'))
    await waitFor(() => expect(sendOtp).toHaveBeenCalledWith('user@example.com'))
    expect(push).toHaveBeenCalledWith('/auth?email=user%40example.com&step=verify')
  })

  it('shows an inline error and does not navigate when the send fails', async () => {
    sendOtp.mockResolvedValue({ success: false, error: 'Nope' })
    render(wrap(<EmailLoginModal isOpen={true} onClose={() => {}} />))
    fireEvent.change(screen.getByTestId('email-modal-input'), {
      target: { value: 'user@example.com' },
    })
    fireEvent.click(screen.getByTestId('email-modal-submit'))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Nope'))
    expect(push).not.toHaveBeenCalled()
  })

  it('submits via the form (Enter key) and routes to the verify step', async () => {
    render(wrap(<EmailLoginModal isOpen={true} onClose={() => {}} />))
    fireEvent.change(screen.getByTestId('email-modal-input'), {
      target: { value: 'user@example.com' },
    })
    fireEvent.submit(screen.getByTestId('email-modal-form'))
    await waitFor(() => expect(sendOtp).toHaveBeenCalledWith('user@example.com'))
    expect(push).toHaveBeenCalledWith('/auth?email=user%40example.com&step=verify')
  })
})
