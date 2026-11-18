// The board's rules, tested on two tiny levels, and the shipped levels checked for sound data.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CHAIN_ID, draw, hasUsefulMoves, move, runStart, score, start, type From, type Game, type Level, type Step, type To } from './engine'
import { LEVELS } from './levels'

// Fruit needs Pear, Plum and the card Apple hands on; Apple needs Stem and Core; Color needs Red and Blue.
const ORCHARD: Level = {
  cats: [{ name: 'Fruit', need: 3 }, { name: 'Apple', need: 2, chain: 0, emoji: '🍎' }, { name: 'Color', need: 2 }],
  cards: [[0, 'Pear', '🍐'], [0, 'Plum'], [1, 'Stem'], [1, 'Core'], [2, 'Red'], [2, 'Blue']],
  // Headers: 6 Fruit, 7 Apple, 8 Color.
  cols: [[4, 6], [0, 7], [2, 1]],
  draw: [3, 5, 8],
  moves: 30,
}

// One column and one bin: a header stacked on its card with no empty bin left is a dead end.
const DEAD_END: Level = {
  cats: [{ name: 'A', need: 2 }, { name: 'B', need: 1 }],
  cards: [[0, 'a1'], [0, 'a2'], [1, 'b']],
  cols: [[0, 2]],
  draw: [3, 1, 4],
  moves: 20,
}

type Action = 'draw' | [From, To]

const freeze = <T>(value: T): T => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const inner of Object.values(value)) freeze(inner)
  }
  return value
}

const apply = (game: Game, action: Action): Step => (action === 'draw' ? draw(game) : move(game, action[0], action[1]))

/** Plays the actions in order; every one must be accepted. Each game is frozen, so a rule that changed it would throw. */
function play(game: Game, ...actions: Action[]): Game {
  let current = freeze(game)
  for (const [index, action] of actions.entries()) {
    const step = apply(current, action)
    assert.ok('game' in step, `action ${index + 1} was refused: ${'refused' in step ? step.refused : ''}`)
    current = freeze(step.game)
  }
  return current
}

const refusal = (game: Game, action: Action): string | null => {
  const step = apply(freeze(game), action)
  return 'refused' in step ? step.refused : null
}

const col = (c: number, row: number): From => ({ col: c, row })
const texts = (cards: { text: string }[]) => cards.map((card) => card.text)

// Completes Apple: its bin empties and its name joins the open pile as a Fruit card.
const APPLE_DONE: Action[] = [
  [col(1, 1), { bin: 0 }], // the Apple header opens the first bin
  [col(2, 1), { col: 1 }], // Plum onto Pear
  [col(2, 0), { bin: 0 }], // Stem
  'draw', // Core
  ['open', { bin: 0 }],
]
const WIN: Action[] = [
  ...APPLE_DONE,
  [col(0, 1), { bin: 0 }], // the Fruit header
  ['open', { bin: 0 }], // the Apple card
  [col(1, 1), { bin: 0 }], // Pear and Plum together
  'draw', // Blue
  'draw', // the Color header
  ['open', { bin: 1 }],
  ['open', { bin: 1 }],
  [col(0, 0), { bin: 1 }], // Red
]

test('a level starts with only the top of each column face up, empty bins and all its moves', () => {
  const game = start(ORCHARD)
  assert.deepEqual(game.cols.map((column) => column.map((card) => card.up)), [[false, true], [false, true], [false, true]])
  assert.deepEqual(texts(game.cols.map((column) => column[column.length - 1])), ['Fruit', 'Apple', 'Plum'])
  assert.deepEqual(game.cols[1][0], { id: 0, cat: 0, text: 'Pear', emoji: '🍐', head: false, up: false })
  assert.deepEqual(game.cols[1][1], { id: 7, cat: 1, text: 'Apple', emoji: '', head: true, up: true })
  assert.deepEqual(game.bins, [null, null, null])
  assert.equal(game.draw.every((card) => !card.up), true)
  assert.equal(game.left, 30)
  assert.equal(game.over, null)
})

test('a level that deals a card it does not have is an error', () => {
  assert.throws(() => start({ ...ORCHARD, draw: [3, 5, 9] }), /No card 9/)
})

test('drawing opens the next card and costs a move', () => {
  const game = play(start(ORCHARD), 'draw')
  assert.deepEqual(texts(game.open), ['Core'])
  assert.equal(game.open[0].up, true)
  assert.equal(game.draw.length, 2)
  assert.equal(game.left, 29)
})

test('an empty draw pile takes the open pile back in the same order, free', () => {
  const game = play(start(ORCHARD), 'draw', 'draw', 'draw', 'draw')
  assert.deepEqual(texts(game.draw), ['Core', 'Blue', 'Color'])
  assert.deepEqual(game.open, [])
  assert.equal(game.left, 27)
})

test('drawing with both piles empty is refused', () => {
  assert.equal(refusal(start({ ...ORCHARD, cols: [[4, 6, 3], [0, 7, 5], [2, 1, 8]], draw: [] }), 'draw'), 'empty')
})

test('a header opens an empty bin, and the card under it turns face up', () => {
  const game = play(start(ORCHARD), [col(0, 1), { bin: 0 }])
  assert.deepEqual(game.bins, [0, null, null])
  assert.deepEqual(game.cols[0].map((card) => [card.text, card.up]), [['Red', true]])
  assert.equal(game.left, 29)
  assert.equal(game.delivered, 0)
})

