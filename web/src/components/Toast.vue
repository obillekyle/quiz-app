<script setup lang="ts">
import { activeToast } from "../composables/toast"
</script>

<template>
  <div class="toast-host" role="status" aria-live="polite">
    <Transition name="toast">
      <div v-if="activeToast" class="toast">{{ activeToast }}</div>
    </Transition>
  </div>
</template>

<style scoped>
.toast-host {
  position: fixed;
  inset: auto 16px calc(16px + env(safe-area-inset-bottom));
  z-index: 50;
  display: flex;
  justify-content: center;
  pointer-events: none;
}
.toast {
  max-width: 480px;
  padding: 12px 20px;
  border-radius: var(--radius-full);
  background: var(--ink);
  color: var(--bg);
  font-size: 14px;
  line-height: 1.45;
  text-align: center;
  text-wrap: balance;
  box-shadow: var(--shadow-md);
}
.toast-enter-active,
.toast-leave-active {
  transition:
    opacity var(--fast) var(--ease),
    translate var(--fast) var(--ease);
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  translate: 0 8px;
}
</style>
