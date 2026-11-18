// The panels shown over the table: the welcome, the level list, the menu, how to play, and how a level ended.
import type { Ending } from './engine'
import { TEXT } from './text'

type Choice = { label: string; run: () => void; primary?: boolean }

const TITLE_ID = 'sheet-title'

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag)
  node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

const host = (): HTMLElement => {
  const node = document.getElementById('sheet')
  if (!node) throw new Error('The page has no #sheet.')
  return node
}

const title = (text: string): HTMLElement => {
  const node = el('h2', 'panel-title', text)
  node.id = TITLE_ID
  return node
}

const choices = (list: Choice[]): HTMLElement => {
  const row = el('div', 'choices')
  for (const choice of list) {
    const button = el('button', choice.primary ? 'btn btn-primary' : 'btn', choice.label)
    button.type = 'button'
    button.addEventListener('click', choice.run)
    row.append(button)
  }
  return row
}

const steps = (): HTMLElement => {
  const list = el('ul', 'how')
  for (const [emoji, text] of TEXT.howSteps) {
    const item = el('li', 'how-step')
    const mark = el('span', 'how-emoji', emoji)
    mark.setAttribute('aria-hidden', 'true')
    item.append(mark, el('span', 'how-text', text))
    list.append(item)
  }
  return list
}

function open(kind: string, parts: HTMLElement[]): void {
  const panel = el('section', `panel panel-${kind}`)
  panel.setAttribute('role', 'dialog')
  panel.setAttribute('aria-modal', 'true')
  panel.setAttribute('aria-labelledby', TITLE_ID)
  panel.append(...parts)
  const sheet = host()
  sheet.replaceChildren(panel)
  sheet.hidden = false
  // The table under a panel is out of reach: no tap, no tab stop, no key plays it.
  document.querySelector('.app')?.toggleAttribute('inert', true)
  // Focus moves into the panel once the player has touched the game; a frame may not take it before that.
  if (navigator.userActivation?.hasBeenActive) panel.querySelector<HTMLElement>('.btn-primary, .level.current')?.focus()
}

export function closeSheet(): void {
  const sheet = host()
  sheet.hidden = true
  sheet.replaceChildren()
  document.querySelector('.app')?.toggleAttribute('inert', false)
}

export const sheetOpen = (): boolean => !host().hidden

export function showHome(on: { play: () => void; levels: () => void }): void {
  const mark = el('h2', 'wordmark')
  mark.id = TITLE_ID
  const icon = el('span', 'app-icon wordmark-icon')
  icon.setAttribute('aria-hidden', 'true')
  mark.append(icon, el('span', 'wordmark-solit', 'Solit'), el('span', 'wordmark-word', 'word'), el('span', 'wordmark-mini', TEXT.mini))
  open('home', [
    mark,
    steps(),
    choices([{ label: TEXT.play, run: on.play, primary: true }, { label: TEXT.pickLevel, run: on.levels }]),
    el('p', 'panel-promo', TEXT.fullGame),
  ])
}

export function showLevels(state: { count: number; current: number; best: ReadonlyMap<number, number>; small: number }, on: { pick: (index: number) => void; back?: () => void }): void {
  const grid = el('ol', 'levels')
  for (let index = 0; index < state.count; index += 1) {
    const best = state.best.get(index)
    const classes = ['level', index >= state.small ? 'big' : '', best !== undefined ? 'done' : '', index === state.current ? 'current' : '']
    const button = el('button', classes.filter(Boolean).join(' '), String(index + 1))
    button.type = 'button'
    button.setAttribute('aria-label', best === undefined ? TEXT.level(index + 1) : TEXT.levelDone(index + 1, best))
    button.addEventListener('click', () => on.pick(index))
    const item = el('li', 'levels-item')
    item.append(button)
    grid.append(item)
  }
  const back = on.back
  open('levels', [title(TEXT.levels), el('p', 'panel-note', TEXT.levelsHint), grid, ...(back ? [choices([{ label: TEXT.back, run: back }])] : [])])
}

export function showMenu(on: { resume: () => void; restart: () => void; levels: () => void; how: () => void }): void {
  open('menu', [
    title(TEXT.menu),
    choices([
      { label: TEXT.resume, run: on.resume, primary: true },
      { label: TEXT.restart, run: on.restart },
      { label: TEXT.levels, run: on.levels },
      { label: TEXT.how, run: on.how },
    ]),
  ])
}

export function showHow(on: { back: () => void }): void {
  open('how', [title(TEXT.how), steps(), choices([{ label: TEXT.back, run: on.back, primary: true }])])
}

export type Outcome = { ending: Ending; delivered: number; left: number; cardPoints: number; movePoints: number; total: number; last: boolean }

export function showResult(outcome: Outcome, on: { next: () => void; retry: () => void; levels: () => void }): void {
  const won = outcome.ending === 'won'
  const emoji = el('p', 'result-emoji', won ? (outcome.last ? '👑' : '🎉') : outcome.ending === 'moves' ? '⏳' : '🧩')
  emoji.setAttribute('aria-hidden', 'true')
  const heading = title(won ? (outcome.last ? TEXT.wonAll : TEXT.won) : outcome.ending === 'moves' ? TEXT.lostMoves : TEXT.lostStuck)

  const sums = el('dl', 'sums')
  const line = (label: string, value: string, className = 'sum') => {
    const row = el('div', className)
    row.append(el('dt', 'sum-label', label), el('dd', 'sum-value', value))
    sums.append(row)
  }
  line(TEXT.cardsDelivered, `${outcome.delivered} × ${outcome.cardPoints}`)
  if (won) line(TEXT.movesLeft, `${outcome.left} × ${outcome.movePoints}`)
  line(TEXT.total, String(outcome.total), 'sum sum-total')

  const parts = won ? [emoji, heading, sums] : [emoji, heading, el('p', 'panel-note', outcome.ending === 'moves' ? TEXT.lostMovesBody : TEXT.lostStuckBody), sums]
  const first: Choice = won && !outcome.last ? { label: TEXT.next, run: on.next, primary: true } : { label: TEXT.retry, run: on.retry, primary: !won }
  open(won ? 'won' : 'lost', [...parts, choices([first, { label: TEXT.levels, run: on.levels, primary: won && outcome.last }])])
}
