<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue"
import { useRoute } from "vue-router"
import CrosswordGrid from "../components/CrosswordGrid.vue"
import Icon from "../components/Icon.vue"
import { useFetch } from "../composables/fetch"
import {
  BLOOM,
  type FullQuiz,
  type Kind,
  type Question,
} from "../composables/quizzes"

const route = useRoute()
const id = computed(() => Number(route.params.id))
const { data, error, loading } = useFetch<FullQuiz>(
  () => `/quizzes/${id.value}`,
)

// ---- what to print ------------------------------------------------------------------
const which = ref<"A" | "B" | "both">("A")
const withKey = ref(true)
const withTos = ref(true)
const PAPERS = {
  letter: {
    label: "Short bond (8.5 × 11 in)",
    size: "8.5in 11in",
    width: "8.5in",
  },
  long: {
    label: "Long bond (8.5 × 13 in)",
    size: "8.5in 13in",
    width: "8.5in",
  },
  a4: { label: "A4", size: "A4", width: "210mm" },
} as const
const paper = ref<keyof typeof PAPERS>("letter")

/** The header's fields, kept in this browser for the next quiz. */
const FIELDS = "qa_print_fields"
const fields = ref<{ school: string; subject: string; teacher: string }>({
  school: "",
  subject: "",
  teacher: "",
})
try {
  Object.assign(fields.value, JSON.parse(localStorage.getItem(FIELDS) ?? "{}"))
} catch {}
watch(fields, (v) => localStorage.setItem(FIELDS, JSON.stringify(v)), {
  deep: true,
})

// ---- black and white, and the paper size, while this page is open -------------------
const pageStyle = document.createElement("style")
watch(
  paper,
  (p) =>
    (pageStyle.textContent = `@page { size: ${PAPERS[p].size}; margin: 14mm 16mm; }`),
  { immediate: true },
)
onMounted(() => {
  document.head.append(pageStyle)
  document.documentElement.setAttribute("data-print", "")
})
onBeforeUnmount(() => {
  pageStyle.remove()
  document.documentElement.removeAttribute("data-print")
})
watch(data, (d) => d && (document.title = `${d.quiz.title} · Print · QuizApp`))

// ---- the words on the paper, in the quiz's language ---------------------------------
const fil = computed(() => data.value?.quiz.language === "fil")
const W = computed(() =>
  fil.value
    ? {
        name: "Pangalan",
        section: "Seksyon",
        date: "Petsa",
        score: "Iskor",
        set: "Set",
        subject: "Asignatura",
        teacher: "Guro",
        key: "Susi sa pagwawasto",
        tos: "Talahanayan ng ispesipikasyon",
        topic: "Paksa",
        items: "Bilang",
        percent: "Bahagdan",
        total: "Kabuuan",
        points: "puntos",
        pointsTitle: "Puntos",
        test: "Pagsusulit",
      }
    : {
        name: "Name",
        section: "Section",
        date: "Date",
        score: "Score",
        set: "Set",
        subject: "Subject",
        teacher: "Teacher",
        key: "Answer key",
        tos: "Table of specifications",
        topic: "Topic",
        items: "Items",
        percent: "Percent",
        total: "Total",
        points: "points",
        pointsTitle: "Points",
        test: "Test",
      },
)
const TITLES: Record<Kind, [string, string]> = {
  choice: ["Multiple choice", "Maramihang pagpipilian"],
  truefalse: ["True or false", "Tama o mali"],
  identify: ["Identification", "Pagtukoy"],
  essay: ["Essay", "Sanaysay"],
}
function directions(kind: Kind, items: Item[]) {
  const [yes, no] = items[0]?.q.choices.map((c) => c.text) ?? ["True", "False"]
  if (fil.value)
    return {
      choice:
        "Piliin ang titik ng tamang sagot. Isulat ito sa patlang bago ang bilang.",
      truefalse: `Isulat ang ${yes} kung wasto ang pahayag, at ${no} kung hindi.`,
      identify: "Isulat ang tamang sagot sa patlang bago ang bilang.",
      essay: "Sagutin nang buong pangungusap.",
    }[kind]
  return {
    choice:
      "Choose the letter of the correct answer. Write it on the blank before the number.",
    truefalse: `Write ${yes} if the statement is correct, and ${no} if it is not.`,
    identify: "Write the correct answer on the blank before the number.",
    essay: "Answer in complete sentences.",
  }[kind]
}
const title = (kind: Kind) => TITLES[kind][fil.value ? 1 : 0]

