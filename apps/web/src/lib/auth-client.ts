import { createAuthClient } from 'better-auth/react'
import {
  emailOTPClient,
  inferAdditionalFields,
} from 'better-auth/client/plugins'
// Force-import the path-to-object types via the public `better-auth/client`
// entry so the inferred `authClient` type can name them without referencing
// the unresolvable `better-auth/dist/client/path-to-object` deep path that
// would otherwise trip TS2742 under `composite: true`. The imports are
// pure type-only sentinels — the bundler strips them at build time.
import type {
  InferRoutes as _InferRoutes,
  PathToObject as _PathToObject,
  InferClientAPI as _InferClientAPI,
} from 'better-auth/client'
import { API_ORIGIN } from './api-origin'
import { getBearerToken, setBearerToken } from './native/auth-token'

// Reference the imports so TS keeps them in scope for emit.
type _PathToObjectAnchor =
  | _InferRoutes<Record<string, unknown>, { plugins: [] }>
  | _PathToObject<'/', () => void>
  | _InferClientAPI<{ plugins: [] }>
const _pathToObjectAnchor: _PathToObjectAnchor | undefined = undefined
void _pathToObjectAnchor

// Same-origin in production (the SPA shell is served by the API). In dev,
// Vite proxies /api/* to the API server, so the empty baseURL still works.
// VITE_AUTH_BASE_URL is only needed when the SPA needs to call a different
// origin (e.g. a previewing developer pointing the web build at a remote API).
// Native (Capacitor) builds set VITE_API_ORIGIN, which API_ORIGIN mirrors —
// the WebView origin is capacitor://kasero.localhost so the client must target
// the deployed API absolutely. On web both env vars are unset and baseURL
// stays '' exactly as before.
const baseURL = import.meta.env.VITE_AUTH_BASE_URL ?? API_ORIGIN

// Mirror of the `additionalFields` block in apps/api/src/lib/auth.ts. The
// server auth module is `'server-only'` so we can't import its type here;
// instead we re-declare the shape so `authClient.updateUser({ language })`
// and `session.user.{language,phoneNumber,phoneNumberVerified}` are typed.
// If you add/rename a user additionalField in apps/api/src/lib/auth.ts,
// mirror the change here.
//
// `as const` is load-bearing: better-auth's InferFieldsInputClient narrows
// "required" / "defaultValue" / "input" against literal types — without
// the const assertion, the booleans widen to `boolean` and every field
// gets surfaced as required on the sign-up payload.
const userAdditionalFields = {
  language: {
    type: 'string',
    required: false,
    defaultValue: 'en-US',
    input: true,
  },
  phoneNumber: {
    type: 'string',
    required: false,
    input: true,
  },
  phoneNumberVerified: {
    type: 'boolean',
    required: false,
    defaultValue: false,
    input: false,
  },
} as const

// We wrap the factory call in a function so the inferred return type is
// fully resolved at the call site instead of leaking the internal
// `better-auth/dist/client/path-to-object.mjs` reference into a top-level
// declaration. Without the wrapper, `export const authClient = ...` emits
// TS2742 under `composite: true` because the inferred shape names that
// internal module path, which isn't portable across `.d.ts` emit. A naive
// `ReturnType<typeof createAuthClient>` annotation collapses the generic
// to an empty-plugin form, which strips the typings for our
// additionalFields (`language`, `phoneNumber`, …) on `updateUser` and
// `session.user`, so we deliberately keep the wrapper pattern instead.
function makeAuthClient() {
  return createAuthClient({
    baseURL,
    // Native bearer-token flow. Both callbacks are inert on web:
    // - getBearerToken() is always null on web, and better-fetch skips
    //   the Authorization header entirely for a falsy Bearer token
    //   (node_modules/@better-fetch/fetch/dist/index.js getAuthHeader),
    //   so web requests are byte-identical to before.
    // - set-auth-token is only emitted by the server's bearer plugin; on
    //   web setBearerToken() is a guarded no-op anyway.
    fetchOptions: {
      auth: {
        type: 'Bearer',
        token: () => getBearerToken() ?? '',
      },
      onSuccess: (ctx: { response: Response }) => {
        const token = ctx.response.headers.get('set-auth-token')
        if (token) void setBearerToken(token)
      },
    },
    plugins: [
      emailOTPClient(),
      inferAdditionalFields({ user: userAdditionalFields }),
    ],
  })
}

export const authClient: ReturnType<typeof makeAuthClient> = makeAuthClient()
