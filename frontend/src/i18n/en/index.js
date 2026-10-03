// The English dictionary, merged from the chunk files in this folder. Loaded
// only for English (i18n/boot.js), as its own lazy chunk.
//   <chunk>.json           { "<Indonesian>": "<English>" }
//   <chunk>.patterns.json  { "<Indonesian with $1…>": "<English with $1 / $t1…>" }
//   <chunk>.same.json      [ "<string identical in both languages>" ]
//   patterns.js            hand-written ordered patterns (generic shapes)
//   contexts.js            words with a second meaning in one place
//   runtime.json           hand-written entries for text assembled at run time
import globalSame from '../same.json';
import contexts from './contexts.js';
import patterns, { finish } from './patterns.js';

const files = import.meta.glob('./*.json', { eager: true, import: 'default' });

const exact = {};
const templates = {};
const same = [...globalSame];
for (const [path, content] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
  if (path.endsWith('.same.json')) same.push(...content);
  else if (path.endsWith('.patterns.json')) Object.assign(templates, content);
  else Object.assign(exact, content);
}

export { exact, templates, patterns, same, finish, contexts };
