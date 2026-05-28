// Global test setup. Adds jest-dom matchers, MSW server, etc., here as needed.

import '@testing-library/jest-dom/vitest'
import { vi } from 'vitest'
import React from 'react'

/**
 * IonModal renders its children into a `<template>` element in JSDOM (Ionic
 * uses a `createInlineOverlayComponent` factory that wraps in `<template>` so
 * the overlay portal can be moved into the ion-app at runtime). JSDOM never
 * runs custom-element constructors, so the portal never materializes —
 * children stay locked in the DocumentFragment behind `<template>`, which
 * the ARIA accessibility tree ignores.
 *
 * Additionally, IonButton renders as `<ion-button>` (a web component), which
 * has no implicit ARIA role in JSDOM, so `getByRole('button', ...)` can never
 * match it.
 *
 * The mock below replaces the two problematic components with lightweight
 * wrappers that behave correctly in JSDOM:
 *
 *   IonModal  → renders children directly when `isOpen` is true; forwards
 *               the `initial-breakpoint` attribute so breakpoint tests pass.
 *   IonButton → renders a native `<button>` so `getByRole('button', {name})`
 *               can match via aria-label.
 *
 * All other @ionic/react exports are forwarded from the real module so
 * existing tests (IonApp, IonHeader, IonToolbar, IonTitle, IonContent,
 * IonFooter, IonButtons, IonIcon, useIonRouter, etc.) are unaffected.
 *
 * NOTE: All multi-step modals in this app are Pattern 1 (state-driven step
 * stack, no IonNav, no nested IonPages — see .claude/docs/modal-system.md
 * rule 5). Each active step renders its own IonHeader/IonContent/IonFooter
 * inside ModalShell, which JSDOM handles fine via the mock above. Pattern 2
 * (IonNav inside IonModal) is forbidden — the per-step IonPage registers
 * against the outer IonRouterOutlet's StackManager and corrupts its view
 * tracking — so no test coverage gap remains on that axis.
 */
vi.mock('@ionic/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ionic/react')>()

  function IonModalMock({
    isOpen,
    initialBreakpoint,
    children,
  }: {
    isOpen?: boolean
    initialBreakpoint?: number
    children?: React.ReactNode
    [key: string]: unknown
  }) {
    return React.createElement(
      'ion-modal',
      { 'initial-breakpoint': String(initialBreakpoint ?? 1), 'is-open': isOpen ? '' : undefined },
      isOpen ? children : null,
    )
  }

  function IonButtonMock({
    children,
    onClick,
    'aria-label': ariaLabel,
    disabled,
    type,
    'data-testid': dataTestid,
  }: {
    children?: React.ReactNode
    onClick?: () => void
    'aria-label'?: string
    disabled?: boolean
    type?: 'button' | 'submit' | 'reset'
    'data-testid'?: string
    [key: string]: unknown
  }) {
    return React.createElement(
      'button',
      { type: type ?? 'button', onClick, 'aria-label': ariaLabel, disabled, 'data-testid': dataTestid },
      children,
    )
  }

  // IonFooter uses Shadow DOM in jsdom, which causes it to swallow its
  // light-DOM children — they never appear in the accessibility tree or the
  // Testing Library query results. Replace it with a plain <div> that passes
  // children through so footer buttons are reachable in tests.
  function IonFooterMock({ children }: { children?: React.ReactNode; [key: string]: unknown }) {
    return React.createElement('ion-footer', {}, children)
  }

  // IonToolbar similarly renders as an opaque custom element in jsdom.
  // Replace with a pass-through so its contents (footer buttons, toolbar
  // icons) remain in the DOM and are reachable by queries.
  function IonToolbarMock({ children }: { children?: React.ReactNode; [key: string]: unknown }) {
    return React.createElement('ion-toolbar', {}, children)
  }

  return {
    ...actual,
    IonModal: IonModalMock,
    IonButton: IonButtonMock,
    IonFooter: IonFooterMock,
    IonToolbar: IonToolbarMock,
  }
})
