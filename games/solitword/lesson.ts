// The lesson of the first level: its opening moves, each with what it teaches. They are the start of that level's
// known winning game, so wherever the lesson ends (or is skipped) the table can still be won.
import type { From, To } from './engine'

export type LessonAction = 'draw' | { from: From; to: To }
export type LessonStep = { action: LessonAction; say: string }

/** The level the lesson belongs to. */
export const LESSON_LEVEL = 0

const from = (col: number, row: number): From => ({ col, row })

export const LESSON: LessonStep[] = [
  { action: { from: from(0, 2), to: { col: 1 } }, say: 'Kartlar kategorisini söylemez, sen bulursun. Kırmızı ile Beyaz ikisi de renk: Kırmızı’ya, sonra Beyaz’a dokun.' },
  { action: { from: from(0, 1), to: { col: 2 } }, say: 'Aynı kategorinin kartları üst üste dizilir. Elbise’yi Pantolon’un üstüne koy.' },
  { action: { from: from(1, 3), to: { col: 0 } }, say: 'Dizdiğin kartlar birlikte taşınır. Beyaz’a, sonra Mor’a dokun.' },
  { action: 'draw', say: 'Dizilecek kart kalmadı. Desteye dokunup kart aç: her açış bir hamle.' },
  { action: { from: 'open', to: { col: 0 } }, say: 'Sarı da bir renk. Renklerin üstüne koy.' },
  { action: 'draw', say: 'Bir kart daha aç.' },
  { action: { from: 'open', to: { col: 0 } }, say: 'Turuncu da renklerin üstüne.' },
  { action: 'draw', say: 'Yeni bir kart aç.' },
  { action: 'draw', say: 'Üzüm’ün yeri henüz yok, açık kalsın. Bir kart daha aç.' },
  { action: { from: 'open', to: { col: 2 } }, say: 'Mont bir giysi: Elbise’nin üstüne koy.' },
  { action: 'draw', say: 'Bir kart daha aç.' },
  { action: { from: 'open', to: { col: 0 } }, say: 'Bu bir kategori kartı. Kendi kartlarının en üstüne koy.' },
  { action: { from: from(0, 0), to: { bin: 0 } }, say: 'Kategori kartı hazneyi açar. Renk’e, sonra boş hazneye dokun: hepsi birden gider.' },
  { action: { from: from(1, 2), to: { col: 0 } }, say: 'Hazne artık Renk’in. Baş’ı boş sütuna taşı: altındaki kart açılsın.' },
  { action: { from: from(1, 1), to: { bin: 0 } }, say: 'Mavi bir renk: Renk haznesine gönder.' },
]

export const LESSON_DONE = 'Hazırsın! Kalan kartları sen diz: hamlen bitmeden bütün kategorileri tamamla.'

/** Whether the player asked for the move the lesson is waiting for. Any card of the same column's run counts. */
export function sameAction(expected: LessonAction, asked: LessonAction): boolean {
  if (expected === 'draw' || asked === 'draw') return expected === asked
  const source = expected.from === 'open' || asked.from === 'open' ? expected.from === asked.from : expected.from.col === asked.from.col
  const target = 'bin' in expected.to ? 'bin' in asked.to && asked.to.bin === expected.to.bin : 'col' in asked.to && asked.to.col === expected.to.col
  return source && target
}
