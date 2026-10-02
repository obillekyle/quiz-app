<script setup lang="ts">
import { Icon as Iconify } from "@iconify/vue"
// Registers the app's icons with @iconify/vue before anything draws one.
import "../icons"
import type { IconName } from "../icons"

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
