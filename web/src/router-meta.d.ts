// Types for the `meta` on each route in router.ts.
import "vue-router"

declare module "vue-router" {
  interface RouteMeta {
    /** Needs a signed-in user; others are sent to sign in. */
    auth?: boolean
    /** For signed-out visitors; a signed-in user is sent to the app. */
    guest?: boolean
  }
}
