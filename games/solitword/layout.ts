// Where everything sits on the table, in pixels, for a game and a table size. Pure: the screen only applies it.
//
//   row 1   moves ........ open pile, draw pile
//   row 2   one bin above each column
//   row 3   the columns, fanned downwards

import type { Game } from './engine'

export type Box = { x: number; y: number; w: number; h: number }

export type Place = {
  x: number
  y: number
  z: number
  /** Another card lies on it: only its top strip shows. */
  covered: boolean
  /** Deep in a pile: not drawn at all. */
  hidden: boolean
}

export type Layout = {
  cardW: number
  cardH: number
  hud: Box
  open: Box
  draw: Box
  bins: Box[]
  /** Where a card may be dropped for each column: the column and everything under it. */
  cols: Box[]
  /** Every card of the game, by id. */
  places: Map<number, Place>
}

const PAD = 10
const GAP = 8
const CARD_RATIO = 1.36
const MAX_CARD_W = 116
const MIN_CARD_W = 44
const BIN_RATIO = 0.62
/** Room kept under a column's first card for its fan, when the table is short. */
const MIN_FAN = 150
const DOWN_STEP = 9
const UP_STEP = 27
const MIN_DOWN_STEP = 4
const MIN_UP_STEP = 17
/** Cards drawn at the top of a pile; the rest lie hidden under them. */
const SHOWN_IN_PILE = 3

/** How far each card of a column sits below the one under it, squeezed so the column fits in `room`. */
function steps(down: number, up: number, room: number): { down: number; up: number } {
  const covered = Math.max(0, up - 1)
  // With no face-up card the last face-down one is the top and takes no step.
  const below = up > 0 ? down : Math.max(0, down - 1)
  let upStep = UP_STEP
  let downStep = DOWN_STEP
  if (below * downStep + covered * upStep > room && covered > 0) upStep = Math.max(MIN_UP_STEP, (room - below * downStep) / covered)
  if (below * downStep + covered * upStep > room && below > 0) downStep = Math.max(MIN_DOWN_STEP, (room - covered * upStep) / below)
  return { down: downStep, up: upStep }
}

export function layout(game: Game, width: number, height: number): Layout {
  const n = game.cols.length
  const byWidth = (width - 2 * PAD - (n - 1) * GAP) / n
  const byHeight = (height - 2 * PAD - 2 * GAP - MIN_FAN) / (2 + BIN_RATIO) / CARD_RATIO
  const cardW = Math.floor(Math.max(MIN_CARD_W, Math.min(MAX_CARD_W, byWidth, byHeight)))
  const cardH = Math.round(cardW * CARD_RATIO)
  const binH = Math.round(cardH * BIN_RATIO)
  const left = Math.round((width - (n * cardW + (n - 1) * GAP)) / 2)
  const colX = (col: number) => left + col * (cardW + GAP)
  const stockY = PAD
  const binY = stockY + cardH + GAP
  const tableY = binY + binH + GAP
  const room = Math.max(0, height - PAD - tableY - cardH)

  const draw: Box = { x: colX(n - 1), y: stockY, w: cardW, h: cardH }
  const open: Box = { x: colX(n - 2), y: stockY, w: cardW, h: cardH }
  const hud: Box = { x: colX(0), y: stockY, w: Math.max(cardW, open.x - GAP - colX(0)), h: cardH }
  const places = new Map<number, Place>()

  game.draw.forEach((card, index) => {
    places.set(card.id, { x: draw.x, y: draw.y, z: 1 + game.draw.length - index, covered: index > 0, hidden: index >= SHOWN_IN_PILE })
  })
  game.open.forEach((card, index) => {
    const fromTop = game.open.length - 1 - index
    places.set(card.id, { x: open.x, y: open.y, z: 100 + index, covered: fromTop > 0, hidden: fromTop >= SHOWN_IN_PILE })
  })
  game.cols.forEach((column, col) => {
    const up = column.filter((card) => card.up).length
    const step = steps(column.length - up, up, room)
    let y = tableY
    column.forEach((card, row) => {
      places.set(card.id, { x: colX(col), y: Math.round(y), z: 200 + row, covered: row < column.length - 1, hidden: false })
      y += card.up ? step.up : step.down
    })
  })

  return {
    cardW,
    cardH,
    hud,
    open,
    draw,
    bins: game.cols.map((_, col) => ({ x: colX(col), y: binY, w: cardW, h: binH })),
    cols: game.cols.map((_, col) => ({ x: colX(col) - GAP / 2, y: tableY, w: cardW + GAP, h: Math.max(cardH, height - tableY) })),
    places,
  }
}

/** Whether a point lies in a box. */
export const inside = (box: Box, x: number, y: number): boolean => x >= box.x && x < box.x + box.w && y >= box.y && y < box.y + box.h
