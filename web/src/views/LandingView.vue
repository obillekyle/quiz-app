<script setup lang="ts">
import Icon from "../components/Icon.vue"
import LogoMark from "../components/LogoMark.vue"

const options = [
  { letter: "A", text: "Gallium" },
  { letter: "B", text: "Mercury", correct: true },
  { letter: "C", text: "Cesium" },
  { letter: "D", text: "Bromine" },
]

const claimRows = [
  {
    title: "Every question shows its source.",
    text: "The sentence it came from sits under it. A question whose sentence is not in the file is flagged before the quiz is shared.",
  },
  {
    title: "It prints as an exam.",
    text: "Set A and Set B, an answer key on its own page, and the table of specifications, in black and white.",
  },
  {
    title: "Results show what to teach again.",
    text: "The questions most people missed, and a short note on which ideas they mixed up.",
  },
]
</script>

<template>
  <section class="hero">
    <!-- Pieces of the app that burst out from behind the headline, as cutvid's do. -->
    <span class="g check" aria-hidden="true">
      <Icon name="check" :size="20" />
    </span>
    <span class="g opt" aria-hidden="true"><b>B.</b> Mercury</span>
    <span class="g bar" aria-hidden="true"><i /></span>
    <span class="g quote" aria-hidden="true">&ldquo;</span>
    <span class="g score" aria-hidden="true">67 / 69</span>
    <span class="g q" aria-hidden="true"><LogoMark :size="30" /></span>

    <h1>Turn your notes into a quiz.</h1>
    <p class="lede">
      Upload a PDF or photos of a handout, in English or Filipino. Every
      question shows the sentence it came from, and nobody sees it until you
      approve it.
    </p>
    <div flex gap="sm" justify="center" mt="2xl" class="ctas">
      <RouterLink to="/register" btn="primary">Create an account</RouterLink>
      <RouterLink to="/login" btn>Sign in</RouterLink>
    </div>
    <p class="note">People answer by link, with no account.</p>

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
        <div flex gap="sm" justify="end">
          <span btn="quiet" aria-hidden="true">Drop</span>
          <span btn="primary" aria-hidden="true">Keep</span>
        </div>
      </div>
    </figure>
  </section>

  <section class="claims">
    <div v-for="c in claimRows" :key="c.title">
      <h2>{{ c.title }}</h2>
      <p>{{ c.text }}</p>
    </div>
  </section>
</template>

<style scoped>
.hero {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: clamp(40px, 8vh, 96px) clamp(16px, 4vw, 40px) 0;
  overflow-x: clip;

  > * {
    position: relative;
    z-index: 1;
  }
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
  max-width: 46ch;
  font-size: clamp(16px, 1.4vw, 19px);
  line-height: 1.5;
  color: var(--muted);
}

.note {
  margin: var(--space-md) 0 0;
  font-size: 13px;
  color: var(--muted);
}

/* ---- the bursting pieces --------------------------------------------------- */

.g {
  position: absolute;
  z-index: 0;
  opacity: var(--o, 0.7);
  animation: burst 0.85s var(--ease) var(--d, 0.35s) both;
}

.check {
  left: 9%;
  top: 130px;
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: var(--good);
  color: white;
  --fx: 38vw;
  --fy: 60px;
  --d: 0.35s;
}

.opt {
  right: 8%;
  top: 120px;
  padding: 8px 14px;
  border: 1px solid color-mix(in srgb, var(--good) 45%, transparent);
  border-radius: var(--radius-md);
  background: var(--good-soft);
  font-size: 14px;
  color: var(--ink);
  --o: 0.85;
  --fx: -36vw;
  --fy: 80px;
  --d: 0.42s;
}

.bar {
  left: 6%;
  top: 250px;
  width: 120px;
  height: 8px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--student) 18%, transparent);
  --fx: 40vw;
  --fy: -40px;
  --d: 0.5s;

  i {
    display: block;
    width: 70%;
    height: 100%;
    border-radius: inherit;
    background: var(--student);
  }
}

.quote {
  left: 17%;
  top: 300px;
  font-size: 72px;
  line-height: 1;
  font-weight: 700;
  color: var(--accent);
  --o: 0.35;
  --fx: 30vw;
  --fy: -120px;
  --d: 0.55s;
}

.score {
  right: 13%;
  top: 310px;
  padding: 6px 10px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--surface);
  font:
    600 13px/1 ui-monospace,
    monospace;
  color: var(--good);
  --o: 0.85;
  --fx: -30vw;
  --fy: -130px;
  --d: 0.6s;
}

.q {
  right: 4%;
  top: 215px;
  color: var(--accent);
  transform: rotate(-12deg);
  --o: 0.5;
  --fx: -42vw;
  --fy: 0px;
  --d: 0.48s;
}

@keyframes burst {
  from {
    opacity: 0;
    transform: translate(var(--fx, 0px), var(--fy, 0px)) scale(0.3);
  }
}

@media (max-width: 900px) {
  .g {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .g {
    animation: none;
  }
}

/* ---- the product ------------------------------------------------------------ */

.shot {
  display: grid;
  grid-template-columns: 5fr 6fr;
  width: min(100%, 1100px);
  margin-top: clamp(40px, 7vh, 72px);
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

/* ---- the .claims ------------------------------------------------------------- */

.claims {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: clamp(24px, 4vw, 56px);
  width: min(100%, 1100px);
  margin: 0 auto;
  padding: clamp(64px, 10vh, 120px) clamp(16px, 4vw, 40px);

  div {
    padding-top: var(--space-lg);
    border-top: 1px solid var(--line);
  }
  h2 {
    margin: 0;
    font-size: var(--fs-lg);
    font-weight: 650;
    letter-spacing: -0.01em;
  }
  p {
    margin: var(--space-sm) 0 0;
    color: var(--muted);
    line-height: 1.55;
  }
}

@media (max-width: 760px) {
  .claims {
    grid-template-columns: 1fr;
  }
}
</style>
