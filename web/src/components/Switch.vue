<script setup lang="ts">
import Icon from "./Icon.vue"

const on = defineModel<boolean>({ required: true })
defineProps<{
  disabled?: boolean
  /** The id of the element that names this switch. */
  labelledby?: string
  /** The name itself, when nothing on the page can be pointed at. */
  label?: string
  /** The id of the element that describes it, shown under the title. */
  describedby?: string
}>()
</script>

<template>
  <button
    type="button"
    role="switch"
    class="switch"
    :aria-checked="on"
    :aria-labelledby="labelledby"
    :aria-label="label"
    :aria-describedby="describedby"
    :disabled="disabled"
    @click="on = !on"
  >
    <span class="track">
      <span class="handle"><Icon v-if="on" name="check" :size="16" /></span>
    </span>
  </button>
</template>

<style scoped>
.switch {
  display: grid;
  flex: none;
  place-items: center;
  width: 52px;
  height: 44px;
  padding: 0;
  border: 0;
  background: none;
  cursor: pointer;

  &:focus-visible {
    outline: none;
  }
  &:focus-visible > .track {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  &:disabled {
    opacity: 0.5;
    cursor: default;
  }
}

.track {
  position: relative;
  display: block;
  width: 52px;
  height: 32px;
  border: 2px solid color-mix(in srgb, var(--ink) 50%, transparent);
  border-radius: var(--radius-xl);
  background: var(--sunken);
  transition:
    background var(--fast) var(--ease),
    border-color var(--fast) var(--ease);
}
.switch[aria-checked="true"] > .track {
  border-color: var(--accent);
  background: var(--accent);
}

.handle {
  position: absolute;
  top: 50%;
  left: 6px;
  display: grid;
  place-items: center;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--ink) 50%, transparent);
  color: var(--accent);
  translate: 0 -50%;
  transition:
    left var(--fast) var(--ease),
    width var(--fast) var(--ease),
    height var(--fast) var(--ease),
    background var(--fast) var(--ease),
    box-shadow var(--fast) var(--ease);
}
.switch[aria-checked="true"] .handle {
  left: 22px;
  width: 24px;
  height: 24px;
  background: var(--accent-ink);
}
.switch:hover:not(:disabled) .handle {
  box-shadow: 0 0 0 8px color-mix(in srgb, var(--ink) 8%, transparent);
}
.switch:active:not(:disabled) .handle {
  left: 4px;
  width: 28px;
  height: 28px;
}
.switch[aria-checked="true"]:active:not(:disabled) .handle {
  left: 18px;
}
</style>
