import { createRouter, createWebHistory } from "vue-router"
import { useAuth } from "./composables/auth"

// Each page is its own chunk, loaded the first time it is visited, so a
// respondent opening a shared quiz does not download the creator's screens.
export const router = createRouter({
  // Real paths (/app/quiz/12), not #/app/quiz/12. The Vite dev server already
  // answers every path with index.html; the deployed server has to do the same.
  history: createWebHistory(),
  routes: [
    {
      // The public site: header and footer around the landing.
      path: "/",
      component: () => import("./layouts/Landing.vue"),
      meta: { guest: true },
      children: [
        {
          path: "",
          name: "landing",
          component: () => import("./views/LandingView.vue"),
        },
      ],
    },
    {
      path: "/login",
      name: "login",
      component: () => import("./views/AuthView.vue"),
      props: { mode: "login" },
      meta: { guest: true },
    },
    {
      path: "/register",
      name: "register",
      component: () => import("./views/AuthView.vue"),
      props: { mode: "register" },
      meta: { guest: true },
    },
    {
      // The two pages Google's OAuth consent screen links to, and the foot of
      // the landing. Plain documents, open to everyone, signed in or not.
      path: "/privacy",
      name: "privacy",
      component: () => import("./views/PrivacyView.vue"),
    },
    {
      path: "/terms",
      name: "terms",
      component: () => import("./views/TermsView.vue"),
    },
    {
      // The creator's app: top bar and sidebar, with the page in the middle.
      // A page that needs no account (the shared quiz a respondent opens)
      // goes beside this route rather than among its children.
      path: "/app",
      component: () => import("./layouts/AppLayout.vue"),
      meta: { auth: true },
      children: [
        {
          path: "",
          name: "home",
          component: () => import("./views/HomeView.vue"),
        },
        {
          path: "responses",
          name: "responses",
          // Every response to every quiz, people still answering first.
          component: () => import("./views/AllResponsesView.vue"),
        },
        {
          // A quiz's overview, as in the QuizApp design and Kyle's dashboard
          // reference: numbers, responses, sharing, options; "Edit quiz" opens
          // the editor.
          path: "quiz/:id",
          name: "overview",
          component: () => import("./views/OverviewView.vue"),
        },
        {
          // A quiz's own pages, from its sidebar (Kyle, 22:58): everyone who
          // answered, the link and QR code, and what can be done to the quiz.
          path: "quiz/:id/responses",
          name: "quiz-responses",
          component: () => import("./views/QuizResponsesView.vue"),
        },
        {
          path: "quiz/:id/sharing",
          name: "quiz-sharing",
          component: () => import("./views/QuizSharingView.vue"),
        },
        {
          path: "quiz/:id/settings",
          name: "quiz-settings",
          component: () => import("./views/QuizSettingsView.vue"),
        },
        {
          // One response, every answer with its verdict (the design's review).
          path: "quiz/:id/responses/:rid",
          name: "response",
          component: () => import("./views/ResponseView.vue"),
        },
        {
          // The account's settings: profile, signing in, theme, devices.
          path: "settings",
          name: "settings",
          component: () => import("./views/SettingsView.vue"),
        },
        {
          path: "archived",
          name: "archived",
          // Quizzes out of the main list; their links do not open.
          component: () => import("./views/ArchivedView.vue"),
        },
      ],
    },
    {
      // The editor: full screen, its own top bar (back, title, Save). Its AI
      // panel (Kyle's sketch of the onboarding) opens from the home prompt box
      // (?ai=1) or the editor's own "Edit with AI".
      path: "/app/quiz/:id/edit",
      name: "edit",
      component: () => import("./views/BuilderView.vue"),
      meta: { auth: true },
    },
    {
      // A quiz as a paper test, in black and white: Set A and B, the answer
      // key, the table of specifications. Full screen, its own controls.
      path: "/app/quiz/:id/print",
      name: "print",
      component: () => import("./views/PrintView.vue"),
      meta: { auth: true },
    },
    {
      // A shared quiz, answered with a name and no account. Open to everyone,
      // signed in or not, so a quiz maker can try their own link.
      path: "/q/:code",
      name: "take",
      component: () => import("./views/TakeView.vue"),
    },
    {
      path: "/:rest(.*)*",
      name: "not-found",
      component: () => import("./views/NotFoundView.vue"),
    },
  ],
})

// `auth` pages send a visitor to sign in, and back afterwards (`next`).
// `guest` pages (the landing, sign-in, create account) send someone already
// signed in to their quizzes, as cutvid sends a returning visitor to projects.
router.beforeEach(async (to) => {
  const { ready, isLoggedIn } = useAuth()
  await ready()
  if (to.matched.some((r) => r.meta.auth) && !isLoggedIn.value)
    return { name: "login", query: { next: to.fullPath } }
  if (to.matched.some((r) => r.meta.guest) && isLoggedIn.value)
    return { name: "home" }
})
