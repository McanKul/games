// The first level's lesson must be playable move for move on the level it was written for.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { draw, move, start, type Game } from './engine'
import { LESSON, LESSON_DONE, LESSON_LEVEL, sameAction, type LessonAction } from './lesson'
import { LEVELS } from './levels'

const take = (game: Game, action: LessonAction) => (action === 'draw' ? draw(game) : move(game, action.from, action.to))
const texts = (cards: { text: string }[]) => cards.map((card) => card.text)

test('every step of the lesson is a move the first level accepts', () => {
  let game = start(LEVELS[LESSON_LEVEL])
  for (const [index, step] of LESSON.entries()) {
    const result = take(game, step.action)
    assert.ok('game' in result, `step ${index + 1} was refused: ${'refused' in result ? result.refused : ''}`)
    assert.ok(step.say.trim(), `step ${index + 1} says nothing`)
    game = result.game
  }
  assert.equal(game.over, null)
  assert.ok(LESSON_DONE.trim())
})

test('the lesson shows what it talks about', () => {
  let game = start(LEVELS[LESSON_LEVEL])
  let done = 0
  /** Plays on until `steps` steps of the lesson have been taken. */
  const play = (steps: number) => {
    for (; done < steps; done += 1) {
      const result = take(game, LESSON[done].action)
      assert.ok('game' in result)
      game = result.game
    }
  }
  assert.deepEqual(texts(game.cols.map((column) => column[column.length - 1])), ['Kırmızı', 'Beyaz', 'Pantolon'])
  play(3)
  assert.deepEqual(texts(game.cols[0]), ['Mor', 'Beyaz', 'Kırmızı'])
  play(12)
  // The colours with their header on top, an empty bin waiting.
  assert.deepEqual(texts(game.cols[0]), ['Mor', 'Beyaz', 'Kırmızı', 'Sarı', 'Turuncu', 'Renk'])
  assert.deepEqual(game.bins, [null, null, null])
  play(13)
  assert.deepEqual(game.bins, [0, null, null])
  assert.equal(game.got[0], 5)
  play(15)
  assert.equal(game.got[0], 6)
})

test('the lesson waits for its own move and takes any card of the run', () => {
  const stack: LessonAction = { from: { col: 1, row: 3 }, to: { col: 0 } }
  assert.equal(sameAction(stack, { from: { col: 1, row: 4 }, to: { col: 0 } }), true)
  assert.equal(sameAction(stack, { from: { col: 1, row: 3 }, to: { col: 2 } }), false)
  assert.equal(sameAction(stack, { from: { col: 2, row: 3 }, to: { col: 0 } }), false)
  assert.equal(sameAction(stack, { from: 'open', to: { col: 0 } }), false)
  assert.equal(sameAction(stack, { from: { col: 1, row: 3 }, to: { bin: 0 } }), false)
  assert.equal(sameAction(stack, 'draw'), false)
  assert.equal(sameAction('draw', 'draw'), true)
  assert.equal(sameAction('draw', stack), false)
  const deliver: LessonAction = { from: 'open', to: { bin: 1 } }
  assert.equal(sameAction(deliver, { from: 'open', to: { bin: 1 } }), true)
  assert.equal(sameAction(deliver, { from: 'open', to: { bin: 0 } }), false)
  assert.equal(sameAction(deliver, { from: 'open', to: { col: 1 } }), false)
})
