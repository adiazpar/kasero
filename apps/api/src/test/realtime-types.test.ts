import { describe, it, expect, expectTypeOf } from 'vitest'
import type {
  RealtimeEvent,
  BusinessRealtimeEvent,
  UserRealtimeEvent,
  CriticalUserRealtimeEvent,
  SystemRealtimeEvent,
} from '@kasero/shared/realtime'
import { businessChannel, userChannel, userStream } from '@kasero/shared/realtime'

describe('realtime types', () => {
  it('businessChannel formats correctly', () => {
    expect(businessChannel('biz-1')).toBe('business:biz-1')
  })
  it('userChannel formats correctly', () => {
    expect(userChannel('u-1')).toBe('user:u-1')
  })
  it('userStream formats correctly', () => {
    expect(userStream('u-1')).toBe('stream:user:u-1')
  })

  it('RealtimeEvent is the union of all sub-unions', () => {
    type Expected =
      | BusinessRealtimeEvent
      | UserRealtimeEvent
      | CriticalUserRealtimeEvent
      | SystemRealtimeEvent
    expectTypeOf<RealtimeEvent>().toEqualTypeOf<Expected>()
  })

  it('exhaustiveness check fails at compile time on missing branch', () => {
    // This function MUST cover every event type — adding a new event
    // without updating the switch is a compile error.
    function dispatch(e: RealtimeEvent): string {
      switch (e.type) {
        case 'team.member.joined':
        case 'team.member.removed':
        case 'team.member.role_changed':
        case 'team.member.status_changed':
        case 'team.invite.created':
        case 'team.invite.regenerated':
        case 'team.invite.consumed':
        case 'team.invite.deleted':
        case 'business.updated':
          return 'biz'
        case 'profile.updated':
        case 'business.list.changed':
          return 'user'
        case 'session.revoked':
        case 'business.deleted':
        case 'ownership.transferred':
          return 'critical'
        case 'system.resync':
        case 'system.error':
        case 'system.auth_expired':
          return 'system'
        default: {
          // Exhaustiveness assertion — if a new event type is added to
          // RealtimeEvent without a case above, this assignment to
          // `never` becomes a compile error. That is the entire point
          // of this test: TS prevents drift between event taxonomy and
          // dispatcher coverage.
          const _exhaustive: never = e
          return _exhaustive
        }
      }
    }
    expect(dispatch({ type: 'system.resync' })).toBe('system')
  })
})
