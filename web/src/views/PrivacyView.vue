<script setup lang="ts">
import { onMounted, onUnmounted } from "vue"
import LogoMark from "../components/LogoMark.vue"

// The tab's title while the page is open; the one before it comes back after.
let before = ""
onMounted(() => {
  before = document.title
  document.title = "Privacy policy · QuizApp"
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
      <h1>Privacy policy</h1>
      <p class="dated">Last updated 2026-10-02</p>
      <p>
        QuizApp is run by Kyle Cyrus Obille, an individual, and was built by BPC
        Competitors for the RAITE 2026 AI in Education Hackathon. It is free,
        and nothing in it is sold, shown to advertisers, or shared beyond the
        services named here.
      </p>

      <h2>What is stored</h2>
      <p>
        Everything sits in one database and one uploads folder on a server Kyle
        runs, until it is deleted or a time given below runs out.
      </p>
      <p>
        <b>Accounts.</b> Your name and email; a password hash (scrypt) when you
        set a password; the id of your Google account when you sign in with
        Google. A session keeps you signed in for 30 days. A sign-in code is
        kept as a hash for a day and works for 10 minutes.
      </p>
      <p>
        <b>Quizzes.</b> The questions and their answer keys, the files you
        upload and the text read from them, your request and chat with the AI,
        the note on what to teach again, and the settings: description, icon,
        cover image, time limits, shuffling, retakes, and whether results show
        at once.
      </p>
      <p>
        <b>Responses.</b> The name a respondent types, each answer with its
        score and verdict, a rating, when the attempt started and finished, and,
        when the quiz shuffles, the paper as it was laid out. An email a
        respondent leaves to be told when held-back results come out is used for
        that one message and goes when the response does.
      </p>
      <p>
        <b>Illustrations.</b> A picture on a question is a file the teacher
        uploaded, a figure cropped from the module, or a copy from Wikimedia
        Commons, shown with its author and license.
      </p>
      <p>
        <b>Reports.</b> A reason, an optional note, the question on screen and
        the time. A report carries no name, is tied to no attempt, and goes to
        the quiz maker only; nobody at QuizApp reviews shared quizzes.
      </p>

      <h2>What is never stored</h2>
      <p>
        A password or a sign-in code in plain text. Google's tokens. A
        respondent's network address: the limits on reports and release emails
        count addresses in memory for an hour and store none.
      </p>

      <h2>What goes to the AI</h2>
      <p>
        Google's Gemini API reads, drafts, edits and grades. It receives the
        text of your material (or, once, photos and scanned pages to
        transcribe), your requests and chat messages, the questions while they
        are edited, and the per-question counts behind the note on what to teach
        again. When AI checking is on, a typed identification answer goes with
        its question and accepted answers, and an essay with its question and
        rubric. Finding a picture sends the question and its page. A
        respondent's name never goes to the AI.
      </p>

      <h2>What else leaves the server</h2>
      <ul>
        <li>
          Sign-in codes and release notices are sent through Gmail's SMTP
          server, to the address typed.
        </li>
        <li>
          Signing in with Google sends the sign-in code and a verifier to
          Google's token endpoint. The scopes are openid, email and profile.
        </li>
        <li>
          Finding a picture sends a search term the AI wrote, at most 60
          characters, to Wikimedia Commons, and the chosen picture is fetched
          from there. No quiz, question or person goes with it.
        </li>
        <li>
          A quiz's icon is drawn by Iconify's icon service, so a browser showing
          a quiz asks api.iconify.design for the icon by name. The icon picker's
          search goes there too.
        </li>
      </ul>

      <h2>Cookies and your browser</h2>
      <p>
        One cookie, <code>qa_session</code>, keeps a teacher signed in for 30
        days; page scripts cannot read it. One more, <code>qa_sidebar</code>,
        remembers a folded sidebar. The browser's own storage holds display
        preferences (theme, grid or list, sort, print header) and, on a
        respondent's browser, the attempt's id and token so a refresh resumes
        the quiz, and whether the visit was counted as a view. There are no
        analytics and no advertising.
      </p>

      <h2>Deleting your data</h2>
      <p>
        Deleting a quiz, from its settings page, takes its questions, files,
        chat, responses and reports with it. Deleting the account, from
        Settings, takes everything. A respondent has no account to delete: ask
        the quiz maker, who can delete any response from the quiz's Respondents
        page.
      </p>

      <h2>Respondents and age</h2>
      <p>
        The respondent side asks for a name only. A teacher who uses QuizApp
        with minors is responsible for their school's consent rules.
      </p>

      <h2>Changes</h2>
      <p>A change to this page moves the date at the top.</p>

      <h2>Contact</h2>
      <p>
        Kyle Cyrus Obille,
        <a href="mailto:okyle.dev@gmail.com">okyle.dev@gmail.com</a>.
      </p>
    </article>

    <footer class="doc-foot">
      <p>See also the <RouterLink to="/terms">terms of use</RouterLink>.</p>
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

p,
li {
  margin: 0 0 var(--space-md);
  text-wrap: pretty;
}

ul {
  margin: 0;
  padding-left: 1.2em;
}

code {
  padding: 1px 3px;
  border-radius: var(--radius-sm);
  background: var(--sunken);
  font-size: 0.92em;
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
