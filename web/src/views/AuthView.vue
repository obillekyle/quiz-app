<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue"
import { useRoute, useRouter } from "vue-router"
import Icon from "../components/Icon.vue"
import LogoMark from "../components/LogoMark.vue"
import { useAuth } from "../composables/auth"
import { useAction } from "../composables/fetch"

const props = defineProps<{ mode: "login" | "register" }>()

const route = useRoute()
const router = useRouter()
const auth = useAuth()

type Step = "welcome" | "email" | "code" | "password" | "name"
const step = ref<Step>("welcome")
const email = ref("")
const password = ref("")
const name = ref("")
const digits = ref<string[]>(["", "", "", "", "", ""])
const via = ref<"mail" | "log">("mail")

/** Where to go once signed in: the page that sent here, if it is one of ours. */
const next = computed(() => {
  const n = route.query.next
  return typeof n === "string" && /^\/(?![/\\])[\w\-./?=&%~+:@,;]*$/.test(n)
    ? n
    : "/app"
})

const TITLES: Record<Step, string> = {
  welcome: "Welcome to QuizApp",
  email: "Enter your email",
  code: "Check your email",
  password: "Sign in with a password",
  name: "Welcome to QuizApp",
}
const BACK: Partial<Record<Step, Step>> = {
  email: "welcome",
  code: "email",
  password: "email",
}

// ---- each step's first field takes the focus as the step opens ----------------
const emailField = ref<HTMLInputElement>()
const passwordEmail = ref<HTMLInputElement>()
const nameField = ref<HTMLInputElement>()
const boxes: HTMLInputElement[] = []

function focusBox(i: number) {
  const box = boxes[Math.max(0, Math.min(i, 5))]
  box?.focus()
  box?.select()
}

watch(step, async (s) => {
  await nextTick()
  if (s === "email") emailField.value?.focus()
  else if (s === "code") focusBox(digits.value.findIndex((d) => !d))
  else if (s === "password") passwordEmail.value?.focus()
  else if (s === "name") nameField.value?.focus()
})

// ---- resending waits as long as the server asks -------------------------------
const wait = ref(0)
let timer: number | undefined
function startWait(seconds: number) {
  wait.value = seconds
  clearInterval(timer)
  timer = window.setInterval(() => {
    wait.value = Math.max(0, wait.value - 1)
    if (!wait.value) clearInterval(timer)
  }, 1000)
}
onBeforeUnmount(() => clearInterval(timer))

// ---- the steps' actions -----------------------------------------------------------
const send = useAction(async () => {
  const r = await auth.sendCode(email.value.trim())
  via.value = r.via
  startWait(r.wait)
  digits.value = ["", "", "", "", "", ""]
  step.value = "code"
})

const resend = useAction(async () => {
  const r = await auth.sendCode(email.value.trim())
  via.value = r.via
  startWait(r.wait)
  verify.error.value = null
  digits.value = ["", "", "", "", "", ""]
  focusBox(0)
})

const verify = useAction(async () => {
  try {
    const isNew = await auth.verifyCode(
      email.value.trim(),
      digits.value.join(""),
    )
    if (isNew) step.value = "name"
    else await router.replace(next.value)
  } catch (e) {
    // A wrong code is typed again from the start.
    digits.value = ["", "", "", "", "", ""]
    focusBox(0)
    throw e
  }
})

const signIn = useAction(async () => {
  await auth.login(email.value.trim(), password.value)
  await router.replace(next.value)
})

const saveName = useAction(async () => {
  await auth.rename(name.value)
  await router.replace(next.value)
})

// ---- the six boxes: typing moves along, a paste or a phone's autofill fills them all
function onBox(i: number, e: Event) {
  const el = e.target as HTMLInputElement
  const typed = el.value.replace(/\D/g, "")
  if (typed.length > 1) {
    const run = typed.slice(0, 6 - i).split("")
    run.forEach((d, k) => (digits.value[i + k] = d))
    focusBox(i + run.length)
  } else {
    digits.value[i] = typed
    if (typed) focusBox(i + 1)
  }
  el.value = digits.value[i] ?? ""
  if (digits.value.every((d) => d)) verify.run()
}
function onBoxKey(i: number, e: KeyboardEvent) {
  if (e.key === "Backspace" && !digits.value[i] && i > 0) {
    e.preventDefault()
    digits.value[i - 1] = ""
    focusBox(i - 1)
  } else if (e.key === "ArrowLeft") focusBox(i - 1)
  else if (e.key === "ArrowRight") focusBox(i + 1)
}

