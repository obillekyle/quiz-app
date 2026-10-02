<script setup lang="ts">
import { computed } from "vue"
import CrosswordGrid from "./CrosswordGrid.vue"
import Icon from "./Icon.vue"
import type { Question } from "../composables/quizzes"

/** A word bank or a crossword in the builder: one card holding its identification items, each a clue and its answer. */
const props = defineProps<{
  /** The set's questions, in the quiz's order. They are edited in place. */
  items: Question[]
  /** The first item's place in the quiz, from 0. */
  first: number
  canUp: boolean
  canDown: boolean
}>()
defineEmits<{
  add: []
  remove: [item: Question]
  removeAll: []
  up: []
  down: []
  title: [text: string]
  extra: [words: string[]]
}>()

const set = computed(() => props.items[0]!.itemSet!)
const bank = computed(() => set.value.style === "bank")
const points = computed(() =>
  props.items.reduce((s, q) => s + (q.points || 0), 0),
)
const words = (text: string) =>
  text
    .split(",")
    .map((w) => w.trim())
    .filter(Boolean)
const setAnswer = (q: Question, text: string) =>
  (q.accepted = [text, ...q.accepted.slice(1)])

/** The grid as it was laid out at the last save, with the answers written in. */
const grid = computed(() =>
  props.items.flatMap((q) =>
    q.entry ? [{ ...q.entry, text: q.accepted[0] ?? "" }] : [],
  ),
)
const size = computed(() => ({
  rows: Math.max(
    0,
    ...grid.value.map((e) => e.row + (e.dir === "down" ? e.length : 1)),
  ),
  cols: Math.max(
    0,
    ...grid.value.map((e) => e.col + (e.dir === "across" ? e.length : 1)),
  ),
}))
const place = (q: Question) =>
  q.entry
    ? `${q.entry.number} ${q.entry.dir === "across" ? "Across" : "Down"}`
    : ""
</script>

<template>
  <article class="setcard">
    <header>
      <span class="num">
        {{ first + 1
        }}{{ items.length > 1 ? ` to ${first + items.length}` : "" }}
      </span>
      <span class="kind">
        <Icon :name="bank ? 'list' : 'grid'" :size="16" />
        {{ bank ? "Word bank" : "Crossword" }}
      </span>
      <span class="count">
        {{ items.length }} {{ items.length === 1 ? "item" : "items" }} ·
        {{ points }} {{ points === 1 ? "pt" : "pts" }}
      </span>
      <span class="actions">
        <button
          class="icon"
          :disabled="!canUp"
          aria-label="Move up"
          title="Move up"
          @click="$emit('up')"
        >
          <Icon name="up" :size="18" />
        </button>
        <button
          class="icon"
          :disabled="!canDown"
          aria-label="Move down"
          title="Move down"
          @click="$emit('down')"
        >
          <Icon name="down" :size="18" />
        </button>
        <button
          class="icon danger"
          :aria-label="bank ? 'Delete the word bank' : 'Delete the crossword'"
          :title="bank ? 'Delete the word bank' : 'Delete the crossword'"
          @click="$emit('removeAll')"
        >
          <Icon name="delete" :size="18" />
        </button>
      </span>
    </header>

    <input
      class="title"
      :value="set.title"
      :placeholder="bank ? 'Word bank' : 'Crossword'"
      aria-label="Title of the set"
      maxlength="120"
      @input="$emit('title', ($event.target as HTMLInputElement).value)"
    />

    <ol class="rows">
      <li v-for="(q, j) in items" :key="j">
        <span class="n">{{ first + j + 1 }}</span>
        <textarea
          v-model="q.prompt"
          class="clue"
          rows="1"
          :placeholder="bank ? 'The question' : 'The clue'"
          :aria-label="`Question ${first + j + 1}`"
        />
        <input
          class="answer"
          :value="q.accepted[0] ?? ''"
          :placeholder="bank ? 'Answer' : 'Answer, one word'"
          :aria-label="`Answer to question ${first + j + 1}`"
          maxlength="200"
          @input="setAnswer(q, ($event.target as HTMLInputElement).value)"
        />
        <span v-if="!bank" class="place">{{ place(q) }}</span>
        <button
          class="icon danger"
          :aria-label="`Remove question ${first + j + 1}`"
          title="Remove"
          @click="$emit('remove', q)"
        >
          <Icon name="close" :size="16" />
        </button>
      </li>
    </ol>

    <button class="more" @click="$emit('add')">
      <Icon name="plus" :size="16" /> Add an item
    </button>

    <template v-if="bank">
      <label class="extra">
        <span class="label">Extra words, separated by commas</span>
        <input
          :value="set.extra.join(', ')"
          placeholder="Words that are the answer to no question"
          @change="
            $emit('extra', words(($event.target as HTMLInputElement).value))
          "
        />
      </label>
      <p class="aside">
        Respondents pick each answer from the bank: these answers and the extra
        words, in alphabetical order. A pick is checked against the answer, with
        no AI.
      </p>
    </template>
    <template v-else>
      <figure v-if="grid.length" class="preview">
        <CrosswordGrid :rows="size.rows" :cols="size.cols" :entries="grid" />
        <figcaption>The grid as it was laid out at the last save.</figcaption>
      </figure>
      <p class="aside">
        Each answer is one word, and the words cross on shared letters. The grid
        is laid out when the quiz is saved. A word that crosses no other is
        asked as a typed question.
      </p>
    </template>
  </article>
