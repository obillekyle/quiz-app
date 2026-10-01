<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue"
import { useRoute, useRouter } from "vue-router"
import AccountMenu from "../components/AccountMenu.vue"
import NotificationsMenu from "../components/NotificationsMenu.vue"
import Icon from "../components/Icon.vue"
import LogoMark from "../components/LogoMark.vue"
import { useCookie } from "../composables/cookie"
import { pageCrumb } from "../composables/crumb"
import { quizColor, useQuizzes } from "../composables/quizzes"

/*
 * The creator's app around every page: a top bar and a sidebar.
 *
 * A computer's bar is laid out like Kajabi's (Kyle's reference, 23:20): the
 * QuizApp chip over the sidebar's column, the trail to the page from where
 * the page begins, and on the right a search icon and the account. The fold
 * toggle sits at the top of the sidebar itself.
 *
 * A phone's bar is the menu, QuizApp centered, search and the account; inside
 * a quiz it is the menu, the quiz's title and Edit. Its sidebar is a drawer.
 */
const route = useRoute()
const router = useRouter()

// ---- the sidebar ------------------------------------------------------------
// A computer folds it to an icon rail and remembers that in a cookie; a phone
// opens it as a drawer over the page, closed on every page change.
const foldedCookie = useCookie("qa_sidebar")
const folded = computed(() => foldedCookie.value === "folded")
const drawer = ref(false)
// The width animates for the fold and for nothing else. A transition left on
// the sidebar for good also ran whenever the phone's layout gave way to the
// computer's, growing the column from the drawer's width: a full-page capture
// passes the view through a phone size, and a ResizeObserver on the sidebar
// read 247, 0, 25, 100, 149, 202 ... 247 px across one, the picture taken at
// 202.
const folding = ref(false)
let foldTimer: number | undefined
function fold() {
  folding.value = true
  clearTimeout(foldTimer)
  foldTimer = window.setTimeout(() => (folding.value = false), 250)
  foldedCookie.value = folded.value ? null : "folded"
}
watch(
  () => route.fullPath,
  () => (drawer.value = false),
)

const nav = [
  { to: "/app", label: "Home", icon: "home" },
  { to: "/app/responses", label: "Responses", icon: "responses" },
  { to: "/app/archived", label: "Archived", icon: "archive" },
] as const

const { quizzes } = useQuizzes()
// Archived quizzes have their own page and leave Recent, as they leave home.
const recent = computed(() =>
  quizzes.value.filter((q) => !q.archived).slice(0, 5),
)

// ---- inside a quiz -------------------------------------------------------------
const quizId = computed(() =>
  route.params.id ? Number(route.params.id) : null,
)
const quizTitle = computed(
  () => quizzes.value.find((q) => q.id === quizId.value)?.title ?? "Quiz",
)
// The quiz's own pages, in its sidebar (Kyle, 22:58), the way a project's
// sidebar works.
const quizNav = computed(() => {
  const base = `/app/quiz/${quizId.value}`
  return [
    { to: base, label: "Overview", icon: "overview", on: ["overview"] },
    { to: `${base}/edit`, label: "Edit quiz", icon: "edit", on: [] },
    {
      to: `${base}/responses`,
      label: "Respondents",
      icon: "people",
      on: ["quiz-responses", "response"],
    },
    {
      to: `${base}/sharing`,
      label: "Sharing",
      icon: "share",
      on: ["quiz-sharing"],
    },
    {
      to: `${base}/settings`,
      label: "Settings",
      icon: "settings",
      on: ["quiz-settings"],
    },
  ] as const
})