function go(s: Step) {
  send.error.value = null
  signIn.error.value = null
  verify.error.value = null
  step.value = s
}

/** Google sign-in leaves the app; the server sends the browser back here to `next`. */
const googleHref = computed(
  () => `/api/auth/google?next=${encodeURIComponent(next.value)}`,
)

/** Why a Google sign-in came back unfinished (`?error=` from the server's callback). */
const GOOGLE_ERRORS: Record<string, string> = {
  "google-off": "Google sign-in is not set up on this server yet.",
  "google-cancelled":
    "Google sign-in was canceled. Try again, or use your email.",
  "google-expired":
    "That sign-in took too long or started in another tab. Try again.",
  "google-failed": "Google sign-in did not finish. Try again.",
  "google-unverified":
    "Your Google account’s email is not verified. Verify it with Google, or use your email.",
}
const pageEl = ref<HTMLElement>()
const brandEl = ref<HTMLElement>()
const sheetEl = ref<HTMLElement>()
function place() {
  const page = pageEl.value
  const brand = brandEl.value
  if (!page || !brand) return
  const height = page.clientHeight
  const top = sheetEl.value ? sheetEl.value.offsetTop : height
  const half = brand.offsetHeight / 2
  const roomy = height / 2 + half + 24 <= top
  page.style.setProperty(
    "--brand-y",
    `${roomy ? height / 2 : Math.max(half + 16, top / 2)}px`,
  )
}
const resized = new ResizeObserver(place)
onMounted(() => {
  if (pageEl.value) resized.observe(pageEl.value)
  if (brandEl.value) resized.observe(brandEl.value)
  place()
})
watch(sheetEl, (el, old) => {
  if (old) resized.unobserve(old)
  if (el) resized.observe(el)
  place()
})
onBeforeUnmount(() => resized.disconnect())

const googleError = computed(() => {
  const e = route.query.error
  return typeof e === "string" ? (GOOGLE_ERRORS[e] ?? null) : null
})
</script>

