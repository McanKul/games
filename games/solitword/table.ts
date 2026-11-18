// The table on screen. Every card is one element that glides to wherever the layout puts it; taps and drags on
// them become draws and moves. The table keeps no rules: it asks, and shows the game it is given back.
import { runStart, type Card, type From, type Game, type Refusal, type To } from './engine'
import { inside, layout, type Box, type Layout, type Place } from './layout'
import { REFUSED, TEXT } from './text'

export type TableHandlers = {
  /** The player asked for a card from the draw pile. Returns why not, or null once the game has changed. */
  draw(): Refusal | null
  /** The player asked for a move. Returns why not, or null once the game has changed. */
  move(from: From, to: To): Refusal | null
  /** Something to tell the player. */
  say(message: string): void
}

export type Change = {
  /** A new deal: the old cards go, the new ones are dealt out from the draw pile. */
  dealt?: boolean
  /** The bin the last move delivered to: cards that left fly there, and a card handed on comes out of it. */
  bin?: number
}

/** A move pointed out to the player: what to take (a card, or the draw pile) and where to put it. */
export type Pointer = { from: From | 'draw'; to?: To }

export type Table = {
  show(game: Game, change?: Change): void
  /** Points a move out on the table, or stops pointing (null). It stays through later shows until changed. */
  point(pointer: Pointer | null): void
  /** Lays the same game out again, measuring every word afresh (the card font has arrived). */
  refit(): void
}

type Spot = { card: Card; from: From | null; inColumn: boolean }
type Press = { pointer: number; from: From; ids: number[]; x: number; y: number; dragging: boolean }
type Slots = { hud: HTMLElement; moves: HTMLElement; open: HTMLElement; draw: HTMLButtonElement; count: HTMLElement; bins: HTMLButtonElement[]; cols: HTMLButtonElement[] }

/** How far a press travels before it is a drag (px). */
const DRAG_START = 8
const LEAVE_MS = 420
const SHAKE_MS = 340
const BIN_DONE_MS = 900
const DEAL_STAGGER_MS = 14
const LOW_MOVES = 10
const MIN_FONT = 7.5
/** A card's word size as a share of the card's width: a header, a card with an emoji, a card with only its word. */
const WORD_SIZE = { head: 0.155, emoji: 0.14, plain: 0.165 }
const WORD_INSET = 14
/** On the strip a covered card shows, as shares of the card's width: the word's size on one line and on two, and the room its emoji takes. */
const STRIP_FONT = 0.135
const STRIP_FONT_WRAPPED = 0.122
const STRIP_EMOJI = 0.2
const STRIP_INSET = 20
/** Below this size a word is not left on one line. */
const MIN_STRIP_FONT = 8.5

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag)
  node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

const moveTo = (node: HTMLElement, box: { x: number; y: number }, scale = 1): void => {
  node.style.transform = `translate(${box.x}px, ${box.y}px)${scale === 1 ? '' : ` scale(${scale})`}`
}

const sizeTo = (node: HTMLElement, box: Box): void => {
  moveTo(node, box)
  node.style.width = `${box.w}px`
  node.style.height = `${box.h}px`
}

const measuring = document.createElement('canvas').getContext('2d')
/** Measured widths, by text: forgotten when the card font arrives, since they were taken in another face. */
const wordWidths = new Map<string, number>()

/** The width of a text's widest word, per pixel of font size. */
function widestWord(text: string): number {
  const cached = wordWidths.get(text)
  if (cached !== undefined) return cached
  if (measuring) measuring.font = '800 100px Nunito, ui-rounded, system-ui, sans-serif'
  const widest = Math.max(...text.split(/\s+/).map((word) => (measuring ? measuring.measureText(word).width / 100 : word.length * 0.62)))
  wordWidths.set(text, widest)
  return widest
}

/** The width of a whole text on one line, per pixel of font size. */
function lineWidth(text: string): number {
  const key = `line:${text}`
  const cached = wordWidths.get(key)
  if (cached !== undefined) return cached
  if (measuring) measuring.font = '800 100px Nunito, ui-rounded, system-ui, sans-serif'
  const width = measuring ? measuring.measureText(text).width / 100 : text.length * 0.58
  wordWidths.set(key, width)
  return width
}

