import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { WizardNavProvider, useWizardNav } from './WizardNavContext'

const makeWrapper = (initialEntry: string) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter initialEntries={[initialEntry]}>
        <WizardNavProvider>{children}</WizardNavProvider>
      </MemoryRouter>
    )
  }

describe('WizardNavContext', () => {
  it('starts on the email step with empty fields when no URL params are present', () => {
    const { result } = renderHook(() => useWizardNav(), {
      wrapper: makeWrapper('/auth'),
    })
    expect(result.current.current).toBe('email')
    expect(result.current.email).toBe('')
    expect(result.current.name).toBe('')
    expect(result.current.isNewUser).toBe(null)
  })

  it('starts on the verify step when ?email=...&step=verify is set', () => {
    const { result } = renderHook(() => useWizardNav(), {
      wrapper: makeWrapper(
        `/auth?email=${encodeURIComponent('a@b.co')}&step=verify`,
      ),
    })
    expect(result.current.current).toBe('verify')
    expect(result.current.email).toBe('a@b.co')
  })

  it('ignores step=verify when no email param is present', () => {
    const { result } = renderHook(() => useWizardNav(), {
      wrapper: makeWrapper('/auth?step=verify'),
    })
    expect(result.current.current).toBe('email')
    expect(result.current.email).toBe('')
  })

  it('ignores a malformed email param and stays on the email step', () => {
    const { result } = renderHook(() => useWizardNav(), {
      wrapper: makeWrapper('/auth?email=not-an-email&step=verify'),
    })
    expect(result.current.current).toBe('email')
    expect(result.current.email).toBe('')
  })

  it('goTo moves between steps without losing field values', () => {
    const { result } = renderHook(() => useWizardNav(), {
      wrapper: makeWrapper('/auth'),
    })

    act(() => result.current.setEmail('a@b.co'))
    act(() => result.current.goTo('verify'))
    expect(result.current.current).toBe('verify')
    expect(result.current.email).toBe('a@b.co')

    act(() => result.current.setIsNewUser(true))
    act(() => result.current.goTo('name'))
    expect(result.current.current).toBe('name')
    expect(result.current.isNewUser).toBe(true)

    act(() => result.current.setName('Alex'))
    expect(result.current.name).toBe('Alex')
    expect(result.current.email).toBe('a@b.co')
  })

  it('useWizardNav throws when used outside the provider', () => {
    const orig = console.error
    console.error = () => {}
    try {
      expect(() => renderHook(() => useWizardNav())).toThrow()
    } finally {
      console.error = orig
    }
  })
})
