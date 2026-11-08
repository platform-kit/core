/*
 * THE MODULES THE KIT IMPORTS THAT CARRY NO TYPES, declared as any until one is written (openspec: typescript-throughout).
 * build/ts-migrate.mjs adds a line when a converted file imports one.
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