<template>
  <main ref="pageEl" class="auth-page" :data-step="step">
    <!-- The design's splash: the mark and the name, centered on the screen. -->
    <div ref="brandEl" class="brand" aria-hidden="true">
      <LogoMark :size="96" />
      <span>QuizApp</span>
    </div>

    <!-- A new account's last step is a page of its own, as in the design. -->
    <section v-if="step === 'name'" class="sheet name-page">
      <form class="step name-step" novalidate @submit.prevent="saveName.run()">
        <h1>{{ TITLES.name }}</h1>
        <span class="tick-wrap" aria-hidden="true">
          <i v-for="n in 8" :key="n" class="bit" />
          <span class="tick"><Icon name="check" :size="40" /></span>
        </span>
        <p class="sub">
          <span>Tell us your name.</span>
          <span>It shows on the quizzes you share.</span>
        </p>
        <label class="float">
          <span>Your name</span>
          <input
            ref="nameField"
            v-model="name"
            field
            autocomplete="name"
            maxlength="80"
            :aria-invalid="!!saveName.error.value || undefined"
          />
        </label>
        <p v-if="saveName.error.value" class="error" role="alert">
          {{ saveName.error.value.message }}
        </p>
        <div class="actions">
          <button btn="primary" :disabled="saveName.pending.value">
            {{ saveName.pending.value ? "Saving…" : "Let’s roll" }}
          </button>
          <RouterLink btn class="outline" :to="next">Maybe later</RouterLink>
        </div>
      </form>
    </section>

    <section v-else ref="sheetEl" class="sheet">
      <header class="sheet-head">
        <button
          v-if="BACK[step]"
          type="button"
          class="back"
          aria-label="Back"
          @click="go(BACK[step]!)"
        >
          <Icon name="back" :size="22" />
        </button>
        <RouterLink
          v-else
          to="/"
          class="back"
          aria-label="Back to the home page"
        >
          <Icon name="back" :size="22" />
        </RouterLink>
        <h1>{{ TITLES[step] }}</h1>
      </header>

      <div v-if="step === 'welcome'" :key="step" class="step">
        <p class="sub">
          {{
            props.mode === "login"
              ? "Sign in to make quizzes and share them."
              : "Make quizzes from your own notes and share them by link."
          }}
        </p>
        <!-- A plain link, not a RouterLink: it leaves the app for Google. -->
        <a btn="primary" :href="googleHref">
          <span class="g" aria-hidden="true">
            <svg viewBox="0 0 48 48" width="18" height="18">
              <path
                fill="#EA4335"
                d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
              />
              <path
                fill="#4285F4"
                d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
              />
              <path
                fill="#FBBC05"
                d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
              />
              <path
                fill="#34A853"
                d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
              />
            </svg>
          </span>
          Continue with Google
        </a>
        <button type="button" btn class="outline" @click="go('email')">
          Continue with email
        </button>
        <p v-if="googleError" class="error boxed" role="alert">
          {{ googleError }}
        </p>
      </div>

      <form
        v-else-if="step === 'email'"
        key="email"
        class="step"
        novalidate
        @submit.prevent="send.run()"
      >
        <p class="sub">
          Sign in, or make an account, with your email. A 6-digit code goes to
          this address.
        </p>
        <label class="with-icon">
          <span class="sr-only">Email address</span>
          <span class="at" aria-hidden="true">@</span>
          <input
            ref="emailField"
            v-model="email"
            field
            type="email"
            autocomplete="email"
            inputmode="email"
            placeholder="Email address"
            :aria-invalid="!!send.error.value || undefined"
          />
        </label>
        <p v-if="send.error.value" class="error" role="alert">
          {{ send.error.value.message }}
        </p>
        <button btn="primary" :disabled="send.pending.value || !email.trim()">
          {{ send.pending.value ? "Sending…" : "Send sign-in code" }}
        </button>
        <button type="button" class="link" @click="go('password')">
          Use a password instead
        </button>
      </form>

      <form
        v-else-if="step === 'code'"
        key="code"
        class="step"
        novalidate
        @submit.prevent="verify.run()"
      >
        <!-- A sentence to a line, so a break never splits one. -->
        <p class="sub">
          <span
            >A sign-in code went to <b>{{ email.trim() }}</b
            >.</span
          >
          <span>Type it here; it works for 10 minutes.</span>
        </p>
        <p v-if="via === 'log'" class="dev-note">
          This server has no mail set up yet, so the code went to its log
          instead of the inbox.
        </p>
        <div class="boxes" role="group" aria-label="The 6-digit code">
          <input
            v-for="(d, i) in digits"
            :key="i"
            :ref="
              (el) => {
                if (el) boxes[i] = el as HTMLInputElement
              }
            "
            :value="d"
            :aria-label="`Digit ${i + 1}`"
            :autocomplete="i === 0 ? 'one-time-code' : 'off'"
            inputmode="numeric"
            pattern="[0-9]*"
            :aria-invalid="!!verify.error.value || undefined"
            :readonly="verify.pending.value"
            @input="onBox(i, $event)"
            @keydown="onBoxKey(i, $event)"
            @focus="($event.target as HTMLInputElement).select()"
          />
        </div>
        <p v-if="verify.error.value" class="error" role="alert">
          {{ verify.error.value.message }}
        </p>
        <button
          btn="primary"
          :disabled="verify.pending.value || digits.some((d) => !d)"
        >
          {{ verify.pending.value ? "Checking…" : "Confirm" }}
        </button>
        <button
          type="button"
          btn
          class="outline"
          :disabled="wait > 0 || resend.pending.value"
          @click="resend.run()"
        >
          {{
            resend.pending.value
              ? "Sending…"
              : wait > 0
                ? `Resend code in ${wait} s`
                : "Resend code"
          }}
        </button>
        <p v-if="resend.error.value" class="error" role="alert">
          {{ resend.error.value.message }}
        </p>
      </form>

      <form
        v-else-if="step === 'password'"
        key="password"
        class="step"
        novalidate
        @submit.prevent="signIn.run()"
      >
        <p class="sub">This works for an account made with a password.</p>
        <label>
          <span>Email</span>
          <input
            ref="passwordEmail"
            v-model="email"
            field
            type="email"
            autocomplete="username"
            inputmode="email"
          />
        </label>
        <label>
          <span>Password</span>
          <input
            v-model="password"
            field
            type="password"
            autocomplete="current-password"
          />
        </label>
        <p v-if="signIn.error.value" class="error" role="alert">
          {{ signIn.error.value.message }}
        </p>
        <button btn="primary" :disabled="signIn.pending.value">
          {{ signIn.pending.value ? "Signing in…" : "Sign in" }}
        </button>
        <button type="button" class="link" @click="go('email')">
          Email me a code instead
        </button>
      </form>

      <p class="terms">
        By signing in you accept the
        <RouterLink to="/terms">terms</RouterLink> and the
        <RouterLink to="/privacy">privacy policy</RouterLink>.
      </p>
    </section>
  </main>
