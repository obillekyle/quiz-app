import { Field, table } from "bakery-orm"

export const users = table("users", {
  id: Field.Primary(),
  name: Field.Varchar(80),
  email: Field.Varchar(254),
  passwordHash: Field.Varchar(255, null),
  googleId: Field.Varchar(64, null),
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

export const bins = table("bins", {
  id: Field.Primary(),
  name: Field.Varchar(80),
  owner: Field.Foreign(users.id, { onDelete: "CASCADE" }),
  ...Field.Timestamps(),
})

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
  description: Field.Text(true),
  icon: Field.Varchar(80, null),
  image: Field.Varchar(500, null),
  color: Field.Varchar(7, null),
  shuffleQuestions: Field.Bool(false),
  shuffleOptions: Field.Bool(false),
  timeMode: Field.Enum(["none", "question", "overall"] as const, "none"),
  timeLimit: Field.Int(null),
  allowRetake: Field.Bool(true),
  showResults: Field.Bool(true),
  resultsReleasedAt: Field.Int(null),
  aiCheck: Field.Bool(true),
  bin: Field.Foreign(bins.id, { nullable: true, onDelete: "SET NULL" }),
  aiEssay: Field.Bool(true),
  showHints: Field.Bool(true),
  feedback: Field.Enum(["each", "end"] as const, "each"),
  ...Field.Timestamps(),
})
export const quizzesShareCode = Field.Unique(quizzes.shareCode)

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
  sourceFile: Field.Varchar(255, null),
  grounded: Field.Bool(false),
  image: Field.Varchar(64, null),
  imageAlt: Field.Varchar(300, null),
  imageCredit: Field.Json(true),
  itemSet: Field.Json(true),
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
  pausedAt: Field.Int(null),
  section: Field.Varchar(80, null),
  advice: Field.Text(true),
  adviceAt: Field.Int(null),
  notifyEmail: Field.Varchar(254, null),
  notifiedAt: Field.Int(null),
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
  pending: Field.Bool(false),
})
export const answersOnce = Field.Unique(answers.responseId, answers.questionId)

export const reports = table("reports", {
  id: Field.Primary(),
  quizId: Field.Foreign(quizzes.id, { onDelete: "CASCADE" }),
  reason: Field.Enum(["wrong", "harmful", "copied", "other"] as const, "other"),
  note: Field.Text(true),
  questionId: Field.Int(null),
  createdAt: Field.Int(),
})
export const reportsQuiz = Field.Index(reports.quizId, reports.createdAt)
