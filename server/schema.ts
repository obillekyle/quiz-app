import { Field, table } from "bakery-orm"

export const users = table("users", {
  id: Field.Primary(),
  name: Field.Varchar(80),
  email: Field.Varchar(254),
  passwordHash: Field.Varchar(255, null),
  googleId: Field.Varchar(64, null),
  // When the bell was last opened: what came after it is unread.
  noticesSeenAt: Field.Int(null),
  createdAt: Field.Date.now(),
})
export const usersEmail = Field.Unique(users.email)
export const usersGoogleId = Field.Unique(users.googleId)

export const sessions = table("sessions", {
  id: Field.Primary(),
  token: Field.Varchar(64),
  userId: Field.Foreign(users.id, { onDelete: "CASCADE" }),
  expiresAt: Field.Int(),
  createdAt: Field.Date.now(),
})
export const sessionsToken = Field.Unique(sessions.token)

// A sign-in code emailed to an address: six digits, kept only as a hash,
// good for ten minutes and five tries. Rows stay for a day after they are
// sent, so the hourly limit per address can count them.
export const codes = table("codes", {
  id: Field.Primary(),
  email: Field.Varchar(254),
  salt: Field.Varchar(32),
  codeHash: Field.Varchar(64),
  tries: Field.Int(0),
  sentAt: Field.Int(),
  expiresAt: Field.Int(),
  usedAt: Field.Int(null),
})
export const codesEmail = Field.Index(codes.email, codes.sentAt)

export const quizzes = table("quizzes", {
  id: Field.Primary(),
  userId: Field.Foreign(users.id, { onDelete: "CASCADE" }),
  title: Field.Varchar(160),
  shareCode: Field.Varchar(12),
  language: Field.Enum(["en", "fil"] as const, "en"),
  status: Field.Enum(["draft", "published"] as const, "draft"),
  archived: Field.Bool(false),
  views: Field.Int(0),
  prompt: Field.Text(true),
  sourceName: Field.Varchar(255, null),
  sourcePages: Field.Int(null),
  insight: Field.Text(true),
  insightAt: Field.Int(null),
  // Its Settings page. `icon` is an Iconify id ("fluent-emoji-flat:test-tube");
  // `image` an uploaded cover under data/uploads, shown instead of the icon.
  description: Field.Text(true),
  icon: Field.Varchar(80, null),
  image: Field.Varchar(500, null),
  shuffleQuestions: Field.Bool(false),
  shuffleOptions: Field.Bool(false),
  // No limit, seconds for each question, or seconds for the whole quiz.
  timeMode: Field.Enum(["none", "question", "overall"] as const, "none"),
  timeLimit: Field.Int(null),
  // A second attempt from the same browser (remembered in its localStorage).
  allowRetake: Field.Bool(true),
  // Off: respondents see neither score nor answers until the maker releases
  // them (`resultsReleasedAt`); those who asked are emailed then.
  showResults: Field.Bool(true),
  resultsReleasedAt: Field.Int(null),
  // Off: identification is exact after normalizing, and essays wait for the
  // maker's score instead of the AI's.
  aiCheck: Field.Bool(true),
  aiEssay: Field.Bool(true),
  ...Field.Timestamps(),
})
export const quizzesShareCode = Field.Unique(quizzes.shareCode)

// A file of material, read once when it is uploaded: `text` holds its pages
// (a JSON array), from a PDF's text layer or, for photos and scanned pages,
// the AI's transcription (`method`). Every later step reads that text, never
// the file. A file waits in the prompt box with no quiz (`quizId` null) and
// joins one when the prompt is sent.
export const sources = table("sources", {
  id: Field.Primary(),
  quizId: Field.Foreign(quizzes.id, { nullable: true, onDelete: "CASCADE" }),
  userId: Field.Foreign(users.id, { nullable: true, onDelete: "CASCADE" }),
  name: Field.Varchar(255),
  mime: Field.Varchar(100),
  size: Field.Int(),
  path: Field.Varchar(500),
  pages: Field.Int(null),
  text: Field.Text(true),
  status: Field.Enum(["reading", "ready", "failed"] as const, "ready"),
  method: Field.Varchar(8, null),
  error: Field.Varchar(300, null),
  createdAt: Field.Date.now(),
})

