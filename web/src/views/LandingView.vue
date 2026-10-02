<script setup lang="ts">
const options = [
  { letter: "A", text: "Gallium" },
  { letter: "B", text: "Mercury", correct: true },
  { letter: "C", text: "Cesium" },
  { letter: "D", text: "Bromine" },
]

const sample = "/q/8FSqvXwx"

const claimRows = [
  {
    title: "It prints as an exam.",
    text: "Set A and Set B print with an answer key on its own page and the table of specifications, in black and white.",
    src: "/landing/print.webp",
    width: 815,
    height: 674,
    alt: "Set A of the printed test: the school header, name and score lines, and Test I, multiple choice.",
  },
  {
    title: "Results show what to teach again.",
    text: "Results list the questions most people missed, with a short note on which ideas they mixed up.",
    src: "/landing/overview.webp",
    width: 1528,
    height: 1246,
    alt: "A shared quiz's results: views, quiz takers, average score and highest score, responses by day, and the three most missed questions.",
  },
]
</script>

<template>
  <section class="hero">
    <h1>Turn your notes into a quiz.</h1>
    <p class="lede">
      Upload a PDF or photos of a handout, in English or Filipino. Every
      question shows the sentence it came from. A quiz is private until it is
      shared by link or QR.
    </p>
    <div flex gap="sm" justify="center" mt="2xl" class="ctas">
      <RouterLink to="/register" btn="primary">Create an account</RouterLink>
      <RouterLink :to="sample" btn>Try a sample quiz</RouterLink>
    </div>
    <p class="note">
      People answer by link, with no account. The sample quiz is one of those
      links.
    </p>

    <!-- The product, drawn rather than screenshotted: the page a question came from, and the question. -->
    <figure class="shot">
      <div class="source-page">
        <small>Module 3, page 3</small>
        <h3>Properties of metals</h3>
        <p>
          Most metals are solid at room temperature.
          <mark
            >Mercury is the only metal that is liquid at room temperature.</mark
          >
          It melts at about &minus;38.8&nbsp;&deg;C, well below the freezing
          point of water.
        </p>
        <p>
          Gallium and cesium melt just above room temperature: gallium melts in
          the hand.
        </p>
      </div>

      <div class="question-card">
        <div flex justify="between" items="center">
          <small class="count">Question 4 of 20</small>
          <span class="chip">Remember</span>
        </div>
        <p class="prompt">
          What is the only metal that is liquid at room temperature?
        </p>
        <ol>
          <li
            v-for="o in options"
            :key="o.letter"
            :class="{ right: o.correct }"
          >
            <b>{{ o.letter }}.</b> {{ o.text }}
          </li>
        </ol>
        <blockquote>
          &ldquo;Mercury is the only metal that is liquid at room
          temperature.&rdquo;
          <small>Page 3. Found in the file.</small>
        </blockquote>
        <p class="review">
          A question can be edited or deleted before the quiz is shared.
        </p>
      </div>
    </figure>
  </section>

  <section class="claims">
    <div class="claim-intro">
      <h2>Every question shows its source.</h2>
      <p>
        The sentence it came from sits under it, as in the card above. A
        question whose sentence is not in the file is flagged before the quiz is
        shared.
      </p>
    </div>
    <div v-for="c in claimRows" :key="c.title" class="claim">
      <div class="claim-text">
        <h2>{{ c.title }}</h2>
        <p>{{ c.text }}</p>
      </div>
      <figure class="claim-shot">
        <img
          :src="c.src"
          :width="c.width"
          :height="c.height"
          :alt="c.alt"
          loading="lazy"
        />
      </figure>
    </div>
  </section>
</template>

<style scoped>
.hero {
  --copy-w: 585px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: clamp(40px, 8vh, 96px) clamp(16px, 4vw, 40px) 0;
}

h1 {
  margin: 0;
  font-size: clamp(40px, 6.4vw, 78px);
  font-weight: 650;
  letter-spacing: -0.035em;
  line-height: 1;
  text-wrap: balance;
  max-width: 14ch;
}

.lede {
  margin: var(--space-xl) 0 0;
  max-width: var(--copy-w);
  font-size: clamp(16px, 1.4vw, 19px);
  line-height: 1.5;
  color: var(--muted);
}

.note {
  margin: var(--space-md) 0 0;
  max-width: var(--copy-w);
  font-size: 13px;
  color: var(--muted);
}

@media (max-width: 520px) {
  .ctas [btn] {
    min-height: 44px;
  }
}

