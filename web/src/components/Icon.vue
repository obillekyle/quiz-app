<script setup lang="ts">
import { Icon as Iconify } from "@iconify/vue"
// Registers the app's icons with @iconify/vue before anything draws one.
import "../icons"
import type { IconName } from "../icons"

/**
 * The app's icons: Material Symbols Rounded, the set the QuizApp design
 * draws with, through @iconify/vue. Each takes `currentColor`, so an icon is
 * the color of the text beside it. The names are ours (`home`, `back`,
 * `face-1`), mapped to Material's in `scripts/icons.ts`; `sparkle` marks what
 * the AI does.
 */
withDefaults(defineProps<{ name: IconName; size?: number }>(), { size: 20 })
</script>

<template>
  <Iconify
    :icon="`qa:${name}`"
    :width="size"
    :height="size"
    aria-hidden="true"
  />
</template>
