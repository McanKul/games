// Solitword Mini: the rules of the board. Plain functions over plain data: no screen, no clock, no randomness.
// Nothing here changes what it is given; every step returns a new game.
//
// The table: columns of cards (only the top of each starts face up), a draw pile with its open pile, and one
// empty bin per column. A category's header card opens a bin; that category's cards are then delivered to it.
// Cards stack only on their own category. Every draw, stack and delivery costs a move.

export type Category = {
  name: string
  /** Cards the category needs delivered. */
  need: number
  /** When this category is complete, a card with its name joins the open pile as a card of category `chain`. */
  chain?: number
  /** The emoji on that card. */
  emoji?: string
}

export type Level = {
  cats: Category[]
  /** The cards as [category, word, emoji?]. A card's id is its place here; the header of category c is `cards.length + c`. */
  cards: [cat: number, word: string, emoji?: string][]
  /** Card ids, each column bottom to top. */
  cols: number[][]
  /** Card ids in drawing order. */
  draw: number[]
  moves: number
}

export type Card = { id: number; cat: number; text: string; emoji: string; head: boolean; up: boolean }

/** Why a game stopped: every category complete, no moves left, or nothing useful left to do. */
export type Ending = 'won' | 'moves' | 'stuck'

export type Game = {
  cats: readonly Category[]
  /** Bottom to top. */
  cols: Card[][]
  /** The next card drawn is the first. */
  draw: Card[]
  /** The top card is the last. */
  open: Card[]
  /** The category each bin is open for, or null while it is empty. */
  bins: (number | null)[]
  /** Cards delivered so far, by category. */
  got: number[]
  left: number
  delivered: number
  over: Ending | null
}

export type From = 'open' | { col: number; row: number }
export type To = { col: number } | { bin: number }

export type Refusal =
  | 'over' // the game has ended
  | 'empty' // nothing there to take, or no such place
  | 'closed' // a face-down card
  | 'same' // it would land where it already is
  | 'stack' // cards stack only on their own category
  | 'header' // a header goes on its own cards, an empty column or an empty bin
  | 'onHeader' // nothing goes on top of a header
  | 'binEmpty' // a bin opens with a header first
  | 'binTaken' // the bin is open for a category already
  | 'binOther' // the bin is open for another category

export type Step = { game: Game } | { refused: Refusal }

/** Ids of the cards complete categories hand on start here, clear of every dealt card. */
export const CHAIN_ID = 1000
export const POINTS_PER_CARD = 10
export const POINTS_PER_MOVE_LEFT = 5

const refuse = (refused: Refusal): Step => ({ refused })
const topOf = (cards: readonly Card[]): Card | undefined => cards[cards.length - 1]

function cardOf(level: Level, id: number): Card {
  const word = level.cards[id]
  if (word) return { id, cat: word[0], text: word[1], emoji: word[2] ?? '', head: false, up: false }
  const cat = id - level.cards.length
  const category = level.cats[cat]
  if (!category) throw new Error(`No card ${id} in this level.`)
  return { id, cat, text: category.name, emoji: '', head: true, up: false }
}

/** A level, dealt and ready to play. */
export function start(level: Level): Game {
  return {
    cats: level.cats,
    cols: level.cols.map((column) => column.map((id, row) => ({ ...cardOf(level, id), up: row === column.length - 1 }))),
    draw: level.draw.map((id) => cardOf(level, id)),
    open: [],
    bins: level.cols.map(() => null),
    got: level.cats.map(() => 0),
    left: level.moves,
    delivered: 0,
    over: null,
  }
}

/** Whether a face-up card may go on a column whose top card is `top` (undefined: an empty column). */
export function canStack(card: Card, top: Card | undefined): boolean {
  if (!card.up) return false
  if (!top) return true
  return top.up && !top.head && top.cat === card.cat
}

const stackable = (cards: readonly Card[], top: Card | undefined): boolean =>
  cards.length > 0 && cards.every((card, i) => canStack(card, i === 0 ? top : cards[i - 1]))

/** Where the run a card belongs to begins: stacked cards of one category move as one block. */
export function runStart(column: readonly Card[], row: number): number {
  const tapped = column[row]
  let from = row
  while (tapped && from > 0) {
    const below = column[from - 1]
    if (!below.up || below.cat !== tapped.cat) break
    from -= 1
  }
  return from
}

const complete = (game: Game): boolean => game.cats.every((category, cat) => game.got[cat] >= category.need)

