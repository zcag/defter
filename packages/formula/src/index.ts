import { FUNCTIONS } from './functions.js'

export { createEngine, type EngineOptions } from './engine.js'
export { parseFormula, type Node } from './parser.js'
export { lex } from './lexer.js'
export { FUNCTIONS } from './functions.js'

/** Sorted list of built-in function names, for autocomplete/tooling. */
export const FUNCTION_NAMES: string[] = Object.keys(FUNCTIONS).sort()

