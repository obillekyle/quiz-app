/**
 * Writes src/icons.ts: the icons the app uses, copied out of Material
 * Symbols (Google, Apache 2.0; the set the QuizApp design draws with) and
 * registered with @iconify/vue under the `qa` prefix.
 *
 * The whole set is 8 MB of JSON (@iconify-json/material-symbols, a dev
 * dependency), so it never reaches the browser: the page carries only these,
 * and draws them without asking Iconify's servers for anything.
 *
 *   bun run icons      after changing ICONS below
 */
const ICONS = {
  panel: 'left-panel-open-outline-rounded',
  home: 'home-outline-rounded',
  responses: 'inbox-outline-rounded',
  archive: 'archive-outline-rounded',
  unarchive: 'unarchive-outline-rounded',
  plus: 'add-rounded',
  send: 'arrow-upward-rounded',
  up: 'arrow-upward-rounded',
  down: 'arrow-downward-rounded',
  search: 'search-rounded',
  grid: 'grid-view-outline-rounded',
  list: 'view-list-outline-rounded',
  file: 'description-outline-rounded',
  image: 'image-outline-rounded',
  copy: 'content-copy-outline-rounded',
  print: 'print-outline-rounded',
  close: 'close-rounded',
  delete: 'delete-outline-rounded',
  more: 'more-vert',
  sparkle: 'auto-awesome-outline-rounded',
  quiz: 'quiz-outline-rounded',
  check: 'check-rounded',
  chevron: 'expand-more-rounded',
  forward: 'chevron-right-rounded',
  back: 'arrow-back-rounded',
  link: 'add-link-rounded',
  linked: 'link-rounded',
  done: 'task-alt-rounded',
  pin: 'pin-outline-rounded',
  review: 'checklist-rounded',
  info: 'info-outline-rounded',
  flag: 'flag-outline-rounded',
  overview: 'space-dashboard-outline-rounded',
  edit: 'edit-outline-rounded',
  people: 'group-outline-rounded',
  settings: 'settings-outline-rounded',
  share: 'share-outline-rounded',
  download: 'download-rounded',
  open: 'open-in-new-rounded',
  bell: 'notifications-outline-rounded',
  logout: 'logout-rounded',
  person: 'person-outline-rounded',
  devices: 'devices-outline-rounded',
  key: 'key-outline-rounded',
  theme: 'contrast-rounded',
  chat: 'chat-outline-rounded',
  folder: 'folder-outline-rounded',
  mail: 'mail-outline-rounded',
  globe: 'public-rounded',
  shuffle: 'shuffle-rounded',
  upload: 'upload-rounded',
  'face-1': 'sentiment-very-dissatisfied-outline-rounded',
  'face-2': 'sentiment-dissatisfied-outline-rounded',
  'face-3': 'sentiment-neutral-outline-rounded',
  'face-4': 'sentiment-satisfied-outline-rounded',
  'face-5': 'sentiment-very-satisfied-outline-rounded',
} as const

type IconData = { body: string; width?: number; height?: number }
type Alias = { parent: string } & Record<string, unknown>
const set: { icons: Record<string, IconData>; aliases?: Record<string, Alias>; width?: number; height?: number } =
  await Bun.file(new URL('../node_modules/@iconify-json/material-symbols/icons.json', import.meta.url)).json()

// Copy each source icon, and the chain of icons an alias in the set leans on.
const icons: Record<string, IconData> = {}
const aliases: Record<string, Alias> = {}
function take(name: string) {
  if (icons[name] || aliases[name]) return
  if (set.icons[name]) icons[name] = set.icons[name]!
  else if (set.aliases?.[name]) {
    aliases[name] = set.aliases[name]!
    take(set.aliases[name]!.parent)
  } else throw new Error(`Material Symbols has no icon named ${name}`)
}
for (const source of Object.values(ICONS)) take(source)
for (const [ours, source] of Object.entries(ICONS)) aliases[ours] = { parent: source }

const collection = { prefix: 'qa', width: set.width ?? 24, height: set.height ?? 24, icons, aliases }
const out = `// Written by scripts/icons.ts from Material Symbols (Google, Apache 2.0).
// Do not edit: change ICONS there and run \`bun run icons\`.
import { addCollection } from '@iconify/vue'

export const ICON_NAMES = ${JSON.stringify(Object.keys(ICONS))} as const
export type IconName = (typeof ICON_NAMES)[number]

addCollection(${JSON.stringify(collection)})
`
const target = new URL('../src/icons.ts', import.meta.url)
await Bun.write(target, out)
console.log(`src/icons.ts: ${Object.keys(ICONS).length} names, ${Object.keys(icons).length} icons, ${(out.length / 1024).toFixed(1)} KB`)
