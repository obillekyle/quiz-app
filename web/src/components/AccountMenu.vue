<script setup lang="ts">
import { computed, ref } from "vue"
import { useRouter } from "vue-router"
import Icon from "./Icon.vue"
import { useAuth } from "../composables/auth"
import { useAction } from "../composables/fetch"

defineProps<{ folded?: boolean }>()
const router = useRouter()
const { userdata, logout } = useAuth()
const initial = computed(() =>
  (userdata.value?.name.trim()[0] ?? "?").toUpperCase(),
)
const menu = ref<HTMLElement>()
const settings = ref<HTMLButtonElement>()

const open = ref(false)
function toggled(e: Event) {
  open.value = (e as ToggleEvent).newState === "open"
  if (open.value) settings.value?.focus()
}

const signOut = useAction(async () => {
  await logout()
  await router.replace("/")
})
function go(to: string) {
  menu.value?.hidePopover()
  router.push(to)
}
</script>

<template>
  <button
    class="me"
    :data-folded="folded || undefined"
    :data-open="open || undefined"
    popovertarget="account-menu"
    :aria-expanded="open"
    :aria-label="`Account: ${userdata?.name}`"
    :title="folded ? userdata?.name : undefined"
  >
    <span class="avatar">{{ initial }}</span>
    <span class="who">
      <strong>{{ userdata?.name }}</strong>
      <small>{{ userdata?.email }}</small>
    </span>
  </button>
  <div
    id="account-menu"
    ref="menu"
    class="menu"
    :data-folded="folded || undefined"
    popover
    @toggle="toggled"
  >
    <p class="email">{{ userdata?.email }}</p>
    <button
      ref="settings"
      type="button"
      class="row"
      @click="go('/app/settings')"
    >
      <Icon name="settings" :size="18" /> Settings
    </button>
    <button
      type="button"
      class="row"
      :disabled="signOut.pending.value"
      @click="signOut.run()"
    >
      <Icon name="logout" :size="18" />
      {{ signOut.pending.value ? "Signing out…" : "Sign out" }}
    </button>
    <small v-if="signOut.error.value" class="error" role="alert">{{
      signOut.error.value.message
    }}</small>
  </div>
</template>

<style scoped>
.me {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-height: 52px;
  padding: 6px 8px 6px 4px;
  border: 0;
  border-radius: var(--radius-lg);
  background: none;
  color: var(--ink);
  font: inherit;
  text-align: left;
  cursor: pointer;

  &:hover,
  &[data-open] {
    background: var(--hover);
  }
  &:focus-visible {
    outline: 2px solid var(--accent);
  }
  &[data-folded] {
    justify-content: center;
    padding: 6px 0;

    .who {
      display: none;
    }
  }
}
.avatar {
  display: grid;
  place-items: center;
  flex: none;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--accent);
  color: var(--accent-ink);
  font-weight: 650;
}
.who {
  display: flex;
  flex-direction: column;
  min-width: 0;

  strong,
  small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  strong {
    font-size: 14px;
    font-weight: 600;
  }
  small {
    font-size: 12px;
    color: var(--muted);
  }
}

.menu {
  position: fixed;
  inset: auto;
  left: 12px;
  bottom: 76px;
  width: 224px;
  margin: 0;
  padding: 8px;
  border: 1px solid var(--line);
  border-radius: var(--radius-xl);
  background: var(--surface);
  color: var(--ink);
  box-shadow: var(--shadow-md);

  &:popover-open {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  &[data-folded] {
    left: 8px;
  }
}
.email {
  margin: 4px 10px 6px;
  overflow: hidden;
  font-size: 13px;
  color: var(--muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  padding: 0 10px;
  border: 0;
  border-radius: var(--radius-lg);
  background: none;
  color: var(--ink);
  font: inherit;
  font-size: 14px;
  text-align: left;
  cursor: pointer;

  svg {
    flex: none;
  }
  &:hover:not(:disabled) {
    background: var(--hover);
  }
  &:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
}
.error {
  margin: 4px 10px;
  color: var(--bad);
}

/* A phone's drawer is never folded, and is as wide as the menu needs. */
@media (max-width: 767px) {
  .me[data-folded] {
    justify-content: flex-start;
    padding: 6px 8px 6px 4px;

    .who {
      display: flex;
    }
  }
  .menu,
  .menu[data-folded] {
    left: 12px;
    width: calc(min(300px, 85vw) - 24px);
  }
}
</style>
