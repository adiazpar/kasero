const FLAGS = {
  expenses_v1: true, // flip to false to disable the entire Phase A surface
} as const

export type FeatureFlag = keyof typeof FLAGS

export function isFeatureEnabled(flag: FeatureFlag): boolean {
  if (typeof window !== 'undefined') {
    const override = window.localStorage.getItem(`feature:${flag}`)
    if (override === '1') return true
    if (override === '0') return false
  }
  return FLAGS[flag]
}

export function useFeatureFlag(flag: FeatureFlag): boolean {
  return isFeatureEnabled(flag)
}
