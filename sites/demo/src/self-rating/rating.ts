/*
 * THE PRESS'S OWN LESSON KIND (platformkit.config.js courses.kinds): the reader rates how sure they are of what a section
 * taught, 0 to 100, and the section's bar shows the rating. Kept in the reader's browser, under the course and the lesson.
 */
type Lesson = { key: string, ref?: string | null }

const keyOf = (course: string, lesson: string) => `northlight:self-rating:${course}:${lesson}`

export function readRating(course: string, lesson: string): number | null {
  try {
    const v = localStorage.getItem(keyOf(course, lesson))
    return v == null ? null : Number(v)
  } catch { return null }
}

export function saveRating(course: string, lesson: string, value: number): void {
  try { localStorage.setItem(keyOf(course, lesson), String(value)) } catch { /* a browser that keeps nothing keeps no rating */ }
}

/* the section's measure: the rating, or nothing until the reader has given one */
export default function progress({ course, lesson }: { course: string, lesson: Lesson }): number | null {
  return readRating(course, lesson.key)
}
