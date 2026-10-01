/**
 * The quiz colors: the palette a quiz picks from by its id or in its
 * settings, and the sums that put text on one of them.
 */

/** The card colors from the QuizApp design, in the order the ids cycle through. */
export const PALETTE: { hex: string; name: string }[] = [
  { hex: "#6b276c", name: "Purple" },
  { hex: "#2f6fdb", name: "Blue" },
  { hex: "#c62828", name: "Red" },
  { hex: "#ef6c00", name: "Orange" },
  { hex: "#2e7d32", name: "Green" },
  { hex: "#5c3715", name: "Brown" },
]

/** The dark ink of the light tokens (`--ink`), for a light color. */
export const DARK_INK = "#1a1a1a"
export const WHITE = "#ffffff"

export const isHex = (s: unknown): s is string =>
  typeof s === "string" && /^#[0-9a-f]{6}$/i.test(s)

const rgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
]
const toHex = (c: [number, number, number]) =>
  "#" +
  c
    .map((v) =>
      Math.round(Math.min(255, Math.max(0, v)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance(hex: string) {
  const [r, g, b] = rgb(hex).map((v) => {
    const s = v / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio between two colors, 1 to 21. */
export function contrast(a: string, b: string) {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/**
 * The ink on `hex`: white where it reaches `floor`, else white or the dark
 * ink, whichever contrasts more. The two are equal at a luminance of about
 * 0.2; a fixed threshold above that leaves white on the palette's orange at
 * 3.1:1, under the 4.5:1 that text needs, while the dark ink reaches 5.7:1
 * there. A large letter or a glyph passes at 3, so the design's white letter
 * stays on the orange card and leaves only a light custom color.
 */
export function inkFor(hex: string, floor = 4.5) {
  const white = contrast(hex, WHITE)
  if (white >= floor) return WHITE
  return white >= contrast(hex, DARK_INK) ? WHITE : DARK_INK
}

/** `hex` mixed toward `target` by `amount` (0 to 1), channel by channel. */
export function mix(hex: string, target: string, amount: number) {
  const to = rgb(target)
  const c = rgb(hex).map((v, i) => v + (to[i]! - v) * amount) as [
    number,
    number,
    number,
  ]
  return toHex(c)
}

/** The surfaces the respondent page lays its accent on: the light and the dark `--surface`. */
export const LIGHT_SURFACE = "#ffffff"
export const DARK_SURFACE = "#1c1c1c"

/**
 * `hex` as an accent on `surface`: moved toward black on a light surface
 * or toward white on a dark one by the least amount that puts it at `ratio`
 * against the surface, so text and marks drawn in the color read there. A
 * color that already reads comes back as it is. On white, the palette's
 * orange (#ef6c00, 3.1:1) becomes #c25700 (4.5:1) and the other five stay;
 * on the dark surface (#1c1c1c) the orange stays and the other five move,
 * the purple most (#6b276c to #a075a1).
 */
export function readableOn(hex: string, surface: string, ratio = 4.5) {
  if (contrast(hex, surface) >= ratio) return hex
  const toward = luminance(surface) > 0.5 ? "#000000" : WHITE
  let lo = 0
  let hi = 1
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2
    if (contrast(mix(hex, toward, mid), surface) >= ratio) hi = mid
    else lo = mid
  }
  return mix(hex, toward, hi)
}