/* ---- the product ------------------------------------------------------------ */

.shot {
  display: grid;
  grid-template-columns: 5fr 6fr;
  width: min(100%, 1100px);
  margin: clamp(40px, 7vh, 72px) 0 0;
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  background: var(--surface);
  box-shadow:
    0 24px 64px rgb(0 0 0 / 0.1),
    0 2px 6px rgb(0 0 0 / 0.04);
  text-align: left;
  overflow: hidden;
}

.source-page {
  display: block;
  padding: var(--space-3xl);
  background: var(--sunken);
  border-right: 1px solid var(--line);
  font-family: Georgia, "Times New Roman", serif;
  line-height: 1.65;

  small {
    font-family: var(--font);
    color: var(--muted);
  }
  h3 {
    margin: var(--space-sm) 0 var(--space-md);
    font-size: 22px;
  }
  p {
    margin: 0 0 var(--space-md);
  }
  mark {
    background: color-mix(in srgb, var(--accent) 16%, transparent);
    color: inherit;
    border-radius: 3px;
    padding: 1px 2px;
  }
}

.question-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  padding: var(--space-3xl);
}

.count {
  color: var(--muted);
}

.chip {
  padding: 2px 10px;
  border-radius: var(--radius-full);
  background: var(--sunken);
  font-size: var(--fs-xs);
  font-weight: 600;
  color: var(--muted);
}

.prompt {
  margin: 0;
  font-size: var(--fs-lg);
  font-weight: 600;
}

ol {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--space-xs);

  li {
    padding: 10px 14px;
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
  }
  li.right {
    background: var(--good-soft);
    border-color: color-mix(in srgb, var(--good) 40%, transparent);
  }
}

blockquote {
  margin: 0;
  padding: var(--space-sm) var(--space-md);
  border-left: 3px solid var(--accent);
  font-size: var(--fs-sm);
  color: color-mix(in srgb, var(--ink) 75%, transparent);

  small {
    display: block;
    margin-top: var(--space-2xs);
    color: var(--good);
    font-weight: 600;
  }
}

.review {
  margin: var(--space-xs) 0 0;
  padding-top: var(--space-md);
  border-top: 1px solid var(--line);
  font-size: 13px;
  color: var(--muted);
}

@media (max-width: 760px) {
  .shot {
    grid-template-columns: 1fr;
  }
  .source-page {
    border-right: 0;
    border-bottom: 1px solid var(--line);
    padding: var(--space-xl);
  }
  .question-card {
    padding: var(--space-xl);
  }
}

/* ---- the claims ------------------------------------------------------------- */

.claims {
  display: grid;
  gap: clamp(48px, 8vh, 88px);
  width: min(100%, 1100px);
  margin: 0 auto;
  padding: clamp(64px, 10vh, 120px) clamp(16px, 4vw, 40px);
}

.claim {
  display: grid;
  grid-template-columns: 1fr 1.4fr;
  gap: clamp(24px, 5vw, 64px);
  align-items: center;
}

.claim:nth-child(odd) {
  grid-template-columns: 1.4fr 1fr;
}
.claim:nth-child(odd) .claim-shot {
  order: -1;
}

.claim-intro {
  width: min(100%, 52ch);
  margin: 0 auto;
  padding-bottom: clamp(32px, 5vh, 48px);
  border-bottom: 1px solid var(--line);
  text-align: center;
}

.claim-text {
  padding-top: var(--space-lg);
  border-top: 1px solid var(--line);
}

.claim-intro,
.claim-text {
  h2 {
    margin: 0;
    font-size: var(--fs-xl);
    font-weight: 650;
    letter-spacing: -0.01em;
  }
  p {
    margin: var(--space-sm) 0 0;
    color: var(--muted);
    line-height: 1.55;
  }
}

.claim-shot {
  margin: 0;
  border: 1px solid var(--line);
  border-radius: var(--radius-xl);
  background: var(--surface);
  overflow: hidden;
  box-shadow:
    0 24px 48px -16px color-mix(in srgb, var(--accent) 28%, transparent),
    0 2px 6px color-mix(in srgb, var(--accent) 8%, transparent);

  img {
    display: block;
    width: 100%;
    height: auto;
  }
}

@media (max-width: 760px) {
  .claim,
  .claim:nth-child(odd) {
    grid-template-columns: 1fr;
    gap: var(--space-xl);
  }
  .claim:nth-child(odd) .claim-shot {
    order: 0;
  }
}
</style>
