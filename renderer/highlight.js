'use strict';

/*
 * A dependency-free syntax highlighter for fenced code blocks.
 *
 * Why hand-written instead of vendoring highlight.js: this repo has no build step and no runtime
 * dependency (docs/INSTALL.md), and highlight.js v11 ships no browser bundle - it would mean adding a
 * bundler to CI plus ~1 MB of vendored code for 190 languages a chat answer never uses. What the
 * transcript needs is the dozen languages a model answers in. An unknown fence info string is not an
 * error: the block is escaped and left uncoloured, so a new language costs a rule set, never a fix.
 *
 * Safety: every character of the input goes through esc() on the way out, so a `<script>` inside a code
 * block cannot survive as markup. test/highlight.test.js pins that first, before any colouring case.
 *
 * Rule lists are `{ re, cls }` objects, in priority order, compiled into ONE alternation per language.
 * Each rule is wrapped in a named group (`r0`, `r1`, ...) so a rule may contain its own groups without
 * shifting the bookkeeping.
 *
 * Loaded as a classic <script> before markdown.js (window.hlHighlight); the same file is requireable
 * from the unit tests.
 */

function esc(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const KW = 'hl-kw';
const STR = 'hl-str';
const COM = 'hl-com';
const NUM = 'hl-num';
const FN = 'hl-fn';
const TYPE = 'hl-type';
const VAR = 'hl-var';
const META = 'hl-meta';
const TAG = 'hl-tag';
const ATTR = 'hl-attr';
const LINK = 'hl-link';
const ADD = 'hl-add';
const REMOVE = 'hl-remove';

/** Keywords written as a space separated list become one alternation; keep the lists readable. */
function words(list) {
  return list.split(/\s+/).filter(Boolean).join('|');
}

function keyword(list) {
  return { re: new RegExp(`\\b(?:${words(list)})\\b`), cls: KW };
}

function builtin(list) {
  return { re: new RegExp(`\\b(?:${words(list)})\\b`), cls: TYPE };
}

const C_COMMENT = { re: /\/\/[^\n]*|\/\*[\s\S]*?\*\//, cls: COM };
const HASH_COMMENT = { re: /#[^\n]*/, cls: COM };
const QUOTED = { re: /"(?:\\[\s\S]|[^\\\n"])*"?|'(?:\\[\s\S]|[^\\\n'])*'?/, cls: STR };
const NUMBER = {
  re: /\b0[xX][\da-fA-F](?:_?[\da-fA-F])*n?\b|\b\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?n?\b/,
  cls: NUM,
};
const CALLED = { re: /\b[A-Za-z_$][\w$]*(?=\s*\()/, cls: FN };

const LANG_RULES = new Map();

/* ---- js and the whole ts family share one grammar: good enough for colouring a snippet ---- */

LANG_RULES.set('js', [
  C_COMMENT,
  { re: /`(?:\\[\s\S]|[^\\`])*`?/, cls: STR },
  QUOTED,
  NUMBER,
  keyword(
    'as async await break case catch class const continue debugger default delete do else export extends ' +
      'finally for from function get if implements import in instanceof interface let new of package private ' +
      'protected public readonly return set static super switch this throw try typeof var void while with yield ' +
      'null true false undefined NaN globalThis',
  ),
  builtin('console window document Math JSON Promise Array Object String Number Boolean Map Set Date RegExp require process module exports'),
  CALLED,
  { re: /[$#][\w$]+/, cls: VAR },
]);

LANG_RULES.set('json', [
  { re: /"[^"\n]*"(?=\s*:)/, cls: ATTR },
  { re: /"(?:\\.|[^\\"])*"/, cls: STR },
  NUMBER,
  keyword('true false null'),
]);

LANG_RULES.set('bash', [
  HASH_COMMENT,
  QUOTED,
  { re: /\$\{[^}\n]*\}|\$[\w?#@!-]+/, cls: VAR },
  NUMBER,
  keyword('if then else elif fi for in do done case esac while until function return exit local export readonly declare unset shift source set trap alias esac'),
  builtin('apt aria2c awk base64 basename brew cat cd chmod curl cut docker du find git grep head jq kubectl ls mkdir mv node npm npx ping ps python python3 rg sed sort ssh tail tar test touch tr wget which xargs yarn'),
  { re: /(?:^|[\s;&|(])(-{1,2}[A-Za-z][\w-]*)/, cls: META },
]);

LANG_RULES.set('powershell', [
  HASH_COMMENT,
  QUOTED,
  { re: /\$[\w:{}?()+.-]+/, cls: VAR },
  NUMBER,
  keyword('begin break class continue default do else elseif end enum finally for foreach from function if in param process return switch throw try until using var while workflow'),
  // the approved Verb-Noun form is the one thing that identifies PowerShell, and it is a name, not a keyword
  { re: /\b(?:Add|Clear|Close|Copy|Get|New|Remove|Rename|Select|Set|Test|Write)-[A-Za-z][\w-]*\b/, cls: FN },
]);

LANG_RULES.set('py', [
  HASH_COMMENT,
  { re: /[rbuf]{0,3}"""[\s\S]*?"""|[rbuf]{0,3}'''[\s\S]*?'''/, cls: STR },
  { re: /[rbuf]{0,3}"(?:\\[\s\S]|[^\\"])*"?|[rbuf]{0,3}'(?:\\[\s\S]|[^\\'])*'?/, cls: STR },
  NUMBER,
  keyword(
    'and as assert async await break class continue def del elif else except finally for from global if import ' +
      'in is lambda match case nonlocal not or pass raise return try while with yield None True False self cls',
  ),
  builtin('abs dict enumerate float format frozenset int len list map max min open print range reversed set sorted str sum tuple type zip getattr hasattr isinstance setattr super'),
  { re: /@[A-Za-z_][\w.]*/, cls: META },
  CALLED,
]);

/** The C family, one template with its keyword and type lists per language. */
function cFamily(keywordList, typeList, extra) {
  return [
    C_COMMENT,
    { re: /^ {0,3}#[A-Za-z_][\w]*(?:[^\n]*)?/, cls: META },
    QUOTED,
    { re: /'(?:\\[\s\S]|[^\\'\n])'/, cls: STR },
    NUMBER,
    keyword(keywordList),
    builtin(typeList),
    { re: /@[A-Za-z_][\w.]*/, cls: META },
    CALLED,
  ].concat(extra || []);
}

LANG_RULES.set(
  'c',
  cFamily(
    'auto break case const continue default do else enum extern for goto if inline register return sizeof static struct switch typedef union volatile while _Bool _Complex',
    'bool char double float int long short signed unsigned void size_t ssize_t int8_t int16_t int32_t int64_t uint8_t uint16_t uint32_t uint64_t NULL true false',
  ),
);
LANG_RULES.set(
  'cpp',
  cFamily(
    'alignas alignof and asm break case catch class constexpr const const_cast continue default delete do dynamic_cast else explicit export extern for friend goto if inline mutable namespace new noexcept not operator or override private protected public reinterpret_cast return sizeof static static_cast struct switch template this throw try typedef typeid typename union using virtual volatile while nullptr true false NULL',
    'bool char double float int long short signed unsigned void auto size_t string vector map set pair unique_ptr shared_ptr',
  ),
);
LANG_RULES.set(
  'csharp',
  cFamily(
    'abstract as async await base break case catch checked class const continue default delegate do else enum event explicit extern finally for foreach from get if implicit in interface internal is lock namespace new operator out override params private protected public readonly ref return sealed set sizeof stackalloc static struct switch this throw try typeof unchecked unsafe using var virtual volatile while yield null true false',
    'bool byte char decimal double dynamic float int long object sbyte short string uint ulong ushort void record',
  ),
);
LANG_RULES.set(
  'java',
  cFamily(
    'abstract assert break case catch class const continue default do else enum extends final finally for if implements import instanceof interface native new package private protected public record sealed return static strictfp super switch synchronized this throw throws transient try var volatile while permits null true false',
    'boolean byte char double float int long short void String Integer Object List Map Set Optional',
  ),
);
LANG_RULES.set(
  'go',
  cFamily(
    'break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var nil true false',
    'bool byte complex64 complex128 error float32 float64 int int8 int16 int32 int64 rune string uint uint8 uint16 uint32 uint64 uintptr any make new len cap append copy',
  ),
);
LANG_RULES.set(
  'rust',
  cFamily(
    'as async await break const continue crate dyn else enum extern fn for if impl in let loop match mod move mut pub ref return self Self static struct trait type unsafe use where while true false Some None Ok Err',
    'bool char f32 f64 i8 i16 i32 i64 i128 isize str u8 u16 u32 u64 u128 usize String Vec Option Result Box HashMap',
  ),
  [{ re: /\b[A-Za-z_]\w*!(?=\s*\()/, cls: FN }],
);

LANG_RULES.set('sql', [
  { re: /--[^\n]*|\/\*[\s\S]*?\*\//, cls: COM },
  QUOTED,
  { re: new RegExp(`\\b(?:${words('select from where join left right inner outer full cross natural on group by having order limit offset insert into values update set delete create alter drop rename index view as and or not null is in like between exists union all distinct case when then else end primary key foreign references default constraint begin commit rollback with returning count sum avg min max coalesce cast asc desc')})\\b`, 'i'), cls: KW },
  NUMBER,
  { re: /\b[a-z_]\w*(?=\s*\()/i, cls: FN },
]);

LANG_RULES.set('yaml', [
  HASH_COMMENT,
  { re: /^[ \t]*[\w.$-]+(?=[ \t]*:)/m, cls: ATTR },
  QUOTED,
  NUMBER,
  keyword('true false null yes no on off'),
  { re: /^[ \t]*-(?=[ \t]|$)/m, cls: LINK },
  { re: /[&*][\w-]+|![\w-]+/, cls: META },
]);

LANG_RULES.set('ini', [
  { re: /[;#][^\n]*/, cls: COM },
  { re: /^[ \t]*\[[^\]\n]+\]/m, cls: TAG },
  { re: /^[ \t]*[\w.-]+(?=[ \t]*=)/m, cls: ATTR },
  QUOTED,
  NUMBER,
]);

LANG_RULES.set('css', [
  { re: /\/\*[\s\S]*?\*\//, cls: COM },
  { re: /@[\w-]+/, cls: META },
  QUOTED,
  { re: /[.#][\w-]+|::?[\w-]+/, cls: TAG },
  { re: /[\w-]+(?=\s*:)/, cls: ATTR },
  { re: /\b\d+(?:\.\d+)?(?:px|em|rem|%|vh|vw|s|ms|deg|fr)?\b/, cls: NUM },
]);

LANG_RULES.set('html', [
  { re: /<!--[\s\S]*?-->/, cls: COM },
  { re: /<![\w\s"']*?>/, cls: META },
  { re: /<\/?[A-Za-z][\w:-]*/, cls: TAG },
  { re: /\/?>/, cls: TAG },
  QUOTED,
  { re: /[A-Za-z_:][\w:.-]*(?==)/, cls: ATTR },
]);

LANG_RULES.set('diff', [
  { re: /^@@[^\n]*/, cls: META },
  { re: /^\+[^\n]*/, cls: ADD },
  { re: /^-[^\n]*/, cls: REMOVE },
  { re: /^(?:diff|index|---|\+\+\+)[^\n]*/, cls: ATTR },
]);

// mermaid is not drawn in the transcript, but its source is read often enough to colour the keywords and
// the arrows, which is what makes a diagram readable as text
LANG_RULES.set('mermaid', [
  { re: /%%[^\n]*/, cls: COM },
  keyword(
    'graph flowchart sequenceDiagram classDiagram stateDiagram erDiagram gantt pie journey mindmap timeline ' +
      'subgraph end class state note linkStyle style click participant actor title as direction',
  ),
  { re: /-->?>|==+>|-\.->|<-->|--+|-{1,2}\|[^|\n]*\|/, cls: LINK },
  QUOTED,
  { re: /[{}[\]()]/, cls: TAG },
]);

/** Fence info strings that mean "no colour": plain text, captured terminal output, logs. */
const PLAIN = new Set(['', 'text', 'txt', 'plain', 'plaintext', 'output', 'log', 'logs', 'console', 'raw']);

const ALIASES = {
  javascript: 'js',
  jsx: 'js',
  mjs: 'js',
  cjs: 'js',
  node: 'js',
  typescript: 'js',
  ts: 'js',
  tsx: 'js',
  jsonc: 'json',
  json5: 'json',
  sh: 'bash',
  shell: 'bash',
  shellsession: 'bash',
  'shell-session': 'bash',
  'c++': 'cpp',
  'c#': 'csharp',
  golang: 'go',
  zsh: 'bash',
  bat: 'powershell',
  batch: 'powershell',
  cmd: 'powershell',
  ps1: 'powershell',
  ps: 'powershell',
  pwsh: 'powershell',
  python: 'py',
  py3: 'py',
  h: 'c',
  hpp: 'cpp',
  hh: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  cs: 'csharp',
  kt: 'java',
  kotlin: 'java',
  scala: 'java',
  rs: 'rust',
  postgres: 'sql',
  postgresql: 'sql',
  sqlite: 'sql',
  mysql: 'sql',
  mariadb: 'sql',
  tsql: 'sql',
  plsql: 'sql',
  yml: 'yaml',
  toml: 'ini',
  conf: 'ini',
  cfg: 'ini',
  properties: 'ini',
  env: 'ini',
  gitignore: 'ini',
  udiff: 'diff',
  patch: 'diff',
  mmd: 'mermaid',
  xml: 'html',
  svg: 'html',
  vue: 'html',
  scss: 'css',
  sass: 'css',
  less: 'css',
};

const compiled = new Map();

/** Compile one language's rules into a single alternation of named groups, once per language. */
function compile(name) {
  const rules = LANG_RULES.get(name);
  if (!rules) return null;
  const parts = [];
  const classes = [];
  let flags = 'gm';
  rules.forEach((rule, index) => {
    parts.push(`(?<r${index}>${rule.re.source})`);
    classes.push(rule.cls);
    // a rule that ignores case (SQL keywords) asks for the flag; it becomes the language's flag, which
    // is what SQL wants anyway, and the flag set stays inside this language's one cached regex
    for (const flag of rule.re.flags) {
      if ('imsu'.includes(flag) && !flags.includes(flag)) flags += flag;
    }
  });
  const regex = new RegExp(parts.join('|'), flags);
  return { regex, classes, names: classes.map((_c, index) => `r${index}`) };
}

function languageOf(lang) {
  const wanted = String(lang == null ? '' : lang).toLowerCase().trim();
  if (!wanted || PLAIN.has(wanted)) return null;
  if (ALIASES[wanted]) return ALIASES[wanted];
  return LANG_RULES.has(wanted) ? wanted : null;
}

/**
 * Escaped HTML with `<span class="hl-*">` around tokens. An unknown language escapes and colours
 * nothing, which is the safe failure: the transcript still shows the code.
 */
function highlightCode(code, lang) {
  const text = code == null ? '' : String(code);
  const name = languageOf(lang);
  if (!name) return esc(text);
  let spec = compiled.get(name);
  if (spec === undefined) {
    spec = compile(name);
    compiled.set(name, spec);
  }
  if (!spec) return esc(text);
  spec.regex.lastIndex = 0;
  let out = '';
  let cursor = 0;
  let match;
  while ((match = spec.regex.exec(text))) {
    if (!match[0]) {
      spec.regex.lastIndex++; // a rule that can match empty must not stall the scan
      continue;
    }
    if (match.index > cursor) out += esc(text.slice(cursor, match.index));
    let cls = '';
    const groups = match.groups;
    if (groups) {
      for (const key of spec.names) {
        if (groups[key] !== undefined) {
          cls = spec.classes[Number(key.slice(1))];
          break;
        }
      }
    }
    out += cls ? `<span class="${cls}">${esc(match[0])}</span>` : esc(match[0]);
    cursor = match.index + match[0].length;
  }
  return out + esc(text.slice(cursor));
}

if (typeof window !== 'undefined') {
  window.hlHighlight = highlightCode;
  window.hlLanguageOf = languageOf;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { highlightCode, languageOf };
}