/** The width of a text broken into the two most even lines, per pixel of font size. */
function twoLineWidth(text: string): number {
  const words = text.split(/\s+/)
  if (words.length < 2) return lineWidth(text)
  const splits = words.slice(1).map((_, index) => Math.max(lineWidth(words.slice(0, index + 1).join(' ')), lineWidth(words.slice(index + 1).join(' '))))
  return Math.min(...splits)
}

const calmMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

function makeCard(card: Card): HTMLButtonElement {
  const node = el('button', `card${card.head ? ' head' : card.emoji ? '' : ' plain'}`)
  node.type = 'button'
  node.dataset.id = String(card.id)
  const face = el('span', 'card-face')
  if (card.head) face.append(el('span', 'card-emoji', '👑'))
  else if (card.emoji) face.append(el('span', 'card-emoji', card.emoji))
  face.append(el('span', 'card-word', card.text))
  const turn = el('span', 'card-turn')
  turn.append(el('span', 'card-back'), face)
  node.append(turn)
  return node
}

export function createTable(root: HTMLElement, handlers: TableHandlers): Table {
  const cards = new Map<number, HTMLButtonElement>()
  /** Cards delivered a moment ago, still flying to their bin. */
  const leaving = new Set<HTMLElement>()
  let game: Game | null = null
  let plan: Layout | null = null
  let slots: Slots | null = null
  let selected: From | null = null
  /** The selection was made for the player (the card just drawn), not by them. */
  let handed = false
  let pointer: Pointer | null = null
  let press: Press | null = null

  /** Every card of the game with where it can be taken from (null: it cannot be). */
  const spots = (current: Game): Spot[] => [
    ...current.draw.map((card) => ({ card, from: null, inColumn: false })),
    ...current.open.map((card, index) => ({ card, from: index === current.open.length - 1 ? ('open' as const) : null, inColumn: false })),
    ...current.cols.flatMap((column, col) => column.map((card, row) => ({ card, from: card.up ? { col, row } : null, inColumn: true }))),
  ]

  /** The ids of the cards that move when `from` is taken: the open card, or a column card's whole run. */
  const runOf = (from: From): number[] => {
    if (!game) return []
    if (from === 'open') return game.open.slice(-1).map((card) => card.id)
    const column = game.cols[from.col] ?? []
    return column.slice(runStart(column, from.row)).map((card) => card.id)
  }

  const sameSource = (a: From, b: From): boolean => (a === 'open' || b === 'open' ? a === b : a.col === b.col)

  function select(from: From | null, byDraw = false): void {
    selected = from
    handed = byDraw && from !== null
    const ids = new Set(from ? runOf(from) : [])
    for (const [id, node] of cards) {
      node.classList.toggle('sel', ids.has(id))
      node.setAttribute('aria-pressed', String(ids.has(id)))
    }
  }

  function buildSlots(columns: number): Slots {
    slots?.hud.remove()
    slots?.open.remove()
    slots?.draw.remove()
    for (const node of [...(slots?.bins ?? []), ...(slots?.cols ?? [])]) node.remove()

    const hud = el('div', 'hud')
    const moves = el('span', 'hud-moves')
    hud.append(el('span', 'hud-label', TEXT.moves), moves)
    const open = el('div', 'slot open-slot', TEXT.openEmpty)
    const draw = el('button', 'slot draw-slot')
    draw.type = 'button'
    const count = el('span', 'draw-count')
    draw.append(el('span', 'draw-mark', '↻'), count)
    draw.addEventListener('click', drawTapped)
    const button = (className: string, onTap: (index: number) => void) =>
      Array.from({ length: columns }, (_, index) => {
        const node = el('button', className)
        node.type = 'button'
        node.addEventListener('click', () => onTap(index))
        return node
      })
    const bins = button('slot bin', (bin) => selected && attempt(selected, { bin }))
    for (const bin of bins) bin.append(el('span', 'bin-crown', '👑'), el('span', 'bin-name'), el('span', 'bin-count'))
    const cols = button('slot col-slot', (col) => selected && attempt(selected, { col }))
    root.append(hud, open, draw, ...bins, ...cols)
    return { hud, moves, open, draw, count, bins, cols }
  }

  function showSlots(current: Game, before: Game | null, to: Layout, made: Slots): void {
    sizeTo(made.hud, to.hud)
    made.moves.textContent = String(current.left)
    made.hud.classList.toggle('low', current.left <= LOW_MOVES)
    sizeTo(made.open, to.open)
    sizeTo(made.draw, to.draw)
    const recycle = current.draw.length === 0 && current.open.length > 0
    made.draw.classList.toggle('recycle', recycle)
    made.draw.classList.toggle('spent', current.draw.length === 0 && !recycle)
    made.draw.disabled = Boolean(current.over) || (current.draw.length === 0 && !recycle)
    made.draw.setAttribute('aria-label', recycle ? TEXT.recycle : current.draw.length ? TEXT.draw : TEXT.drawEmpty)
    made.count.textContent = current.draw.length ? String(current.draw.length) : ''

    made.bins.forEach((bin, index) => {
      sizeTo(bin, to.bins[index])
      const cat = current.bins[index]
      const [crown, name, count] = [...bin.children] as HTMLElement[]
      bin.classList.toggle('open', cat !== null)
      if (cat === null) {
        name.textContent = ''
        count.textContent = ''
        bin.setAttribute('aria-label', TEXT.bin(index + 1))
      } else {
        const category = current.cats[cat]
        name.textContent = category.name
        name.style.fontSize = `${Math.max(MIN_FONT, Math.min(to.cardW * WORD_SIZE.head, (to.cardW - WORD_INSET) / widestWord(category.name)))}px`
        count.textContent = `${current.got[cat]}/${category.need}`
        bin.style.setProperty('--progress', String(current.got[cat] / category.need))
        bin.setAttribute('aria-label', TEXT.binOpen(category.name, current.got[cat], category.need))
      }
      // A category just completed here: the bin says so for a moment.
      const was = before?.bins[index] ?? null
      if (was !== null && cat === null && current.got[was] >= current.cats[was].need) {
        crown.textContent = '✓'
        bin.classList.add('done')
        window.setTimeout(() => {
          crown.textContent = '👑'
          bin.classList.remove('done')
        }, BIN_DONE_MS)
      }
    })
    made.cols.forEach((slot, index) => {
      const zone = to.cols[index]
      sizeTo(slot, { x: zone.x + (zone.w - to.cardW) / 2, y: zone.y, w: to.cardW, h: to.cardH })
      slot.setAttribute('aria-label', TEXT.column(index + 1))
      slot.disabled = current.cols[index].length > 0
    })
  }

  function showCard(node: HTMLButtonElement, spot: Spot, place: Place, to: Layout): void {
    const { card } = spot
    node.classList.remove('dragging')
    moveTo(node, place)
    node.style.zIndex = String(place.z)
    node.hidden = place.hidden
    node.disabled = spot.from === null
    node.classList.toggle('up', card.up)
    node.classList.toggle('covered', spot.inColumn && card.up && place.covered)
    node.setAttribute('aria-label', !card.up ? TEXT.closedCard : card.head ? TEXT.header(card.text) : card.text)
    const share = card.head ? WORD_SIZE.head : card.emoji ? WORD_SIZE.emoji : WORD_SIZE.plain
    node.style.setProperty('--fs', `${Math.max(MIN_FONT, Math.min(to.cardW * share, (to.cardW - WORD_INSET) / widestWord(card.text)))}px`)
    // Under another card only a strip shows. The word goes on one line if it can be read there; if not it gives up
    // its emoji, and then takes two smaller lines, before it is ever cut.
    const room = to.cardW - STRIP_INSET
    const beside = card.emoji ? to.cardW * STRIP_EMOJI : 0
    const lean = beside > 0 && (room - beside) / lineWidth(card.text) < MIN_STRIP_FONT
    const oneLine = (room - (lean ? 0 : beside)) / lineWidth(card.text)
    const wrap = oneLine < MIN_STRIP_FONT
    node.classList.toggle('lean', lean)
    node.classList.toggle('wrap', wrap)
    const size = wrap ? Math.min(to.cardW * STRIP_FONT_WRAPPED, room / twoLineWidth(card.text)) : Math.min(to.cardW * STRIP_FONT, oneLine)
    node.style.setProperty('--fs-line', `${Math.max(MIN_FONT, size)}px`)
  }

  function leave(node: HTMLButtonElement, bin: Box | undefined, to: Layout): void {
    if (!bin) {
      node.remove()
      return
    }
    node.classList.add('leaving')
    node.disabled = true
    node.style.zIndex = '900'
    moveTo(node, { x: bin.x, y: bin.y + (bin.h - to.cardH) / 2 }, bin.h / to.cardH)
    leaving.add(node)
    window.setTimeout(() => {
      leaving.delete(node)
      node.remove()
    }, LEAVE_MS)
  }

  /** Lets go of a press the table can no longer honour: the cards under it are about to be laid out again. */
  function dropPress(): void {
    if (!press) return
    const { pointer } = press
    press = null
    if (root.hasPointerCapture(pointer)) root.releasePointerCapture(pointer)
  }

  function show(next: Game, change: Change = {}): void {
    const before = change.dealt ? null : game
    if (change.dealt) {
      // Nothing of the last deal stays: its cards, the ones still flying to a bin, a bin still showing its tick.
      for (const node of [...cards.values(), ...leaving]) node.remove()
      cards.clear()
      leaving.clear()
      for (const bin of slots?.bins ?? []) bin.classList.remove('done')
    }
    game = next
    dropPress()
    const to = layout(next, root.clientWidth, root.clientHeight)
    plan = to
    root.style.setProperty('--cw', `${to.cardW}px`)
    root.style.setProperty('--ch', `${to.cardH}px`)
    if (!slots || slots.bins.length !== next.cols.length) slots = buildSlots(next.cols.length)
    showSlots(next, before, to, slots)

    const present = new Set<number>()
    const bin = change.bin === undefined ? undefined : to.bins[change.bin]
    // On a deal the column cards leave the draw pile one after another.
    const stagger = change.dealt && !calmMotion.matches
    let dealtSoFar = 0
    spots(next).forEach((spot) => {
      const place = to.places.get(spot.card.id)
      if (!place) return
      present.add(spot.card.id)
      let node = cards.get(spot.card.id)
      if (!node) {
        // A new card starts where it comes from: the draw pile on a deal, the bin of the category that handed it on.
        node = makeCard(spot.card)
        node.classList.add('still')
        moveTo(node, bin ?? to.draw)
        root.append(node)
        cards.set(spot.card.id, node)
        void node.offsetWidth
        node.classList.remove('still')
      }
      node.style.transitionDelay = stagger && spot.inColumn ? `${dealtSoFar * DEAL_STAGGER_MS}ms` : ''
      if (spot.inColumn) dealtSoFar += 1
      showCard(node, spot, place, to)
    })
    for (const [id, node] of cards) {
      if (present.has(id)) continue
      cards.delete(id)
      leave(node, bin, to)
    }
    select(null)
    showPointer()
  }

  /** Marks the pointed-out move: the cards to take glow, the place to put them is ringed. */
  function showPointer(): void {
    for (const node of root.querySelectorAll('.hint, .aim')) node.classList.remove('hint', 'aim')
    if (!pointer || !game || !slots) return
    if (pointer.from === 'draw') slots.draw.classList.add('hint')
    else for (const id of runOf(pointer.from)) cards.get(id)?.classList.add('hint')
    const to = pointer.to
    if (!to) return
    if ('bin' in to) {
      slots.bins[to.bin]?.classList.add('aim')
      return
    }
    const column = game.cols[to.col] ?? []
    const top = column[column.length - 1]
    const target = top ? cards.get(top.id) : slots.cols[to.col]
    target?.classList.add('aim')
  }

  /** Puts every card back where the layout has it (after a drag that went nowhere). */
  function settle(): void {
    if (!game || !plan) return
    for (const spot of spots(game)) {
      const node = cards.get(spot.card.id)
      const place = plan.places.get(spot.card.id)
      if (!node || !place) continue
      node.classList.remove('dragging')
      node.style.transitionDelay = ''
      moveTo(node, place)
      node.style.zIndex = String(place.z)
    }
  }

  function shake(ids: number[]): void {
    for (const id of ids) {
      const node = cards.get(id)
      if (!node) continue
      node.classList.add('shake')
      window.setTimeout(() => node.classList.remove('shake'), SHAKE_MS)
    }
  }

  /** Asks for a move. A refusal is shown (a shake and its reason) unless `quiet`. Returns whether the move was made. */
  function attempt(from: From, to: To, quiet = false): boolean {
    const ids = runOf(from)
    const refused = handlers.move(from, to)
    if (refused === null) return true
    settle()
    select(null)
    const message = REFUSED[refused]
    if (message && !quiet) {
      shake(ids)
      handlers.say(message)
    }
    return false
  }

  function tapped(from: From): void {
    if (!selected) {
      select(from)
      return
    }
    if (sameSource(selected, from)) {
      select(null)
      return
    }
    // With a card in hand, a tap on a column puts it there; a tap on the open card takes that one instead.
    if (from === 'open') {
      select(from)
      return
    }
    // The drawn card was put in the player's hand for them: where it does not fit, the tap takes the tapped card.
    const wasHanded = handed
    if (!attempt(selected, { col: from.col }, wasHanded) && wasHanded) select(from)
  }

  function drawTapped(): void {
    select(null)
    if (handlers.draw() === null && game?.open.length) select('open', true)
  }

  const sourceOf = (target: EventTarget | null): From | null => {
    const node = target instanceof Element ? target.closest<HTMLElement>('.card') : null
    if (!node || !game) return null
    const id = Number(node.dataset.id)
    return spots(game).find((spot) => spot.card.id === id)?.from ?? null
  }

  const pointIn = (event: PointerEvent): { x: number; y: number } => {
    const frame = root.getBoundingClientRect()
    return { x: event.clientX - frame.left, y: event.clientY - frame.top }
  }

  root.addEventListener('pointerdown', (event) => {
    if (press || !event.isPrimary || event.button > 0) return
    const from = sourceOf(event.target)
    if (!from) return
    try {
      root.setPointerCapture(event.pointerId)
    } catch {
      // A pointer that cannot be captured still taps and drags while it stays over the table.
    }
    press = { pointer: event.pointerId, from, ids: runOf(from), x: event.clientX, y: event.clientY, dragging: false }
  })

  root.addEventListener('pointermove', (event) => {
    if (!press || event.pointerId !== press.pointer || !plan) return
    const dx = event.clientX - press.x
    const dy = event.clientY - press.y
    if (!press.dragging && Math.hypot(dx, dy) < DRAG_START) return
    press.dragging = true
    press.ids.forEach((id, index) => {
      const node = cards.get(id)
      const place = plan?.places.get(id)
      if (!node || !place) return
      node.classList.add('dragging')
      node.style.zIndex = String(1000 + index)
      moveTo(node, { x: place.x + dx, y: place.y + dy })
    })
  })

  const release = (event: PointerEvent, dropped: boolean): void => {
    if (!press || event.pointerId !== press.pointer) return
    const { from, dragging } = press
    press = null
    if (root.hasPointerCapture(event.pointerId)) root.releasePointerCapture(event.pointerId)
    if (!dragging) {
      if (dropped) tapped(from)
      return
    }
    const point = pointIn(event)
    const bin = plan?.bins.findIndex((box) => inside(box, point.x, point.y)) ?? -1
    const col = plan?.cols.findIndex((box) => inside(box, point.x, point.y)) ?? -1
    for (const id of runOf(from)) cards.get(id)?.classList.remove('dragging')
    if (dropped && bin >= 0) attempt(from, { bin })
    else if (dropped && col >= 0) attempt(from, { col })
    else settle()
  }
  root.addEventListener('pointerup', (event) => release(event, true))
  root.addEventListener('pointercancel', (event) => release(event, false))
  root.addEventListener('lostpointercapture', (event) => release(event, false))

  // A card taken with the keyboard: a click that no pointer made.
  root.addEventListener('click', (event) => {
    if (event.detail !== 0) return
    const from = sourceOf(event.target)
    if (from) tapped(from)
  })

  /** Lays the same game out again, without the glide; the card in hand stays in hand. */
  const relay = (): void => {
    if (!game) return
    const inHand = selected
    const wasHanded = handed
    root.classList.add('still')
    show(game)
    select(inHand, wasHanded)
    void root.offsetWidth
    root.classList.remove('still')
  }
  new ResizeObserver(relay).observe(root)

  return {
    show,
    point: (next) => {
      pointer = next
      showPointer()
    },
    refit: () => {
      wordWidths.clear()
      relay()
    },
  }
}