// ---- the sets: sections by kind, Set B shuffled with a seed, so a reprint matches its key
type Item = { q: Question; n: number; order: number[] }
type Section = { kind: Kind; items: Item[] }
const ORDER: Kind[] = ["choice", "truefalse", "identify", "essay"]
const LETTERS = "ABCDEFGH"
const ROMAN = ["I", "II", "III", "IV"]

const bank = computed(() => data.value?.sets?.find((x) => x.style === "bank"))
const cross = computed(() =>
  data.value?.sets?.find((x) => x.style === "crossword"),
)
const crossEntries = computed(() =>
  (data.value?.questions ?? []).flatMap((q) => (q.entry ? [q.entry] : [])),
)
const place = (q: Question) =>
  q.entry
    ? `${q.entry.number} ${
        q.entry.dir === "across"
          ? fil.value
            ? "Pahalang"
            : "Across"
          : fil.value
            ? "Pababa"
            : "Down"
      }`
    : ""
const setNote = computed(() => {
  const notes: string[] = []
  if (bank.value)
    notes.push(
      fil.value
        ? "Para sa mga tanong na walang puwesto sa krosword, pumili ng sagot mula sa kahon ng mga salita."
        : "For an item with a blank, choose the answer from the word bank.",
    )
  if (cross.value)
    notes.push(
      fil.value
        ? "Isulat sa krosword ang sagot ng bawat tanong na may bilang at direksyon."
        : "For an item with a number and a direction, write the answer in the crossword.",
    )
  return notes.join(" ")
})

function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
function shuffle<T>(list: T[], next: () => number) {
  const out = [...list]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * i)
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

function arrange(seed: number | null, avoid?: Map<number, string>): Section[] {
  const next = seed == null ? null : random(seed)
  let n = 0
  return ORDER.map((kind) => {
    let list = (data.value?.questions ?? []).filter((q) => q.kind === kind)
    if (next) list = shuffle(list, next)
    const items = list.map((q) => {
      const same = q.choices.map((_, i) => i)
      let order = kind === "choice" && next ? shuffle(same, next) : same
      const at = ++n
      if (
        kind === "choice" &&
        q.answer != null &&
        avoid?.get(at) === LETTERS[order.indexOf(q.answer)]
      )
        order = [...order.slice(1), ...order.slice(0, 1)]
      return { q, n: at, order }
    })
    return { kind, items }
  }).filter((s) => s.items.length)
}

/** Each objective item's answer by its number: what a neighbor's paper would give away. */
function answersByNumber(sections: Section[]) {
  const out = new Map<number, string>()
  for (const s of sections)
    for (const it of s.items)
      if (s.kind === "choice" || s.kind === "truefalse")
        out.set(it.n, answer(it))
  return out
}

const setA = computed(() => arrange(null))
const setB = computed(() => {
  const a = answersByNumber(setA.value)
  const first = id.value * 7919 + 66
  let best = first
  let fewest = Infinity
  for (let k = 0; k < 24 && fewest > 0; k++) {
    const seed = first + k * 104729
    const same = [...answersByNumber(arrange(seed))].filter(
      ([n, x]) => a.get(n) === x,
    ).length
    if (same < fewest) {
      best = seed
      fewest = same
    }
  }
  return arrange(best, a)
})
const build = (set: "A" | "B") => (set === "A" ? setA.value : setB.value)
const sets = computed(() =>
  (which.value === "both"
    ? (["A", "B"] as const)
    : ([which.value] as const)
  ).map((set) => ({ set, sections: build(set) })),
)
const points = computed(() =>
  (data.value?.questions ?? []).reduce((s, q) => s + q.points, 0),
)

