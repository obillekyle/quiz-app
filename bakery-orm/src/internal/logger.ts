/**
 * The part of @bakery-framework/core's logger the ORM uses: a named `Logger`
 * with `log()` and `confirm()`, and `messageLogger`, which turns a table of
 * `'E …'` / `'W …'` / `'D …'` templates with `{param}` placeholders into
 * functions, plus the two terminal prompts schema sync asks.
 *
 * The line format and the `%r`, `%y`, `%*` color codes match core's, so the
 * ORM's messages read the same. Left behind: core's prompt tracking (a bakery
 * dev-server concern) and its log callbacks. Colors are dropped when stdout
 * is not a terminal or `NO_COLOR` is set.
 */
import { readSync } from 'node:fs'
import type { MapOf } from './types.js'

export type LogLevels = 'info' | 'warn' | 'error' | 'fatal' | 'debug' | 'trace'

const COLORS: MapOf<string> = {
  r: '\x1b[31m',
  g: '\x1b[32m',
  y: '\x1b[33m',
  b: '\x1b[34m',
  m: '\x1b[35m',
  c: '\x1b[36m',
  w: '\x1b[37m',
  d: '\x1b[90m',
  B: '\x1b[38;5;94m',
  p: '\x1b[38;5;129m',
  o: '\x1b[38;5;208m',
  '*': '\x1b[0m',
  '0': '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
  reset: '\x1b[0m',
}

const RX_COLORIZE = /%<([a-zA-Z0-9]+)>|%([a-zA-Z0-9*%])/g

const TAG: Record<LogLevels, string> = {
  info: '%w[I]',
  warn: '%y[W]',
  error: '%r[E]',
  fatal: '%r[F]',
  debug: '%m[D]',
  trace: '%d[T]',
}

function colorize(msg: string): string {
  const on = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR
  return msg.replace(RX_COLORIZE, (match, long?: string, short?: string) => {
    if (short === '%') return '%'
    const code = COLORS[(long ?? short) as string]
    if (!code) return match
    return on ? code : ''
  })
}

export interface LoggerEntry {
  level?: LogLevels
  by?: string
  msg: string
}

let onLog: ((entry: LoggerEntry) => void) | null = null

/**
 * Receives every entry as well as stdout does, with its message raw (color
 * codes and all). For routing the ORM's messages into an app's own logger,
 * and for tests that read what was said.
 */
export function setLogCallback(callback: ((entry: LoggerEntry) => void) | null): void {
  onLog = callback
}

export function log({ level = 'info', by = 'global', msg }: LoggerEntry): void {
  if (level === 'debug' && process.env.NODE_ENV === 'production') return
  const prefix = `${TAG[level]}%0 %d${by.padEnd(15)}%0 `
  for (const line of msg.split('\n')) {
    process.stdout.write(`${colorize(`${prefix}${line}%0`)}\n`)
  }
  if (onLog) {
    // A sink that throws must not take the log line's caller down with it,
    // which is how core treated it too.
    try {
      onLog({ level, by, msg })
    } catch {
      // See above: the line has already reached stdout.
    }
  }
}

/** False in Docker and CI, where nobody is there to answer. */
export function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY)
}

/**
 * One line from the terminal, synchronously, as the prompts below need.
 *
 * Bun has a global `prompt()`, which is what core used. Node has none, so the
 * line is read off file descriptor 0 a byte at a time: blocking, which is
 * the point, and safe because nothing in this package puts stdin into
 * flowing mode first.
 */
function ask(question: string): string | null {
  const native = (globalThis as { prompt?: (q: string) => string | null }).prompt
  if (typeof native === 'function') return native(question)

  process.stdout.write(`${question} `)
  const byte = Buffer.alloc(1)
  const bytes: number[] = []
  for (;;) {
    let read = 0
    try {
      read = readSync(0, byte, 0, 1, null)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EOF') break
      throw error
    }
    if (read === 0 || byte[0] === 0x0a) break
    bytes.push(byte[0])
  }
  return Buffer.from(bytes).toString('utf8').replace(/\r$/, '')
}

