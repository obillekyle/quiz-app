<script setup lang="ts">
import LogoMark from "../components/LogoMark.vue"
// The other marks, inlined (`?raw`) because they are drawn in currentColor:
// inside an <img> there is no current color to take. Inline they follow the
// text, gray at rest and ink on hover, as cutvid's foot does.
import livro from "../assets/brands/livro.svg?raw"
import paldo from "../assets/brands/paldo.svg?raw"
import okyle from "../assets/brands/okyle.png"
</script>

<template>
  <header class="site-header">
    <RouterLink to="/" class="mark">
      <LogoMark :size="28" />
      <span>QuizApp</span>
    </RouterLink>
    <nav flex items="center" gap="xs">
      <RouterLink to="/login" btn="quiet">Sign in</RouterLink>
      <RouterLink to="/register" btn="primary">Create account</RouterLink>
    </nav>
  </header>

  <RouterView />

  <footer class="site-footer">
    <div class="foot-brand">
      <RouterLink to="/" class="mark"
        ><LogoMark :size="22" /> QuizApp</RouterLink
      >
      <p>
        Quizzes from your own notes, and every question shows the sentence it
        came from.
      </p>
      <nav aria-label="This site">
        <RouterLink to="/register">Create an account</RouterLink>
        <RouterLink to="/login">Sign in</RouterLink>
        <RouterLink to="/q/8FSqvXwx">Sample quiz</RouterLink>
        <RouterLink to="/privacy">Privacy</RouterLink>
        <RouterLink to="/terms">Terms</RouterLink>
      </nav>
    </div>

    <!-- Where else Kyle is, as on cutvid and okyle.dev: his mark in color, the
         others gray until hovered (Livro then shows its own colors). -->
    <nav class="foot-sites" aria-label="Elsewhere">
      <a href="https://okyle.dev/" rel="noopener">
        <img :src="okyle" width="26" height="26" alt="" />
        <span>okyle.dev</span>
      </a>
      <a
        class="wordmark paldo"
        href="https://www.paldo.dev/"
        rel="noopener"
        aria-label="paldo.dev"
        v-html="paldo"
      />
      <a
        class="wordmark livro"
        href="https://livro.systems/"
        rel="noopener"
        aria-label="Livro Systems"
        v-html="livro"
      />
    </nav>

    <p class="credit">Built for the RAITE 2026 AI in Education Hackathon.</p>
  </footer>
</template>

<style scoped>
.site-header {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 64px;
  padding-inline: clamp(16px, 4vw, 40px);
  background: color-mix(in srgb, var(--bg) 82%, transparent);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--line);
}

.mark {
  font-family: var(--font-heading);
  display: inline-flex;
  align-items: center;
  gap: var(--space-sm);
  color: var(--ink);
  font-weight: 650;
  font-size: var(--fs-lg);
  letter-spacing: -0.01em;
  text-decoration: none;

  svg {
    color: var(--accent);
  }
}

.site-footer {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 28px clamp(24px, 4vw, 64px);
  align-items: end;
  padding: clamp(40px, 6vh, 64px) clamp(16px, 4vw, 40px) 28px;
  border-top: 1px solid var(--line);
}

.foot-brand {
  display: flex;
  flex-direction: column;
  gap: 10px;

  .mark {
    font-size: var(--fs-md);
  }
  p {
    margin: 0;
    max-width: 44ch;
    font-size: 14px;
    color: var(--muted);
  }
  /* Five links at a phone's width go onto two lines, each link whole. */
  nav {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 18px;
    font-size: 14px;
  }
  nav a {
    color: color-mix(in srgb, var(--ink) 70%, transparent);
    text-decoration: none;
    white-space: nowrap;

    &:hover {
      color: var(--ink);
    }
  }
}

/* Each site with its own mark, at a size the mark can carry: the avatar is
     square, the two wordmarks are wide, so the row aligns on their centers. */
.foot-sites {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: clamp(20px, 3vw, 40px);

  a,
  .wordmark {
    display: inline-flex;
    align-items: center;
    gap: 9px;
    font-size: 13.5px;
    color: var(--muted);
    text-decoration: none;
    transition: color var(--fast) var(--ease);
  }
  a:hover {
    color: var(--ink);
  }
  img {
    width: 26px;
    height: 26px;
    border-radius: 7px;
    flex: none;
  }
  .paldo :deep(svg) {
    width: 74px;
    height: auto;
  }
  .livro :deep(svg) {
    width: 92px;
    height: auto;
  }
  /* Gray at rest; under the pointer, Livro's own blue and orange. */
  .livro :deep(path) {
    transition: fill var(--fast) var(--ease);
  }
  .livro:hover :deep(.b),
  .livro:focus-visible :deep(.b) {
    fill: #2b388e;
  }
  .livro:hover :deep(.o),
  .livro:focus-visible :deep(.o) {
    fill: #ff6e00;
  }
}

.credit {
  grid-column: 1 / -1;
  margin: 0;
  padding-top: 18px;
  border-top: 1px solid var(--line);
  font-size: 13px;
  color: var(--muted);
}

@media (max-width: 700px) {
  .site-footer {
    grid-template-columns: 1fr;
  }
  .foot-sites {
    justify-content: flex-start;
  }
}

@media (max-width: 520px) {
  nav [btn="quiet"] {
    padding-inline: var(--space-md);
  }
}
</style>