/** What the key says for an item. */
function answer(it: Item) {
  const q = it.q
  if (q.kind === "choice")
    return q.answer == null ? "" : (LETTERS[it.order.indexOf(q.answer)] ?? "")
  if (q.kind === "truefalse")
    return q.answer == null ? "" : (q.choices[q.answer]?.text ?? "")
  if (q.kind === "identify") return q.accepted.join(", ")
  return q.rubric ?? ""
}
/** Options short enough sit in two columns. */
/** The question's picture for the paper: its file, its description, and a Commons credit. */
type Pictured = Question & {
  image?: string | null
  imageAlt?: string | null
  imageCredit?: { text: string } | null
}
const pictureOf = (q: Question) => {
  const p = q as Pictured
  return p.image
    ? {
        src: `/api/illustrations/file/${p.image}`,
        alt: p.imageAlt || "",
        credit: p.imageCredit?.text ?? null,
      }
    : null
}

const shortOptions = (q: Question) =>
  q.choices.every((c) => c.text.length <= 34)
/** Ruled lines for an essay, more for more points. */
const lines = (pts: number) => Math.min(12, Math.max(4, pts + 2))

// ---- the table of specifications, numbered as Set A is --------------------------------
const tos = computed(() => {
  const items = build("A").flatMap((s) => s.items)
  const topics = [...new Set(items.map((i) => i.q.topic || "General"))]
  const rows = topics.map((topic) => {
    const mine = items.filter((i) => (i.q.topic || "General") === topic)
    return {
      topic,
      cells: BLOOM.map((b) =>
        mine.filter((i) => i.q.bloom === b).map((i) => i.n),
      ),
      count: mine.length,
    }
  })
  const allPoints = items.reduce((sum, i) => sum + i.q.points, 0)
  const withPoints = rows.map((r) => {
    const pts = items
      .filter((i) => (i.q.topic || "General") === r.topic)
      .reduce((sum, i) => sum + i.q.points, 0)
    const exact = allPoints ? (pts / allPoints) * 100 : 0
    return {
      ...r,
      points: pts,
      percent: Math.floor(exact),
      rest: exact - Math.floor(exact),
    }
  })
  let left = allPoints
    ? 100 - withPoints.reduce((sum, r) => sum + r.percent, 0)
    : 0
  for (const r of [...withPoints].sort((a, b) => b.rest - a.rest)) {
    if (left <= 0) break
    r.percent++
    left--
  }
  return {
    rows: withPoints,
    totals: BLOOM.map((b) => items.filter((i) => i.q.bloom === b).length),
    total: items.length,
    points: allPoints,
  }
})
const BLOOM_LABEL: Record<string, [string, string]> = {
  remember: ["Remember", "Pag-alala"],
  understand: ["Understand", "Pag-unawa"],
  apply: ["Apply", "Paglalapat"],
  analyze: ["Analyze", "Pagsusuri"],
  evaluate: ["Evaluate", "Pagtataya"],
  create: ["Create", "Paglikha"],
}

const print = () => window.print()
</script>

