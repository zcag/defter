import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const src = resolve(here, '../src/styles.css')
const dest = resolve(here, '../dist/styles.css')
mkdirSync(dirname(dest), { recursive: true })
copyFileSync(src, dest)
console.log('copied styles.css → dist/')