/** Whether any card on the table or in the piles can still be stacked, delivered or used to open a bin. */
export function hasUsefulMoves(game: Game): boolean {
  const emptyBin = game.bins.includes(null)
  const canPlace = (cards: readonly Card[], fromCol: number | null, wholeColumn: boolean): boolean => {
    const top = cards[cards.length - 1]
    if (top.head ? emptyBin : game.bins.includes(top.cat)) return true
    return game.cols.some((column, target) => {
      if (target === fromCol) return false
      const destination = topOf(column)
      // A whole column moved to an empty one only renames the column.
      if (!destination && wholeColumn) return false
      return stackable(cards, destination)
    })
  }
  const onTable = game.cols.some((column, col) => {
    const starts = new Set<number>()
    column.forEach((card, row) => {
      if (card.up) starts.add(runStart(column, row))
    })
    return [...starts].some((from) => canPlace(column.slice(from), col, from === 0))
  })
  // After the open pile is taken back every card of both piles comes up again, so each is tried once.
  return onTable || [...game.open, ...game.draw].some((card) => canPlace([{ ...card, up: true }], null, false))
}

/** A move was spent on `next`: count it and see whether the game is over. */
function settle(next: Game): Game {
  const left = next.left - 1
  const counted = { ...next, left }
  const over: Ending | null = complete(counted) ? 'won' : left <= 0 ? 'moves' : hasUsefulMoves(counted) ? null : 'stuck'
  return { ...counted, over }
}

/** Opens the next card of the draw pile (a move). An empty draw pile takes the open pile back, free. */
export function draw(game: Game): Step {
  if (game.over) return refuse('over')
  if (game.draw.length === 0) {
    if (game.open.length === 0) return refuse('empty')
    return { game: { ...game, draw: game.open.map((card) => ({ ...card, up: false })), open: [] } }
  }
  const [next, ...rest] = game.draw
  return { game: settle({ ...game, draw: rest, open: [...game.open, { ...next, up: true }] }) }
}

type Taken = { cards: Card[]; cols: Card[][]; open: Card[]; wholeColumn: boolean }

function take(game: Game, from: From): Taken | Refusal {
  if (from === 'open') {
    const card = topOf(game.open)
    if (!card) return 'empty'
    return { cards: [card], cols: game.cols, open: game.open.slice(0, -1), wholeColumn: false }
  }
  const column = game.cols[from.col]
  const card = column?.[from.row]
  if (!card) return 'empty'
  if (!card.up) return 'closed'
  const begin = runStart(column, from.row)
  const kept = column.slice(0, begin)
  // The card left on top turns face up.
  const turned = kept.map((below, row) => (row === kept.length - 1 && !below.up ? { ...below, up: true } : below))
  return {
    cards: column.slice(begin),
    cols: game.cols.map((existing, col) => (col === from.col ? turned : existing)),
    open: game.open,
    wholeColumn: begin === 0,
  }
}

function toColumn(game: Game, from: From, taken: Taken, col: number): Step {
  const column = Number.isInteger(col) ? game.cols[col] : undefined
  if (!column) return refuse('empty')
  const destination = topOf(column)
  if (from !== 'open' && (from.col === col || (taken.wholeColumn && !destination))) return refuse('same')
  if (!stackable(taken.cards, destination)) {
    if (destination?.up && destination.head) return refuse('onHeader')
    return refuse(taken.cards[0].head ? 'header' : 'stack')
  }
  const cols = taken.cols.map((existing, index) => (index === col ? [...existing, ...taken.cards] : existing))
  return { game: settle({ ...game, cols, open: taken.open }) }
}

function toBin(game: Game, taken: Taken, bin: number): Step {
  if (!Number.isInteger(bin) || bin < 0 || bin >= game.bins.length) return refuse('empty')
  const top = taken.cards[taken.cards.length - 1]
  const words = top.head ? taken.cards.slice(0, -1) : taken.cards
  const holds = game.bins[bin]
  if (top.head && holds !== null) return refuse('binTaken')
  if (!top.head && holds === null) return refuse('binEmpty')
  if (!top.head && holds !== top.cat) return refuse('binOther')

  const cat = top.cat
  const got = game.got.map((count, index) => (index === cat ? count + words.length : count))
  const category = game.cats[cat]
  const done = got[cat] >= category.need
  // A complete category empties its bin for the next header, and a chained one hands its name on as a card.
  const open =
    done && category.chain !== undefined
      ? [...taken.open, { id: CHAIN_ID + cat, cat: category.chain, text: category.name, emoji: category.emoji ?? '', head: false, up: true }]
      : taken.open
  const bins = game.bins.map((existing, index) => (index === bin ? (done ? null : cat) : existing))
  return { game: settle({ ...game, cols: taken.cols, open, bins, got, delivered: game.delivered + words.length }) }
}

/** Moves the open card, or the run a column card belongs to, onto a column or into a bin (a move). */
export function move(game: Game, from: From, to: To): Step {
  if (game.over) return refuse('over')
  const taken = take(game, from)
  if (typeof taken === 'string') return refuse(taken)
  return 'col' in to ? toColumn(game, from, taken, to.col) : toBin(game, taken, to.bin)
}

/** Points so far: every delivered card, and on a win every move left over. */
export const score = (game: Game): number =>
  game.delivered * POINTS_PER_CARD + (game.over === 'won' ? game.left * POINTS_PER_MOVE_LEFT : 0)