<template>
  <div class="print-page" :style="{ '--paper': PAPERS[paper].width }">
    <header class="toolbar">
      <RouterLink
        :to="`/app/quiz/${id}`"
        class="back"
        aria-label="Back to the quiz"
        title="Back to the quiz"
      >
        <Icon name="back" :size="22" />
      </RouterLink>
      <h1>Print as a test</h1>

      <div class="controls">
        <label>
          <span>Sets</span>
          <select v-model="which" field>
            <option value="A">Set A</option>
            <option value="B">Set B</option>
            <option value="both">Set A and Set B</option>
          </select>
        </label>
        <label>
          <span>Paper</span>
          <select v-model="paper" field>
            <option v-for="(p, k) in PAPERS" :key="k" :value="k">
              {{ p.label }}
            </option>
          </select>
        </label>
        <label class="check"
          ><input v-model="withKey" type="checkbox" /> Answer key</label
        >
        <label class="check"
          ><input v-model="withTos" type="checkbox" /> Table of
          specifications</label
        >
      </div>

      <button btn="primary" class="go" :disabled="!data" @click="print">
        <Icon name="print" :size="20" /> Print
      </button>
    </header>

    <div class="fields">
      <label
        ><span>School</span
        ><input v-model="fields.school" field placeholder="Your school's name"
      /></label>
      <label
        ><span>Subject</span
        ><input v-model="fields.subject" field placeholder="Science 7"
      /></label>
      <label
        ><span>Teacher</span
        ><input v-model="fields.teacher" field placeholder="Your name"
      /></label>
      <p>
        These go at the top of each test, and this browser keeps them for the
        next one.
      </p>
    </div>

    <p v-if="error" class="state" role="alert">{{ error.message }}</p>
    <p v-else-if="loading && !data" class="state">Loading the quiz…</p>
    <p v-else-if="data && !data.questions.length" class="state">
      This quiz has no questions yet.
    </p>

    <main v-else-if="data" class="sheets">
      <!-- The test, one per set -->
      <article v-for="s in sets" :key="`test-${s.set}`" class="sheet">
        <header class="paper-head">
          <div class="school">
            <strong>{{ fields.school || " " }}</strong>
            <span>{{
              [
                fields.subject,
                fields.teacher && `${W.teacher}: ${fields.teacher}`,
              ]
                .filter(Boolean)
                .join(" · ")
            }}</span>
          </div>
          <span class="set">{{ W.set }} {{ s.set }}</span>
        </header>
        <h2 class="paper-title">{{ data.quiz.title }}</h2>
        <div class="blanks">
          <span>{{ W.name }}: <i /></span>
          <span>{{ W.score }}: <i class="short" /> / {{ points }}</span>
          <span>{{ W.section }}: <i /></span>
          <span>{{ W.date }}: <i /></span>
        </div>

        <section v-for="(sec, k) in s.sections" :key="sec.kind" class="test">
          <h3>{{ W.test }} {{ ROMAN[k] }}. {{ title(sec.kind) }}</h3>
          <p class="dir">
            {{ directions(sec.kind, sec.items) }}
            <template v-if="sec.kind === 'identify'">{{ setNote }}</template>
          </p>
          <template v-if="sec.kind === 'identify'">
            <div v-if="bank" class="wordbank">
              <b>{{ bank.title || "Word bank" }}</b>
              <ul>
                <li v-for="w in bank.words" :key="w">{{ w }}</li>
              </ul>
            </div>
            <div v-if="cross && crossEntries.length" class="crossword">
              <CrosswordGrid
                :rows="cross.rows"
                :cols="cross.cols"
                :entries="crossEntries"
                print
              />
            </div>
          </template>
          <ol class="items">
            <li v-for="it in sec.items" :key="it.q.id ?? it.n" class="item">
              <p class="stem">
                <span
                  v-if="sec.kind !== 'essay' && !it.q.entry"
                  class="blank"
                  :data-kind="sec.kind"
                />
                <span v-else-if="it.q.entry" class="place">{{
                  place(it.q)
                }}</span>
                <b>{{ it.n }}.</b>
                <span>
                  {{ it.q.prompt }}
                  <em v-if="sec.kind === 'essay'"
                    >({{ it.q.points }} {{ W.points }})</em
                  >
                </span>
              </p>
              <figure v-if="pictureOf(it.q)" class="pic">
                <img :src="pictureOf(it.q)!.src" :alt="pictureOf(it.q)!.alt" />
                <figcaption v-if="pictureOf(it.q)!.credit">
                  {{ pictureOf(it.q)!.credit }}
                </figcaption>
              </figure>
              <ol
                v-if="sec.kind === 'choice'"
                class="opts"
                :data-cols="shortOptions(it.q) ? 2 : 1"
              >
                <li v-for="(o, j) in it.order" :key="o">
                  <b>{{ LETTERS[j] }}.</b> {{ it.q.choices[o]?.text }}
                </li>
              </ol>
              <div v-if="sec.kind === 'essay'" class="ruled" aria-hidden="true">
                <i v-for="l in lines(it.q.points)" :key="l" />
              </div>
            </li>
          </ol>
        </section>
      </article>

      <!-- The answer key, one per set -->
      <template v-if="withKey">
        <article v-for="s in sets" :key="`key-${s.set}`" class="sheet key">
          <header class="paper-head">
            <div class="school">
              <strong>{{ W.key }}</strong>
              <span>{{ data.quiz.title }}</span>
            </div>
            <span class="set">{{ W.set }} {{ s.set }}</span>
          </header>
          <section v-for="(sec, k) in s.sections" :key="sec.kind" class="test">
            <h3>{{ W.test }} {{ ROMAN[k] }}. {{ title(sec.kind) }}</h3>
            <ol class="answers" :data-essay="sec.kind === 'essay' || undefined">
              <li v-for="it in sec.items" :key="it.n">
                <b>{{ it.n }}.</b>
                <span>{{ answer(it) }}</span>
              </li>
            </ol>
          </section>
        </article>
      </template>

      <!-- The table of specifications, numbered as Set A -->
      <article v-if="withTos" class="sheet tos">
        <header class="paper-head">
          <div class="school">
            <strong>{{ W.tos }}</strong>
            <span>{{ data.quiz.title }}</span>
          </div>
          <span class="set">{{ W.set }} A</span>
        </header>
        <table>
          <thead>
            <tr>
              <th scope="col">{{ W.topic }}</th>
              <th v-for="b in BLOOM" :key="b" scope="col">
                {{ BLOOM_LABEL[b]![fil ? 1 : 0] }}
              </th>
              <th scope="col">{{ W.items }}</th>
              <th scope="col">{{ W.pointsTitle }}</th>
              <th scope="col">{{ W.percent }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in tos.rows" :key="r.topic">
              <th scope="row">{{ r.topic }}</th>
              <td v-for="(c, i) in r.cells" :key="i">{{ c.join(", ") }}</td>
              <td class="num">{{ r.count }}</td>
              <td class="num">{{ r.points }}</td>
              <td class="num">{{ r.percent }}%</td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">{{ W.total }}</th>
              <td v-for="(t, i) in tos.totals" :key="i" class="num">{{ t }}</td>
              <td class="num">{{ tos.total }}</td>
              <td class="num">{{ tos.points }}</td>
              <td class="num">100%</td>
            </tr>
          </tfoot>
        </table>
      </article>
    </main>
  </div>
</template>

<style scoped>
/* ---- on screen: the controls, then each page as a sheet of paper ---- */
.print-page {
  min-height: 100dvh;
  background: #e9e9e9;
}
.toolbar {
  position: sticky;
  top: 0;
  z-index: 2;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px 16px;
  padding: 10px 20px;
  border-bottom: 1px solid #ccc;
  background: #fff;

  h1 {
    margin: 0;
    font-size: 18px;
  }
}
.back {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  color: #1a1a1a;

  &:hover {
    background: #eee;
  }
}
.controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 16px;
  margin-left: auto;

  label {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
  }
  select {
    width: auto;
    min-height: 40px;
  }
  .check {
    min-height: 44px;
    cursor: pointer;

    input {
      width: 18px;
      height: 18px;
      accent-color: #1a1a1a;
    }
  }
}
.go {
  min-height: 44px;
}
.fields {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  gap: 8px 16px;
  width: min(100% - 32px, var(--paper));
  margin: 16px auto 0;

  label {
    display: flex;
    flex: 1 1 180px;
    flex-direction: column;
    gap: 4px;
    font-size: 13px;
    font-weight: 600;
  }
  input {
    min-height: 40px;
    font-weight: 400;
  }
  p {
    flex-basis: 100%;
    margin: 0;
    font-size: 13px;
    color: #555;
  }
}
.state {
  padding: 48px 16px;
  text-align: center;
  color: #555;
}

