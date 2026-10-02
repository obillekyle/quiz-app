# QuizApp technical documentation

How QuizApp works, from the screens down to the tables. Setup, settings and the project layout are in the [README](../README.md).

## Contents

1. [Overview](#overview)
2. [User flows](#user-flows)
3. [Interface](#interface)
4. [The AI pipeline](#the-ai-pipeline)
5. [Model chains and resting](#model-chains-and-resting)
6. [Data model](#data-model)
7. [API routes](#api-routes)
8. [Security and privacy](#security-and-privacy)
9. [Error handling](#error-handling)
10. [Known limits](#known-limits)

## Overview

![QuizApp architecture](architecture.png)

QuizApp is two programs and a database:

- **`web/`**, a Vue 3 single-page app with two sides. The teacher side (brown, `#5c3715`) needs an account. The respondent side (purple, `#6b276c`, or the quiz's own color, at `/q/<code>`) needs a name only.
- **`server/`**, a Hono API under `/api`. Bun runs it in development and Node 24 in deployment, from the same TypeScript files. Deployed, the same process serves the built pages.
- **One SQLite file** through bakery-orm (`server/data/silid.db`), plus the files on disk: the uploaded material and each quiz's cover under `server/data/uploads`, and the pictures on questions under `server/data/illustrations`.

Five outside services: the Gemini API for every AI step, Google OAuth for "Continue with Google", Gmail SMTP for sign-in codes and the notice that held results are out, Wikimedia Commons (with English Wikipedia's search) for pictures on questions, and Iconify's API, which the browser asks for a quiz's icon by name and for the icon search.

In development, Vite on port 3220 forwards `/api` to the API on port 3221, so the app always calls its own origin. Deployed, the one Node process answers `/api` and serves `web/dist` itself, with `index.html` for any path that is no file; Apache maps the domain to the process's port as a reverse proxy, and Cloudflare sits in front of Apache. It runs as a systemd unit at https://quiz.okyle.dev; the README has the steps.

"Teacher" below means whoever makes the quiz; the app itself calls them the quiz maker. Anyone can be one.

## User flows

### Teacher

1. **Sign in.** "Continue with Google", or "Continue with email": a six-digit code arrives by email and signs in, creating the account when the address is new (one more step then asks for a name). An account that has a password can sign in with it instead.
2. **Start a quiz.** Home has a prompt box for a request and files (PDF, JPG, PNG, WebP or HEIC, through the + button or dropped on the box). Each file uploads the moment it is picked and the server starts reading it; the file's line shows how far it has got and how it was read. Sending creates the quiz (`POST /api/quizzes`) and opens the builder with its AI panel. Under the box, the quizzes as cards or rows, each with its cover, else its icon, else its first letter on its color, a line counting its questions and its finished responses ("11 questions · 12 responses"; the time of the last edit is the card's tooltip), and a small square that draws those responses per day over the last 14 days, scaled to its own busiest day (`GET /api/responses/activity`).
3. **Get the draft.** The builder asks for the draft (`POST /api/quizzes/:id/draft`) and names the step the AI is on: reading the material, writing the questions, checking every quote against the file. Under that name the questions pane builds skeleton cards ([the building preview](#the-building-preview)), and the chat's prompt box shows its working look ([the prompt box](#the-prompt-box)). The questions appear with a summary line: the number of questions and points, how many quotes were found in the file, and how many were not ("1 not found in the file"). The AI's reply in the chat says what it made and what to check.
4. **Refine.** A chat message, with more files if needed, changes the quiz through operations. Edits made by hand on the question cards are saved first, so the AI edits what is on screen. The Files tab lists the material and how each file was read. Every field of a question can be edited by hand (kind, Bloom level, points, options and their reasons, the correct answer, accepted answers, rubric, explanation, quote, topic), and questions can be added, moved and deleted. Save stores the quiz and runs the grounding check again. Leaving with unsaved edits asks first. Until the first message after the draft, the chat's empty state offers three asks as chips worded for this quiz ("Make question 4 harder", "Add two questions from page 2", "Put the hints in Filipino"); a chip fills the box. On a phone the builder is three tabs, chat, questions and files, each the full width while the AI panel is open; the quiz name takes the bar with its status as a caption under it, and Save is drawn disabled while there is nothing to save.
   A card's "Add a picture" offers two ways: "Find one" asks the AI for a figure on the page the question's quote is on and for a search term, then shows the crops from the page and the Wikimedia Commons pictures to choose from, each with its credit; "Upload" takes the teacher's own JPG, PNG or WebP. The picture sits above the prompt with a field for its alt text, and Save stores it with the question ([pipeline step 7](#7-pictures-for-questions)).
5. **Share.** The overview's Sharing panel shares the quiz (it needs at least one question): a link to `/q/<code>`, a copy button and a QR code. The Sharing page shows the QR code large, to download as SVG or to show a class, and above the link the choice of Practice, Test or Graded: a segmented control over four settings (`feedback`, `showResults`, `showHints`, `allowRetake`), saved in one request.

   | Mode | Answers (`feedback`) | Results | Hints | Attempts |
   | --- | --- | --- | --- | --- |
   | Practice, the default | Checked when confirmed, then locked (`each`) | Shown | On | More than one per browser |
   | Test | Saved unchecked, changeable until Finish (`end`) | Shown at the end | Off | More than one per browser |
   | Graded | Saved unchecked, changeable until Finish (`end`) | Held until released | Off | One per browser |

   Any other mix of the four reads "Custom", a state this control only reports, with the four values listed under it and a link to the Settings page. The overview's panel states the mode in a sentence ("Test. Answers can be changed until the quiz is finished. The score and the answers show at the end.") with a Change link to the Sharing page, or to Settings while Custom. Choosing Practice or Test on a quiz whose results were held releases them, and whoever left an email is told.

   Beside the title, a chip reads "Shared" while the link is open, "Not shared" for a quiz that was shared before (it has takers, open attempts or a release) and "Draft" for one never shared; an archived quiz shows "Archived" instead, and its Sharing panel reads "Archived. The link does not open." Stopping turns the link off and pauses the overall clock of every attempt still open; sharing again brings back the same link and resumes those clocks where they stopped. Archiving a shared quiz pauses them the same way, and restoring it resumes them (the rule is under [API routes](#api-routes)).
6. **Follow the results.** The overview shows views, quiz takers (and how many are still answering), the average and highest score, responses per day for the last 14 days, the five questions missed most often, recent respondents, reports, and the quiz's shape (kinds, Bloom levels, topics, how many quotes were found, the material). An average under 75%, the passing mark in DepEd Order No. 8, s. 2015, is marked. "Ask the AI for a note" ("Rewrite the note" once there is one) asks the AI what to teach again ([pipeline step 6](#6-what-to-teach-again)). The recent respondents' heading carries Download CSV, the same file as the Respondents page. The bell in the top bar lists finished responses and reports across every quiz the teacher owns. What waits for the teacher sits above the numbers: while the results are held and at least one person has finished, "Results are held" with how many people left an email, and "Release results"; essays waiting for a score, counted, with a link to the oldest response holding one.
7. **Review a response.** Respondents lists every attempt, finished or still answering, each with the section typed under the name when there was one. A select sorts them by newest, name, score high to low or score low to high (a score order puts the ones still answering last), a second select narrows the list to one section, and a search finds one by name; a response with essays waiting for a score says how many. Download CSV (`GET /api/quizzes/:id/responses.csv`) writes every row for a spreadsheet, the DepEd e-Class Record being filled by hand otherwise. A response shows the section beside the name and every question with the answer given: the options in green and red for multiple choice and true or false; the typed text, the accepted answers and the verdict for identification and essays. An AI verdict carries an "AI" label. A shuffled paper opens in the order the respondent saw, marked "Shuffled for this respondent", its options lettered as the respondent saw them and each question's key named as shown ("Key B"). "Change score" sets the teacher's own score (from 0 to the question's points, in halves); the answer is marked as changed, an essay that waited for the score waits no longer, and the response's total is added up again. A response can also be deleted. The sidebar's Responses page lists every response across all of the teacher's quizzes, people still answering first, each with its section and its quiz, and finds one by name or quiz.
8. **Print.** "Print as a test" opens the print view: Set A, Set B or both; short bond (8.5 × 11 in), long bond (8.5 × 13 in) or A4; the answer key and the table of specifications on or off; and the school, subject and teacher for the header, kept in the browser for the next test. A question's picture prints in grayscale, no taller than a third of the page, with its credit under it. The browser's own print dialog makes the paper or a PDF.
9. **Quiz settings.** The quiz's own page, in five sections, every control saving on its own as it changes (text when it loses focus), with "Saved" beside it for two seconds:
   - **Quiz.** The name (160 characters at most) and a description (1,000) shown on the shared quiz's intro. An icon from any Iconify set, searched by word, or an uploaded cover (JPG, PNG, WebP or GIF; the page shrinks a photo to 1600 px on its long side as WebP before sending, and the server takes 5 MB at most and reads the file's first bytes rather than its name). The cover shows on the quiz's card and its shared page in place of the icon, and the icon returns when the cover is removed. A Color tile: six palette swatches (purple, blue, red, orange, green, brown), a custom swatch on the browser's own color picker, and "Use the default", which goes back to the palette color the quiz's id picks ([a color per quiz](#a-color-per-quiz)). "Shuffle questions" gives each respondent the questions in a different order; "Shuffle options" does the same for the options of every multiple-choice question (true or false keeps its order).
   - **Time limit.** None, per question (10 s to 10 min) or overall (1 min to 3 h). The hint under the field says what the limit means for a respondent.
   - **Responses.** "Show hints": off, no question offers its "Show hint" (the topic and the page), as on a Test or Graded quiz. "Allow more than one attempt": off, a browser that finished the quiz opens the finished attempt instead, though another browser can still start one. "Show score and answers": off, both wait until the teacher releases them; the panel under it says how many people left an email, and "Release results" releases them and emails everyone who asked. Turning the switch back on is a release too, confirmed first when people are waiting. Each switch is a button with the switch role, named for a screen reader by its row's title and described by the line under it.
   - **AI checking.** "Check typed answers with AI": off, an identification answer counts only on an exact match after normalizing. "Score essays with AI": off, every essay waits for the teacher's score and counts as 0 until it is given; the section links to the oldest response with one waiting.
   - **Archive and delete.** Archive takes the quiz off the home list and onto the sidebar's Archived page, and its link stops opening; nothing is deleted, and Restore puts it back. Delete, after a confirmation, removes the quiz with its questions, files and responses.
   Print and duplicate (a new draft with the same questions, files, settings and cover, and no responses) are on the overview's Quiz options. Archive, Restore, Duplicate, Delete, Share, Stop sharing and the builder's Save each confirm themselves with a toast: one line at the bottom center for 3 s, one at a time, in a live region a screen reader hears as it lands.
10. **Account settings.** The name respondents see; the ways in (the email code, Google, a password to set or change); a system, light or dark theme; signing out every other device; deleting the account, which needs the email typed back.

### Respondent

1. **Open the quiz.** The link or the QR code opens `/q/<code>`. The page shows the quiz's cover or icon, the title, the description, the number of questions and points, and the quiz maker's name, then the quiz's rules as a list: the time limit and what happens at zero, answers that can be changed until the quiz is finished (a quiz checked at the end), one attempt per browser, results that come later, essays the quiz maker scores by hand. The page wears the quiz's color when it has one, and the student purple otherwise. When the quiz has typed questions that the AI checks, a notice says some answers are checked by an AI that can be wrong, and that the quiz maker sees every verdict and can change a score. A line at the foot says QuizApp does not review or endorse shared quizzes, and asks for no passwords or private details.
2. **Give a name.** "Take the quiz" asks for a name and says the quiz maker sees it beside the answers, with a "Section (optional)" field under it ("Such as 7 Sampaguita"), 80 characters each; an empty section is stored as none. There is no account. The server starts an attempt, lays the paper out (shuffled or not) and gives the browser a token for it. With one attempt per browser, a browser that already finished this quiz sees "Quiz already taken" instead.
3. **Pick, then confirm.** One question at a time, with a progress bar. When the quiz offers hints, "Show hint" names the topic and the page of the material to look at; a Test or Graded quiz offers none. A question's picture sits above its prompt with its credit. A tap on an option, or text typed into the field, is a pick and never an answer: it sends nothing, and another tap moves it. The filled button under the question confirms the pick, and it is drawn unfilled and disabled until there is one. What the button does depends on `quizzes.feedback`:
   - **`each` (Practice).** The button reads Check. It sends the pick, the answer is graded and locked, the feedback shows, and the button then reads Next (Finish on the last question). When the answer comes back kept rather than checked (the results are held, or an essay waits for the quiz maker's score), the button reads Submit instead of Check.
   - **`end` (Test, Graded).** The button reads Next. It saves the pick and moves on, and nothing comes back about how it scored. A saved answer shows as chosen, marked "Answer saved", and stays open: a different pick confirmed with Next replaces it, until Finish.
4. **Read the feedback.** On an `each` quiz it comes back on Check: the right option in green, a wrong pick in red, why each option is right or wrong, the verdict on a typed answer (labeled when the AI gave it), the explanation, and the sentence of the material with its page. An essay the quiz maker scores by hand says "The quiz maker scores this essay. Its points come later." On an `end` quiz the same feedback comes for every question at once, when the attempt is finished and the results are shown. While the results are held, an answer is saved and nothing comes back about how it scored, on either kind of quiz.
5. **Move and finish.** Back, Skip and the filled button move between questions. Skip is the quiet button while the question is open, and it leaves the question for now: on an `end` quiz it drops a pick that was not confirmed, so what shows chosen later is what was saved; on an `each` quiz the pick waits, unchecked, for the way back. Back on an `end` quiz saves a changed pick first. On an `end` quiz, moving on from the last question opens "Your answers": every question in a list, each row marked "Answered" or "Not answered" and opening its question (whose Next and Skip come back to the list), with a tally above Finish saying how many of the questions are unanswered, or that all of them are answered. Finish there asks nothing more, and nothing can be changed after it. On an `each` quiz, and on any quiz timed per question (which has no way back and so no list), finishing with questions unanswered asks first, since an unanswered question scores zero.
6. **Keep to the clock.** A timed quiz shows a clock in the top bar: per question, the clock restarts on each question, the quiz moves on at zero, and a passed question cannot be opened again (it counts as not answered, and the page says so); overall, the clock runs from the start, says so a minute before the end, and finishes the quiz on its own at zero. At zero the pick on screen is sent first, since it was made in time: on an `each` quiz timed per question its feedback then shows and Next moves on; on an `end` quiz it is saved and the next question comes up; on an overall clock it is sent and the attempt finishes.
7. **See the score.** The points, how many were right, a notice when the AI checked any answer, a rating from five faces, a review of every question (skipped ones included), a button to share the link, and, when the quiz allows it, "Take the quiz again" (a new attempt with empty name and section fields, since the next attempt on a shared classroom phone is often another student's; the old one stays with the quiz maker). While the results are held, the end says "Your answers are in" with how many were answered, and a form takes an email address to write to when the quiz maker releases them; one email goes to it then, and nothing else. The address can be changed, and the score page shows on the next visit once the results are out.
8. **Resume.** A refresh or a closed tab picks up at the first unanswered question: the attempt's id and token stay in the browser's localStorage. On an `end` quiz the answers saved so far come back as picks, shown chosen and still open to change. An overall clock keeps running while the quiz is closed, and the resume note says what is left; an attempt whose time ran out while it was closed is finished on the next visit. While the quiz's link is closed (sharing stopped, or the quiz archived), the clock stands still, and sharing or restoring resumes it where it stopped.
9. **Report.** The flag at the top of every page, drawn in the muted ink like the bar's other glyphs, reports the quiz: a reason (an answer is wrong, harmful or unsafe content, copies someone else's work, something else) and an optional note of up to 600 characters. A report made while a question is on screen names that question. It carries no name and no answers. Once a report is sent the flag turns red.

## Interface

### A color per quiz

Code: `web/src/composables/color.ts`; the Color tile in `web/src/views/QuizSettingsView.vue`; `tint` in `web/src/views/TakeView.vue`.

- A quiz's color is `quizzes.color`: `#rrggbb` in lowercase, or null. A null color takes one of the six palette colors by the quiz's id, so it is steady across visits.
- On the teacher's side the quiz's card and the overview's head show the cover, else the icon on a tint of the color, else the first letter of the title on the color itself. The letter is white where white reaches 3:1 (a large letter passes there), and otherwise whichever of white and the dark ink (`#1a1a1a`) contrasts more. The sidebar's square is the color alone.
- The respondent's page takes the color `GET /api/q/:code` returns as its accent in place of the student purple; a null color leaves the purple. One rule gives it two tones:
  - **A fill keeps the picked color.** The intro's disc, a filled button and the progress bar wear the color as it was picked, the one the card and the sidebar wear. The ink on it is white where white reaches 4.5:1, and otherwise whichever of white and the dark ink contrasts more.
  - **Accent text takes a tone that reads.** Where the accent is itself text, an icon or a line (a focus ring, the outline of a pick), the color is moved toward black on the light theme, or toward white on the dark one, by the least amount that reaches 4.5:1 on every ground it is drawn on: the surface, the page behind it, and the color's own 16% tint. A color that already reads there stays as it is.
- The palette's orange, `#ef6c00`, shows both: as a fill it carries `#1a1a1a` ink at 5.65:1; as text it becomes `#ae4e00`, 5.40:1 on white and 4.51:1 on its tint.

### Motion

Code: each component's own styles; the reduced-motion rule in `web/src/style.css`.

- **What moves.** Motion marks a change of state and nothing else, and none of it delays input.
  - On the respondent's page: an option presses in under the finger (scale 0.98, 100 ms); the pick fills; when an answer is checked, the correct answer's green follows a wrong pick's red by 80 ms, and the reasons, the explanation and the source sentence rise 8 px into place in reading order, 40 ms apart; a question's card fades out in 120 ms and the next one rises in over 200 ms; the progress bar's width runs for 300 ms; the score counts up from 0 over 600 ms; the rating's faces and the review's rows come in one after another. Feedback animates only when it arrives while its question is on screen; a question opened already checked, and a pick saved on a quiz checked at the end, move nothing.
  - In the builder: the draft's cards rise in one after another; a card a chat edit changed flashes its border in the accent once, and a card it added slides into place; the correct-answer mark fills and its check sweeps in.
  - On the overview: the numbers count up over 500 ms, and the chart's bars grow from the baseline in date order, 20 ms apart.
- **What is animated.** A piece that enters or moves animates its translate, scale, transform or opacity. A fill or an outline is a color transition. Three things animate something else: the progress bar its width, the correct-answer check its clip, and a skeleton the position of its background.
- **What repeats.** Only work going on repeats: the prompt box's ring and shadows, the three dots on a file being read and on a reply being written, the light passing over a skeleton, and the building preview's loop. Everything else runs once.
- **Reduced motion.** One rule in `web/src/style.css` covers every animation and transition in the app. Under `prefers-reduced-motion: reduce` it sets every animation's and transition's duration to 0.01 ms and every delay to 0 s, runs an animation once, and turns smooth scrolling off. It is marked important inside the `base` layer, which outranks the components' own unlayered rules. The delays are zeroed with the durations, since a staggered item would otherwise wait invisible for its turn. The motion driven by script (the two counts and the word-by-word reply) reads the same setting and shows its final state at once.

### The prompt box

Code: `web/src/components/PromptBox.vue`; `streamReply` in `web/src/views/BuilderView.vue`.

One component serves the home page's large box and the builder's chat box. It has three looks, and color means work:

- **At rest.** A 1 px line.
- **With the cursor in it.** A neutral 1.5 px outline in the ink's gray. The home page's box also has a still colored glow behind it, four soft shadows at 60%.
- **While work is going on.** A gradient ring turns on the box's edge once every 3 s, and the four colored shadows come to full strength, breathe between 70% and full every 2 s, and go round the box once every 12 s. Only the shadows' transform and opacity change. Work here is a quiz being started or drafted, a chat reply being written, or a file going up or being read. When it ends, the ring and the shadows fade back to the neutral outline in 300 ms.

Loading and saving switch sending off without the working look. The attach button is off while the AI works.

The AI's reply arrives whole from the server and is revealed word by word, 18 ms a word and 1.6 s at most for a whole reply: a reading pace, not the network's.

### The building preview

Code: `web/src/components/DraftPreview.vue`.

While a draft is written and the quiz has no questions yet, the questions pane shows the phase's name ("Reading the module", then "Writing the questions", then "Checking each quote against the file" once the reply is in), a line saying the draft takes about 20 seconds, and four skeleton cards in the shape of a question card. Each card fills piece by piece (its header row, its prompt, four options), one piece every 250 ms, so a card every 1.5 s; when all four are drawn they hold for a moment and the loop starts over. The first two phases are on a timer tuned to the measured draft, and the cards count nothing. The phase is a status line a screen reader hears; the cards are hidden from it.

### Scrolling

Code: `web/src/layouts/AppLayout.vue`; `web/src/views/OverviewView.vue`.

Inside the app the document does not scroll. `AppLayout`'s content column is the window's height under the top bar, scrolls on its own, and keeps its own scrollbar gutter (`scrollbar-gutter: stable`), so a page is the same width whether it scrolls or not. A gutter reserved on the document showed as an empty strip on the pages that scroll in a column of their own. The overview opts out of the column's gutter: it splits the height into two columns that each scroll, the page and its 360 px panel, so the panel reaches the window's edge. The builder is a full-window page outside this layout, and its panes scroll on their own.

## The AI pipeline

### 1. Reading the files, once, on upload

Code: `server/src/quiz/read.ts`, `server/src/ai/transcribe.ts`, `server/src/quiz/sources.ts`.

- `POST /api/uploads` checks the type and size (a PDF up to 25 MB; a JPG, PNG, WebP, HEIC or HEIF photo up to 10 MB), saves the file under `server/data/uploads/u<user id>/`, adds a `sources` row with the status `reading`, and starts the read in the background. The prompt box asks `GET /api/uploads/:id` every 800 ms until the read ends.
- A PDF's pages come from its text layer (unpdf), with no AI. A page whose text layer holds fewer than 30 letters counts as scanned.
- Scanned pages are copied into new PDFs of five pages each (pdf-lib) and sent to the AI's `read` chain, two batches at a time, since the Flash Lite models allow 15 requests a minute.
- A photo goes to the AI whole, as one page. A photo in which fewer than three letters could be read fails, with a message to take it closer and in better light.
- The transcription rules (temperature 0): copy every word as printed, in reading order; keep the language, spelling and punctuation; never correct, translate, summarize, shorten or add; a table becomes one line per row, its cells separated by single spaces; a figure becomes one bracketed line starting "Figure:", followed by any text printed in it; page numbers and headers or footers that repeat on every page are left out.
- The pages are stored as a JSON array in `sources.text`, with the method: `text` (the text layer), `ai` (transcribed) or `mixed` (some pages each way).
- Every later step (the draft, chat edits, the grounding check) reads that stored text and never the file again. A summary would lose the sentences the questions must quote word for word, so there is none.
- A read cut short by a restart leaves its row `reading` with nothing running; the next status request, or the next draft that needs the file, starts it again.
- A file left in a prompt box for a day without being sent is deleted (its row and the file) the next time the same person uploads.

Measured: a digital PDF in about 0.5 s, a photo in 6.7 s, a 21-page scanned PDF in 33 s.

### 2. Drafting

Code: `draftQuiz` in `server/src/ai/quiz.ts`; `server/src/routes/quizzes.ts`.

- `POST /api/quizzes` saves the request, moves the uploads into the new quiz and answers with its id at once. The builder then calls `POST /api/quizzes/:id/draft`, so the wait happens on the builder, with its steps showing.
- The draft waits for any read still running. If every file failed and there is no request text, it stops with a message.
- The model receives the material as text, page by page (`[Page 3]`), and the request.
- Without a stated count and mix, it writes 10 questions: mostly multiple choice, with two true or false and two identification. Essays come only when asked. The questions follow the order in which the material teaches the ideas, in the language the request asks for, or else the material's (English or Filipino).
- For every question the model returns: the kind; the prompt; the options, each with one sentence on why it is right or wrong; the index of the correct option; the accepted answers (identification, the right answer first, then synonyms, digits and words, common spellings); a rubric of 2 to 4 criteria (essay, 3 to 10 points); the points; an explanation shown after answering; a topic from the material's headings; a Bloom level, spread across the levels rather than all recall; and the supporting sentence copied word for word, with its page. A table row is quoted as its cells in order, separated by single spaces.
- Multiple choice has exactly four options from the model. True or false is True and False (Tama and Mali in Filipino), and not every statement may be true. The model never asks about the material's own instructions, headings or layout.
- Its reply says what it made and anything to check, such as a question it could not support with a sentence.
- Every question then passes the server's own rules, whoever wrote it: multiple choice needs 2 to 6 options and a marked answer; true or false has exactly two options; identification needs an accepted answer; an essay needs a rubric and is worth at least 2 points; points stay between 1 and 20. Then the grounding check runs and the questions are saved.
- The chat shows the AI's reply with the number of questions, how many quotes were found, and the seconds taken.

Measured: a draft of 10 to 12 questions takes 17 to 21 s, and 9 to 12 of its quotes are found in the material. A draft from a PDF plus a photo took 17.2 s and found 8 of 8 quotes.

### 3. The grounding check

Code: `server/src/ai/ground.ts`; `saveQuestions` in `server/src/quiz/store.ts`.

Plain code with no AI, so the answer to "what if the AI made it up" does not depend on the AI.

- Both texts are normalized first: Unicode NFKC, lowercase, soft hyphens removed, a word broken across two lines with a hyphen joined again, curly quotes and every kind of dash made plain, whitespace collapsed.
- A quote is found when it appears in a page as it is, after normalizing.
- Otherwise it is found when at least 85% of its words appear in order in one place: the longest common subsequence of words over a window about as long as the quote (its length plus a quarter, plus two words). That forgives a word that a PDF's text layer split or joined, and does not pass a sentence that is not there.
- A quote of fewer than three words is never found.
- The check runs over every page of every file of the quiz, on every save: the draft, each chat edit, a save by hand, and a duplicate. A found quote takes the file and page it was found on, which corrects the page the AI gave.
- Each question ends in one of four states, shown on its card:

| State | Meaning | Card |
| --- | --- | --- |
| `found` | The quote is in the material. | "Found in science7-metals.pdf, page 1" |
| `missing` | The material has text and the quote is not in it. | "Not found in the file" |
| `photo` | The material has no stored text (a file uploaded before transcription existed), so a person checks by eye. | "From a photo: check it by eye" |
| `none` | There is no material. | Says there is no material, so the teacher checks it |

A quote edited by hand shows as unchecked until the next save.

### 4. Chat edits by operations

Code: `refineQuiz` and `applyOps` in `server/src/ai/quiz.ts`; `POST /api/quizzes/:id/chat`.

- The model receives the material as text, the quiz as JSON with each question's number, and the message. It answers with operations rather than a new quiz: `add` (a question, at a position), `update` (a number and the whole changed question), `remove` (a number) and `move` (a number and its new position), with a reply, and a new title only when the message asks for one. Changing one question costs one question's worth of output.
- Numbers always refer to the quiz as it was before the operations. The server applies updates, then removals, then moves, then additions, tracking each question by its original number while the list changes underneath.
- The result passes the same rules and the same grounding check as a draft.
- A message that is not about the quiz gets no operations, and a reply saying what the chat can help with.
- Files attached in the chat join the material first. A quiz with no questions yet gets a draft instead of an edit.
- One AI job runs per quiz at a time: a second request while one runs gets a 409 with a message to wait.
- A question keeps its row through an edit. The builder's Save sends each question with the id it was loaded with, and a chat edit carries the ids through the operations (the model sees the questions without them). `saveQuestions` updates a row whose id the list names, inserts a question without one, and deletes a row the list no longer names. Answers hang off question rows with a cascade, so only a question the maker removes takes its answers with it. Before 2026-10-02 every save deleted and inserted all the rows, which deleted every respondent's answers.

Measured: 5 to 6.4 s per edit on `gemini-3.1-flash-lite`.

### 5. Grading

Code: `server/src/quiz/grade.ts`; `POST /api/attempts/:id/answers`.

| Kind | How it is graded | Measured |
| --- | --- | --- |
| Multiple choice, true or false | The chosen index against the key, in code. Full points or none. | 5 to 11 ms on the server |
| Identification | Plain normalization first; any accepted answer that matches makes it right, with no AI. Otherwise the `check` chain judges whether it means the same as an accepted answer. | Median 3.1 s when the AI is asked |
| Essay | The `essay` chain scores it from 0 to the question's points, in halves, against the rubric, with two sentences of feedback. It counts as right at 60% of the points or more. | 3 to 7.5 s |

**Normalization.** Lowercase; accents and punctuation removed; single spaces; number words as digits (English zero to twenty, thirty, forty, fifty and hundred; Filipino wala to sampu); a leading article dropped (the, a, an, ang, ng, mga, si, sa). "The Mercury!" and "mercury" become the same string, and so do "five" and "5".

**The check.** Count it right when it means the same as an accepted answer, forgiving capitalization, spacing, small spelling slips and numbers written as words; do not accept a different thing, a vaguer thing, or a guess that lists several things; give the reason in one short sentence, in the question's language. Temperature 0. Each model gets 8 s before the next is tried.

**The essay.** Follow the rubric strictly and do not reward length; the feedback says what earned points and what was missing. The first 6,000 characters are scored. Temperature 0. Each model gets 20 s.

**When the AI cannot be reached.** An identification answer keeps the plain verdict (wrong), with a note that the AI could not check it. An essay gets 0, with a note that the quiz maker will score it. Neither is labeled as the AI's.

**When the quiz's settings keep the AI out.** With "Check typed answers with AI" off, an identification answer that misses every accepted answer after normalizing is wrong, with the verdict "It does not match an accepted answer." With "Score essays with AI" off, an essay is stored with 0 points and `pending`, no AI is called, and the quiz maker's score (`PATCH .../answers/:aid`) settles it. The overview and the most-missed list leave a pending essay out of their counts until then.

**Labels and changes.** Every verdict the AI gives is stored with `byAi` and shown with an "AI" label, beside a line saying the AI can be wrong and the quiz maker can change the score. The quiz maker's own score (`PATCH .../answers/:aid`) replaces it, marks the answer `overridden`, and adds up the response's total again; the label then reads as changed rather than AI.

**Stored once, or replaced.** Each answer is one row, by a unique index on the response and the question. On an `each` quiz it is stored once, and answering again returns the first answer's reply. On an `end` quiz an open attempt's answer can be replaced: a different value is graded again and takes the stored row's place (with `overridden` cleared, since a score the quiz maker gave belonged to the answer it replaces), and the same value comes back as it was stored, with no second AI call. An answer is graded as it is saved on either kind of quiz; what an `end` quiz holds back is the reply, which carries the pick and no verdict until the attempt is finished.

### 5b. Sets: a word bank and a crossword

An identification question can belong to a set. A set is not a row of its own: each member carries the same `itemSet` (`{ key, style, title, extra }`, `style` being `bank` or `crossword`), and what a respondent is shown is worked out from the members' first accepted answers in `server/src/quiz/sets.ts`, so the bank and the grid cannot disagree with the answer key. A quiz has at most one bank and one crossword.

- **Word bank.** The words are every member's first accepted answer plus the set's `extra` words, without repeats, in alphabetical order, so the order says nothing about which word goes where.
- **Crossword.** `server/src/quiz/crossword.ts` folds each answer to its letters (A to Z and 0 to 9, accents folded), places the longest across, then takes the remaining word with a legal crossing and puts it where it crosses the most letters, then where the grid stays smallest. A position is legal when it crosses at least one equal letter, overwrites nothing, and touches no other word side by side or end to end. The layout uses no randomness, so every respondent and every reprint gets the same grid. A word with no legal crossing is left out of the set and asked as a typed question. Of MERCURY, COPPER, ALLOY, BRASS, DUCTILE, LUSTER and ZINC, five are placed in a 7 by 9 grid and two are left.
- **Checking.** An answer inside a set is exact and never goes to the AI: a bank pick is compared after the usual normalizing, a crossword answer letter by letter after folding. Four such answers were checked in 79 ms in all.
- **What is sent.** The shared quiz's payload carries the bank's words and each crossword word's number, place, direction and length. It carries neither `accepted` nor `itemSet`.

### 6. What to teach again

Code: `teachAgainNote` in `server/src/ai/quiz.ts`; `POST /api/quizzes/:id/insight`.

- It needs at least one finished response. The overview's button reads "Ask the AI for a note", and "Rewrite the note" once there is one.
- The model receives the quiz's title, the number of finished responses, and one line per question: its number, topic, kind and prompt, how many answered it and how many of those missed it, and for multiple choice and true or false how many picked each option, the correct one marked. An essay still waiting for the quiz maker's score is left out of the counts. No name and no single person's answers.
- It writes two to four sentences, with no list, heading, praise or greeting. Every claim about what the class found hard names the question numbers it rests on with their miss counts ("Q3 and Q7, each missed by 4 of 12", "Q5 (9 of 12 missed)"), so each can be checked against the table on the overview; it says how many finished, names the idea the missed questions share and a common wrong option where the picks show one, and speaks of the class in the third person, never to the teacher. Under five finished, it opens with a sentence saying that is too few to tell a pattern from and reports what those few missed rather than a trend; at five or more, a question missed by one person is left out. In the quiz's language. Temperature 0.3.
- The note is stored on the quiz with its time, and shown as written by the AI from anonymous counts, with a reminder to check it against what happened in class.

The list of most-missed questions beside it is plain arithmetic: the share of finished responses that missed each question, the top five, with ties broken by how many answered.

### 6b. A study note for the respondent

Code: `studyNote` and `studyNoteRequest` in `server/src/ai/quiz.ts`; `POST /api/attempts/:id/advice`; `web/src/components/StudyNote.vue`.

- Offered on the finished page and above the review, only when the attempt is finished and its results are shown; a held quiz answers 409.
- The request carries the quiz's title and language, the score, and one line per question in the order the respondent saw them: number, topic, kind, prompt, how it went (right, wrong, partly right, not answered, not scored yet) with the points it cost, and for a missed question the page and supporting sentence from the material. It never carries the name, the section or an email.
- The reply, by schema: one sentence on what was answered right, and at most three things to review, each with the questions missed and where in the material to look. A page that no missed question carries is dropped before the note is stored, and a reply with nothing to review when something was missed is refused.
- One AI call per attempt: the note is stored on the response (`advice`, `adviceAt`) and returned from then on; two requests at once share the call. When every scored answer is right a fixed sentence is returned with no AI call. Sixty notes an hour per sender.
- The note is written to the respondent in the quiz's language and is labeled as the AI's, which can be wrong.

Measured: 4.5 to 6.9 s for the first request, 6 to 9 ms for a stored note.

### 7. Pictures for questions

Code: `server/src/quiz/illustrate.ts`; `server/src/routes/illustrations.ts`.

A question's picture comes from one of three places, and every one is a copy under `server/data/illustrations/` with a random 24-hex-character name, so the same file serves the builder, the shared quiz and the printed test, and a Commons picture stays as it was even if its page changes.

- **The teacher's upload** (`POST /api/illustrations/upload`): a JPG, PNG or WebP of 5 MB at most, its type read from the file's first bytes. It carries no credit.
- **A figure on the module's page** (`POST /api/illustrations/find`): the page the question's quote was found on (its file by name, or the only file) is drawn as a picture, a PDF page through unpdf at twice its size, a JPG, PNG or WebP photo as it is (a HEIC photo cannot be drawn here). The picture goes to the `illustrate` chain with the question, its topic and its quote, and the model returns at most two figures, each as a box scaled 0 to 1000 with one sentence of alt text, and a search term of 2 to 4 English words. The rules: box a photograph, drawing, diagram, chart, map or table that would help, with its caption; never a paragraph, a heading, a logo or the whole page; never a figure that gives the answer away; and a search term that names a thing, a material, a place or a process, never the question or its answer. The server crops each box with a small margin through `@napi-rs/canvas`, drops a crop under 60 px on a side or covering more than 85% of the page, scales it to 1200 px at most, and saves it as a JPEG; the credit reads "From science7-metals.pdf, page 2".
- **Wikimedia Commons**, for the search term: the lead pictures of the first three English Wikipedia articles the term finds (freely licensed only, so each is on Commons), then Commons' own search over bitmaps and drawings; at most six, no file twice, each as an 800 px thumbnail with its author, license and file page, as Commons' metadata gives them. Attaching one (`POST /api/illustrations/attach`) copies the thumbnail from upload.wikimedia.org, and only from there, and stores the credit as "Author, CC BY-SA 4.0, via Wikimedia Commons" with a link to the file page, which CC BY and CC BY-SA ask for wherever the picture is shown.

The builder shows the crops first, then the Commons pictures, with the search term under them; the chosen one, or the upload, lands on the question as `image`, `imageAlt` and `imageCredit`, and Save stores them with the question. The files are served to anyone at `GET /api/illustrations/file/:name`, since a shared quiz shows them to people with no account; the name is 96 random bits, so a draft's pictures cannot be guessed.

Nothing is generated. Gemini's image models answered 429 on the free tier on the first request to each of them.

## Model chains and resting

Code: `server/src/ai/gemini.ts`. Every call goes to the Gemini API (`generativelanguage.googleapis.com/v1beta`) over REST with `fetch`, carrying a system instruction, the parts, a JSON response schema and a temperature. The full Gemini 3 Flash models think at the "low" level; Flash Lite and Gemma get no thinking setting. HTML entities a model writes into its JSON (such as `&deg;`) are decoded once, as each reply arrives, so a quiz stores the characters themselves.

| Job | Chain, in order | Temperature | Time per model |
| --- | --- | --- | --- |
| `read` | `gemini-3.1-flash-lite`, `gemini-3.5-flash-lite`, `gemini-3-flash-preview` | 0 | 120 s |
| `draft` | `gemini-3.6-flash`, `gemini-3-flash-preview`, `gemini-3.8-flash`, `gemini-3.5-flash`, `gemini-3.7-flash`, `gemini-3.1-flash-lite`, `gemini-3.5-flash-lite` | 0.4 | 60 s |
| `edit` | `gemini-3.1-flash-lite`, `gemini-3.5-flash-lite`, `gemini-3.6-flash`, `gemini-3-flash-preview` | 0.3 | 60 s |
| `check` | `gemma-4-26b-a4b-it`, `gemini-3.1-flash-lite`, `gemini-3.5-flash-lite` | 0 | 8 s |
| `essay` | `gemini-3.1-flash-lite`, `gemini-3.5-flash-lite`, `gemma-4-26b-a4b-it` | 0 | 20 s |
| `insight` | `gemini-3.1-flash-lite`, `gemini-3.5-flash-lite`, `gemma-4-26b-a4b-it` | 0.3 | 60 s |
| `illustrate` | `gemini-3.1-flash-lite`, `gemini-3.5-flash-lite`, `gemini-3-flash-preview` | 0.2 | 45 s |

**Why these chains.** The free tier's limits for this project's key on 2026-10-01 set them: each full Flash model allows 20 requests a day and 5 a minute; the Flash Lite models 500 a day and 15 a minute; Gemma 4 14,400 a day and 30 a minute, but 16K tokens a minute. So drafts, where quality shows, go to the full Flash models, and everything frequent runs on Flash Lite or Gemma. Demand on any one model swings, so a chain moves on rather than waiting.

**How a call goes down its chain:**

- Resting models move to the end of the chain. At most four models are tried per call, half a second apart.
- **503** (overloaded) or **429** (a per-minute limit): the model rests for 2 minutes, and the next one is tried.
- **429 with the day's quota spent:** the model rests until the daily reset, midnight Pacific (the code uses 07:00 UTC, midnight Pacific in October).
- **404** (a model this key may not use): it rests until the same reset.
- **Another 5xx, a timeout, a network error, or a reply that is not valid JSON:** the next model is tried, with no rest.
- **400** (the request could not be read): the call stops, with a message to try a smaller file or a shorter prompt.
- **A safety block:** the call stops with a 422 and a message that the AI declined the material.
- **Any other refusal:** the call stops, with a message that the server's AI settings need checking.
- **When every try fails:** a 429 when the last answer was a rate limit, a 504 when it was a timeout, and a 502 otherwise, each with a message to try again.

The rest list lives in the server's memory. Without it, every request spent its first seconds on the same refusing model.

## Data model

Defined in `server/schema.ts` with bakery-orm's `table()` and `Field`. `bun run db:sync` migrates the database to it, with a backup first in `server/data/backups`. The deploy script runs it on the box on every deploy once the box has a database, since a code-only deploy used to leave new columns missing there. Times are Unix seconds.

| Table | What a row holds |
| --- | --- |
| `users` | A person: `name`, `email` (unique), `passwordHash` (scrypt, when a password is set), `googleId` (unique, when Google is linked), `noticesSeenAt` (when the bell was last opened), `createdAt`. |
| `bins` | A named folder of quizzes: `name`, `owner`, `createdAt`, `updatedAt`. `quizzes.bin` points at one, or is null; deleting a bin sets it to null. |
| `sessions` | A signed-in browser: `token` (unique, 64 hex characters), `userId`, `expiresAt` (30 days on), `createdAt`. |
| `codes` | An emailed sign-in code: `email`, `salt`, `codeHash` (SHA-256 of the salt and the code), `tries`, `sentAt`, `expiresAt`, `usedAt`. Kept for a day, so the hourly limit can count them. |
| `quizzes` | A quiz: `userId`, `title`, `shareCode` (unique, 8 characters), `language` (`en` or `fil`), `status` (`draft` or `published`), `archived`, `views`, `prompt` (the original request), `insight` and `insightAt` (the note on what to teach again), `createdAt`, `updatedAt`. `sourceName` and `sourcePages` describe the seed's sample quizzes, which have no stored files. The settings page: `description`, `icon` (an Iconify id such as `fluent-emoji-flat:test-tube`), `image` (the cover's path under `data/uploads`, `<quizId>/cover-<time>-<random>.<ext>`), `color` (`#rrggbb` in lowercase, or null for the palette color the id picks), `shuffleQuestions`, `shuffleOptions`, `timeMode` (`none`, `question` or `overall`) and `timeLimit` in seconds, `allowRetake`, `showResults` and `resultsReleasedAt` (set by a release; results show when either says so), `showHints` (off: no "Show hint" on the questions), `aiCheck`, `aiEssay`, `feedback` (`each`, the default: an answer is checked when it is confirmed and locked from then on; `end`: answers are saved, changeable until the attempt is finished, and shown checked then). Practice, Test and Graded on the Sharing page are fixed values of `feedback`, `showResults`, `showHints` and `allowRetake`. |
| `sources` | A file of material: `quizId` (empty while it waits in a prompt box), `userId`, `name`, `mime`, `size`, `path` on disk, `pages`, `text` (each page's text, as a JSON array), `status` (`reading`, `ready` or `failed`), `method` (`text`, `ai` or `mixed`), `error`, `createdAt`. |
| `messages` | The builder's chat: `quizId`, `role` (`user` or `ai`), `text`, `meta` (the attached file names; for the AI, the model, the milliseconds, the question and found counts, the operations), `createdAt`. |
| `questions` | `quizId`, `position`, `kind` (`choice`, `truefalse`, `identify`, `essay`), `prompt`, `choices` (JSON: each option's text and why), `answer` (the correct index), `accepted` (JSON list), `rubric`, `points`, `explain`, `topic`, `bloom`, `sourcePage`, `sourceQuote`, `sourceFile`, `grounded`. The picture: `image` (a file name under `data/illustrations`), `imageAlt`, `imageCredit` (JSON: `from` as `upload`, `module` or `wikimedia`, the credit's `text`, and the Commons file page as `url`). |
| `responses` | An attempt: `quizId`, `name` (as the respondent typed it), `section` (typed under the name, or null), `token`, `status` (`open` or `finished`), `score`, `total`, `rating` (1 to 5), `createdAt` (the start of the attempt less any time it spent paused, so the clock an overall limit runs on rather than the moment the respondent began), `pausedAt` (stamped on an open attempt when the quiz's link closes, by unsharing or by archiving; sharing or restoring moves `createdAt` forward by the paused span and clears it), `finishedAt`, `notifyEmail` and `notifiedAt` (an address left while the results were held, and when it was written to), `layout` (JSON, the paper as served: the question ids in the order shown, for each multiple-choice or true-or-false question the original option indices in the order shown, and the key as the letter or word shown; null on a quiz that shuffles nothing). |
| `answers` | One answer: `responseId`, `questionId`, `choice`, `text`, `correct`, `score`, `verdict`, `byAi`, `overridden`, `pending` (an essay waiting for the quiz maker's score). |
| `reports` | A respondent's report: `quizId`, `reason` (`wrong`, `harmful`, `copied`, `other`), `note`, `questionId` (the question on screen, a plain number rather than a foreign key, so the report outlives an edit), `createdAt`. No name and no attempt. |

**Indexes.** Unique: `users.email`, `users.googleId`, `sessions.token`, `quizzes.shareCode`, and `answers` on (`responseId`, `questionId`). Plain: `codes` on (`email`, `sentAt`), `questions` on (`quizId`, `position`), `reports` on (`quizId`, `createdAt`).

**Deleting.** Foreign keys cascade: deleting a user deletes their sessions, quizzes and files' rows; deleting a quiz deletes its files' rows, chat, questions, responses, answers and reports; deleting a response deletes its answers. The route that deletes a quiz also removes the quiz's folder under `data/uploads` (its material and its cover); the route that deletes an account removes the material's files. The pictures on questions under `data/illustrations` are not removed by either (see Known limits).

## API routes

Everything is under `/api`, and every reply is JSON. "Session" means the `qa_session` cookie; a request without a valid one gets 401. A quiz, upload, response, answer or attempt that is not the caller's answers 404, so ids reveal nothing.

### Accounts: `/api/auth`

| Method | Path | Purpose | Auth |
| --- | --- | --- | --- |
| POST | `/api/auth/code` | Emails a six-digit sign-in code. The reply is the same whether or not the address has an account. | None |
| POST | `/api/auth/code/verify` | Checks a code and signs in, creating the account for a new address. | None |
| POST | `/api/auth/login` | Signs in with an email and a password. | None |
| POST | `/api/auth/logout` | Ends this browser's session. | None |
| GET | `/api/auth/me` | Who is signed in, or `null`. | None |
| PATCH | `/api/auth/me` | Sets the name. | Session |
| GET | `/api/auth/account` | The settings page's facts: name, email, whether a password and Google are set, how many devices are signed in. | Session |
| POST | `/api/auth/password` | Sets a password, or changes one (the current one is needed). | Session |
| POST | `/api/auth/devices/sign-out` | Ends every other session of the account. | Session |
| DELETE | `/api/auth/account` | Deletes the account and everything in it; the email must be typed back. | Session |
| GET | `/api/auth/google` | Sends the browser to Google with a state value and a PKCE challenge. | None |
| GET | `/api/auth/google/callback` | Where Google sends the browser back: signs in, then goes to the page the sign-in started from. | The pending sign-in cookie |

### Quizzes: `/api/quizzes`

Every route here needs a session, except the cover's own address.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/quizzes` | The caller's quizzes, newest edit first, each with its question count, its finished responses (`responses`) and its settings. |
| POST | `/api/quizzes/blank` | A quiz with no request and no questions, for writing by hand. The editor drafts nothing for it. |
| GET, POST | `/api/bins` | The caller's bins with the number of quizzes in each; a new bin from a `name` of 1 to 80 characters. |
| PATCH, DELETE | `/api/bins/:id` | Rename a bin; delete it, its quizzes kept and returned to no bin. A bin that is not the caller's is a 404. |
| POST | `/api/quizzes` | Starts a quiz from a request and uploaded files; answers with its id at once. |
| GET | `/api/quizzes/:id` | The quiz with its settings, its questions with their check states, its files and its chat. |
| PUT | `/api/quizzes/:id` | Saves the title and every question as edited (pictures included), and checks the quotes again. |
| PATCH | `/api/quizzes/:id` | Shares or unshares it (`status`), archives or restores it (`archived`), and sets any field of the settings page: `title`, `description`, `icon`, `color` (`#rrggbb`, stored in lowercase, or null for the default; anything else answers 400), the seven switches (`shuffleQuestions`, `shuffleOptions`, `allowRetake`, `showResults`, `showHints`, `aiCheck`, `aiEssay`), `feedback` (`each` or `end`), `timeMode` with `timeLimit`. The Sharing page's Practice, Test or Graded sends `feedback` and three of the switches in one request. Only the fields sent change. Turning `showResults` on releases the results and answers with `told`, how many addresses were emailed; turning it off holds them again. Closing the link (unsharing, or archiving a shared quiz) stamps `pausedAt` on every open attempt; opening it again (sharing, or restoring) moves each stamped attempt's `createdAt` forward by the time it waited and clears the stamp. A name, a description, an icon or a color counts as an edit for the list's order; a switch does not. |
| DELETE | `/api/quizzes/:id` | Deletes the quiz, its files and its responses. |
| POST | `/api/quizzes/:id/image` | The cover (multipart, field `file`): JPG, PNG, WebP or GIF, 5 MB at most, its type read from its first bytes. Replaces the old file. |
| DELETE | `/api/quizzes/:id/image` | Removes the cover; the icon shows again. |
| GET | `/api/quizzes/:id/image/:file` | The cover's bytes, cached for a year under its name. No session: the name is random and changes with every upload, so the address itself is the permission, as a share code is, and the shared quiz's page can show it. |
| POST | `/api/quizzes/:id/release` | Releases held results: scores and answers show from now on, and everyone who finished and left an email is written to, each address once. Answers `{ releasedAt, told, failed }`; an address the mail could not reach stays waiting for the next release. |
| POST | `/api/quizzes/:id/draft` | The AI's first draft. A quiz that already has questions comes back as it is. |
| POST | `/api/quizzes/:id/chat` | A chat message, with more files if any; the AI edits the quiz. |
| POST | `/api/quizzes/:id/duplicate` | Copies the quiz, its files, its settings and its cover as a new draft with no responses and no release. |
| GET | `/api/quizzes/:id/overview` | Views, takers, scores, finishing times, most missed, recent respondents, the quiz's shape, reports and the note; and `results`: whether they are held, when they were released, how many addresses wait to be told, how many essays wait for a score and the response holding the oldest. |
| POST | `/api/quizzes/:id/insight` | Writes the note on what to teach again. |
| GET | `/api/quizzes/:id/responses` | Every response, newest first, each with its section and its count of essays waiting for a score. |
| GET | `/api/quizzes/:id/responses.csv` | Every response as a CSV for a spreadsheet, in name order, open attempts included as "Still answering". Two header rows: Name, Section, Score, Total, Percent, Status, Started, Finished, Q1 to Qn, Rating, and under them each question's prompt cut to 60 characters. A question's column holds the points that answer earned; the times are local ISO dates; a UTF-8 byte order mark leads, so Excel reads the file as UTF-8; a cell with a comma, a quote or a line break is quoted. The file is named after the quiz. |
| GET | `/api/quizzes/:id/responses/:rid` | One response, with its section, every answer and its verdict. A shuffled paper comes back in the order it was shown, each question with `order` (the original option indices in the order shown) and `key` (the correct answer as shown). A question added since goes at the end; `choice` stays an original index. |
| DELETE | `/api/quizzes/:id/responses/:rid` | Deletes one response and its answers. |
| PATCH | `/api/quizzes/:id/responses/:rid/answers/:aid` | The quiz maker's own score for one answer; an essay that waited for it waits no longer. |

### Responses across quizzes: `/api/responses`

| Method | Path | Purpose | Auth |
| --- | --- | --- | --- |
| GET | `/api/responses` | Every response to the caller's quizzes (200 per quiz, 300 in all), people still answering first, then the finished ones, newest first, each with its quiz and its section. | Session |
| GET | `/api/responses/activity?days&tz` | Finished responses per day for each of the caller's quizzes, oldest day first, the last one today: `days` from 7 to 90 (30 when unset; the home list asks for 14), `tz` the browser's `getTimezoneOffset()` in minutes, so a day ends at the browser's midnight rather than the server's. | Session |

### Pictures on questions: `/api/illustrations`

| Method | Path | Purpose | Auth |
| --- | --- | --- | --- |
| GET | `/api/illustrations/file/:name` | A stored picture's bytes, cached for a year under its name. | None |
| POST | `/api/illustrations/find` | Candidates for one question (`quizId`, and the question's prompt, topic, quote, file and page): crops from the module's page, then Wikimedia Commons pictures for the search term the AI named, with the term and the model. | Session |
| POST | `/api/illustrations/attach` | Makes a candidate the question's: a crop is already stored; a Commons picture is copied from upload.wikimedia.org. Answers `image`, `imageAlt` and `imageCredit`, which the builder saves with the question. | Session |
| POST | `/api/illustrations/upload` | The teacher's own picture (multipart, `quizId` and `file`): JPG, PNG or WebP, 5 MB at most. | Session |

### Uploads: `/api/uploads`

Every route here needs a session.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/uploads` | One file (multipart, field `file`), saved and read at once. The reply has no path and no text. |
| GET | `/api/uploads/:id` | Where the reading stands. |
| DELETE | `/api/uploads/:id` | Takes a file back out of the prompt box before it is sent. |

### Notifications: `/api/notifications`

| Method | Path | Purpose | Auth |
| --- | --- | --- | --- |
| GET | `/api/notifications` | Finished responses and reports on the caller's quizzes, newest first (25 at most), each marked unread when it came after the bell was last opened. Nothing is stored for it beyond that time. | Session |
| POST | `/api/notifications/seen` | Marks everything up to now as read. | Session |

### Respondents: `/api/q` and `/api/attempts`

| Method | Path | Purpose | Auth |
| --- | --- | --- | --- |
| GET | `/api/q/:code` | A shared quiz without its answers, reasons or quotes, with its description, icon, cover, color (null when none is set), time limit, retake rule, whether results show, whether hints show, the AI switches, and `feedback` (`each` or `end`). Counts a view unless `?seen=1`. | None |
| POST | `/api/q/:code/attempts` | Starts an attempt with a name and an optional section, lays the paper out (shuffled questions and options, saved on the attempt as served), and answers with the attempt's id and token, the order to show, each question's option order, and the time left on an overall limit. | None |
| POST | `/api/q/:code/reports` | Reports the quiz, optionally naming a question. | None (ten an hour per address) |
| GET | `/api/attempts/:id` | The attempt so far, with its name and section, in its served order, with the feedback for each answered question (and for every question, once finished), the time left, and the email left for a release. While the results are held, each answer carries only what was given, and the score stays out. On an `end` quiz an open attempt's answers come back as picks (`pick: true`, with what was chosen or typed and nothing judged), and the score stays out until the attempt is finished. | Attempt token |
| POST | `/api/attempts/:id/answers` | Answers one question: graded and stored. On an `each` quiz the answer is stored once and the reply is the feedback (or, while the results are held, only what was given). On an `end` quiz a different value replaces the stored answer while the attempt is open, and the reply is the pick only. On a quiz whose link is closed (not shared, or archived) it is refused with 409 and `field: "closed"`. Past an overall limit and 30 s of allowance for the network it is refused with 409 and `field: "time"`. | Attempt token |
| POST | `/api/attempts/:id/finish` | Finishes the attempt and adds up the score; takes a rating from 1 to 5, then or later. Works past a time limit, which is how a timed-out attempt ends. While the results are held, the reply says only how many were answered. On an `end` quiz with the results shown, the reply carries the score and every question's feedback in the order the attempt was shown, the skipped ones included. | Attempt token |
| POST | `/api/attempts/:id/advice` | The AI's study note for a finished attempt whose results are shown: written once, stored, returned from then on. 409 before finish or while results are held. | Attempt token |
| POST | `/api/attempts/:id/notify` | An email address to write to when the results are released, kept on the attempt (a second replaces the first). Only while the results are held and the attempt is finished. | Attempt token (sixty an hour per address) |

A quiz counts as shared when its status is `published` and it is not archived; any other quiz answers 404, "This quiz is not shared, or the link is wrong."

A per-question limit is kept by the page, which moves on at zero; the server does not refuse an answer by it, since the clock stops while a respondent reads the feedback and a ceiling on the whole would refuse honest answers. An overall limit is kept on the server from the attempt's start (`createdAt`). While the quiz's link is closed (not shared, or archived), an open attempt's clock stands still: closing it stamps `pausedAt`, the deadline is the start plus the limit plus the time since the stamp, and opening it again moves `createdAt` forward by that span and clears the stamp. Measured: 33 ms lost over a 4 s pause.

### Health

| Method | Path | Purpose | Auth |
| --- | --- | --- | --- |
| GET | `/api/health` | The runtime (Bun or Node, with its version) and the number of quizzes. | None |

## Security and privacy

### Sessions

- A session is 32 random bytes, as hex, in the `qa_session` cookie: httpOnly (page scripts cannot read it, so an injected script cannot steal it), SameSite=Lax (other sites cannot send it with a form post), Secure in production, and 30 days long.
- The web app asks `/api/auth/me` who is signed in instead of reading a cookie.
- An expired session is deleted when it is next seen. Signing out deletes the row, and "Sign out everywhere else" deletes every other row of the account.

### Passwords

- scrypt from `node:crypto`, which Bun and Node both have: N 16384, r 8, p 1 (16 MB per hash), a 16-byte salt and a 64-byte key. The parameters are stored in the hash, so they can be raised later without breaking stored hashes.
- Compared in constant time. An email with no account is checked against a decoy hash, so it takes as long as a wrong password and gets the same message; the form does not reveal which emails have accounts.
- At least 8 characters.

### Google sign-in

- The OAuth authorization code flow with PKCE, run by the server. The browser goes to Google with a random `state` and the SHA-256 challenge of a random verifier. The state, the verifier and the page to return to wait in a 10-minute httpOnly cookie scoped to `/api/auth/google`.
- On the way back the state must match. The server trades the code and the verifier for an ID token directly with Google, and checks its audience, issuer and expiry. Its signature is not checked: the token came straight from Google's token endpoint over TLS, in answer to the server's own request, which OpenID Connect Core 1.0 (section 3.1.3.7) accepts in place of the signature.
- The Google account's email must be verified. A Google account with the same verified email as an existing account is linked to it, so both ways in reach one account.
- The scopes are `openid email profile`. No Google token is stored or sent to a page.
- The page to return to must be a path of the app, so the sign-in cannot be used to redirect elsewhere.

### Sign-in codes

- Six digits from a cryptographic random source, stored only as a SHA-256 hash with a 16-byte salt.
- A code works for 10 minutes, for five tries, and once. A newer code voids every older one.
- One code per address per 30 s, and five per hour.
- The reply is the same whether or not the address has an account; the code itself proves the inbox.
- Without mail settings, a development server prints codes to its log. A production server refuses instead, since a code in a log file is a way into someone's account.

### Respondents and attempts

- No account and no email: a name of up to 80 characters, an optional section of up to 80, the answers, a score and an optional rating.
- An attempt's token (24 random bytes) travels in the `x-attempt-token` header, never in the address, which servers and proxies write to their logs. A wrong token gets 404.
- **No answers before answering.** The public quiz carries the prompts, the option texts, the points, and the topic and page for the hint. The key, the reasons, the explanation and the quote come back only in the feedback for a question that has been answered, and for skipped questions once the attempt is finished. On a quiz checked at the end they come back for no question until the attempt is finished. While the quiz maker holds the results, they do not come back even then, and the score stays out of every reply until the release.
- A finished attempt takes no more answers, and neither does an open attempt whose quiz's link is closed: the page cannot load such a quiz, and a browser still holding the attempt's token gets 409 from the answers route.
- **One attempt per browser** is the browser's own record: a finished quiz is marked in localStorage, and the page opens it as taken. The server does not count attempts by anyone, since it knows no one.
- An email left for a release is kept on the attempt, used for that one message, and goes when the response does.

### Uploads

- Only PDFs and photos (JPG, PNG, WebP, HEIC, HEIF), up to 25 MB per PDF and 10 MB per photo.
- File names are cleaned before they touch the disk, and each person's uploads sit in a folder of their own.
- The uploads routes never send a file's path or stored text to the browser.
- A cover (JPG, PNG, WebP or GIF) and a picture on a question (JPG, PNG or WebP) are 5 MB at most, their type read from the first bytes rather than the name, and stored under random names of the server's own. A Commons picture is fetched only from `upload.wikimedia.org` over HTTPS, and its credit link is kept only when it points at `commons.wikimedia.org`.

### Rate limits

| What | Limit |
| --- | --- |
| Sign-in codes | One per email address per 30 s, five per hour; five tries per code. Sixty an hour per sender (a hall's network is one sender) and 300 a day in all, so the mailbox's daily sends cannot be spent. |
| Password sign-in | Thirty tries an hour per sender and ten per email address. |
| Attempts started | 600 an hour per sender: a school's network, or a hall where an audience scans the code, is one sender. |
| Typed answers and essays | 2,000 an hour per sender; each may be an AI call. An answer on a quiz checked at the end can be replaced eight times. An identification answer is cut to 200 characters. |
| AI requests by an account | Sixty an hour for drafts, chat edits and notes; sixty picture searches; sixty uploaded files. |
| Request size | 512 KB, and 26 MB on the three routes that take a file; a larger body is refused with 413 before it is read. |
| Reports | Ten an hour per sender, counted in memory. |
| Leaving an email for a release | Sixty an hour per address, counted the same way: a class on one school network leaves one each within minutes, and a script collecting addresses gets no further. |
| AI work on a quiz | One job at a time per quiz; a second gets 409. |

A sender is the address Cloudflare reports (`cf-connecting-ip`), or the last entry of `X-Forwarded-For`, the one the nearest proxy appended; the first entry is whatever the sender typed. Every count is kept in memory by the one process and starts over when it restarts. Code: `server/src/limits.ts`.

An account starts with a code sent to its inbox or with Google. No route makes one from an email and a password alone: such a route would let anyone make an account for an address they do not own, and its password would keep working after the owner signed in.

### What is stored

- **Accounts:** a name, an email, a password hash when a password is set, and the Google account ID when Google is linked.
- **Sign-in:** session tokens, and the hashes of sign-in codes for a day.
- **Quizzes:** the questions, the chat with the AI, the uploaded files on disk and their text, the settings (description, icon, cover, color, shuffling, time limit, retakes, when answers are checked, whether results show, hints, the AI switches), and the pictures on questions with their alt text and credit.
- **Responses:** the name and the section the respondent typed, each answer with its score and verdict, an optional rating, the paper's layout when the quiz shuffles, and an email the respondent left to be told of a release.
- **Reports:** a reason, an optional note, the question on screen when there was one, and the time.
- **In the browser:** the session cookie; display preferences (grid or list, the sort, a folded sidebar, the theme); the print header's fields; and on the respondent's side, the attempt's id and token, whether this visit has been counted as a view, which question a per-question clock was on, and whether the quiz has been finished in this browser.

### What is never stored

- A password or a sign-in code in plain text.
- Google's tokens.
- A respondent's account or network address. The limits on reports and release emails keep addresses in memory for an hour; none is written to the database. A respondent's email is stored only when the respondent leaves one for a release.
- A summary of the material.

### What leaves the server

- **To the Gemini API:** the material's text (or, once, a photo or a batch of scanned pages to transcribe); the request and the chat messages; the quiz's questions during an edit; when the quiz allows it, a typed identification answer with its question and accepted answers, and an essay with its question and rubric; for the note, each question's prompt, topic and kind with how many answered and missed it and how many picked each option; and, to find a picture, the question's prompt, topic and quote with a picture of the module's page. A respondent's name is never sent.
- **To Google's token endpoint:** the sign-in code and the PKCE verifier.
- **To Gmail's SMTP server:** the email carrying a sign-in code, and the notice that held results are out, each to the address typed.
- **To Wikimedia Commons and English Wikipedia:** the search term the AI named, 60 characters at most, with a User-Agent naming the app; and a request for the chosen file. No quiz, question or person goes with it.
- **From the browser to Iconify's API:** a quiz's icon is fetched from api.iconify.design by name whenever a page shows it, on the respondent's side too, and the icon picker's search goes there. The server never calls it.

## Error handling

### On the server

- Every failure leaves as JSON (`{ "error": "…" }`) with a message written for people, never as an HTML error page. A request error or an AI error carries its own message and status; anything else is logged and answered with a general 500 message. An unknown route answers 404 with its method and path.
- A form's error names its field (`{ "error", "field" }`), so the page marks that field.
- Input is cleaned before it is stored: text is trimmed and capped, and a question that breaks its kind's rules is refused with its number and what it lacks ("Mark the correct option in question 3.").
- Files: the wrong type, an empty file or one too large is refused with a message naming the file. A PDF that cannot be opened (damaged, or protected with a password), a photo with no readable text, or a file the AI could not read is marked failed with the reason; the prompt box shows the reason and holds the send until the file is removed.
- The AI: the chains and rests above; a time limit on every try; messages for rate limits, timeouts, refusals, declined material and a missing API key (503).
- Grading never fails an answer because the AI did: the plain verdict or a note for the quiz maker stands in, as described under grading.
- A release that cannot send an email (the mail settings missing, or Gmail refusing) logs it, counts it as `failed`, and leaves the address waiting for the next release; the results are released all the same.
- A picture search that Wikimedia does not answer within 10 s gives no Commons candidates; a file Commons refuses answers 502 with a message to try another, and the fetch gives up after 15 s. A crop that fails is skipped. A cover or a picture is checked twice: the page's file picker takes only the allowed types, and the server reads the bytes.
- Bun closes a connection that sends nothing for 10 s by default, which would cut off a 17 to 21 s draft, so the server sets Bun's maximum, 255 s.

### In the web app

- Every request goes through one `api()` function. A network failure becomes a message that the server could not be reached; any other failure carries the server's own message, which the page shows as it is.
- A reply that arrives after a newer request was sent is dropped, so a quick change of page never shows the older page's data. A second click on an action that is still running is ignored.
- The builder warns before leaving with unsaved edits (inside the app, and when the tab is closed), saves hand edits before a chat message, and offers "Try the draft again" when a draft fails.
- The respondent's page keeps working when localStorage refuses (the attempt then cannot resume, and one attempt per browser cannot be kept). An attempt the server no longer knows is dropped; one that failed to load because the network was down is kept for the next try. An answer refused because the time is up finishes the attempt from the page. An answer refused because the quiz is closed shows the server's message under the question, and the pick stays on screen.
- The pages that load data show a loading line, an empty state where one applies, and the server's message when a load fails.

## Known limits

- **A quiz that shows its results gives up its answers to anyone who finishes it.** Starting an attempt and finishing it with nothing answered returns every answer, reason and source sentence, since that is what the review shows. Practice and Test are for learning and low stakes; Graded holds everything until the maker releases it. One attempt per browser is kept by the browser, not the server.
- **An exact identification answer returns faster than a near miss**, which goes to the AI. On a quiz checked at the end, the wait tells an attentive respondent whether the typed answer matched exactly.
- **"Found" is about the quote, not the question.** The check proves the supporting sentence is in the material. It does not prove that the question or its answer key is right, which is why a quiz stays a draft until the teacher shares it.
- **Short quotes are never found.** A quote of fewer than three words is always "Not found".
- **Photos and scans are checked against the AI's transcription.** A word the transcription got wrong is wrong in the check too.
- **AI verdicts can be wrong.** They are labeled, and the quiz maker can change any typed answer's score. An essay is scored on its first 6,000 characters.
- **Free-tier quotas.** Each full Flash model allows 20 requests a day, so drafts are the scarce call; when every model in a chain refuses, the request fails with a message to try again.
- **One process.** The model rests, the one-job-per-quiz lock, the report limit and the reads in progress live in the server's memory. A restart clears them, and a read cut short starts again when it is next needed.
- **The report limit needs the proxy.** It counts by the first address in `X-Forwarded-For`, so the proxy in front must set that header; without it, every report shares one count.
- **Password sign-in has no attempt limit of its own.** scrypt's cost per guess is the only brake; codes and reports have limits.
- **No platform moderation.** A report reaches only the quiz maker; there is no admin role to review shared quizzes.
- **Views count browser visits.** A visit is remembered in localStorage, so clearing the browser's storage counts the next visit again.
- **One attempt per browser is the browser's word.** The mark lives in localStorage; another browser, a private window or cleared storage starts a fresh attempt. The quiz maker sees every attempt by name either way, and a Graded quiz relies on this mark for its one attempt.
- **A quiz set to Graded before `feedback` existed reads as Custom.** Its three switches are off and its `feedback` is `each`, the column's default, which matches none of the three modes. Choosing Graded again on the Sharing page sets `feedback` to `end`; the Settings page has no control for it.
- **A per-question limit is the page's clock.** The server does not refuse a late answer by it, only by an overall limit, with 30 s of allowance.
- **The paused clock is `createdAt` moving.** Closing the link stamps `pausedAt` on open attempts, and opening it again moves each one's `createdAt` forward by the paused span, so the Respondents list and the CSV's Started column show the start less the pause, not the moment the respondent began. Archiving a shared quiz pauses the same way, and restoring resumes.
- **Pictures outlive their questions.** Removing a picture, deleting its question or deleting the quiz leaves the file under `data/illustrations`; a crop the teacher did not pick stays too. The names are random, so nothing finds them, but nothing removes them either.
- **A quiz's icon needs Iconify's API.** The browser fetches it by name; offline, or with api.iconify.design unreachable, the icon does not draw and the card's square stays empty on its color. The app's own icons are bundled and unaffected.
- **A HEIC photo gives no figure.** The server cannot draw one, so "Find one" on a question from a HEIC photo searches Commons only.
- **A release with no mail settings tells nobody.** The results are released; the addresses stay waiting until a release on a server that can send.
- **Two languages.** A quiz is English or Filipino.
