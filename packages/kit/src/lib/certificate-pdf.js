/*
 * A CERTIFICATE AS A PDF (openspec: courses) — one landscape A4 page, written directly: the PDF format's own Helvetica,
 * so there is no font to embed and no library to load for a page of five lines. Text is Latin-1 (WinAnsiEncoding,
 * which the standard fonts carry); a character outside it is written as "?" rather than breaking the file.
 *
 *   certificatePdf({ heading, line, name, completed, course, on, date, by, check, url }) → Uint8Array
 */
const W = 842, H = 595
/* Helvetica's widths, in thousandths of the size, for the characters that matter; anything else is the average */
const NARROW = { i: 222, l: 222, j: 222, I: 278, ' ': 278, '.': 278, ',': 278, f: 278, t: 278, r: 333, '-': 333 }
const WIDE = { m: 833, w: 722, M: 833, W: 944 }
const width = (s, size, bold) => [...s].reduce((n, c) => n + (NARROW[c] || WIDE[c] || (c === c.toUpperCase() && c !== c.toLowerCase() ? 667 : 556)) * (bold ? 1.05 : 1), 0) * size / 1000

const latin1 = (s) => [...String(s ?? '')].map((c) => (c.charCodeAt(0) < 256 ? c : '?')).join('')
const esc = (s) => latin1(s).replace(/[\\()]/g, (c) => '\\' + c)

export function certificatePdf({ heading = 'Certificate of completion', line = 'This certifies that', name = '', completed = 'completed', course = '', on = 'on', date = '', by = '', check = '', url = '' } = {}) {
  const ops = []
  const center = (text, y, size, bold = false, grey = 0) => {
    const t = latin1(text)
    ops.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${grey} g ${((W - width(t, size, bold)) / 2).toFixed(1)} ${y} Td (${esc(t)}) Tj ET`)
  }
  /* a double rule round the page */
  ops.push('0.75 w 0.2 G 36 36 770 523 re S 0.4 w 44 44 754 507 re S')
  center(heading.toUpperCase(), 470, 14, true, 0.35)
  center(line, 400, 15)
  center(name, 350, 34, true)
  center(`${completed}`, 300, 15)
  center(course, 258, 24, true)
  center(`${on} ${date}`, 214, 13, false, 0.3)
  /* who issued it, under a short rule */
  if (by) { ops.push('0.5 w 0.75 G 371 172 m 471 172 l S'); center(by.toUpperCase(), 150, 11, true, 0.35) }
  if (url) center(url, 96, 9, false, 0.45)
  if (check) center(check, 80, 9, false, 0.45)
  const stream = ops.join('\n')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>`,
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
  ]
  let out = '%PDF-1.4\n'
  const at = []
  objects.forEach((o, i) => { at.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n` })
  const xref = out.length
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + at.map((n) => String(n).padStart(10, '0') + ' 00000 n \n').join('')
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  /* every character is one byte (Latin-1), so the offsets above are byte offsets */
  return Uint8Array.from(out, (c) => c.charCodeAt(0))
}
