<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue"
import { useRouter } from "vue-router"
import Icon from "../components/Icon.vue"
import { api } from "../composables/api"
import { useAuth } from "../composables/auth"
import { useAction, useFetch } from "../composables/fetch"
import { useTheme, type Theme } from "../composables/theme"

/**
 * The account's settings (Kyle, 23:55), as Material You groups: the profile,
 * the ways to sign in, the theme, the devices signed in, and deleting the
 * account.
 */
type Account = {
  name: string
  email: string
  password: boolean
  google: boolean
  devices: number
}

const router = useRouter()
const auth = useAuth()
const { data, error, loading, refresh } = useFetch<Account>("/auth/account")

// ---- profile ----
const name = ref("")
watch(data, (d) => d && (name.value = d.name), { immediate: true })
// Save shows only while the name differs from the account's; once it is
// saved, a quiet "Saved" stands in its place for 2 s.
const nameChanged = computed(
  () => !!data.value && name.value.trim() !== data.value.name,
)
const nameJustSaved = ref(false)
let savedTimer: number | undefined
const saveName = useAction(async () => {
  await auth.rename(name.value)
  await refresh()
  nameJustSaved.value = true
  clearTimeout(savedTimer)
  savedTimer = window.setTimeout(() => (nameJustSaved.value = false), 2000)
})
onBeforeUnmount(() => clearTimeout(savedTimer))

// ---- password ----
const current = ref("")
const next = ref("")
const passwordDone = ref(false)
const savePassword = useAction(async () => {
  await api("/auth/password", {
    body: { current: current.value, next: next.value },
  })
  current.value = ""
  next.value = ""
  passwordDone.value = true
  await refresh()
})

// ---- theme ----
const theme = useTheme()
const THEMES: { value: Theme; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
]

// ---- devices ----
const signedOut = ref<number | null>(null)
const signOutOthers = useAction(async () => {
  const r = await api<{ ended: number }>("/auth/devices/sign-out", {
    method: "POST",
  })
  signedOut.value = r.ended
  await refresh()
})

// ---- deleting the account ----
const deleteDialog = ref<HTMLDialogElement>()
const typed = ref("")
const remove = useAction(async () => {
  await api("/auth/account", { method: "DELETE", body: { email: typed.value } })
  await auth.logout().catch(() => {})
  await router.replace("/")
})
function openDelete() {
  typed.value = ""
  remove.error.value = null
  deleteDialog.value?.showModal()
}
</script>

