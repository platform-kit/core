/*
 * Inline markdown for the landing sections' copy: a page's markdown may say
 * **bold**, *emphasis*, `code` or [a link](/app) in any string, and every
 * section renders it rather than showing the marks. Inline only — a heading
 * or a line never becomes a paragraph. The pages are our own content, so the
 * HTML is trusted. `mdBlock` is the block form, for a section whose field is
 * a passage (the Prose section, an FAQ's answer, a timeline's entry).
 */
import { marked } from 'marked'
/* ^^word^^ is gradient text — the look's accent running to its light — on top of marked's own marks */
const grad = (h) => h.replace(/\^\^([^^]+)\^\^/g, '<span class="lpgrad">$1</span>')
export const md = (s) => (s == null ? '' : grad(marked.parseInline(String(s))))
export const mdBlock = (s) => (s == null ? '' : grad(marked.parse(String(s))))
