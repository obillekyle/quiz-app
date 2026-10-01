<script setup lang="ts">
/**
 * The top of a quiz's own pages (Respondents, Sharing, Settings): the trail
 * back, the page's name, and the quiz it belongs to with its status.
 */
defineProps<{
  quizId: number
  quiz: string
  page: string
  status?: "draft" | "published"
  archived?: boolean
}>()
</script>

<template>
  <header class="head">
    <div class="title-row">
      <h1>{{ page }}</h1>
    </div>
  </header>
</template>

<style scoped>
.head {
  padding-bottom: 16px;
}
.crumbs {
  display: flex;
  gap: 8px;
  min-width: 0;
  font-size: 14px;
  color: var(--muted);

  a {
    color: inherit;
    text-decoration: none;
    white-space: nowrap;
  }
  a:hover {
    color: var(--ink);
  }
  .quiz {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  [aria-current] {
    white-space: nowrap;
  }
}
.title-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-top: 8px;

  h1 {
    margin: 0;
    font-size: clamp(24px, 3vw, 30px);
    letter-spacing: -0.02em;
  }
}
.status {
  padding: 2px 10px;
  border-radius: var(--radius-full);
  background: var(--sunken);
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);

  &[data-status="published"] {
    background: color-mix(in srgb, var(--accent) 12%, var(--surface));
    color: var(--accent);
  }
}
</style>