<template>
  <div class="page">
    <h1>Settings</h1>
    <p v-if="error" class="state" role="alert">{{ error.message }}</p>
    <ul v-else-if="loading && !data" stack aria-label="Loading your account">
      <li v-for="n in 4" :key="n" class="row-skel" aria-hidden="true">
        <div skeleton="text" style="width: 25%" />
        <div skeleton="text" style="width: 55%" />
      </li>
    </ul>

    <template v-else-if="data">
      <!-- Profile -->
      <section class="group">
        <h2>Profile</h2>
        <ul stack>
          <li>
            <form class="field-row" @submit.prevent="saveName.run()">
              <label for="settings-name"
                ><Icon name="person" :size="20" /> Name</label
              >
              <input
                id="settings-name"
                v-model="name"
                field
                maxlength="80"
                autocomplete="name"
              />
              <button
                v-if="nameChanged || saveName.pending.value"
                btn="primary"
                :disabled="saveName.pending.value || !name.trim()"
              >
                {{ saveName.pending.value ? "Saving…" : "Save" }}
              </button>
              <span v-else-if="nameJustSaved" class="saved" role="status"
                >Saved</span
              >
            </form>
            <p class="hint">Shown to people who answer your quizzes.</p>
            <p v-if="saveName.error.value" class="error" role="alert">
              {{ saveName.error.value.message }}
            </p>
          </li>
          <li class="line">
            <Icon name="mail" :size="20" />
            <span class="what">
              <strong>Email</strong>
              <span>{{ data.email }}</span>
            </span>
          </li>
        </ul>
      </section>

      <!-- Signing in -->
      <section class="group">
        <h2>Signing in</h2>
        <ul stack>
          <li class="line">
            <Icon name="pin" :size="20" />
            <span class="what">
              <strong>Sign-in code by email</strong>
              <span
                >A 6-digit code sent to {{ data.email }} signs you in on any
                device.</span
              >
            </span>
            <span class="state-chip on">On</span>
          </li>
          <li class="line">
            <Icon name="linked" :size="20" />
            <span class="what">
              <strong>Google</strong>
              <span v-if="data.google"
                >Continue with Google signs you in to this account.</span
              >
              <span v-else
                >To link it, sign in with Google as {{ data.email }}.</span
              >
            </span>
            <span class="state-chip" :class="{ on: data.google }">{{
              data.google ? "Linked" : "Not linked"
            }}</span>
          </li>
          <li>
            <form
              class="password"
              novalidate
              @submit.prevent="savePassword.run()"
            >
              <span class="line-head">
                <Icon name="key" :size="20" />
                <strong>{{
                  data.password ? "Change your password" : "Set a password"
                }}</strong>
              </span>
              <div v-if="data.password" class="pw-field">
                <label for="settings-current">Current password</label>
                <input
                  id="settings-current"
                  v-model="current"
                  field
                  type="password"
                  autocomplete="current-password"
                />
              </div>
              <div class="pw-field">
                <label for="settings-new">New password</label>
                <input
                  id="settings-new"
                  v-model="next"
                  field
                  type="password"
                  autocomplete="new-password"
                  aria-describedby="settings-new-hint"
                />
                <p id="settings-new-hint" class="hint">
                  Use at least 8 characters.
                </p>
              </div>
              <div class="row-end">
                <span v-if="passwordDone" class="hint" role="status"
                  >Password saved.</span
                >
                <button
                  btn
                  :disabled="savePassword.pending.value || next.length < 8"
                >
                  {{ savePassword.pending.value ? "Saving…" : "Save password" }}
                </button>
              </div>
              <p v-if="savePassword.error.value" class="error" role="alert">
                {{ savePassword.error.value.message }}
              </p>
            </form>
          </li>
        </ul>
      </section>

      <!-- Appearance -->
      <section class="group">
        <h2>Appearance</h2>
        <ul stack>
          <li class="line">
            <Icon name="theme" :size="20" />
            <span class="what">
              <strong>Theme</strong>
              <span>System follows this device's light or dark setting.</span>
            </span>
            <div class="seg" role="radiogroup" aria-label="Theme">
              <button
                v-for="t in THEMES"
                :key="t.value"
                type="button"
                role="radio"
                :aria-checked="theme === t.value"
                @click="theme = t.value"
              >
                {{ t.label }}
              </button>
            </div>
          </li>
        </ul>
      </section>

      <!-- Devices -->
      <section class="group">
        <h2>Devices</h2>
        <ul stack>
          <li class="line">
            <Icon name="devices" :size="20" />
            <span class="what">
              <strong
                >Signed in on {{ data.devices }}
                {{ data.devices === 1 ? "device" : "devices" }}</strong
              >
              <span v-if="signedOut != null"
                >Signed out of {{ signedOut }} other
                {{ signedOut === 1 ? "device" : "devices" }}.</span
              >
              <span v-else
                >Signing out everywhere else keeps this device signed in.</span
              >
            </span>
            <button
              btn
              :disabled="signOutOthers.pending.value || data.devices < 2"
              @click="signOutOthers.run()"
            >
              Sign out everywhere else
            </button>
          </li>
        </ul>
        <p v-if="signOutOthers.error.value" class="error" role="alert">
          {{ signOutOthers.error.value.message }}
        </p>
      </section>

      <!-- Deleting the account -->
      <section class="group">
        <h2>Delete account</h2>
        <ul stack>
          <li class="line danger">
            <Icon name="delete" :size="20" />
            <span class="what">
              <span class="lead"
                >Your quizzes, their files and every response are deleted for
                good.</span
              >
            </span>
            <button btn class="delete" @click="openDelete">
              Delete account
            </button>
          </li>
        </ul>
      </section>
    </template>

    <dialog ref="deleteDialog" class="confirm">
      <form @submit.prevent="remove.run()">
        <h2>Delete your account?</h2>
        <p>
          Your quizzes, their files and every response go with it. This cannot
          be undone.
        </p>
        <label for="delete-email">Type {{ data?.email }} to confirm.</label>
        <input id="delete-email" v-model="typed" field autocomplete="off" />
        <p v-if="remove.error.value" class="error" role="alert">
          {{ remove.error.value.message }}
        </p>
        <div class="actions">
          <button type="button" btn @click="deleteDialog?.close()">
            Cancel
          </button>
          <button
            btn="primary"
            class="danger-btn"
            :disabled="
              remove.pending.value ||
              typed.trim().toLowerCase() !== data?.email.toLowerCase()
            "
          >
            {{ remove.pending.value ? "Deleting…" : "Delete account" }}
          </button>
        </div>
      </form>
    </dialog>
  </div>
