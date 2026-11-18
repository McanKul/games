// Solitword Mini, a solo game: the screen plays a level and reports its score. One level is one round.
import { connect } from '@kampuse/games-kit'
import { POINTS_PER_CARD, POINTS_PER_MOVE_LEFT, draw, move, score, start, type Game, type Refusal, type Step } from './engine'
import { LESSON, LESSON_DONE, LESSON_LEVEL, sameAction, type LessonAction } from './lesson'
import { LEVELS } from './levels'
import { closeSheet, sheetOpen, showHome, showHow, showLevels, showMenu, showResult } from './sheets'
import { createTable } from './table'
import { TEXT } from './text'

/** The first levels are small tables; the rest are large ones. */
const SMALL_LEVELS = 10
/** How long the last move stays on the table before the result covers it. */
const RESULT_DELAY_MS = 750
const TOAST_MS = 2600
const FONT_WAIT_MS = 1500
const SPLASH_MIN_MS = 1200
/** How long the lesson's last words stay once it is over. */
const LESSON_DONE_MS = 6000

/** Plays a CSS animation that hangs on a class again from its start. */
const replay = (node: HTMLElement, className: string): void => {
  node.classList.remove(className)
  void node.offsetWidth
  node.classList.add(className)
}

const need = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id)
  if (!node) throw new Error(`The page has no #${id}.`)
  return node as T
}

/** The card font, so words are measured in it; the game starts without it if it is slow. */
const fontReady = (): Promise<unknown> =>
  Promise.race([document.fonts.load('800 16px Nunito'), new Promise((resolve) => window.setTimeout(resolve, FONT_WAIT_MS))]).catch(() => undefined)

/** Takes the splash (the game's name, shown while it loads) away. */
const unveil = (): void => need('splash').classList.add('gone')

/** Says something in place of the table (the game could not start). */
const instead = (message: string): void => {
  const table = need('table')
  table.textContent = message
  table.classList.add('table-message')
  unveil()
}

async function main(): Promise<void> {
  // Opened on its own, there is no Kampüse to talk to.
  if (window.parent === window) {
    instead(TEXT.outside)
    return
  }
  // The splash stays long enough to be read, however fast the game loads.
  const shown = new Promise((resolve) => window.setTimeout(resolve, SPLASH_MIN_MS))
  const kampuse = await connect('solitword')
  await Promise.all([fontReady(), shown])

  const titleEl = need('level-title')
  const scoreEl = need('score')
  const toastEl = need('toast')
  /** Best score of each level won since the game was opened (nothing is kept between visits). */
  const best = new Map<number, number>()
  let index = 0
  let game: Game | null = null
  let toastTimer = 0
  let resultTimer = 0
  /** The level has ended and its result is about to cover the table. */
  let resultPending = false

  const coachEl = need('coach')
  const coachText = need('coach-text')
  const coachStep = need('coach-step')
  /** The lesson step the player is on while the first level teaches; null when nothing is being taught. */
  let lesson: number | null = null
  /** The lesson was finished or skipped since the game was opened: it does not come back. */
  let taught = false
  let coachTimer = 0

  /** Shows the lesson's current step: its words, and its move pointed out on the table. */
  function teach(): void {
    window.clearTimeout(coachTimer)
    coachEl.classList.remove('done')
    const step = lesson === null ? undefined : LESSON[lesson]
    if (lesson === null || !step) {
      coachEl.hidden = true
      table.point(null)
      return
    }
    coachText.textContent = step.say
    coachStep.textContent = TEXT.lessonStep(lesson + 1, LESSON.length)
    coachEl.hidden = false
    replay(coachEl, 'fresh')
    table.point(step.action === 'draw' ? { from: 'draw' } : step.action)
  }

  /** While the lesson runs only its own move is taken; anything else nudges the lesson's words instead. */
  function inLesson(asked: LessonAction): boolean {
    if (lesson === null || sameAction(LESSON[lesson].action, asked)) return true
    replay(coachEl, 'nudge')
    return false
  }

  /** Ends the lesson for this visit: finished (its last words stay a moment) or skipped. */
  function endLesson(finished: boolean): void {
    lesson = null
    taught = true
    teach()
    if (!finished) return
    coachText.textContent = LESSON_DONE
    coachEl.classList.add('done')
    coachEl.hidden = false
    coachTimer = window.setTimeout(() => {
      coachEl.hidden = true
    }, LESSON_DONE_MS)
  }

  const say = (message: string): void => {
    toastEl.textContent = message
    toastEl.classList.add('shown')
    window.clearTimeout(toastTimer)
    toastTimer = window.setTimeout(() => toastEl.classList.remove('shown'), TOAST_MS)
  }

  const report = (final = false): void => {
    const points = game ? score(game) : 0
    scoreEl.textContent = String(points)
    kampuse.score(points, final)
  }

  const levels = (back?: () => void): void =>
    showLevels({ count: LEVELS.length, current: index, best, small: SMALL_LEVELS }, { pick: play, back })

  function finish(ended: Game): void {
    const ending = ended.over
    if (!ending) return
    const total = score(ended)
    if (ending === 'won') best.set(index, Math.max(total, best.get(index) ?? 0))
    const last = index === LEVELS.length - 1
    resultPending = true
    resultTimer = window.setTimeout(() => {
      resultPending = false
      showResult(
        { ending, delivered: ended.delivered, left: ended.left, cardPoints: POINTS_PER_CARD, movePoints: POINTS_PER_MOVE_LEFT, total, last },
        { next: () => play(index + 1), retry: () => play(index), levels: () => levels() },
      )
    }, RESULT_DELAY_MS)
  }

  /** Takes a step of the game: shows it and reports the score, or says why it was refused. */
  function take(step: Step, bin?: number): Refusal | null {
    if ('refused' in step) return step.refused
    game = step.game
    table.show(game, { bin })
    if (lesson !== null) {
      lesson += 1
      if (lesson < LESSON.length) teach()
      else endLesson(true)
    }
    report(Boolean(game.over))
    finish(game)
    return null
  }

  const table = createTable(need('table'), {
    draw: () => (game && inLesson('draw') ? take(draw(game)) : 'over'),
    move: (from, to) => (game && inLesson({ from, to }) ? take(move(game, from, to), 'bin' in to ? to.bin : undefined) : 'over'),
    say,
  })

  /** Starts a level. A level left unfinished ends its round with the score it had. */
  function play(level: number): void {
    window.clearTimeout(resultTimer)
    resultPending = false
    if (game && !game.over) report(true)
    index = Math.min(Math.max(level, 0), LEVELS.length - 1)
    game = start(LEVELS[index])
    titleEl.textContent = TEXT.level(index + 1)
    closeSheet()
    table.show(game, { dealt: true })
    // The first level teaches the game, once a visit.
    lesson = index === LESSON_LEVEL && !taught ? 0 : null
    teach()
    report()
  }

  const menu = (): void => {
    if (resultPending) return
    if (!game || game.over) {
      levels()
      return
    }
    showMenu({ resume: closeSheet, restart: () => play(index), levels: () => levels(menu), how: () => showHow({ back: menu }) })
  }

  need('menu-button').addEventListener('click', menu)
  need('coach-skip').addEventListener('click', () => endLesson(false))
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && sheetOpen() && game && !game.over) closeSheet()
  })

  // Words measured before the card font arrived were measured in another face.
  void document.fonts.ready.then(() => table.refit())
  showHome({ play: () => play(0), levels: () => levels() })
  unveil()
}

main().catch((error: unknown) => {
  // Kampüse did not answer, or the game broke while starting: say so instead of an empty table.
  instead(TEXT.failed)
  throw error
})