// ---- the trail to the page ------------------------------------------------------
type Crumb = { label: string; to?: string }
const PAGE: Record<string, string> = {
  "quiz-responses": "Respondents",
  response: "Respondents",
  "quiz-sharing": "Sharing",
  "quiz-settings": "Settings",
}
const trail = computed<Crumb[]>(() => {
  const name = String(route.name)
  if (quizId.value != null) {
    const base = `/app/quiz/${quizId.value}`
    const page = PAGE[name]
    return [
      { label: "Your quizzes", to: "/app" },
      { label: quizTitle.value, to: page ? base : undefined },
      ...(page
        ? [
            {
              label: page,
              to: name === "response" ? `${base}/responses` : undefined,
            },
          ]
        : []),
      // One response: the person's name, which the page itself knows.
      ...(name === "response" && pageCrumb.value
        ? [{ label: pageCrumb.value }]
        : []),
    ]
  }
  if (name === "home") return [{ label: "Your quizzes" }]
  if (name === "responses") return [{ label: "Responses" }]
  if (name === "archived") return [{ label: "Archived" }]
  if (name === "settings") return [{ label: "Settings" }]
  return []
})

// ---- one left edge for the trail and the page --------------------------------------
// A page's column is at most 1120 px, centered in the space beside the
// sidebar (Kyle, 23:50). The trail moves right by the same amount, so it
// still starts where the page does. A quiz's overview keeps its 360 px panel
// at the window's edge while it is wider than 900 px, and centers its page in
// what is left, less the scrollbar its page column always keeps room for
// (measured once, since its width depends on the platform).
const PAGE_W = 1120
const PANEL_W = 360
const contentEl = ref<HTMLElement>()
const contentW = ref(0)
const gutter = ref(0)
let sizer: ResizeObserver | undefined
onMounted(() => {
  sizer = new ResizeObserver(([e]) => (contentW.value = e!.contentRect.width))
  if (!contentEl.value) return
  sizer.observe(contentEl.value)
  const probe = document.createElement("div")
  probe.style.cssText =
    "position:absolute;visibility:hidden;width:100px;height:50px;overflow-y:scroll"
  contentEl.value.append(probe)
  gutter.value = probe.offsetWidth - probe.clientWidth
  probe.remove()
})
onBeforeUnmount(() => sizer?.disconnect())
const shift = computed(() => {
  const panel =
    route.name === "overview" && contentW.value > 900
      ? PANEL_W + gutter.value
      : 0
  return Math.max(0, Math.floor((contentW.value - panel - PAGE_W) / 2))
})

// ---- search: kept in the address (?q=), so the home page filters by it ------
const search = computed({
  get: () => (typeof route.query.q === "string" ? route.query.q : ""),
  set: (q: string) => {
    const query = { ...route.query, q: q || undefined }
    if (route.name === "home") router.replace({ query })
    else router.push({ name: "home", query })
  },
})
// An icon until it is pressed; the field stays open while it holds a search.
const searching = ref(!!search.value)
const searchField = ref<HTMLInputElement>()
async function openSearch() {
  searching.value = true
  await nextTick()
  searchField.value?.focus()
}
function closeSearch() {
  searching.value = false
  if (search.value) search.value = ""
}
</script>

