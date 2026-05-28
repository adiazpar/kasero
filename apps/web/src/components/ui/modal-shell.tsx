import { useMemo, type ReactNode } from 'react'
import {
  IonModal,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonFooter,
  IonButtons,
  IonButton,
  IonIcon,
} from '@ionic/react'
import { close, chevronBack } from 'ionicons/icons'

interface ModalShellProps {
  isOpen: boolean
  onClose: () => void
  /** Header title text. Omit for chromeless modals (rare). */
  title?: string
  /** Drawer height variant. 'full' = [0,1] initial 1; 'half' = [0,0.5,1] initial 0.5. Default 'full'. */
  variant?: 'full' | 'half'
  /** When set, renders a back arrow in the toolbar's start slot. */
  onBack?: () => void
  /** When set, renders inside an IonFooter at the bottom of the modal. */
  footer?: ReactNode
  /**
   * Body content. For multi-step modals, the active step renders its own
   * `IonHeader` + `IonContent` + `IonFooter` directly here; the modal owns
   * a step-stack state and conditionally renders the active step.
   */
  children: ReactNode
  /**
   * When true, children are rendered directly inside IonModal without an
   * auto-wrapped IonContent. Required for any modal whose step body
   * renders its own `IonHeader` / `IonContent` / `IonFooter` chrome
   * (i.e. every multi-step modal in this app).
   */
  rawContent?: boolean
  /**
   * Disables sheet swipe-to-dismiss. Drops the `0` snap point from the
   * breakpoints array and removes the drag handle so the modal can ONLY be
   * dismissed via an explicit close/cancel/done button. Required for any
   * Pattern 1 modal that contains an IonInput AND a Lottie/celebration
   * success step — when iOS dismisses the keyboard mid-step-transition,
   * the resulting visualViewport resize can make Ionic's sheet gesture
   * snap to the `0` breakpoint and auto-dismiss the modal, leaving the
   * backdrop attached and the app feeling bricked. See ionic-team/ionic-framework
   * issues #23878, #25245, #30144.
   */
  noSwipeDismiss?: boolean
  /**
   * Skip the default `.modal-content` horizontal/vertical inset on the
   * auto-rendered IonContent. Use for list-style sheets where each row
   * already paints edge-to-edge with its own padding (UserMenu, action
   * sheets) — adding `.modal-content` on top would double the inset and
   * leave the items floating narrowly inside the sheet.
   */
  flushContent?: boolean
  /**
   * Disables the IonContent inner scroll via `--overflow: hidden`. Use
   * for fixed-layout step bodies that must fit the viewport without
   * scrolling — e.g. cash-keypad steps where scrolling to reach the 0
   * key would be a usability bug. The body must lay itself out with
   * `height: 100%` flex column so it fills (but doesn't overflow) the
   * IonContent's available space.
   */
  noScroll?: boolean
  /**
   * Suppress the auto-rendered header bar (title + X) entirely. Use for
   * terminal success/celebration steps whose primary "Done" button is the
   * only dismissal affordance. This is the explicit, self-documenting form
   * of "no header" — preferred over omitting `title`, which produces the
   * same result implicitly and has silently created close-traps. Has no
   * effect when `rawContent` is set (those modals render their own header).
   */
  chromeless?: boolean
  /**
   * Keep modal contents mounted across open/close cycles. By default
   * Ionic unmounts modal children when the modal is dismissed (frees
   * memory), and remounts them on the next present. Set this to true to
   * force the body to stay mounted from the page's first render — useful
   * when a step's mount-time animation (Lottie, iOS-style enter) needs to
   * be ready before the modal's slide-up so the two don't stack into a
   * diagonal motion. Unused today; keep as an escape hatch.
   */
  keepContentsMounted?: boolean
}

/**
 * ModalShell — the only wrapper used for IonModal in this app. Standardizes
 * the chrome (header + toolbar + close button + breakpoints + drag handle)
 * across all ~30 modals in the app. Multi-step flows live in the consumer:
 *
 *   - Pattern 0: pass a single body via `children`.
 *   - Pattern 1: own a `step` state (or step-stack) in the consumer;
 *     conditionally render the active step's body. For a single-step modal
 *     with a back affordance, pass `onBack` and the shell renders the
 *     chevron in the start slot. For a multi-step stack, the steps own
 *     their own toolbars and render the back chevron themselves driven by
 *     a step-stack context (see NewOrderModal / EditProductModal).
 *
 * **Do NOT nest `<IonNav>` (or any `<IonPage>`) inside the modal.** Even
 * inside the IonModal portal, an IonPage in the React tree registers
 * against the surrounding IonRouterOutlet's StackManager and corrupts its
 * view-stack tracking. The corruption is dormant until the next push+pop
 * in the outer outlet, at which point the outlet serves a cached IonPage
 * from the wrong route under the correct URL. The order modals (and
 * AddProductModal/EditProductModal) were both migrated away from IonNav
 * for this reason — see .claude/docs/modal-system.md, rule 5.
 */