test('a card is delivered only to the bin open for its category', () => {
  const opened = play(start(ORCHARD), [col(0, 1), { bin: 0 }])
  assert.equal(refusal(start(ORCHARD), [col(2, 1), { bin: 0 }]), 'binEmpty')
  assert.equal(refusal(opened, [col(0, 0), { bin: 0 }]), 'binOther')
  assert.equal(refusal(opened, [col(1, 1), { bin: 0 }]), 'binTaken')
  const delivered = play(opened, [col(2, 1), { bin: 0 }])
  assert.deepEqual(delivered.got, [1, 0, 0])
  assert.equal(delivered.delivered, 1)
  assert.equal(score(delivered), 10)
})

test('cards stack only on their own category, and nothing goes on a header', () => {
  const game = start(ORCHARD)
  const opened = play(game, [col(0, 1), { bin: 0 }])
  assert.equal(refusal(game, [col(2, 1), { col: 0 }]), 'onHeader')
  assert.equal(refusal(opened, [col(2, 1), { col: 0 }]), 'stack')
  assert.equal(refusal(opened, [col(1, 1), { col: 0 }]), 'header')
  assert.equal(refusal(game, [col(0, 0), { col: 2 }]), 'closed')
  assert.equal(refusal(game, ['open', { col: 0 }]), 'empty')
  assert.equal(refusal(game, [col(2, 1), { col: 2 }]), 'same')
  assert.equal(refusal(game, [col(2, 1), { col: 7 }]), 'empty')
  assert.equal(refusal(game, [col(2, 1), { bin: 7 }]), 'empty')
})

test('a header on its own cards is delivered with them to an empty bin in one move', () => {
  const stacked = play(start(ORCHARD), [col(0, 1), { col: 2 }])
  assert.deepEqual(texts(stacked.cols[2]), ['Stem', 'Plum', 'Fruit'])
  assert.equal(runStart(stacked.cols[2], 2), 1)
  const delivered = play(stacked, [col(2, 2), { bin: 1 }])
  assert.deepEqual(delivered.bins, [null, 0, null])
  assert.deepEqual(delivered.got, [1, 0, 0])
  assert.deepEqual(delivered.cols[2].map((card) => [card.text, card.up]), [['Stem', true]])
  assert.equal(delivered.left, 28)
})

test('stacked cards of one category move as one block, whichever of them is taken', () => {
  const game = play(start(ORCHARD), ...APPLE_DONE.slice(0, 2))
  assert.deepEqual(texts(game.cols[1]), ['Pear', 'Plum'])
  assert.equal(runStart(game.cols[1], 1), 0)
  // A whole column moved to an empty one would change nothing.
  const emptied = play(game, [col(2, 0), { bin: 0 }])
  assert.deepEqual(emptied.cols[2], [])
  assert.equal(refusal(emptied, [col(1, 1), { col: 2 }]), 'same')
})

test('a complete category empties its bin and hands its name on as a card of the next category', () => {
  const game = play(start(ORCHARD), ...APPLE_DONE)
  assert.deepEqual(game.bins, [null, null, null])
  assert.deepEqual(game.got, [0, 2, 0])
  assert.deepEqual(game.open, [{ id: CHAIN_ID + 1, cat: 0, text: 'Apple', emoji: '🍎', head: false, up: true }])
})

test('the game is won when every category is complete, and moves left over add to the score', () => {
  const game = play(start(ORCHARD), ...WIN)
  assert.equal(game.over, 'won')
  assert.deepEqual(game.got, [3, 2, 2])
  assert.equal(game.left, 17)
  assert.equal(score(game), 7 * 10 + 17 * 5)
  assert.equal(refusal(game, 'draw'), 'over')
  assert.equal(refusal(game, [col(0, 0), { bin: 0 }]), 'over')
})

test('the game is lost when the moves run out', () => {
  const game = play(start({ ...ORCHARD, moves: 2 }), 'draw', 'draw')
  assert.equal(game.left, 0)
  assert.equal(game.over, 'moves')
  assert.equal(score(game), 0)
})

test('the last move can still win', () => {
  const game = play(start({ ...ORCHARD, moves: WIN.length }), ...WIN)
  assert.equal(game.left, 0)
  assert.equal(game.over, 'won')
})

test('the game is lost when nothing useful is left to do', () => {
  const before = play(start(DEAD_END), 'draw', ['open', { bin: 0 }], 'draw', ['open', { bin: 0 }], 'draw')
  assert.equal(before.over, null)
  assert.equal(hasUsefulMoves(before), true)
  // The B header onto its card: the only bin is still open for A, whose last card lies under them.
  const stuck = play(before, ['open', { col: 0 }])
  assert.equal(stuck.over, 'stuck')
  assert.equal(hasUsefulMoves(stuck), false)
})

test('every shipped level deals each of its cards once and can complete every category', () => {
  assert.equal(LEVELS.length, 20)
  LEVELS.forEach((level, index) => {
    const where = `level ${index + 1}`
    const ids = Array.from({ length: level.cards.length + level.cats.length }, (_, id) => id)
    assert.deepEqual([...level.cols.flat(), ...level.draw].sort((a, b) => a - b), ids, where)
    assert.equal(start(level).bins.length, level.cols.length)
    level.cats.forEach((category, cat) => {
      const own = level.cards.filter(([owner]) => owner === cat).length
      const handedOn = level.cats.filter((other) => other.chain === cat).length
      assert.equal(own + handedOn, category.need, `${where} ${category.name}`)
      assert.ok(category.name.trim(), `${where} has a category without a name`)
      assert.ok(category.chain === undefined || (category.chain !== cat && level.cats[category.chain]), `${where} ${category.name} chains nowhere`)
    })
    assert.ok(level.cards.every(([, word]) => word.trim()), `${where} has a card without a word`)
    assert.ok(level.moves > 0, where)
  })
})
