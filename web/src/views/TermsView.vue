<script setup lang="ts">
import { onMounted, onUnmounted } from "vue"
import LogoMark from "../components/LogoMark.vue"

// The tab's title while the page is open; the one before it comes back after.
let before = ""
onMounted(() => {
  before = document.title
  document.title = "Terms of use · QuizApp"
})
onUnmounted(() => {
  document.title = before
})
</script>

<template>
  <main class="doc">
    <header class="doc-head">
      <RouterLink to="/" class="mark">
        <LogoMark :size="24" />
        <span>QuizApp</span>
      </RouterLink>
    </header>

    <article>
      <h1>Terms of use</h1>
      <p class="dated">Last updated 2026-10-02</p>
      <p>
        QuizApp is a free platform for making and sharing quizzes, run by Kyle
        Cyrus Obille, an individual, and built for the RAITE 2026 AI in
        Education Hackathon. Using it means you accept these terms and the
        <RouterLink to="/privacy">privacy policy</RouterLink>.
      </p>

      <h2>Your account</h2>
      <p>
        Making quizzes needs an account; answering one does not. What is done
        from your account is yours to answer for, so keep your sign-in to
        yourself. You can delete the account at any time from Settings.
      </p>

      <h2>Your material</h2>
      <p>
        What you upload stays yours. Upload only material you own or may use for
        this purpose; QuizApp does not check. By uploading, you let QuizApp
        store the files, read their text, and send that text to Google's Gemini
        API to draft and grade, as the privacy policy describes.
      </p>

      <h2>Quizzes you share</h2>
      <p>
        A shared quiz opens for anyone with its link or QR code until you stop
        sharing or archive it. You are responsible for what it contains, for
        whom you give the link to, and for telling respondents what the quiz is
        for and who sees their answers. QuizApp does not review or endorse
        shared quizzes. A respondent can report one, and the report reaches you
        alone.
      </p>

      <h2>The AI</h2>
      <p>
        Drafts and verdicts come from an AI that can be wrong. Check every
        question before you share it, and every AI verdict before a score
        counts; you can change any score. Respondents are told when an AI
        checked an answer.
      </p>

      <h2>Respondents</h2>
      <p>
        A quiz asks for your name and nothing else. Do not type passwords or
        other private details into a quiz; QuizApp never asks for them. The quiz
        maker sees your name beside your answers and decides whether you can
        take the quiz again.
      </p>

      <h2>What is not allowed</h2>
      <p>
        A quiz must not carry harmful or unlawful content, pass off someone
        else's work as its own, or be used to collect passwords, money details
        or other private information. Do not probe, scrape or overload the
        service. A quiz or an account that breaks these terms can be removed.
      </p>

      <h2>No promises</h2>
      <p>
        QuizApp is provided as is, during and after the hackathon. There is no
        promise of uptime, of keeping data for any length of time, or of the
        AI's accuracy. Print what you need to keep; every quiz has a print view.
        To the extent the law allows, Kyle is not liable for loss that comes
        from using it.
      </p>

      <h2>Changes</h2>
      <p>These terms can change; the date at the top says when.</p>

      <h2>Contact</h2>
      <p>
        Kyle Cyrus Obille,
        <a href="mailto:okyle.dev@gmail.com">okyle.dev@gmail.com</a>.
      </p>
    </article>

    <footer class="doc-foot">
      <p>See also the <RouterLink to="/privacy">privacy policy</RouterLink>.</p>
    </footer>
  </main>
</template>

<style scoped>
/* A plain document: one reading column, the app's type and colors. */
.doc {
  box-sizing: border-box;
  width: min(100%, 720px);
  margin: 0 auto;
  padding: 40px var(--page-pad, 20px);
  color: var(--ink);
  background: var(--bg);
}

.doc-head {
  margin-bottom: var(--space-3xl);
}

.mark {
  display: inline-flex;
  align-items: center;
  gap: var(--space-sm);
  color: var(--ink);
  font: 650 var(--fs-lg) var(--font-heading);
  letter-spacing: -0.01em;
  text-decoration: none;

  svg {
    color: var(--accent);
  }
}

h1 {
  margin: 0;
  font-size: var(--fs-3xl);
  font-weight: 650;
  letter-spacing: -0.02em;
  line-height: 1.15;
}

.dated {
  margin: var(--space-sm) 0 var(--space-2xl);
  font-size: var(--fs-sm);
  color: var(--muted);
}

h2 {
  margin: var(--space-3xl) 0 var(--space-sm);
  font-size: var(--fs-xl);
  font-weight: 650;
  letter-spacing: -0.01em;
}

p {
  margin: 0 0 var(--space-md);
  text-wrap: pretty;
}

a {
  color: var(--accent);
}

.doc-foot {
  margin-top: var(--space-4xl);
  padding-top: var(--space-lg);
  border-top: 1px solid var(--line);
  font-size: var(--fs-sm);
  color: var(--muted);

  p {
    margin: 0;
  }
}
</style>