export function ModalShell({
  isOpen,
  onClose,
  title,
  variant = 'full',
  onBack,
  footer,
  children,
  rawContent = false,
  noSwipeDismiss = false,
  flushContent = false,
  noScroll = false,
  keepContentsMounted = false,
  chromeless = false,
}: ModalShellProps) {
  // Sheet-mode is a property of `breakpoints` AND `initialBreakpoint` BOTH being
  // defined — see @ionic/core modal.js: `isSheetModal = breakpoints !== undefined
  // && initialBreakpoint !== undefined`. When sheet-mode is on, IonModal attaches
  // a `KEYBOARD_DID_OPEN` listener (modal.js:474) that briefly disables the sheet
  // gesture to work around a webview-resize bug — but the matching keyboard-DOWN
  // path leaves the gesture in "free-scroll" mode, which on iOS makes the sheet
  // snap-to-0 (dismiss) when an IonInput unmounts mid-step transition. The result
  // is the modal auto-dismisses while a Lottie success step is rendering, and the
  // backdrop can stick → app feels bricked.
  //
  // To kill this entirely, `noSwipeDismiss` makes BOTH breakpoints AND
  // initialBreakpoint undefined, which flips `isSheetModal` to false. The modal
  // becomes a regular IonModal: iOS-style fullscreen card animation, no sheet
  // gesture, no keyboard-coupled gesture handler. `rawContent` is non-sheet
  // for the same reason — each step renders its own IonContent and manages
  // its own per-step layout. Pattern 0/1 modals without `noSwipeDismiss`
  // keep the sheet.
  //
  // The breakpoints array is memoized so passing a fresh reference on every
  // parent render doesn't make IonModal re-evaluate its gesture mid-animation.
  const breakpoints = useMemo<number[] | undefined>(() => {
    if (rawContent || noSwipeDismiss) return undefined
    return variant === 'full' ? [0, 1] : [0, 0.5, 1]
  }, [rawContent, variant, noSwipeDismiss])
  const initialBreakpoint =
    rawContent || noSwipeDismiss
      ? undefined
      : variant === 'full'
        ? 1
        : 0.5
  // Suppress the drag handle when swipe-dismiss is disabled — the handle
  // implies draggability and is misleading if the user can't drag away.
  const showHandle = !rawContent && !noSwipeDismiss

  const showHeader = !chromeless && title !== undefined

  // Dev guard: a non-rawContent modal with neither a title nor an explicit
  // `chromeless` renders no header and no X close button — almost always an
  // unintended close-trap. Surface it loudly in development.
  if (import.meta.env.DEV && !rawContent && !chromeless && title === undefined) {
    console.warn(
      '[ModalShell] No header will render (no `title` and not `chromeless`). ' +
        'Pass a `title` for a content step, or set `chromeless` for a terminal/success step.',
    )
  }

  return (
    <IonModal
      isOpen={isOpen}
      onDidDismiss={onClose}
      breakpoints={breakpoints}
      initialBreakpoint={initialBreakpoint}
      handle={showHandle}
      keepContentsMounted={keepContentsMounted}
    >
      {showHeader && (
        <IonHeader>
          <IonToolbar>
            {/* Toolbar icon buttons use fill="clear" so they inherit
                Ionic's compact default padding rather than the
                pill-shaped CTA padding our ionic-theme.css applies to
                every other ion-button. Without this they sit ~30px
                from the toolbar edge while the body content is at the
                standard 16px inset, leaving them visibly stranded. */}
            {onBack && (
              <IonButtons slot="start">
                <IonButton fill="clear" onClick={onBack} aria-label="Back">
                  <IonIcon icon={chevronBack} />
                </IonButton>
              </IonButtons>
            )}
            <IonTitle>{title}</IonTitle>
            <IonButtons slot="end">
              <IonButton fill="clear" onClick={onClose} aria-label="Close">
                <IonIcon icon={close} />
              </IonButton>
            </IonButtons>
          </IonToolbar>
        </IonHeader>
      )}
      {/* The .modal-content class on the auto-rendered IonContent gives
          every Pattern 0/1 modal the same --page-padding inset + a touch
          of vertical breathing room (CSS in app.css). Pattern 2 wizards
          opt out via rawContent — they manage padding via .wizard-step
          on their own per-step IonContent. List-style sheets (UserMenu,
          action lists where each row paints edge-to-edge) opt out via
          flushContent so the per-item padding isn't doubled. */}
      {rawContent
        ? children
        : (
          <IonContent
            className={[
              flushContent ? '' : 'modal-content',
              noScroll ? 'modal-content--no-scroll' : '',
            ].filter(Boolean).join(' ') || undefined}
          >
            {children}
          </IonContent>
        )}
      {footer && (
        <IonFooter>
          <IonToolbar>
            {/* The .modal-footer wrapper standardises layout for single
                or multi-button footers — see app.css. Children laid out
                in a flex row with equal width, 50px height, pill radius,
                consistent gap. Per-modal layouts that want something
                different can opt out by passing their own wrapper as the
                footer prop. */}
            <div className="modal-footer">{footer}</div>
          </IonToolbar>
        </IonFooter>
      )}
    </IonModal>
  )
}
