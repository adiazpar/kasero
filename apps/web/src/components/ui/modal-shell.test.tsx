import { describe, it, expect, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { IonApp } from '@ionic/react'
import type { ReactNode } from 'react'
import { ModalShell } from './modal-shell'

const wrapper = ({ children }: { children: ReactNode }) => (
  <IonApp>{children}</IonApp>
)

describe('ModalShell', () => {
  it('renders title in IonTitle when title prop is provided', () => {
    render(
      <ModalShell isOpen={true} onClose={() => {}} title="Edit name">
        <div>body content</div>
      </ModalShell>,
      { wrapper },
    )
    expect(screen.getByText('Edit name')).toBeDefined()
    expect(screen.getByText('body content')).toBeDefined()
  })

  it('does not render title element when title prop is omitted', () => {
    const { container } = render(
      <ModalShell isOpen={true} onClose={() => {}}>
        <div>body content</div>
      </ModalShell>,
      { wrapper },
    )
    expect(container.querySelector('ion-title')).toBeNull()
    expect(screen.getByText('body content')).toBeDefined()
  })

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn()
    render(
      <ModalShell isOpen={true} onClose={onClose} title="Edit name">
        <div>body</div>
      </ModalShell>,
      { wrapper },
    )
    const closeButton = screen.getByRole('button', { name: /close/i })
    act(() => closeButton.click())
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('renders a back button when onBack is provided and calls it on click', () => {
    const onBack = vi.fn()
    render(
      <ModalShell isOpen={true} onClose={() => {}} title="Confirm" onBack={onBack}>
        <div>body</div>
      </ModalShell>,
      { wrapper },
    )
    const backButton = screen.getByRole('button', { name: /back/i })
    act(() => backButton.click())
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('does not render a back button when onBack is omitted', () => {
    render(
      <ModalShell isOpen={true} onClose={() => {}} title="Edit name">
        <div>body</div>
      </ModalShell>,
      { wrapper },
    )
    expect(screen.queryByRole('button', { name: /back/i })).toBeNull()
  })

  it('renders footer content inside an IonFooter when footer prop is provided', () => {
    render(
      <ModalShell
        isOpen={true}
        onClose={() => {}}
        title="Edit"
        footer={<button>Save</button>}
      >
        <div>body</div>
      </ModalShell>,
      { wrapper },
    )
    expect(screen.getByText('Save')).toBeDefined()
  })

  it('uses full-variant breakpoints by default', () => {
    const { container } = render(
      <ModalShell isOpen={true} onClose={() => {}} title="Edit">
        <div>body</div>
      </ModalShell>,
      { wrapper },
    )
    const ionModal = container.querySelector('ion-modal')
    expect(ionModal).not.toBeNull()
    // Ionic stringifies array attributes; full variant is [0, 1] with initial 1
    expect(ionModal?.getAttribute('initial-breakpoint')).toBe('1')
  })

  it('uses half-variant breakpoints when variant="half"', () => {
    const { container } = render(
      <ModalShell isOpen={true} onClose={() => {}} title="Quick" variant="half">
        <div>body</div>
      </ModalShell>,
      { wrapper },
    )
    const ionModal = container.querySelector('ion-modal')
    expect(ionModal?.getAttribute('initial-breakpoint')).toBe('0.5')
  })

  it('renders no header when chromeless, even if a title is provided', () => {
    const { container } = render(
      <ModalShell isOpen={true} onClose={() => {}} title="Saved" chromeless>
        <div>body content</div>
      </ModalShell>,
      { wrapper },
    )
    expect(container.querySelector('ion-header')).toBeNull()
    expect(screen.queryByText('Saved')).toBeNull()
    expect(screen.queryByRole('button', { name: /close/i })).toBeNull()
    expect(screen.getByText('body content')).toBeDefined()
  })

  it('still renders the header + close when a title is provided and not chromeless', () => {
    const { container } = render(
      <ModalShell isOpen={true} onClose={() => {}} title="Edit name">
        <div>body</div>
      </ModalShell>,
      { wrapper },
    )
    expect(container.querySelector('ion-header')).not.toBeNull()
    expect(screen.getByText('Edit name')).toBeDefined()
    expect(screen.getByRole('button', { name: /close/i })).toBeDefined()
  })
})
