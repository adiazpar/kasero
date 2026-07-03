import { useIntl } from 'react-intl'
import { useEffect, useRef } from 'react'
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonSpinner,
  IonButtons,
  IonButton,
  IonIcon,
} from '@ionic/react'
import { close } from 'ionicons/icons'
import { LottiePlayerDynamic } from '@/components/animations'
import { useProductForm } from '@/contexts/product-form-context'
import { useProductNav, useAddProductCallbacks } from './ProductNavContext'

type Phase = 'preparing' | 'identifying' | 'generating' | 'removing-bg' | 'analyzing'

const PHASE_ORDER: Phase[] = ['preparing', 'identifying', 'generating', 'removing-bg']

export function AnalyzingStep() {
  const t = useIntl()
  const nav = useProductNav()
  const { onAbortAiProcessing, onClose, onStartAiPipeline, suggestedCategoryName } =
    useAddProductCallbacks()
  const { pipelineStep, isCompressing, error, setError } = useProductForm()

  const isError = pipelineStep === 'error'

  // Track whether we've already navigated away from this step to avoid pushing twice.
  const navigatedRef = useRef(false)

  useEffect(() => {
    if (navigatedRef.current) return
    if (pipelineStep === 'complete') {
      navigatedRef.current = true
      if (suggestedCategoryName) {
        nav.push('suggested-category')
      } else {
        nav.push('review')
      }
    }
  }, [pipelineStep, suggestedCategoryName, nav])

  function handleRetry() {
    setError('')
    onStartAiPipeline()
  }

  // Determine current phase for the heading + ledger.
  const currentPhase: Phase = isCompressing
    ? 'preparing'
    : pipelineStep === 'identifying'
    ? 'identifying'
    : pipelineStep === 'generating'
    ? 'generating'
    : pipelineStep === 'removing-bg'
    ? 'removing-bg'
    : 'analyzing'

  function isPhaseDone(p: Phase): boolean {
    if (currentPhase === 'analyzing') return false
    const ci = PHASE_ORDER.indexOf(currentPhase)
    const pi = PHASE_ORDER.indexOf(p)
    return pi >= 0 && pi < ci
  }

  const phaseLabel: Record<Phase, string> = {
    preparing: t.formatMessage({ id: 'aiPipeline.preparing_photo' }),
    identifying: t.formatMessage({ id: 'aiPipeline.identifying' }),
    generating: t.formatMessage({ id: 'aiPipeline.generating_icon' }),
    'removing-bg': t.formatMessage({ id: 'aiPipeline.removing_bg' }),
    analyzing: t.formatMessage({ id: 'aiPipeline.analyzing' }),
  }

  function handleCancel() {
    onAbortAiProcessing()
    onClose()
  }

  return (
    <>
      <IonHeader className="pm-header">
        <IonToolbar>
          <IonTitle>
            {t.formatMessage({ id: 'productForm.ai_step_analyzing_title' })}
          </IonTitle>
          <IonButtons slot="end">
            <IonButton
              fill="clear"
              onClick={handleCancel}
              aria-label={t.formatMessage({ id: 'common.close' })}
            >
              <IonIcon icon={close} />
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent className="pm-content">
        {isError ? (
          <div className="pm-analyzing pm-analyzing--error">
            <div className="pm-analyzing__lottie" aria-hidden="true">
              <LottiePlayerDynamic
                src="/animations/error.json"
                loop={false}
                autoplay
                style={{ width: '100%', height: '100%' }}
              />
            </div>

            <h2 className="pm-analyzing__heading">
              {t.formatMessage(
                { id: 'aiPipeline.error_heading' },
                { em: (chunks) => <em key="em">{chunks}</em> },
              )}
            </h2>

            <p className="pm-hero__subtitle" style={{ textAlign: 'center' }}>
              {error || t.formatMessage({ id: 'aiPipeline.error_fallback' })}
            </p>

            <IonButton expand="block" onClick={handleRetry}>
              {t.formatMessage({ id: 'aiPipeline.try_again' })}
            </IonButton>
          </div>
        ) : (
          <div className="pm-analyzing">
            <span className="pm-analyzing__ring">
              <IonSpinner name="crescent" />
            </span>

            <h2 className="pm-analyzing__heading">
              {t.formatMessage(
                { id: 'productAddEdit.analyzing_heading' },
                { em: (chunks) => <em key="em">{chunks}</em> },
              )}
            </h2>

            <span className="pm-analyzing__caption">
              {phaseLabel[currentPhase]}
              <span className="pm-analyzing__dots" aria-hidden="true">
                <span className="pm-analyzing__dot" />
                <span className="pm-analyzing__dot" />
                <span className="pm-analyzing__dot" />
              </span>
            </span>

            <div className="pm-analyzing__phases">
              {PHASE_ORDER.map((p) => {
                const active = currentPhase === p
                const done = isPhaseDone(p)
                return (
                  <div
                    key={p}
                    className={`pm-analyzing__phase ${
                      active
                        ? 'pm-analyzing__phase--active'
                        : done
                        ? 'pm-analyzing__phase--done'
                        : ''
                    }`}
                  >
                    <span>{phaseLabel[p]}</span>
                    <span
                      className="pm-analyzing__phase-leader"
                      aria-hidden="true"
                    />
                    <span>
                      {done
                        ? t.formatMessage({ id: 'productAddEdit.phase_done' })
                        : active
                        ? t.formatMessage({ id: 'productAddEdit.phase_running' })
                        : t.formatMessage({ id: 'productAddEdit.phase_pending' })}
                    </span>
                  </div>
                )
              })}
            </div>

            <p className="pm-hero__subtitle" style={{ textAlign: 'center', marginTop: 'var(--space-2)' }}>
              {t.formatMessage({ id: 'aiPipeline.may_take_seconds' })}
            </p>
          </div>
        )}
      </IonContent>
    </>
  )
}
