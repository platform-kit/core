/*
 * THE MODULES THE KIT IMPORTS THAT CARRY NO TYPES, declared as any until one is written (openspec: typescript-throughout).
 * A module that ships no types is named here, one line each; a module that has types is never.
 */
declare module 'pg'
declare module 'picomatch'
declare module 'validator'
declare module 'nunjucks'
declare module 'validatorjs'
declare module 'validatorjs/src/lang/en.js'
declare module '@calcom/sdk'
/* optional: the ffmpeg binary npm ships, when the machine has none — its path, or null on a platform it has no build for */
declare module 'ffmpeg-static' { const path: string | null; export default path }
/* optional: ONNX Runtime's native build, when the machine sets the spoken books itself — the same API as the
   common package the web build shares */
declare module 'onnxruntime-node' { export * from 'onnxruntime-common' }
/* optional: Typst's native compiler, when the machine sets the printed books — only what build/print/typeset uses */
declare module '@myriaddreamin/typst-ts-node-compiler' {
  interface CompileResult { hasError(): boolean, printErrors(): void, result: unknown }
  interface CompileArgs { mainFilePath: string }
  export class NodeCompiler {
    static create(opts: { workspace: string, fontArgs?: Array<{ fontPaths: string[] }> }): NodeCompiler
    compile(args: CompileArgs): CompileResult
    pdf(args: CompileArgs): Uint8Array
    svg(args: CompileArgs): string
    query(doc: unknown, args: { selector: string }): unknown
  }
}
/* StPageFlip ships its TypeScript source without a types entry: what the print preview uses of it */
declare module 'page-flip' {
  export class PageFlip {
    constructor(el: HTMLElement, settings: Record<string, unknown>)
    loadFromHTML(items: NodeListOf<HTMLElement> | HTMLElement[]): void
    on(event: string, callback: (e: { data: any, object: PageFlip }) => void): PageFlip
    flipNext(corner?: 'top' | 'bottom'): void
    flipPrev(corner?: 'top' | 'bottom'): void
    turnToPage(page: number): void
    destroy(): void
  }
}
/* MJML's browser build has no types: the call the email editor makes of it */
declare module 'mjml-browser' {
  const mjml: (source: string, options?: Record<string, unknown>) => { html: string, errors: unknown[] }
  export default mjml
}