.sheets {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 24px;
  padding: 20px 16px 64px;
}
.sheet {
  width: min(100%, var(--paper));
  padding: 14mm 16mm;
  background: #fff;
  color: #000;
  box-shadow: 0 1px 4px rgb(0 0 0 / 0.15);
  font: 11pt/1.45 var(--font);
}

/* ---- the paper itself ---- */
.paper-head {
  display: flex;
  justify-content: space-between;
  align-items: start;
  gap: 16px;
  padding-bottom: 6px;
  border-bottom: 1.5pt solid #000;
}
.school {
  display: flex;
  flex-direction: column;

  strong {
    font: 700 13pt var(--font-heading);
  }
  span {
    font-size: 10pt;
  }
}
.set {
  flex: none;
  padding: 2px 10px;
  border: 1pt solid #000;
  font-weight: 700;
}
.paper-title {
  margin: 10px 0 8px;
  font-size: 15pt;
  text-align: center;
}
.blanks {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px 24px;
  font-size: 10.5pt;

  span {
    display: flex;
    align-items: end;
    gap: 4px;
    white-space: nowrap;
  }
  i {
    flex: 1;
    min-width: 0.8in;
    border-bottom: 0.75pt solid #000;
  }
  .short {
    flex: none;
    width: 0.6in;
    min-width: 0;
  }
}
.test {
  margin-top: 14px;
  break-inside: auto;

  h3 {
    margin: 0;
    font-size: 11.5pt;
  }
}
.dir {
  margin: 2px 0 6px;
  font-style: italic;
}
.wordbank {
  display: grid;
  gap: 4px;
  margin: 4px 0 10px;
  padding: 6px 10px 8px;
  border: 0.75pt solid #000;
  break-inside: avoid;

  ul {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 22px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
}
.crossword {
  margin: 4px 0 10px;
  break-inside: avoid;
}
.place {
  flex: none;
  width: 1.75in;
  font-size: 9.5pt;
  font-weight: 600;
  white-space: nowrap;
}
.items {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.item {
  break-inside: avoid;
  --blank: 0.55in;
}
/* A section's heading and directions stay with its first item on paper. */
.test h3,
.dir {
  break-after: avoid;
}
.pic {
  margin: 4px 0 6px calc(var(--blank) + 6px);
  break-inside: avoid;

  img {
    display: block;
    max-width: 60%;
    max-height: 2.8in;
    filter: grayscale(1);
  }
  figcaption {
    margin-top: 2px;
    font-size: 8pt;
    color: #555;
  }
}
.stem {
  display: flex;
  gap: 6px;
  margin: 0;

  b {
    flex: none;
    width: 2.1em;
    text-align: right;
  }
  em {
    font-style: normal;
    white-space: nowrap;
  }
}
.blank {
  flex: none;
  width: 0.55in;
  height: 1.1em;
  border-bottom: 0.75pt solid #000;

  &[data-kind="truefalse"] {
    width: 0.9in;
  }
  &[data-kind="identify"] {
    width: 1.75in;
  }
}
.opts {
  display: grid;
  gap: 1px 18px;
  margin: 3px 0 0 calc(var(--blank) + 2.1em + 12px);
  padding: 0;
  list-style: none;

  &[data-cols="2"] {
    grid-template-columns: 1fr 1fr;
  }
}
.ruled {
  display: flex;
  flex-direction: column;
  margin: 4px 0 0 calc(2.1em + 6px);

  i {
    height: 0.32in;
    border-bottom: 0.5pt solid #000;
  }
}

.answers {
  columns: 3;
  column-gap: 24px;
  margin: 4px 0 0;
  padding: 0;
  list-style: none;

  li {
    display: flex;
    gap: 6px;
    break-inside: avoid;
  }
  &[data-essay] {
    columns: 1;

    li {
      margin-bottom: 6px;
    }
  }
}

.tos table {
  width: 100%;
  margin-top: 12px;
  border-collapse: collapse;
  font-size: 9.5pt;

  th,
  td {
    padding: 4px 5px;
    border: 0.75pt solid #000;
    text-align: center;
    vertical-align: top;
  }
  tbody th,
  tfoot th {
    text-align: left;
    font-weight: 600;
  }
  thead th {
    font-weight: 700;
  }
  .num {
    font-variant-numeric: tabular-nums;
  }
  tfoot {
    font-weight: 700;
  }
}

/* ---- on paper: no controls, no gray, a page per sheet ---- */
@media print {
  .toolbar,
  .fields {
    display: none;
  }
  .print-page {
    background: none;
  }
  .sheets {
    display: block;
    padding: 0;
  }
  .sheet {
    width: auto;
    padding: 0;
    box-shadow: none;
    break-after: page;
  }
  .sheet:last-child {
    break-after: auto;
  }
}
</style>