export const messages = table("messages", {
  id: Field.Primary(),
  quizId: Field.Foreign(quizzes.id, { onDelete: "CASCADE" }),
  role: Field.Enum(["user", "ai"] as const),
  text: Field.Text(),
  meta: Field.Json(true),
  createdAt: Field.Date.now(),
})

export const questions = table("questions", {
  id: Field.Primary(),
  quizId: Field.Foreign(quizzes.id, { onDelete: "CASCADE" }),
  position: Field.Int(),
  kind: Field.Enum(["choice", "truefalse", "identify", "essay"] as const),
  prompt: Field.Text(),
  choices: Field.Json(),
  answer: Field.Int(null),
  accepted: Field.Json(true),
  rubric: Field.Text(true),
  points: Field.Int(1),
  explain: Field.Text(true),
  topic: Field.Varchar(120),
  bloom: Field.Enum([
    "remember",
    "understand",
    "apply",
    "analyze",
    "evaluate",
    "create",
  ] as const),
  sourcePage: Field.Int(null),
  sourceQuote: Field.Text(true),
  // The file the quote was found in, when the material is more than one.
  sourceFile: Field.Varchar(255, null),
  grounded: Field.Bool(false),
  // An illustration shown above the prompt: a file under data/illustrations
  // (uploaded, cropped from the module, or copied from Wikimedia Commons),
  // its alt text, and its credit ({ from, text, url }). A Commons picture
  // names its author and license, as its license asks.
  image: Field.Varchar(64, null),
  imageAlt: Field.Varchar(300, null),
  imageCredit: Field.Json(true),
})
export const questionsOrder = Field.Index(questions.quizId, questions.position)

export const responses = table("responses", {
  id: Field.Primary(),
  quizId: Field.Foreign(quizzes.id, { onDelete: "CASCADE" }),
  name: Field.Varchar(80),
  token: Field.Varchar(64, null),
  status: Field.Enum(["open", "finished"] as const, "open"),
  score: Field.Float(0),
  total: Field.Int(0),
  rating: Field.Int(null),
  createdAt: Field.Date.now(),
  finishedAt: Field.Int(null),
  // Left by a respondent when results are held back, to be told on release.
  notifyEmail: Field.Varchar(254, null),
  notifiedAt: Field.Int(null),
  // The paper this respondent was served, saved when the attempt starts so a
  // shuffled quiz is reviewed as it was laid out: question ids in order, and
  // for each question the original option indices in the order shown, with
  // the key as the letter shown ({ questions: [12, 9, ...], options: { "12":
  // [2, 0, 3, 1] }, key: { "12": "B" } }). Null for a quiz that shuffles nothing.
  layout: Field.Json(true),
})

export const answers = table("answers", {
  id: Field.Primary(),
  responseId: Field.Foreign(responses.id, { onDelete: "CASCADE" }),
  questionId: Field.Foreign(questions.id, { onDelete: "CASCADE" }),
  choice: Field.Int(null),
  text: Field.Text(true),
  correct: Field.Bool(false),
  score: Field.Float(0),
  verdict: Field.Text(true),
  byAi: Field.Bool(false),
  overridden: Field.Bool(false),
  // An essay waiting for the maker's score (essay checking by AI is off).
  pending: Field.Bool(false),
})
export const answersOnce = Field.Unique(answers.responseId, answers.questionId)

// A respondent's report on a shared quiz, from the flag on its pages: why,
// and a note. Anonymous (no attempt, no name), and shown to the quiz maker.
// `questionId` is the question on screen when the flag was pressed, a plain
// integer rather than a foreign key: the question can be edited or deleted
// later, and the report stays.
export const reports = table("reports", {
  id: Field.Primary(),
  quizId: Field.Foreign(quizzes.id, { onDelete: "CASCADE" }),
  reason: Field.Enum(["wrong", "harmful", "copied", "other"] as const, "other"),
  note: Field.Text(true),
  questionId: Field.Int(null),
  createdAt: Field.Int(),
})
export const reportsQuiz = Field.Index(reports.quizId, reports.createdAt)