</template>

<style scoped>
.page {
  width: min(100%, 1120px);
  padding: 28px var(--page-pad) 64px;

  h1 {
    margin: 0 0 8px;
    font-size: clamp(24px, 3vw, 30px);
    letter-spacing: -0.02em;
  }
}
.state {
  padding: 40px 0;
  color: var(--muted);
}
.group {
  margin-top: 24px;

  h2 {
    margin: 0 0 8px;
    font-size: 15px;
    color: color-mix(in srgb, var(--ink) 70%, transparent);
  }
}
li {
  padding: 14px 18px;
}
.line {
  display: flex;
  align-items: center;
  gap: 14px;

  > svg {
    flex: none;
    color: var(--muted);
  }
}
.what {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-width: 0;

  span {
    font-size: 14px;
    color: var(--muted);
    overflow-wrap: anywhere;
  }
}
.field-row {
  display: flex;
  align-items: center;
  gap: 12px;

  label {
    display: flex;
    align-items: center;
    gap: 14px;
    width: 120px;
    font-weight: 600;

    svg {
      color: var(--muted);
    }
  }
  input {
    flex: 1;
    min-width: 0;
  }
}
.saved {
  flex: none;
  font-size: 14px;
  color: var(--muted);
}
.hint {
  margin: 6px 0 0 34px;
  font-size: 13px;
  color: var(--muted);
}
.error {
  margin: 6px 0 0 34px;
  font-size: 13px;
  color: var(--bad);
}
.state-chip {
  flex: none;
  padding: 2px 10px;
  border-radius: var(--radius-full);
  background: var(--sunken);
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);

  &.on {
    background: color-mix(in srgb, var(--good) 14%, var(--surface));
    color: var(--good);
  }
}
.password {
  display: flex;
  flex-direction: column;
  gap: 12px;

  .error {
    margin-top: 0;
  }
}
/* A label over each field, the rule under the new one. */
.pw-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-width: 454px;
  margin-left: 34px;

  label {
    font-size: 14px;
    font-weight: 600;
  }
  .hint {
    margin: 0;
  }
}
.line-head {
  display: flex;
  align-items: center;
  gap: 14px;

  svg {
    color: var(--muted);
  }
}
.row-end {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-left: 34px;

  .hint {
    margin: 0;
  }
}
.row-skel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 18px 16px;
}

.seg {
  display: flex;
  flex: none;
  padding: 3px;
  border-radius: var(--radius-lg);
  background: var(--sunken);

  button {
    min-height: 44px;
    padding: 0 14px;
    border: 0;
    border-radius: var(--radius-md);
    background: none;
    color: color-mix(in srgb, var(--ink) 70%, transparent);
    font: inherit;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;

    &[aria-checked="true"] {
      background: var(--surface);
      color: var(--accent);
      box-shadow: var(--shadow-sm);
    }
    &:focus-visible {
      outline: 2px solid var(--accent);
    }
  }
}
.danger > svg {
  color: var(--bad);
}
/* The consequence leads the row on its own; the section and the button
   already name the action. */
.what .lead {
  font-size: 15px;
  color: var(--ink);
}
.delete {
  border-color: color-mix(in srgb, var(--bad) 40%, transparent);
  color: var(--bad);
}

.confirm {
  width: min(92vw, 440px);
  padding: 24px;
  border: 0;
  border-radius: var(--radius-2xl);
  background: var(--surface);
  color: var(--ink);
  box-shadow: var(--shadow-md);

  &::backdrop {
    background: rgb(0 0 0 / 0.35);
  }
  form {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  h2 {
    margin: 0;
    font-size: 19px;
  }
  p {
    margin: 0;
    color: color-mix(in srgb, var(--ink) 70%, transparent);
  }
  label {
    margin-top: 4px;
    font-size: 14px;
    font-weight: 600;
  }
  .error {
    margin: 0;
  }
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
}
.danger-btn {
  border-color: var(--bad);
  background: var(--bad);
}

@media (max-width: 640px) {
  .line {
    flex-wrap: wrap;

    .what {
      flex-basis: calc(100% - 40px);
    }
    [btn],
    .seg {
      margin-left: 34px;
    }
  }
  .field-row {
    flex-wrap: wrap;

    label {
      width: 100%;
    }
    input {
      margin-left: 34px;
    }
  }
}
</style>
