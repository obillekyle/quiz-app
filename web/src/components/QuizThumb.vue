<script setup lang="ts">
import { Icon as Iconify } from "@iconify/vue"
import { computed, ref, watch } from "vue"
import { inkFor } from "../composables/color"
import { quizColor } from "../composables/quizzes"

const props = withDefaults(
  defineProps<{
    id: number
    title?: string
    icon?: string | null
    image?: string | null
    /** The quiz's chosen color; null takes the palette color its id picks. */
    color?: string | null
    iconSize?: number
  }>(),
  { title: "", icon: null, image: null, color: null, iconSize: 56 },
)
const tint = computed(() => quizColor({ id: props.id, color: props.color }))
const ink = computed(() => inkFor(tint.value, 3))

// A cover that fails to load (removed on another tab, say) falls back to the icon.
const broken = ref(false)
watch(
  () => props.image,
  () => (broken.value = false),
)
const letter = computed(() => {
  const first = props.title.trim().match(/\p{L}|\p{N}/u)?.[0] ?? ""
  return first.toLocaleUpperCase()
})
</script>

<template>
  <div
    class="qthumb"
    :data-kind="image && !broken ? 'image' : icon ? 'icon' : 'color'"
    :style="{ '--c': tint, '--c-ink': ink, '--s': `${iconSize}px` }"
    aria-hidden="true"
  >
    <img
      v-if="image && !broken"
      :src="image"
      alt=""
      decoding="async"
      @error="broken = true"
    />
    <Iconify
      v-else-if="icon"
      :icon="icon"
      :width="iconSize"
      :height="iconSize"
    />
    <span v-else-if="letter" class="letter">{{ letter }}</span>
  </div>
</template>

<style scoped>
.qthumb {
  display: grid;
  place-items: center;
  overflow: hidden;
  background: var(--c);
  /* A one-color icon takes the quiz's color. */
  color: var(--c);

  &[data-kind="icon"] {
    background: color-mix(in srgb, var(--c) 14%, var(--surface));
  }
  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
}

.letter {
  font: 650 calc(var(--s) * 0.8) / 1 var(--font-heading);
  color: var(--c-ink, white);
  user-select: none;
}
</style>