</template>

<style scoped>
/* A computer: the mark on the left half, the steps on the right. */
.auth-page {
  display: grid;
  grid-template-columns: 1fr 1fr;
  min-height: 100dvh;
}

.brand {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-lg);
  border-right: 1px solid var(--line);
  color: var(--accent);

  span {
    color: var(--muted);
    font: 600 var(--fs-xl) var(--font-heading);
  }
}

.sheet {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-xl);
  padding: var(--space-4xl) var(--space-2xl);
  background: var(--surface);
}

.sheet-head {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: min(100%, 380px);
  min-height: 44px;

  h1 {
    margin: 0;
    padding: 0 48px;
    text-align: center;
    font-size: var(--fs-2xl);
    font-weight: 650;
    letter-spacing: -0.02em;
  }
}

.back {
  position: absolute;
  /* The arrow's stroke on the edge the fields below share; the 44 px target stays. */
  left: -15px;
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border: 0;
  border-radius: var(--radius-full);
  background: none;
  color: var(--ink);
  cursor: pointer;

  &:hover {
    background: var(--hover);
  }
  &:focus-visible {
    outline: 2px solid var(--accent);
  }
}

.step {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  width: min(100%, 380px);
  animation: rise 0.25s var(--ease);

  [btn] {
    width: 100%;
    border-radius: var(--radius-full);
  }
}
@keyframes rise {
  from {
    opacity: 0;
    translate: 0 8px;
  }
}

.sub {
  margin: 0 0 var(--space-xs);
  text-align: center;
  text-wrap: balance;

  /* Two sentences, each its own balanced line block. */
  > span {
    display: block;
    text-wrap: balance;
  }
  color: var(--muted);

  b {
    color: var(--ink);
    font-weight: 600;
    overflow-wrap: anywhere;
  }
}

.g {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: white;
}

.outline {
  border-color: var(--accent);
  background: transparent;
  color: var(--accent);
}

label {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);

  > span {
    font-size: var(--fs-sm);
    font-weight: 600;
  }
}

.with-icon {
  position: relative;

  .at {
    position: absolute;
    left: 14px;
    top: 50%;
    translate: 0 -50%;
    color: var(--muted);
    pointer-events: none;
  }
  input {
    padding-left: 38px;
  }
}

/* The code: six boxes, as in the design. */
.boxes {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: var(--space-sm);

  input {
    width: 100%;
    min-width: 0;
    height: 56px;
    padding: 0;
    border: 1px solid color-mix(in srgb, var(--ink) 22%, transparent);
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--ink);
    font: 600 24px var(--font-heading);
    text-align: center;
    caret-color: var(--accent);

    &:focus {
      outline: 2px solid var(--accent);
      outline-offset: -1px;
      border-color: transparent;
    }
    &[aria-invalid="true"] {
      border-color: var(--bad);
    }
  }
}

.dev-note {
  margin: 0;
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--warn) 12%, var(--surface));
  font-size: var(--fs-sm);
  color: color-mix(in srgb, var(--warn) 75%, black);
}

.link {
  display: inline-flex;
  align-items: center;
  align-self: center;
  min-height: 44px;
  padding: 0 var(--space-md);
  border: 0;
  background: none;
  color: var(--accent);
  font: inherit;
  font-size: var(--fs-sm);
  font-weight: 600;
  cursor: pointer;

  &:hover {
    text-decoration: underline;
  }
}

.error {
  margin: 0;
  font-size: var(--fs-sm);
  color: var(--bad);

  &.boxed {
    padding: var(--space-sm) var(--space-md);
    border-radius: var(--radius-md);
    background: var(--bad-soft);
  }
}

/* The legal line under every step's last control. */
.terms {
  width: min(100%, 380px);
  margin: 0;
  text-align: center;
  font-size: 12px;
  color: var(--muted);

  a {
    color: inherit;
    text-decoration: underline;
    text-underline-offset: 2px;

    &:hover {
      color: var(--ink);
    }
  }
}