<template>
  <header
    class="topbar"
    :data-searching="searching || undefined"
    :data-in-quiz="quizId != null || undefined"
    :data-folded="folded || undefined"
    :style="{ '--shift': `${shift}px` }"
  >
    <!-- A phone's way to its drawer; a computer's toggle is in the sidebar. -->
    <button
      class="icon-button menu"
      aria-label="Open the menu"
      :aria-expanded="drawer"
      @click="drawer = !drawer"
    >
      <Icon name="panel" />
    </button>

    <div class="brand-slot">
      <RouterLink to="/app" class="brand" aria-label="QuizApp, your quizzes">
        <LogoMark :size="26" />
        <span>QuizApp</span>
      </RouterLink>
    </div>

    <nav v-if="trail.length" class="trail" aria-label="Breadcrumb">
      <template v-for="(c, i) in trail" :key="i">
        <span v-if="i" aria-hidden="true" class="sep">/</span>
        <RouterLink v-if="c.to" :to="c.to" :class="{ quiz: i === 1 }">{{
          c.label
        }}</RouterLink>
        <span v-else aria-current="page" :class="{ quiz: i === 1 }">{{
          c.label
        }}</span>
      </template>
    </nav>

    <!-- A phone, inside a quiz: its title and Edit. -->
    <template v-if="quizId != null">
      <span class="quiz-title">{{ quizTitle }}</span>
      <RouterLink :to="`/app/quiz/${quizId}/edit`" class="quiz-edit"
        >Edit</RouterLink
      >
    </template>

    <div class="tools">
      <label v-if="searching" class="search">
        <Icon name="search" :size="18" />
        <input
          ref="searchField"
          v-model="search"
          type="search"
          placeholder="Search your quizzes"
          aria-label="Search your quizzes"
          @keydown.esc="closeSearch"
        />
        <button
          class="clear"
          aria-label="Close the search"
          title="Close the search"
          @click="closeSearch"
        >
          <Icon name="close" :size="18" />
        </button>
      </label>
      <button
        v-else
        class="icon-button tool"
        aria-label="Search your quizzes"
        title="Search your quizzes"
        @click="openSearch"
      >
        <Icon name="search" />
      </button>
      <NotificationsMenu />
    </div>
  </header>

  <div class="body">
    <nav
      class="sidebar"
      aria-label="Main"
      :data-folded="folded || undefined"
      :data-folding="folding || undefined"
      :data-open="drawer || undefined"
    >
      <!-- The fold toggle, at the top of the sidebar it folds (Kyle, 23:22). -->
      <div class="sidebar-top">
        <!-- A new quiz starts from a request or a module, in home's prompt box.
             An action, not a page: the plus in a filled circle, as Claude's
             app draws New chat, and no fill on the row but the hover's. -->
        <RouterLink
          :to="{ name: 'home', query: { new: '1' } }"
          class="new-quiz"
          :title="folded ? 'New quiz' : undefined"
        >
          <span class="plus"><Icon name="plus" /></span>
          <span class="label">New quiz</span>
        </RouterLink>
        <button
          class="icon-button fold"
          :aria-label="folded ? 'Show the sidebar' : 'Hide the sidebar'"
          :title="folded ? 'Show the sidebar' : 'Hide the sidebar'"
          :aria-expanded="!folded"
          @click="fold"
        >
          <Icon name="panel" />
        </button>
      </div>

      <template v-if="quizId == null">
        <div class="sidebar-section">
          <RouterLink
            v-for="n in nav"
            :key="n.to"
            :to="n.to"
            class="item"
            :title="folded ? n.label : undefined"
          >
            <Icon :name="n.icon" />
            <span>{{ n.label }}</span>
          </RouterLink>
        </div>

        <div class="sidebar-section" v-if="recent.length">
          <h2>Recent</h2>
          <RouterLink
            v-for="q in recent"
            :key="q.id"
            :to="`/app/quiz/${q.id}`"
            class="item recent"
            :title="folded ? q.title : undefined"
          >
            <i :style="{ background: quizColor(q.id) }" />
            <span>{{ q.title }}</span>
          </RouterLink>
        </div>
      </template>

      <!-- Inside a quiz: the quiz and its pages (and, in a phone's drawer, the way back). -->
      <template v-else>
        <div class="sidebar-section back-section">
          <RouterLink to="/app" class="item">
            <Icon name="back" />
            <span>Your quizzes</span>
          </RouterLink>
        </div>
        <div class="sidebar-section">
          <div class="quiz-id" :title="folded ? quizTitle : undefined">
            <i :style="{ background: quizColor(quizId) }" />
            <span>{{ quizTitle }}</span>
          </div>
          <RouterLink
            v-for="n in quizNav"
            :key="n.to"
            :to="n.to"
            class="item"
            :data-on="
              (n.on as readonly string[]).includes(String(route.name)) ||
              undefined
            "
            :title="folded ? n.label : undefined"
          >
            <Icon :name="n.icon" />
            <span>{{ n.label }}</span>
          </RouterLink>
        </div>
      </template>

      <!-- The account at the foot, as in Claude's app (Kyle, 23:55). -->
      <div class="sidebar-foot">
        <AccountMenu :folded="folded" />
      </div>
    </nav>

    <div class="scrim" v-if="drawer" @click="drawer = false" />

    <main ref="contentEl" class="content">
      <RouterView />
    </main>
  </div>
</template>

<style scoped>
.topbar {
  --side: 248px;
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 60px;
  padding-inline: 12px 16px;
  background: var(--surface);
  border-bottom: 1px solid var(--line);

  &[data-folded] {
    --side: 64px;
  }
}

button {
  font: inherit;
  color: inherit;
  cursor: pointer;
}

.icon-button {
  display: grid;
  place-items: center;
  flex: none;
  width: 40px;
  height: 40px;
  border: 0;
  border-radius: var(--radius-lg);
  background: none;
  color: color-mix(in srgb, var(--ink) 70%, transparent);

  &:hover {
    background: var(--hover);
  }
  &:focus-visible {
    outline: 2px solid var(--accent);
  }
}

/* ---- the bar on a computer ---- */
.menu,
.quiz-title,
.quiz-edit {
  display: none;
}

/* The QuizApp chip over the sidebar's column, so the trail starts where the
   page does; folded to the mark when the sidebar folds. */
.brand-slot {
  flex: none;
  width: calc(var(--side) - 12px);
  transition: width 0.2s var(--ease);
}
.brand {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  max-width: 100%;
  padding: 4px 8px 4px 4px;
  border-radius: var(--radius-lg);
  color: var(--ink);
  font: 650 17px var(--font-heading);
  letter-spacing: -0.01em;
  text-decoration: none;

  svg {
    flex: none;
    color: var(--accent);
  }
  &:hover {
    background: var(--hover);
  }
}
.topbar[data-folded] .brand {
  padding: 4px;

  span {
    display: none;
  }
}

.trail {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 8px;
  min-width: 0;
  /* The bar's 8px gap plus this: the page's own inset, and as far again as
     the page column is moved to center it. */
  padding-left: calc(var(--page-pad) - 8px + var(--shift, 0px));
  font-size: 14px;
  color: var(--muted);

  a {
    color: inherit;
    text-decoration: none;
    white-space: nowrap;

    &:hover {
      color: var(--ink);
    }
  }
  .quiz {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  [aria-current] {
    color: var(--ink);
    font-weight: 600;
    white-space: nowrap;
  }
  .sep {
    color: color-mix(in srgb, var(--ink) 40%, transparent);
  }
}

.tools {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}

.search {
  display: flex;
  align-items: center;
  gap: 8px;
  width: min(320px, 40vw);
  height: 40px;
  padding: 0 4px 0 12px;
  border-radius: var(--radius-lg);
  background: var(--sunken);
  color: var(--muted);

  &:focus-within {
    outline: 2px solid var(--accent);
  }
  input {
    flex: 1;
    min-width: 0;
    border: 0;
    background: none;
    font: inherit;
    font-size: 14px;
    color: var(--ink);
    outline: none;
  }
}
.clear {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: var(--radius-md);
  background: none;
  color: var(--muted);

  &:hover {
    background: var(--hover);
  }
}

/* ---- the sidebar ---- */
.body {
  display: flex;
}

/* A column that never gives up its width to the page beside it. */
.sidebar {
  position: sticky;
  top: 60px;
  display: flex;
  flex: none;
  flex-direction: column;
  width: 248px;
  min-width: 248px;
  height: calc(100dvh - 60px);
  overflow-y: auto;
  overflow-x: hidden;
  border-right: 1px solid var(--line);
  background: var(--surface);

  &[data-folding] {
    transition:
      width 0.2s var(--ease),
      min-width 0.2s var(--ease);
  }

  /* The circle's center and the label's start are the rows' icon center
     (x 32) and label start (x 54). */
  .new-quiz {
    display: flex;
    flex: 1;
    align-items: center;
    gap: 8px;
    min-width: 0;
    height: 40px;
    padding: 0 10px 0 6px;
    border-radius: var(--radius-md);
    color: var(--ink);
    text-decoration: none;
    white-space: nowrap;
    transition: background var(--fast);

    .plus {
      display: grid;
      place-items: center;
      flex: none;
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: var(--accent);
      color: var(--accent-ink);
    }
    svg {
      flex: none;
    }
    .label {
      overflow: hidden;
      text-overflow: ellipsis;
    }
    &:hover {
      background: var(--hover);
    }
    &:focus-visible {
      outline: 2px solid var(--accent);
    }
  }
  &[data-folded] {
    .new-quiz {
      flex: none;
      width: 48px;
      justify-content: center;
      padding: 0;

      .label {
        display: none;
      }
    }
    .sidebar-top {
      flex-direction: column;
      gap: 6px;
    }
  }

  .sidebar-top {
    display: flex;
    align-items: center;
    gap: 8px;
    justify-content: flex-end;
    padding: 8px 12px 0;
  }

  .sidebar-foot {
    margin-top: auto;
    padding: 8px 12px 12px;
    border-top: 1px solid var(--line);
  }
  &[data-folded] .sidebar-foot {
    padding-inline: 8px;
  }

  .sidebar-section {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 8px 12px 12px;
  }

  .sidebar-section + .sidebar-section {
    padding-top: 12px;
    border-top: 1px solid var(--line);
  }

  /* The way back is a phone's: a computer has the trail. */
  .back-section {
    display: none;
  }
  .back-section + .sidebar-section {
    padding-top: 8px;
    border-top: 0;
  }

  h2 {
    margin: 4px 10px 6px;
    font-family: var(--font);
    font-size: 13px;
    font-weight: 600;
    color: var(--muted);
  }

  .item {
    display: flex;
    align-items: center;
    gap: 12px;
    height: 40px;
    padding-inline: 10px;
    border-radius: var(--radius-md);
    color: var(--ink);
    text-decoration: none;
    white-space: nowrap;
    transition: background var(--fast);

    svg {
      flex: none;
      color: var(--muted);
    }
    span {
      overflow: hidden;
      text-overflow: ellipsis;
    }
    &:hover {
      background: var(--hover);
    }
    &.router-link-exact-active,
    &[data-on] {
      background: color-mix(in srgb, var(--accent) 12%, transparent);
      color: var(--accent);
      font-weight: 600;

      svg {
        color: var(--accent);
      }
    }
  }

  .quiz-id {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 40px;
    padding: 0 10px 4px;
    font: 650 15px var(--font-heading);
    color: var(--ink);

    i {
      flex: none;
      width: 20px;
      height: 20px;
      border-radius: var(--radius-tile);
    }
    span {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }

  .recent i {
    flex: none;
    width: 20px;
    height: 20px;
    border-radius: var(--radius-tile);
  }

  /* Folded: an icon rail. Labels and headings leave; each item's name is
     its tooltip instead. */
  &[data-folded] {
    width: 64px;
    min-width: 64px;

    .sidebar-top {
      justify-content: center;
      padding-inline: 0;
    }
    .sidebar-section {
      padding-inline: 8px;
    }
    .item {
      justify-content: center;
      padding: 0;
    }
    .item span,
    .quiz-id span,
    h2 {
      display: none;
    }
    .quiz-id {
      justify-content: center;
      padding: 0 0 4px;
    }
  }
}

/* Dark: a light ring keeps a dark swatch's edge on the dark sidebar. */
:root[data-theme="dark"] .sidebar .recent i,
:root[data-theme="dark"] .sidebar .quiz-id i {
  box-shadow: 0 0 0 1px rgb(255 255 255 / 0.25);
}

.scrim {
  display: none;
}

.content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  /* Every page's column (at most 1120 px) centered beside the sidebar. */
  align-items: center;
}
/* The overview fills the width itself: its panel is pinned to the window's
   edge, and it centers its own page beside the panel. */
.content > :deep(.overview) {
  align-self: stretch;
}

/* ---- a phone: the menu, QuizApp centered, search and the account; the
   sidebar a drawer over the page ---- */
@media (max-width: 767px) {
  .topbar {
    padding-inline: 8px;
  }
  .icon-button {
    width: 44px;
    height: 44px;
  }
  .menu {
    display: grid;
  }
  .trail {
    display: none;
  }

  /* The name alone, centered on the bar, with no mark and no chip. */
  .brand-slot {
    position: absolute;
    left: 50%;
    width: auto;
    translate: -50% 0;
  }
  .brand,
  .topbar[data-folded] .brand {
    padding: 0;
    background: none;
    font-size: 18px;

    svg {
      display: none;
    }
    span {
      display: inline;
    }
  }
  .tool {
    background: none;
  }

  /* Inside a quiz: the menu, the quiz's title, Edit. */
  .topbar[data-in-quiz]:not([data-searching]) {
    .brand-slot,
    .tools {
      display: none;
    }
    .quiz-title {
      display: block;
      flex: 1;
      min-width: 0;
      overflow: hidden;
      font: 650 17px var(--font-heading);
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .quiz-edit {
      display: grid;
      place-items: center;
      min-width: 44px;
      height: 44px;
      padding: 0 12px;
      border-radius: var(--radius-md);
      color: var(--accent);
      font-weight: 650;
      text-decoration: none;

      &:hover {
        background: var(--hover);
      }
    }
  }

  /* Searching: the field across the bar. */
  .topbar[data-searching] {
    .menu,
    .brand-slot,
    .account,
    .quiz-title,
    .quiz-edit {
      display: none;
    }
    .tools {
      flex: 1;
      margin: 0;
    }
    .search {
      flex: 1;
      width: auto;
      height: 44px;
    }
  }

  .sidebar,
  .sidebar[data-folded] {
    position: fixed;
    top: 60px;
    left: 0;
    z-index: 15;
    width: min(300px, 85vw);
    min-width: 0;
    /* Closed, the drawer is out of sight, out of the tab order, and casts
       no shadow: a shadow on the box parked off screen ran down the page's
       left edge. It hides once the slide out has finished. */
    translate: -100% 0;
    visibility: hidden;
    transition:
      translate 0.25s var(--ease),
      box-shadow 0.25s var(--ease),
      visibility 0s 0.25s;

    /* New quiz leads the drawer as a full row; the fold is a computer's. */
    .sidebar-top {
      flex-direction: row;
      justify-content: flex-start;
      padding: 8px 12px 0;
    }
    .fold {
      display: none;
    }
    .new-quiz {
      flex: 1;
      width: auto;
      height: 44px;
      justify-content: flex-start;
      padding: 0 10px 0 6px;

      .label {
        display: revert;
      }
    }
    .sidebar-section {
      padding-inline: 12px;
    }
    .back-section {
      display: flex;
    }
    /* Every row a finger's height. */
    .item {
      justify-content: flex-start;
      height: 44px;
      padding-inline: 10px;
    }
    .item span,
    .quiz-id span,
    h2 {
      display: revert;
    }
    .quiz-id {
      justify-content: flex-start;
      padding: 0 10px 4px;
    }
  }

  .sidebar[data-open] {
    translate: 0 0;
    visibility: visible;
    box-shadow: var(--shadow-md);
    transition:
      translate 0.25s var(--ease),
      box-shadow 0.25s var(--ease);
  }

  .scrim {
    display: block;
    position: fixed;
    inset: 60px 0 0;
    z-index: 14;
    background: rgb(0 0 0 / 0.3);
  }
}

@media (prefers-reduced-motion: reduce) {
  .sidebar,
  .brand-slot {
    transition: none;
  }
}
</style>
