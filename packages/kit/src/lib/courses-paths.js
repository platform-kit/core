/*
 * WHERE A COURSE ADDRESS GOES (openspec: courses). Pure, so the router and its test read the same rule: the app area
 * once carried the reader's courses at /app/courses, and that address — and anything under it — is the library at
 * /courses now. The router asks this before any community place's claim on /app, so a site whose own place claims the
 * app area still sends /app/courses to the library.
 */
export function libraryOf(p, app = '/app', courses = '/courses') {
  const at = app + '/courses'
  return p === at || p.startsWith(at + '/') ? courses + p.slice(at.length) : null
}