/* ---- a new account's name ---- */
.name-step {
  align-items: center;
  text-align: center;

  h1 {
    margin: 0;
    font-size: var(--fs-2xl);
    font-weight: 650;
    letter-spacing: -0.02em;
  }
}
.tick-wrap {
  position: relative;
  display: grid;
  place-items: center;
  width: 150px;
  height: 112px;
}
.tick {
  display: grid;
  place-items: center;
  width: 76px;
  height: 76px;
  border-radius: 50%;
  background: var(--good);
  color: white;
}
/* Confetti: eight pieces around the check, each its own color and angle. */
.bit {
  position: absolute;
  width: 11px;
  height: 4px;
  border-radius: var(--radius-sm);

  &:nth-child(1) {
    left: 6px;
    top: 44px;
    background: #e53935;
    rotate: -20deg;
  }
  &:nth-child(2) {
    left: 20px;
    top: 14px;
    background: #fbc02d;
    rotate: 40deg;
  }
  &:nth-child(3) {
    left: 52px;
    top: 2px;
    background: #1e88e5;
    rotate: -60deg;
  }
  &:nth-child(4) {
    left: 96px;
    top: 4px;
    background: #fb8c00;
    rotate: 30deg;
  }
  &:nth-child(5) {
    left: 126px;
    top: 18px;
    background: #8e24aa;
    rotate: -40deg;
  }
  &:nth-child(6) {
    left: 136px;
    top: 52px;
    background: #43a047;
    rotate: 15deg;
  }
  &:nth-child(7) {
    left: 122px;
    top: 88px;
    background: #1e88e5;
    rotate: 60deg;
  }
  &:nth-child(8) {
    left: 14px;
    top: 84px;
    background: #fb8c00;
    rotate: -50deg;
  }
}
/* The design's field: its label sits in the top border. */
.float {
  position: relative;
  width: 100%;
  text-align: left;

  > span {
    position: absolute;
    top: -8px;
    left: 10px;
    padding: 0 4px;
    background: var(--surface);
    font-size: var(--fs-xs);
    font-weight: 500;
    color: var(--muted);
  }
  input {
    border-color: var(--accent);
  }
}
.actions {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  width: 100%;
  margin-top: var(--space-md);
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

@media (max-width: 767px) {
  .auth-page {
    position: relative;
    grid-template: 1fr / 1fr;
    background: var(--bg);

    &::before {
      content: "";
      grid-area: 1 / 1;
      z-index: 1;
      background: rgb(0 0 0 / 0.22);
      pointer-events: none;
      transition: opacity 0.4s var(--ease);

      @starting-style {
        opacity: 0;
      }
    }
  }

  .brand {
    position: absolute;
    inset-inline: 0;
    top: var(--brand-y, 50%);
    translate: 0 -50%;
    border-right: 0;
    transition: top 0.35s var(--ease);
  }

  .sheet {
    grid-area: 1 / 1;
    z-index: 2;
    align-self: end;
    gap: var(--space-lg);
    padding: var(--space-xl) var(--space-xl)
      calc(var(--space-2xl) + env(safe-area-inset-bottom));
    border-radius: var(--radius-2xl) var(--radius-2xl) 0 0;
    box-shadow: 0 -8px 32px rgb(0 0 0 / 0.08);
    transition: translate 0.4s var(--ease);

    @starting-style {
      translate: 0 100%;
    }
  }

  .sheet-head h1 {
    font-size: var(--fs-xl);
  }

  .step {
    width: 100%;
  }

  /* The name step: no dim, no mark, the page itself. */
  .auth-page[data-step="name"] {
    &::before {
      display: none;
    }
    .brand {
      display: none;
    }
  }
  .name-page {
    align-self: stretch;
    justify-content: space-between;
    padding-top: var(--space-4xl);
    border-radius: 0;
    box-shadow: none;
    background: var(--bg);

    .float > span,
    .float input {
      background: var(--bg);
    }
  }
  .name-step {
    flex: 1;

    h1 {
      font-size: var(--fs-xl);
    }
  }
  .name-step .actions {
    margin-top: auto;
  }
}

@media (prefers-reduced-motion: reduce) {
  .sheet,
  .step {
    transition: none;
    animation: none;
  }
}
</style>
