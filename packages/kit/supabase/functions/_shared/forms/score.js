/*
 * A quiz's grade — plain JavaScript shared by the runner (the end slide), the build and the `form`
 * function (the response row), so a score means one thing everywhere. The right answers are the
 * form's `#! score = field: answer, …` setting (a choice allowing several is `field: a | b`); an
 * answer is right when it reads the same, case and surrounding space aside; a list of values is
 * right when it is the same set.
 */
const norm = (v) => String(v == null ? '' : v).trim().toLowerCase()
const setOf = (v) => (Array.isArray(v) ? v : String(v == null ? '' : v).split('|')).map(norm).filter(Boolean).sort()

export function isRight(want, got) {
  if (Array.isArray(got) || String(want).includes('|')) { const a = setOf(want), b = setOf(got); return a.length === b.length && a.every((x, i) => x === b[i]) }
  return norm(want) === norm(got)
}

/* { score, total, passed } — passed is null when the form sets no pass mark */
export function grade(score, answers, pass) {
  const names = Object.keys(score || {})
  const total = names.length
  const right = names.filter((n) => isRight(score[n], (answers || {})[n])).length
  return { score: right, total, passed: pass == null ? null : right >= pass }
}