</template>

<style scoped>
.setcard {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px 18px;
  border: 1px solid var(--line);
  border-radius: var(--radius-xl);
  background: var(--surface);
  transition: box-shadow var(--fast);

  &:focus-within {
    box-shadow: var(--shadow-md);
  }
}

header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.num {
  display: grid;
  place-items: center;
  min-width: 28px;
  height: 28px;
  padding: 0 8px;
  border-radius: var(--radius-md);
  background: var(--accent);
  color: var(--accent-ink);
  font: 650 14px/1 var(--font-heading);
}
.kind {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 10px;
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  font-size: 13px;
  font-weight: 600;
}
.count {
  font-size: 13px;
  color: var(--muted);
}
.actions {
  display: flex;
  gap: 4px;
  margin-left: auto;
}
.icon {
  display: grid;
  flex: none;
  place-items: center;
  width: 30px;
  height: 30px;
  border: 0;
  padding: 0;
  border-radius: var(--radius-md);
  background: none;
  color: var(--muted);
  cursor: pointer;

  &:hover:not(:disabled) {
    background: var(--hover);
    color: var(--ink);
  }
  &:disabled {
    opacity: 0.3;
    cursor: default;
  }
  &.danger:hover {
    color: var(--bad);
  }
}

.title {
  padding: 6px 0;
  border: 0;
  border-bottom: 1px solid var(--line);
  outline: none;
  background: none;
  color: inherit;
  font: inherit;
  font-size: 17px;
  font-weight: 600;

  &:focus {
    border-bottom-color: var(--accent);
  }
}

.rows {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;

  li {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .n {
    flex: none;
    width: 22px;
    font-size: 13px;
    font-weight: 600;
    color: var(--muted);
    text-align: right;
  }
  .clue,
  .answer {
    min-height: 36px;
    padding: 7px 10px;
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    outline: none;
    background: var(--surface);
    color: inherit;
    font: inherit;
    font-size: 15px;

    &:focus {
      border-color: var(--accent);
    }
  }
  .clue {
    flex: 1 1 0;
    min-width: 0;
    field-sizing: content;
    resize: none;
  }
  .answer {
    flex: 0 1 190px;
    min-width: 0;
    background: var(--good-soft);
    font-weight: 600;
  }
  .place {
    flex: none;
    width: 66px;
    font-size: 12px;
    font-weight: 600;
    color: var(--muted);
  }
}

.more {
  display: inline-flex;
  align-items: center;
  align-self: flex-start;
  gap: 6px;
  min-height: 36px;
  margin-left: 30px;
  padding: 0 12px;
  border: 1px dashed var(--line);
  border-radius: var(--radius-md);
  background: none;
  color: inherit;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;

  &:hover {
    background: var(--hover);
  }
}

.label {
  font-size: 13px;
  font-weight: 600;
  color: color-mix(in srgb, var(--ink) 70%, transparent);
}
.extra {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 10px;

  input {
    flex: 1 1 240px;
    min-height: 36px;
    padding: 0 10px;
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    background: var(--surface);
    color: inherit;
    font: inherit;
    font-size: 14px;
  }
}
.aside {
  margin: 0;
  font-size: 13px;
  color: var(--muted);
}
.preview {
  display: grid;
  gap: 6px;
  justify-items: start;
  margin: 4px 0 0;

  figcaption {
    font-size: 12px;
    color: var(--muted);
  }
}

@media (max-width: 640px) {
  .rows li {
    flex-wrap: wrap;
  }
  .rows .clue {
    flex-basis: calc(100% - 30px);
  }
  .rows .answer {
    flex: 1 1 0;
    margin-left: 30px;
    min-height: 44px;
  }
  .icon {
    width: 44px;
    height: 44px;
  }
  .more {
    min-height: 44px;
  }
}
</style>
