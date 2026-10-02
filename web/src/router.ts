import { createRouter, createWebHistory } from "vue-router"
import { useAuth } from "./composables/auth"

export const router = createRouter({
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
          path: "quiz/:id",
          name: "overview",
          component: () => import("./views/OverviewView.vue"),
        },
        {
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
      path: "/app/quiz/:id/edit",
      name: "edit",
      component: () => import("./views/BuilderView.vue"),
      meta: { auth: true },
    },
    {
      path: "/app/quiz/:id/print",
      name: "print",
      component: () => import("./views/PrintView.vue"),
      meta: { auth: true },
    },
    {
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

router.beforeEach(async (to) => {
  const { ready, isLoggedIn } = useAuth()
  await ready()
  if (to.matched.some((r) => r.meta.auth) && !isLoggedIn.value)
    return { name: "login", query: { next: to.fullPath } }
  if (to.matched.some((r) => r.meta.guest) && isLoggedIn.value)
    return { name: "home" }
})