/** Yes or no. Without a terminal the answer is no, never an assumed yes. */
export function confirm(msg: string, by = 'global'): boolean {
  log({ level: 'warn', by, msg: `%y${msg} (y/n)` })
  if (!isInteractive()) return false
  const answer = ask(colorize(`${TAG.warn}%0 %d${by.padEnd(15)}%0 %y>%0`))
  return /^y(es)?$/i.test(String(answer ?? '').trim())
}

const MAX_PROMPT_ATTEMPTS = 10

/**
 * A numbered choice, returned as its index. Without a terminal there is no
 * safe default (the choice is between keeping a column and dropping it), so
 * the process stops and says what to do instead, as core did.
 */
export function selectIndex(msg: string, options: string[], by = 'global'): number {
  log({ by, msg })
  options.forEach((option, i) => log({ by, msg: `  ${i + 1}. ${option}` }))

  if (!isInteractive()) {
    log({
      level: 'error',
      by,
      msg: 'Cannot prompt for input: no interactive terminal. Run this again in a terminal.',
    })
    process.exit(1)
  }

  const question = colorize(`${TAG.info}%0 %d${by.padEnd(15)}%0 Select an option (1-${options.length}):`)
  for (let attempt = 0; attempt < MAX_PROMPT_ATTEMPTS; attempt++) {
    const n = Number.parseInt(ask(question)?.trim() ?? '', 10)
    if (n >= 1 && n <= options.length) return n - 1
    log({ level: 'error', by, msg: 'Invalid option.' })
  }
  log({ level: 'error', by, msg: `No valid option after ${MAX_PROMPT_ATTEMPTS} attempts. Aborting.` })
  process.exit(1)
}

export function select(msg: string, options: string[], by = 'global'): string {
  return options[selectIndex(msg, options, by)] as string
}

export class Logger {
  constructor(private by: string) {}

  log(msg: string, level?: LogLevels) {
    log({ level, by: this.by, msg })
  }

  confirm(msg: string) {
    return confirm(msg, this.by)
  }

  select(msg: string, options: string[]) {
    return select(msg, options, this.by)
  }

  selectIndex(msg: string, options: string[]) {
    return selectIndex(msg, options, this.by)
  }
}

type Prettify<T> = { [K in keyof T]: T[K] } & {}

type ExtractArgs<S extends string> =
  S extends `${infer _}{${infer Param}}${infer Rest}`
    ? Prettify<{ [K in Param]: string | number | boolean } & ExtractArgs<Rest>>
    : {}

type Messages<T extends MapOf<string>> = {
  [K in keyof T]: T[K] extends string
    ? keyof ExtractArgs<T[K]> extends never
      ? () => void
      : (payload: ExtractArgs<T[K]>) => void
    : never
}

const RX_PARAM = /\{([^}]+)\}/g

function parse(raw: string): { level: LogLevels; template: string } {
  const space = raw.indexOf(' ')
  const head = space > -1 ? raw.slice(0, space) : 'E'
  const level: LogLevels =
    head === 'W' ? 'warn' : head === 'E' ? 'error' : head === 'D' ? 'debug' : 'info'
  return { level, template: space > -1 ? raw.slice(space + 1) : raw }
}

export function messageLogger<T extends MapOf<string>>(logger: Logger, table: T) {
  return new Proxy(table, {
    get(target, prop: string) {
      const raw = target[prop] ?? `E Error message not found: ${String(prop)}`
      const { level, template } = parse(raw)
      return (payload?: MapOf<unknown>) =>
        logger.log(
          template.replace(RX_PARAM, (_, key: string) =>
            String(payload?.[key] ?? `{${key}}`),
          ),
          level,
        )
    },
  }) as unknown as Messages<T>
}
