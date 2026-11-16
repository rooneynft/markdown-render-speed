// A fast, dependency-free drop-in for marked 18.1.3 (default options, GFM on).
// parse(markdown) returns exactly the HTML marked renders, byte for byte.
// Written from the published CommonMark 0.31.2 / GFM 0.29 behaviour and the
// observable output of marked 18.1.3; it is an independent implementation
// that mirrors marked's tokeniser decisions (same block/inline grammars and
// the same renderer output) without reusing its code.
//
// Speed strategy: no token objects are built for inline content. Block
// parsing produces a small tree of block nodes holding raw text; inline
// parsing renders straight to strings. Delimiter scans are cached per
// inline source, code-point helpers avoid array spreads, and the common
// plain-text inline case short-circuits before any regex work.

export function parse(markdown) {
  return renderDoc(markdown);
}

// ---------------------------------------------------------------- helpers

function c(a, e = '') {
  let t = typeof a === 'string' ? a : a.source;
  const n = {
    replace(s, r) {
      let o = typeof r === 'string' ? r : r.source;
      o = o.replace(T.caret, '$1');
      t = t.replace(s, o);
      return n;
    },
    getRegex() { return new RegExp(t, e); },
  };
  return n;
}

function D(a) {
  const e = [];
  return (t) => {
    const n = Math.max(0, Math.min(3, t - 1));
    let s = e[n];
    return s || (s = a(n), e[n] = s);
  };
}

// code-point length without allocating an array
function cplen(s) {
  let n = 0;
  for (let i = 0; i < s.length; i++, n++) {
    const ch = s.charCodeAt(i);
    if (ch >= 0xD800 && ch <= 0xDBFF && i + 1 < s.length) {
      const lo = s.charCodeAt(i + 1);
      if (lo >= 0xDC00 && lo <= 0xDFFF) i++;
    }
  }
  return n;
}

// length in UTF-16 units of the first code point of s (0 when empty)
function firstCpLen(s) {
  if (!s) return 0;
  const ch = s.charCodeAt(0);
  if (ch >= 0xD800 && ch <= 0xDBFF && s.length > 1) {
    const lo = s.charCodeAt(1);
    if (lo >= 0xDC00 && lo <= 0xDFFF) return 2;
  }
  return 1;
}

// last code point of s as a string ('' when empty)
function lastCp(s) {
  if (!s) return '';
  const n = s.length;
  const lo = s.charCodeAt(n - 1);
  if (lo >= 0xDC00 && lo <= 0xDFFF && n > 1) {
    const hi = s.charCodeAt(n - 2);
    if (hi >= 0xD800 && hi <= 0xDBFF) return s.slice(n - 2);
  }
  return s.slice(n - 1);
}

const T = {
  codeRemoveIndent: /^(?: {0,3}\t| {1,4})/gm,
  outputLinkReplace: /\\([\[\]])/g,
  indentCodeCompensation: /^(\s+)(?:```)/,
  beginningSpace: /^\s+/,
  endingHash: /#$/,
  startingSpaceChar: /^ /,
  endingSpaceChar: / $/,
  endingSpaceTabChar: /[ \t]$/,
  nonSpaceChar: /[^ ]/,
  newLineCharGlobal: /\n/g,
  tabCharGlobal: /\t/g,
  leadingSpaceTab: /^[ \t]+/,
  multipleSpaceGlobal: /\s+/g,
  blankLine: /^[ \t]*$/,
  doubleBlankLine: /\n[ \t]*\n[ \t]*$/,
  blockquoteStart: /^ {0,3}>/,
  blockquoteSetextReplace: /\n {0,3}((?:=+|-+)[ \t]*)(?=\n|$)/g,
  blockquoteSetextReplace2: /^ {0,3}>[ \t]?/gm,
  blockquoteMarkerWhitespace: /^( {0,3}>)([ \t]+)/gm,
  listReplaceNesting: /^ {1,4}(?=( {4})*[^ ])/g,
  listIsTask: /^\[[ xX]\][ \t]+\S/,
  listReplaceTask: /^\[[ xX]\][ \t]+/,
  listTaskCheckbox: /\[[ xX]\]/,
  anyLine: /\n.*\n/,
  hrefBrackets: /^<(.*)>$/,
  tableDelimiter: /[:|]/,
  tableAlignChars: /^\||\| *$/g,
  tableRowBlankLine: /\n[ \t]*$/,
  tableAlignRight: /^ *-+: *$/,
  tableAlignCenter: /^ *:-+: *$/,
  tableAlignLeft: /^ *:-+ *$/,
  startATag: /^<a /i,
  endATag: /^<\/a>/i,
  startPreScriptTag: /^<(pre|code|kbd|script)(\s|>)/i,
  endPreScriptTag: /^<\/(pre|code|kbd|script)(\s|>)/i,
  startAngleBracket: /^</,
  endAngleBracket: />$/,
  pedanticHrefTitle: /^([^'"]*[^\s])\s+(['"])(.*)\2/,
  unicodeAlphaNumeric: /[\p{L}\p{N}]/u,
  numericCharacterReference: /&#(?:(\d{1,7})|[Xx]([A-Fa-f0-9]{1,6}));/,
  numericCharacterReferenceOrAmpersand: /&#(?:(\d{1,7})|[Xx]([A-Fa-f0-9]{1,6}));|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g,
  escapeTest: /[&<>"']/,
  escapeReplace: /[&<>"']/g,
  escapeTestNoEncode: /[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/,
  escapeReplaceNoEncode: /[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g,
  caret: /(^|[^\[])\^/g,
  percentDecode: /%25/g,
  findPipe: /\|/g,
  splitPipe: / \|/,
  slashPipe: /\\\|/g,
  carriageReturn: /\r\n|\r/g,
  spaceLine: /^ +$/gm,
  notSpaceStart: /^\S*/,
  endingNewline: /\n$/,
  listItemRegex: (a) => new RegExp(`^( {0,3}${a})((?:[ \t][^\n]*)?(?:\n|$))`),
  nextBulletRegex: D((a) => new RegExp(`^ {0,${a}}(?:[*+-]|\\d{1,9}[.)])((?:[ \t][^\n]*)?(?:\n|$))`)),
  hrRegex: D((a) => new RegExp(`^ {0,${a}}((?:-[ \t]*){3,}|(?:_[ \t]*){3,}|(?:\\*[ \t]*){3,})(?:\\n+|$)`)),
  fencesBeginRegex: D((a) => new RegExp(`^ {0,${a}}(?:\`\`\`|~~~)`)),
  headingBeginRegex: D((a) => new RegExp(`^ {0,${a}}#{1,6}(?:\\s|$)`)),
  pedanticHeadingBeginRegex: D((a) => new RegExp(`^ {0,${a}}#`)),
  htmlBeginRegex: D((a) => new RegExp(`^ {0,${a}}(?:</?(?:${K})(?: +|$|/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[)`, 'i')),
  blockquoteBeginRegex: D((a) => new RegExp(`^ {0,${a}}>`)),
};

const K = 'address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul';

// block grammars (GFM)
const BL_NEWLINE = /^(?:[ \t]*(?:\n|$))+/;
const BL_CODE = /^((?: {4}| {0,3}\t)[^\n]+(?:\n(?:[ \t]*(?:\n|$))*)?)+/;
const BL_FENCES = /^ {0,3}(`{3,}(?=[^`\n]*(?:\n|$))|~{3,})([^\n]*)(?:\n|$)(?:|([\s\S]*?)(?:\n|$))(?: {0,3}(?:(?=`)\1`*|(?=~)\1~*) *(?=\n|$)|$)/;
const BL_HR = /^ {0,3}((?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/;
const BL_HEADING = /^ {0,3}(#{1,6})(?=\s|$)(.*)(?:\n+|$)/;
const BL_LH_BASE = /^(?!bull |blockCode|fences|blockquote|heading|html|table)((?:.|\n(?!\s*?\n|bull |fences|blockquote|heading|hr|html|table))+?)\n {0,3}(=+|-+)[ \t]*(?:\n+|$)/;
const BL_BULL = / {0,3}(?:[*+-]|\d{1,9}[.)])/;
const BL_LHEADING = c(BL_LH_BASE)
  .replace(/bull/g, BL_BULL)
  .replace(/blockCode/g, /(?: {4}| {0,3}\t)/)
  .replace(/fences/g, / {0,3}(?:`{3,}|~{3,})/)
  .replace(/blockquote/g, / {0,3}>/)
  .replace(/heading/g, / {0,3}#{1,6}(?:\s|$)/)
  .replace(/hr/g, / {0,3}(?:(?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/)
  .replace(/html/g, / {0,3}<[^\n>]+>\n/)
  .replace(/table/g, / {0,3}\|?(?:[:\- ]*\|)+[\:\- ]*\n/)
  .getRegex();
const BL_PARA_BASE = /^([^\n]+(?:\n(?!hr|heading|lheading|blockquote|fences|list|html|table|[ \t]+\n)[^\n]+)*)/;
const BL_TEXT = /^[^\n]+/;
const BL_LABEL = /(?!\s*\])(?:\\[\s\S]|[^\[\]\\\n]|\n(?![ \t]*\n))+/;
const BL_DEF = c(/^ {0,3}\[(label)\]: *(?:\n[ \t]*)?([^<\s][^\s]*|<.*?>)(?:(?: +(?:\n[ \t]*)?| *\n[ \t]*)(title))? *(?:\n+|$)/)
  .replace('label', BL_LABEL)
  .replace('title', /(?:"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\\n]|\n(?!\n))*'|\((?:\\[\s\S]|[^()\\])*\))/)
  .getRegex();
const BL_LIST = c(/^(bull)([ \t][^\n]*?)?(?:\n|$)/).replace(/bull/g, BL_BULL).getRegex();
const BL_COMMENT = /<!--(?:-?>|[\s\S]*?(?:-->|$))/;
const BL_HTML = c('^ {0,3}(?:<(script|pre|style|textarea)[\\s>][\\s\\S]*?(?:</\\1>[^\\n]*\\n*|$)|comment[^\\n]*(\\n+|$)|<\\?[\\s\\S]*?(?:\\?>[^\\n]*\\n*|$)|<![A-Z][\\s\\S]*?(?:>[^\\n]*\\n*|$)|<!\\[CDATA\\[[\\s\\S]*?(?:\\]\\]>[^\\n]*\\n*|$)|</?(tag)(?:[ \\t]+|\\n|/?>|$)[\\s\\S]*?(?:(?:\\n[ \t]*)+\\n|$)|<(?!(?:script|pre|style|textarea)(?![a-z0-9-]))([a-z][a-z0-9-]*)(?:attribute)*? */?>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ \t]*)+\\n|$)|</[a-z][a-z0-9-]*\\s*>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ \t]*)+\\n|$))', 'i')
  .replace('comment', BL_COMMENT)
  .replace('tag', K)
  .replace('attribute', / +[a-zA-Z:_][\w.:-]*(?: *= *"[^"\n]*"| *= *'[^'\n]*'| *= *[^\s"'=<>`]+)?/)
  .getRegex();
const BL_TABLE = c('^ *([^\\n ].*)\\n {0,3}((?:\\| *)?:?-+:? *(?:\\| *:?-+:? *)*(?:\\| *)?)(?:\\n((?:(?! *\\n|hr|heading|blockquote|code|fences|list|html).*(?:\\n|$))*)\\n*|$)')
  .replace('hr', BL_HR)
  .replace('heading', ' {0,3}#{1,6}(?:\\s|$)')
  .replace('blockquote', ' {0,3}>')
  .replace('code', '(?: {4}| {0,3}\t)[^\\n]')
  .replace('fences', ' {0,3}(?:`{3,}(?=[^`\\n]*(?:\\n|$))|~~~)[^\\n]*(?:\\n|$)')
  .replace('list', ' {0,3}(?:[*+-]|1[.)])[ \\t]')
  .replace('html', ' {0,3}(?:</?(?:tag)(?: +|\\n|/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[)')
  .replace('tag', K)
  .getRegex();
const BL_PARAGRAPH = c(BL_PARA_BASE)
  .replace('hr', BL_HR)
  .replace('heading', ' {0,3}#{1,6}(?:\\s|$)')
  .replace('|lheading', '')
  .replace('table', BL_TABLE)
  .replace('blockquote', ' {0,3}>')
  .replace('fences', ' {0,3}(?:`{3,}(?=[^`\\n]*(?:\\n|$))|~~~)[^\\n]*(?:\\n|$)')
  .replace('list', ' {0,3}(?:[*+-]|1[.)])[ \\t]+[^ \\t\\n]')
  .replace('html', ' {0,3}(?:</?(?:tag)(?: +|\\n|/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[)')
  .replace('tag', K)
  .getRegex();
// marked's blockquote regex embeds the PEDANTIC paragraph (Pe with the
// pedantic list pattern and NO table in its lookahead), not the GFM
// paragraph: a table-shaped line inside a quote must not stop the quote's
// lazy continuation (e.g. "> quote\na  \n ---" keeps "a  " in the quote)
const BL_PARA_KE = c(BL_PARA_BASE)
  .replace('hr', BL_HR)
  .replace('heading', ' {0,3}#{1,6}(?:\\s|$)')
  .replace('|lheading', '')
  .replace('|table', '')
  .replace('blockquote', ' {0,3}>')
  .replace('fences', ' {0,3}(?:`{3,}(?=[^`\\n]*(?:\\n|$))|~~~)[^\\n]*(?:\\n|$)')
  .replace('list', ' {0,3}(?:[*+-]|\\d{1,9}[.)])(?:[ \\t]|\\n|$)')
  .replace('html', ' {0,3}(?:</?(?:tag)(?: +|\\n|/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[)')
  .replace('tag', K)
  .getRegex();
const BL_BLOCKQUOTE = c(/^( {0,3}> ?(?:(?![ \t]*(?:\n|$))(paragraph)|[^\n]*)(?:\n|$))+/).replace('paragraph', BL_PARA_KE).getRegex();

// inline grammars (GFM)
const IN_ESCAPE = /^\\([!"#$%&'()*+,\-./:;<=>?@\[\]\\^_`{|}~])/;
const IN_CODE = /^(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/;
const IN_BR = /^( {2,}|\\)\n(?!\s*$)[ \t]*/;
const IN_TEXT_BASE = /^(`+|[^`])(?:(?= {2,}\n)|[\s\S]*?(?:(?=[\\<!\[`*_]|\b_|$)|[^ ](?= {2,}\n)))/;
const IN_PUNCT = /[\p{P}\p{S}]/u;
const IN_PUNCT_SPACE = /[\s\p{P}\p{S}]/u;
const IN_NOT_PUNCT_SPACE = /[^\s\p{P}\p{S}]/u;
const IN_PUNCT_NOT_TILDE = /(?!~)[\p{P}\p{S}]/u;
const IN_PUNCT_SPACE_NOT_TILDE = /(?!~)[\s\p{P}\p{S}]/u;
const IN_NOT_PUNCT_SPACE_TILDE = /(?:[^\s\p{P}\p{S}]|~)/u;
const IN_OPEN_QUOTE = /[\p{Pi}\p{Ps}"']/u;
const IN_EM_STRONG_L_BASE = /^(?:\*+(?:((?!\*)punct)|([^\s*]))?)|^_+(?:((?!_)punct)|([^\s_]))?/;
const IN_EM_STRONG_L = c(IN_EM_STRONG_L_BASE, 'u').replace(/punct/g, IN_PUNCT_NOT_TILDE).getRegex();
const IN_EM_STRONG_L_QUOTE = c(/^(?:\*+(?:((?!\*)(?!openQuote)punct)|([^\s*]))?)|^_+(?:((?!_)(?!openQuote)punct)|([^\s_]))?/, 'u')
  .replace(/openQuote/g, IN_OPEN_QUOTE).replace(/punct/g, IN_PUNCT).getRegex();
const IN_DEL_L = c(/^~~?(?:((?!~)punct)|[^\s~])/, 'u').replace(/punct/g, IN_PUNCT).getRegex();
const IN_DEL_R_SRC = '^[^~]+(?=[^~])|(?!~)punct(~~?)(?=[\\s]|$)|notPunctSpace(~~?)(?!~)(?=punctSpace|$)|(?!~)punctSpace(~~?)(?=notPunctSpace)|[\\s](~~?)(?!~)(?=punct)|(?!~)punct(~~?)(?!~)(?=punct)|notPunctSpace(~~?)(?=notPunctSpace)';
const IN_DEL_R = c(IN_DEL_R_SRC, 'gu').replace(/notPunctSpace/g, IN_NOT_PUNCT_SPACE).replace(/punctSpace/g, IN_PUNCT_SPACE).replace(/punct/g, IN_PUNCT).getRegex();
const IN_EM_R_AST_SRC = '^[^_*]*?__[^_*]*?\\*[^_*]*?(?=__)|[^*]+(?=[^*])|(?!\\*)punct(\\*+)(?=[\\s]|$)|notPunctSpace(\\*+)(?!\\*)(?=punctSpace|$)|(?!\\*)punctSpace(\\*+)(?=notPunctSpace)|[\\s](\\*+)(?!\\*)(?=punct)|(?!\\*)punct(\\*+)(?!\\*)(?=punct)|notPunctSpace(\\*+)(?=notPunctSpace)';
const IN_EM_R_AST = c(IN_EM_R_AST_SRC, 'gu').replace(/notPunctSpace/g, IN_NOT_PUNCT_SPACE_TILDE).replace(/punctSpace/g, IN_PUNCT_SPACE_NOT_TILDE).replace(/punct/g, IN_PUNCT_NOT_TILDE).getRegex();
const IN_EM_R_UND_SRC = '^[^_*]*?\\*\\*[^_*]*?_[^_*]*?(?=\\*\\*)|[^_]+(?=[^_])|(?!_)punct(_+)(?=[\\s]|$)|notPunctSpace(_+)(?!_)(?=punctSpace|$)|(?!_)punctSpace(_+)(?=notPunctSpace)|[\\s](_+)(?!_)(?=punct)|(?!_)punct(_+)(?!_)(?=punct)';
const IN_EM_R_UND = c(IN_EM_R_UND_SRC, 'gu').replace(/notPunctSpace/g, IN_NOT_PUNCT_SPACE).replace(/punctSpace/g, IN_PUNCT_SPACE).replace(/punct/g, IN_PUNCT).getRegex();
const IN_ANY_PUNCT = c(/\\(punct)/, 'gu').replace(/punct/g, IN_PUNCT).getRegex();
const IN_ANY_PUNCT_OUTSIDE_CODE = c(/(`+)(?:[^`]|[^`][\s\S]*?[^`])\1(?!`)|`+|\\(punct)/, 'gu').replace(/punct/g, IN_PUNCT).getRegex();
const IN_AUTOLINK = c(/^<(scheme:[^\s\x00-\x1f<>]*|email)>/)
  .replace('scheme', /[a-zA-Z][a-zA-Z0-9+.-]{1,31}/)
  .replace('email', /[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+(@)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+(?![-_])/)
  .getRegex();
const IN_TAG = c('^comment|^</[a-zA-Z][a-zA-Z0-9-]*\\s*>|^<[a-zA-Z][a-zA-Z0-9-]*(?:attribute)*?\\s*/?>|^<\\?[\\s\\S]*?\\?>|^<![a-zA-Z]+\\s[\\s\\S]*?>|^<!\\[CDATA\\[[\\s\\S]*?\\]\\]>')
  .replace('comment', c(BL_COMMENT).replace('(?:-->|$)', '-->').getRegex())
  .replace('attribute', /\s+[a-zA-Z:_][\w.:-]*(?:\s*=\s*"[^"]*"|\s*=\s*'[^']*'|\s*=\s*[^\s"'=<>`]+)?/)
  .getRegex();
const IN_BRACKETS = /\[(?:\\[\s\S]|[^\[\]\\])*\]/;
const IN_LABEL_RE = c(/(?:\[(?:brackets|\\[\s\S]|[^\[\]\\])*\]|\\[\s\S]|`+(?!`)[^`]*?`+(?!`)|``+(?=\])|[^\[\]\\`])*?/).replace('brackets', IN_BRACKETS).getRegex();
const IN_LINK = c(/^!?\[(label)\]\([ \t\n]*(href)(?:(?:[ \t]+(?:\n[ \t]*)?|\n[ \t]*)(title))?[ \t\n]*\)/)
  .replace('label', IN_LABEL_RE)
  .replace('href', /<(?:\\.|[^\n<>\\])+>|[^ \t\n\x00-\x1f]+|(?=\))/)
  .replace('title', /"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|\((?:\\[\s\S]|[^)\\])*\)/)
  .getRegex();
const IN_REFLINK = c(/^!?\[(label)\]\[(ref)\]/).replace('label', IN_LABEL_RE).replace('ref', BL_LABEL).getRegex();
const IN_NOLINK = c(/^!?\[(ref)\](?:\[\])?/).replace('ref', BL_LABEL).getRegex();
const IN_REFLINK_SEARCH_LABEL = c(/(?:[^\[\]\\`]*(?:\[(?:brackets|\\[\s\S]|[^\[\]\\])*\]|\\[\s\S]|`+(?!`)[^`]*?`+(?!`)|``+(?=\]))){0,999}?[^\[\]\\`]*?/).replace('brackets', IN_BRACKETS).getRegex();
const IN_REFLINK_SEARCH = c('reflink|nolink(?!\\()', 'g')
  .replace('reflink', c(/^!?\[(label)\]\[(ref)\]/).replace('label', IN_REFLINK_SEARCH_LABEL).replace('ref', /(?:\\[\s\S]|[^\[\]\\]){1,999}/).getRegex())
  .replace('nolink', c(/^!?\[(ref)\](?:\[\])?/).replace('ref', /(?:\\[\s\S]|[^\[\]\\]){1,999}/).getRegex())
  .getRegex();
const IN_BLOCK_SKIP = c(/link|precode-code|html/, 'g')
  .replace('link', /\[(?:[^\[\]`]|(?<a>`+)[^`]+\k<a>(?!`))*?\]\((?:\\[\s\S]|[^\\\(\)]|\((?:\\[\s\S]|[^\\\(\)])*\))*\)/)
  .replace('precode-', '(?<!`)()')
  .replace('code', /(?<b>`+)[^`]+\k<b>(?!`)/)
  .replace('html', /<(?! )[^<>]*?>/)
  .getRegex();
const IN_PUNCT_START = c(/^((?![*_])punctSpace)/, 'u').replace(/punctSpace/g, IN_PUNCT_SPACE).getRegex();
const IN_SCHEME_RE = /[hH][tT][tT][pP][sS]?|[fF][tT][pP]/;
const IN_EMAIL_RE = /[A-Za-z0-9._+-]+@[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![\w-])/;
const IN_EMAIL_PROTO = c(/(?:mailto:email|xmpp:email(?:\/[A-Za-z0-9@.]+)?)/).replace(/email/g, IN_EMAIL_RE).getRegex();
const IN_URL = c(/^emailProtocol|^((?:protocol):\/\/|www\.)(?:[a-zA-Z0-9\-]+\.?)+[^\s<]*|^email/)
  .replace('emailProtocol', IN_EMAIL_PROTO)
  .replace('protocol', IN_SCHEME_RE)
  .replace('email', /[A-Za-z0-9._+-]+(@)[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![\w-])/)
  .getRegex();
const IN_BACKPEDAL = /(?:[^?!.,:;*_'"~()&]+|\([^)]*\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_'"~)]+(?!$))+/;
const IN_DEL = /^(~~?)(?=[^\s~])((?:\\[\s\S]|[^\\])*?(?:\\[\s\S]|[^\s~\\]))\1(?=[^~]|$)/;
const IN_TEXT = c(/^(?:[^a-zA-Z0-9](?=emailProtocol)|(`+|~+|[^`~])(?:(?=[`~])|(?= {2,}\n)|(?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)|[\s\S]*?(?:(?=[\\<!\[`*~_]|\b_|protocol:\/\/|wwwStart|$)|[^ ](?= {2,}\n)|[^a-zA-Z0-9](?=emailProtocol)|[^a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-](?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@))))/)
  .replace('protocol', IN_SCHEME_RE)
  .replace(/emailProtocol/g, /(?:mailto|xmpp):/)
  .replace('wwwStart', '(?<![^\\s*_~(])www\\.')
  .getRegex();

// ---------------------------------------------------------------- utils

const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function esc(a, encode) {
  if (encode) {
    if (T.escapeTest.test(a)) return a.replace(T.escapeReplace, (ch) => ESC_MAP[ch]);
  } else if (T.escapeTestNoEncode.test(a)) {
    return a.replace(T.escapeReplaceNoEncode, (ch) => ESC_MAP[ch]);
  }
  return a;
}

function decodeEntities(a) {
  return T.numericCharacterReference.test(a)
    ? a.replace(T.numericCharacterReferenceOrAmpersand, (e, t, n) => {
        if (t === undefined && n === undefined) return '&amp;';
        const s = t === undefined ? Number.parseInt(n, 16) : Number.parseInt(t, 10);
        return s === 0 || s > 1114111 || (s >= 55296 && s <= 57343) ? '\uFFFD' : s === 38 ? '&amp;' : String.fromCodePoint(s);
      })
    : a;
}

const HREF_SAFE = /^[A-Za-z0-9;,/?:@&=+$\-_.!~*'()#]*$/;
function encodeHref(a) {
  // encodeURI leaves exactly these characters alone; anything else needs it.
  if (HREF_SAFE.test(a)) return a;
  try {
    a = encodeURI(a).replace(T.percentDecode, '%');
  } catch {
    return null;
  }
  return a;
}

// split a table row on unescaped pipes
function splitRow(a, e) {
  // normalise every unescaped pipe to " |" so the split on " |" works; an
  // escaped pipe stays put and loses its backslash in the cell step below.
  // Without a backslash in the row, no pipe is escaped: plain replacement.
  const t = a.includes('\\') ? a.replace(T.findPipe, (r, o, i) => {
    let l = false, p = o;
    for (; --p >= 0 && i[p] === '\\';) l = !l;
    return l ? '|' : ' |';
  }) : a.replace(T.findPipe, ' |');
  const n = t.split(T.splitPipe);
  let s = 0;
  if (n[0].trim() || n.shift(), n.length > 0 && !n.at(-1)?.trim() && n.pop(), e) {
    if (n.length > e) n.splice(e);
    else for (; n.length < e;) n.push('');
  }
  for (; s < n.length; s++) {
    const c = n[s].trim();
    n[s] = c.includes('\\') ? c.replace(T.slashPipe, '|') : c;
  }
  return n;
}

// trim trailing runs of char e from a (t=true: trim runs of anything but e)
function trimEndChar(a, e, t) {
  const n = a.length;
  if (n === 0) return '';
  let s = 0;
  for (; s < n;) {
    const r = a.charAt(n - s - 1);
    if (r === e && !t) s++;
    else if (r !== e && t) s++;
    else break;
  }
  return a.slice(0, n - s);
}

// drop trailing blank lines unless only one/two lines remain
function trimBlankTail(a) {
  const e = a.split('\n');
  let t = e.length - 1;
  for (; t >= 0 && T.blankLine.test(e[t]);) t--;
  return e.length - t <= 2 ? a : e.slice(0, t + 1).join('\n');
}

// link-label normalisation: trim, collapse whitespace, case-fold
function normLabel(a) {
  return a.trim().replace(T.multipleSpaceGlobal, ' ').toLowerCase().toUpperCase().toLowerCase();
}

// index of the unmatched close paren (or -2 unbalanced-open, -1 none)
function parenIndex(a, e) {
  if (a.indexOf(e[0]) === -1 && a.indexOf(e[1]) === -1) return -1;
  let t = 0;
  for (let n = 0; n < a.length; n++) {
    if (a[n] === '\\') n++;
    else if (a[n] === e[0]) t++;
    else if (a[n] === e[1] && (t--, t < 0)) return n;
  }
  return t > 0 ? -2 : -1;
}

// expand tabs to spaces (tab stops of 4, offset by b)
function expandTabs(a, e = 0) {
  let t = e, n = '';
  for (const s of a) {
    if (s === '\t') {
      const r = 4 - t % 4;
      n += ' '.repeat(r);
      t += r;
    } else {
      n += s;
      t++;
    }
  }
  return n;
}

// compensate fenced-code indentation
function fenceDedent(a, e, t) {
  const n = a.match(t.other.indentCodeCompensation);
  if (n === null) return e;
  const s = n[1];
  return e.split('\n').map((r) => {
    const o = r.match(t.other.beginningSpace);
    if (o === null) return r;
    const [i] = o;
    return r.slice(Math.min(i.length, s.length));
  }).join('\n');
}

// true when the link text at offset t contains a '<' that starts a tag/autolink
function linkHasTag(a, e, t, n) {
  if (!e.includes('<')) return false;
  for (let s = 0; s < e.length; s++) {
    if (e[s] === '\\') { s++; continue; }
    if (e[s] === '`') {
      const i = n.inline.code.exec(e.slice(s));
      if (i) { s += i[0].length - 1; continue; }
    }
    if (e[s] !== '<') continue;
    const r = a.slice(t + s);
    const o = n.inline.tag.exec(r) || n.inline.autolink.exec(r);
    if (o) {
      if (o[0].length > e.length - s) return true;
      s += o[0].length - 1;
    }
  }
  return false;
}

// last index in e where an emphasis/strong closer may occur, per delimiter
function lastCloser(e) {
  const t = { '*': -1, _: -1 };
  let n = -1;
  const s = e.length;
  for (let r = 0; r < s; r++) {
    const o = e[r];
    if (o !== '*' && o !== '_' && o !== '~') continue;
    const i = r === 0 ? '\n' : e[r - 1];
    let l = r + 1;
    for (; l < s && e[l] === o;) l++;
    if (i !== ' ' && i !== '\t' && i !== '\n' && i !== '\r' && i !== '\f') {
      if (o === '~') n = r;
      else t[o] = r;
    }
    r = l - 1;
  }
  return { em: t, del: n, src: e };
}

// ---------------------------------------------------------------- context

function newCtx() {
  return {
    links: Object.create(null),
    linkCount: 0,
    state: { inLink: false, inRawBlock: false, linkEmitted: false, linkParenPossible: true, top: true },
  };
}

// ---------------------------------------------------------------- block tokenizers

function tokSpace(src) {
  const t = BL_NEWLINE.exec(src);
  if (t && t[0].length > 0) return { type: 'space', raw: t[0] };
  return null;
}

function tokCode(src) {
  const t = BL_CODE.exec(src);
  if (t) {
    const n = trimBlankTail(t[0]);
    const s = n.replace(T.codeRemoveIndent, '');
    return { type: 'code', raw: n, text: s, lang: '' };
  }
  return null;
}

function tokFences(src) {
  const t = BL_FENCES.exec(src);
  if (t) {
    const n = t[0];
    const s = fenceDedent(n, t[3] || '', { other: T });
    return { type: 'code', raw: n, text: s, lang: t[2] ? t[2].trim().replace(IN_ANY_PUNCT, '$1') : t[2] };
  }
  return null;
}

function tokHeading(src) {
  const t = BL_HEADING.exec(src);
  if (t) {
    let n = t[2].trim();
    if (T.endingHash.test(n)) {
      const s = trimEndChar(n, '#');
      if (!s || T.endingSpaceTabChar.test(s)) n = s.trim();
    }
    return { type: 'heading', raw: trimEndChar(t[0], '\n'), depth: t[1].length, text: n };
  }
  return null;
}

function tokHr(src) {
  const t = BL_HR.exec(src);
  if (t) return { type: 'hr', raw: trimEndChar(t[0], '\n') };
  return null;
}

function tokHtml(src) {
  const t = BL_HTML.exec(src);
  if (t) {
    const n = trimBlankTail(t[0]);
    return { type: 'html', raw: n, pre: t[1] === 'pre' || t[1] === 'script' || t[1] === 'style', text: n };
  }
  return null;
}

function tokDef(src) {
  const t = BL_DEF.exec(src);
  if (t) {
    if (!T.startAngleBracket.test(t[2]) && parenIndex(t[2], '()') !== -1) return null;
    const n = normLabel(t[1]);
    const s = t[2] ? t[2].replace(T.hrefBrackets, '$1').replace(IN_ANY_PUNCT, '$1') : '';
    const r = t[3] ? t[3].substring(1, t[3].length - 1).replace(IN_ANY_PUNCT, '$1') : t[3];
    return { type: 'def', tag: n, raw: trimEndChar(t[0], '\n'), href: s, title: r };
  }
  return null;
}

function tokTable(src) {
  // necessary shape: the delimiter row (2nd line) holds '-' and (':' or '|')
  const nl = src.indexOf('\n');
  if (nl === -1) return null;
  const nl2 = src.indexOf('\n', nl + 1);
  const line2 = nl2 === -1 ? src.slice(nl + 1) : src.slice(nl + 1, nl2);
  if (!line2.includes('-') || (!line2.includes(':') && !line2.includes('|'))) return null;
  const t = BL_TABLE.exec(src);
  if (!t || !T.tableDelimiter.test(t[2])) return null;
  const n = splitRow(t[1]);
  const s = t[2].replace(T.tableAlignChars, '').split('|');
  const r = t[3]?.trim() ? t[3].replace(T.tableRowBlankLine, '').split('\n') : [];
  const o = { type: 'table', raw: trimEndChar(t[0], '\n'), header: [], align: [], rows: [] };
  if (n.length === s.length) {
    for (const i of s) {
      if (T.tableAlignRight.test(i)) o.align.push('right');
      else if (T.tableAlignCenter.test(i)) o.align.push('center');
      else if (T.tableAlignLeft.test(i)) o.align.push('left');
      else o.align.push(null);
    }
    for (let i = 0; i < n.length; i++) o.header.push({ text: n[i], align: o.align[i] });
    for (const i of r) o.rows.push(splitRow(i, o.header.length).map((l, p) => ({ text: l, align: o.align[p] })));
    return o;
  }
  return null;
}

function tokLheading(src) {
  const t = BL_LHEADING.exec(src);
  if (t) {
    const n = t[1].trim();
    return { type: 'heading', raw: trimEndChar(t[0], '\n'), depth: t[2].charAt(0) === '=' ? 1 : 2, text: n };
  }
  return null;
}

function tokParagraph(src) {
  const t = BL_PARAGRAPH.exec(src);
  if (t) {
    const n = t[1].charAt(t[1].length - 1) === '\n' ? t[1].slice(0, -1) : t[1];
    return { type: 'paragraph', raw: t[0], text: n };
  }
  return null;
}

function tokText(src) {
  const t = BL_TEXT.exec(src);
  if (t) return { type: 'text', raw: t[0], text: t[0] };
  return null;
}

function tokBlockquote(src, ctx) {
  const t = BL_BLOCKQUOTE.exec(src);
  if (!t) return null;
  const lines = trimEndChar(t[0], '\n').split('\n');
  let s = '', r = '';
  const o = [];
  let n = lines;
  while (n.length > 0) {
    let i = false;
    const l = [];
    let p;
    for (p = 0; p < n.length; p++) {
      if (T.blockquoteStart.test(n[p])) { l.push(n[p]); i = true; }
      else if (!i) l.push(n[p]);
      else break;
    }
    n = n.slice(p);
    const h = l.join('\n');
    const u = h
      .replace(T.blockquoteMarkerWhitespace, (g, b, m) => b + expandTabs(m, b.length))
      .replace(T.blockquoteSetextReplace, '\n    $1')
      .replace(T.blockquoteSetextReplace2, '');
    s = s ? `${s}\n${h}` : h;
    r = r ? `${r}\n${u}` : u;
    const d = ctx.state.top;
    ctx.state.top = true;
    blockTokens(u, ctx, true, o);
    ctx.state.top = d;
    if (n.length === 0) break;
    const k = o.at(-1);
    if (k?.type === 'code' || k?.type === 'heading' || k?.type === 'hr' || k?.type === 'html' || k?.type === 'table') break;
    if (k?.type === 'blockquote') {
      const g = k;
      const b = n.join('\n');
      const m = g.raw + '\n' + b.replace(T.blockquoteSetextReplace2, '');
      const f = tokBlockquote(m, ctx);
      o[o.length - 1] = f;
      const y = m.substring(f.raw.length).replace(/^\n/, '');
      const R = y ? y.split('\n').length : 0;
      const A = R ? n.slice(0, -R) : n;
      if (A.length > 0) s = `${s}\n${A.join('\n')}`;
      r = r.substring(0, r.length - g.text.length) + f.text;
      n = n.slice(A.length);
      if (n.length > 0 && T.blockquoteStart.test(n[0])) continue;
      break;
    } else if (k?.type === 'list') {
      const g = k;
      const b = g.raw + '\n' + n.join('\n');
      const m = tokList(b, ctx);
      o[o.length - 1] = m;
      const f = m.raw.length > g.raw.length ? b.slice(g.raw.length + 1, m.raw.length).split('\n').length : 0;
      if (f > 0) {
        const y = n.slice(0, f).join('\n');
        s = `${s}\n${y}`;
        r = `${r}\n${y}`;
      }
      n = n.slice(f);
      continue;
    }
  }
  return { type: 'blockquote', raw: s, text: r, blocks: o };
}

// first line of s (no allocation of a split array)
function firstLine(s) {
  const i = s.indexOf('\n');
  return i === -1 ? s : s.slice(0, i);
}

// index of the first char that is not a space (-1 when none / all spaces)
function firstNonSpace(s) {
  let i = 0;
  while (i < s.length && s.charCodeAt(i) === 32) i++;
  return i < s.length ? i : -1;
}

// String.trim() blankness without allocating: true when every char is one
// trim removes (White_Space / line terminators / FEFF).
function isTrimBlank(s) {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 32 || c === 9 || c === 10 || c === 13 || c === 11 || c === 12 || c === 160 || c === 0x1680 ||
        (c >= 0x2000 && c <= 0x200a) || c === 0x2028 || c === 0x2029 || c === 0x202f || c === 0x205f ||
        c === 0x3000 || c === 0xfeff) continue;
    return false;
  }
  return true;
}

// char code of the first non-space char within maxSpaces leading spaces
// (NaN past the end); the block/inline grammars only allow spaces there.
function firstSig(s, maxSpaces) {
  let i = 0;
  while (i < maxSpaces && s.charCodeAt(i) === 32) i++;
  return s.charCodeAt(i);
}

function tokList(src, ctx) {
  let t = BL_LIST.exec(src);
  if (!t) return null;
  const n0 = src;
  const srcLen = () => n0.length - src.length;
  const r0 = t[1].trim();
  const ordered = r0.length > 1;
  const list = { type: 'list', raw: '', ordered, start: ordered ? +r0.slice(0, -1) : '', loose: false, items: [] };
  let r = ordered ? `\\d{1,9}\\${r0.slice(-1)}` : `\\${r0}`;
  const itemRe = T.listItemRegex(r);
  let p = false;
  while (src) {
    let u = false;
    let d = '';
    if (!(t = itemRe.exec(src)) || BL_HR.test(src)) break;
    const k = srcLen();
    src = src.substring(t[0].length);
    const g = firstLine(t[2]);
    const b = t[1].length;
    let m = g.replace(T.leadingSpaceTab, (v) => expandTabs(v, b));
    let f = firstLine(src);
    const y0 = isTrimBlank(m);
    let y = y0;
    let R = 0;
    if (y) R = b + 1;
    else {
      R = firstNonSpace(m);
      R = R > 4 ? 1 : R;
      d = m.slice(R);
      R += b;
    }
    if (y && T.blankLine.test(f)) { src = src.substring(f.length + 1); u = true; }
    if (!u) {
      const v = T.nextBulletRegex(R);
      const Q = T.hrRegex(R);
      const ee = T.fencesBeginRegex(R);
      const te = T.headingBeginRegex(R);
      const M = T.htmlBeginRegex(R);
      const ne = T.blockquoteBeginRegex(R);
      while (src) {
        const U = firstLine(src);
        let Z;
        f = U;
        const fc = firstSig(f, R);
        const canFence = fc === 96 || fc === 126;
        const canHead = fc === 35;
        const canHtml = fc === 60;
        const canQuote = fc === 62;
        const canBull = fc === 42 || fc === 43 || fc === 45 || (fc >= 48 && fc <= 57);
        const canHr = fc === 45 || fc === 95 || fc === 42;
        if ((canFence && ee.test(f)) || (canHead && te.test(f)) || (canHtml && M.test(f)) || (canQuote && ne.test(f)) || (canBull && v.test(f)) || (canHr && Q.test(f))) break;
        const f0 = f.charCodeAt(0);
        Z = (f0 === 32 || f0 === 9) ? f.replace(T.leadingSpaceTab, (me) => expandTabs(me)) : f;
        if (firstNonSpace(Z) >= R || isTrimBlank(f)) d += '\n' + Z.slice(R);
        else {
          const mc = firstSig(m, R);
          const mCanFence = mc === 96 || mc === 126;
          const mCanHead = mc === 35;
          const mCanHtml = mc === 60;
          const mCanHr = mc === 45 || mc === 95 || mc === 42;
          if (y || firstNonSpace(m.includes('\t') ? m.replace(T.tabCharGlobal, '    ') : m) >= 4 || (mCanFence && ee.test(m)) || (mCanHead && te.test(m)) || (mCanHtml && M.test(m)) || (mCanHr && Q.test(m))) break;
          const qe = (firstSig(f, 3) === 61 || firstSig(f, 3) === 45) && /^ {0,3}(?:=+|-+) *$/.test(f) && BL_LHEADING.test(`${m}\n${f}`) ? `    ${Z.replace(/^ {0,3}/, '')}` : f;
          d += '\n' + qe;
        }
        y = isTrimBlank(f);
        src = src.substring(U.length + 1);
        m = Z.slice(R);
      }
    }
    const A = n0.slice(k, srcLen());
    if (!list.loose) {
      if (p) list.loose = true;
      else {
        const ni = A.indexOf('\n');
        if (ni !== -1 && A.indexOf('\n', ni + 1) !== -1 && T.doubleBlankLine.test(A)) p = true;
      }
    }
    list.items.push({ type: 'list_item', raw: A, task: T.listIsTask.test(d), loose: false, text: d, blocks: [], checked: false });
  }
  const h = list.items.at(-1);
  if (h) { h.raw = h.raw.trimEnd(); h.text = h.text.trimEnd(); }
  else return null;
  list.raw = n0.slice(0, srcLen()).trimEnd();
  for (const u of list.items) {
    ctx.state.top = false;
    u.blocks = blockTokens(u.text, ctx, false, []);
    if (!list.loose) {
      const sp = u.blocks.filter((g) => g.type === 'space');
      const kk = sp.length > 0 && sp.some((g) => T.anyLine.test(g.raw));
      list.loose = kk;
    }
  }
  for (const u of list.items) {
    const d = u.blocks[0];
    if (u.task && (d?.type === 'text' || d?.type === 'paragraph')) {
      u.text = u.text.replace(T.listReplaceTask, '');
      d.raw = d.raw.replace(T.listReplaceTask, '');
      d.text = d.text.replace(T.listReplaceTask, '');
      const kk = T.listTaskCheckbox.exec(u.raw);
      if (kk) {
        const g = { type: 'checkbox', raw: kk[0] + ' ', checked: kk[0] !== '[ ]' };
        u.checked = g.checked;
        if (list.loose) {
          if (u.blocks[0] && (u.blocks[0].type === 'paragraph' || u.blocks[0].type === 'text')) {
            u.blocks[0].raw = g.raw + u.blocks[0].raw;
            u.blocks[0].cb = g;
          } else {
            u.blocks.unshift({ type: 'paragraph', raw: g.raw, text: '', cb: g });
          }
        } else {
          u.blocks.unshift(g);
        }
      }
    } else if (u.task) u.task = false;
  }
  if (list.loose) {
    for (const u of list.items) {
      u.loose = true;
      for (const dd of u.blocks) if (dd.type === 'text') dd.type = 'paragraph';
    }
  }
  return list;
}

// ---------------------------------------------------------------- block lexer

function blockTokens(src, ctx, nested, out) {
  let guard = Infinity;
  let nestedFlag = nested;
  while (src) {
    if (src.length < guard) guard = src.length;
    else throw new Error('Infinite loop on byte: ' + src.charCodeAt(0));
    // First-char dispatch: every block grammar except paragraph/text/
    // lheading/table starts with a fixed character (after <=3 spaces), so
    // only the tokenisers that can match at this position are tried, in
    // marked's order. Table is gated inside tokTable.
    const c0 = src.charCodeAt(0);
    let fc = c0;
    if (c0 === 32) {
      let i = 0;
      while (i < 3 && src.charCodeAt(i) === 32) i++;
      fc = src.charCodeAt(i);
    }
    const canSpace = c0 === 32 || c0 === 9 || c0 === 10;
    const canCode = c0 === 32 || c0 === 9;
    const canFence = fc === 96 || fc === 126;
    const canHead = fc === 35;
    const canHr = fc === 45 || fc === 95 || fc === 42;
    const canQuote = fc === 62;
    const canList = fc === 42 || fc === 43 || fc === 45 || (fc >= 48 && fc <= 57);
    const canHtml = fc === 60;
    const canDef = fc === 91;
    let r;
    if (canSpace && (r = tokSpace(src))) {
      src = src.substring(r.raw.length);
      const prev = out.at(-1);
      if (r.raw.length === 1 && prev !== undefined) prev.raw += '\n';
      else out.push(r);
      continue;
    }
    if (canCode && (r = tokCode(src))) {
      src = src.substring(r.raw.length);
      const prev = out.at(-1);
      if (prev?.type === 'paragraph' || prev?.type === 'text') {
        prev.raw += (prev.raw.endsWith('\n') ? '' : '\n') + r.raw;
        prev.text += '\n' + r.text;
      } else out.push(r);
      continue;
    }
    if (canFence && (r = tokFences(src))) { src = src.substring(r.raw.length); out.push(r); continue; }
    if (canHead && (r = tokHeading(src))) { src = src.substring(r.raw.length); out.push(r); continue; }
    if (canHr && (r = tokHr(src))) { src = src.substring(r.raw.length); out.push(r); continue; }
    if (canQuote && (r = tokBlockquote(src, ctx))) { src = src.substring(r.raw.length); out.push(r); continue; }
    if (canList && (r = tokList(src, ctx))) { src = src.substring(r.raw.length); out.push(r); continue; }
    if (canHtml && (r = tokHtml(src))) { src = src.substring(r.raw.length); out.push(r); continue; }
    if (canDef && (r = tokDef(src))) {
      src = src.substring(r.raw.length);
      const prev = out.at(-1);
      if (prev?.type === 'paragraph' || prev?.type === 'text') {
        prev.raw += (prev.raw.endsWith('\n') ? '' : '\n') + r.raw;
        prev.text += '\n' + r.raw;
      } else {
        if (!ctx.links[r.tag]) { ctx.links[r.tag] = { href: r.href, title: r.title }; ctx.linkCount++; }
        out.push(r);
      }
      continue;
    }
    if ((r = tokTable(src))) { src = src.substring(r.raw.length); out.push(r); continue; }
    if ((r = tokLheading(src))) { src = src.substring(r.raw.length); out.push(r); continue; }
    if (ctx.state.top && (r = tokParagraph(src))) {
      const prev = out.at(-1);
      if (nestedFlag && prev?.type === 'paragraph') {
        prev.raw += (prev.raw.endsWith('\n') ? '' : '\n') + r.raw;
        prev.text += '\n' + r.text;
      } else out.push(r);
      nestedFlag = false;
      src = src.substring(r.raw.length);
      continue;
    }
    if ((r = tokText(src))) {
      src = src.substring(r.raw.length);
      const prev = out.at(-1);
      if (prev?.type === 'text') {
        prev.raw += (prev.raw.endsWith('\n') ? '' : '\n') + r.raw;
        prev.text += '\n' + r.text;
      } else out.push(r);
      continue;
    }
    if (src) throw new Error('Infinite loop on byte: ' + src.charCodeAt(0));
  }
  ctx.state.top = true;
  return out;
}

// ---------------------------------------------------------------- inline text scan

function isAlnum(c) {
  return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
}

// [a-zA-Z0-9.!#$%&'*+/=?_`{|}~-]
function isEmailChar(c) {
  return isAlnum(c) || c === 46 || c === 33 || c === 35 || c === 36 || c === 37 || c === 38 || c === 39 ||
    c === 42 || c === 43 || c === 47 || c === 61 || c === 63 || c === 95 || c === 96 ||
    c === 123 || c === 124 || c === 125 || c === 126 || c === 45;
}

// \s plus * _ ~ ( : the characters allowed right before "www."
function isWwwPre(c) {
  return c === 32 || c === 9 || c === 10 || c === 13 || c === 11 || c === 12 || c === 160 || c === 0x1680 ||
    (c >= 0x2000 && c <= 0x200a) || c === 0x2028 || c === 0x2029 || c === 0x202f || c === 0x205f ||
    c === 0x3000 || c === 0xfeff || c === 42 || c === 95 || c === 126 || c === 40;
}

function isProtocolAt(e, i) {
  const c = e.charCodeAt(i) | 32;
  if (c === 104) { // h: http:// or https://
    if ((e.charCodeAt(i + 1) | 32) !== 116 || (e.charCodeAt(i + 2) | 32) !== 116 || (e.charCodeAt(i + 3) | 32) !== 112) return false;
    let j = i + 4;
    if ((e.charCodeAt(j) | 32) === 115) j++;
    return e.charCodeAt(j) === 58 && e.charCodeAt(j + 1) === 47 && e.charCodeAt(j + 2) === 47;
  }
  if (c === 102) { // f: ftp://
    return (e.charCodeAt(i + 1) | 32) === 116 && (e.charCodeAt(i + 2) | 32) === 112 &&
      e.charCodeAt(i + 3) === 58 && e.charCodeAt(i + 4) === 47 && e.charCodeAt(i + 5) === 47;
  }
  return false;
}

// Length of the next plain-text run, following marked's inline-text grammar
// exactly: stops before \\ < ! [ ` * ~ _, before http(s)://, ftp:// and
// www. (with its lookbehind), before an email-looking run, before
// mailto:/xmpp:, and after the last char before a hard break ("  \n").
const STOP_TABLE = new Uint8Array(128);
for (const ch of '\\<!\\[`*~_') STOP_TABLE[ch.charCodeAt(0)] = 1;
const EMAIL_TABLE = new Uint8Array(128);
for (const ch of 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.!#$%&\'*+/=?_`{|}~-') EMAIL_TABLE[ch.charCodeAt(0)] = 1;

// Next plain-text run, following marked's inline-text grammar exactly.
// Jumps with native scans: the next hard-stop char, then the earliest of the
// multi-character stops (protocol://, www., mailto:/xmpp:, an email run, a
// hard break) before it.
const STOP_RE = /[\\<[!*_`~_]/g;

function textLen(e) {
  const n = e.length;
  if (n === 0) return 0;
  const c0 = e.charCodeAt(0);
  if (!isAlnum(c0) && (e.startsWith('mailto:', 1) || e.startsWith('xmpp:', 1))) return 1;
  let start;
  if (c0 === 96) { start = 1; while (start < n && e.charCodeAt(start) === 96) start++; }
  else if (c0 === 126) { start = 1; while (start < n && e.charCodeAt(start) === 126) start++; }
  else start = 1;
  // right after the first char, an email-char run ending at '@' ends the run
  let k = start;
  while (k < n) {
    const ck = e.charCodeAt(k);
    if (ck >= 128 || !EMAIL_TABLE[ck]) break;
    k++;
  }
  if (k > start && k < n && e.charCodeAt(k) === 64) return start;
  STOP_RE.lastIndex = start;
  const m = STOP_RE.exec(e);
  const j = m ? m.index : n;
  let best = j;
  // protocol:// : find '://'; the name ending at p-1 is http, https or ftp
  let p = e.indexOf('://', start);
  while (p !== -1 && p < best) {
    const q = p - 1;
    const c = e.charCodeAt(q) | 32;
    if (c === 112) { // ...p: http or ftp
      if ((e.charCodeAt(q - 1) | 32) === 116 && (e.charCodeAt(q - 2) | 32) === 116 &&
          (e.charCodeAt(q - 3) | 32) === 104 && q - 3 >= start) { best = q - 3; break; } // http
      if ((e.charCodeAt(q - 1) | 32) === 116 && (e.charCodeAt(q - 2) | 32) === 102 &&
          q - 2 >= start) { best = q - 2; break; } // ftp
    } else if (c === 115) { // ...s: https
      if ((e.charCodeAt(q - 1) | 32) === 112 && (e.charCodeAt(q - 2) | 32) === 116 &&
          (e.charCodeAt(q - 3) | 32) === 116 && (e.charCodeAt(q - 4) | 32) === 104 &&
          q - 4 >= start) { best = q - 4; break; }
    }
    p = e.indexOf('://', p + 1);
  }
  // www. with its lookbehind
  p = e.indexOf('www.', start);
  while (p !== -1 && p < best) {
    if (isWwwPre(e.charCodeAt(p - 1))) { best = p; break; }
    p = e.indexOf('www.', p + 1);
  }
  // mailto:/xmpp: preceded by a non-alphanumeric char
  for (const word of ['mailto:', 'xmpp:']) {
    p = e.indexOf(word, start);
    while (p !== -1 && p < best) {
      if (!isAlnum(e.charCodeAt(p - 1))) { best = p; break; }
      p = e.indexOf(word, p + 1);
    }
  }
  // email: an email-char run ending at '@', preceded by a non-email char;
  // the stop is at the run's start, which is BEFORE the '@' position, so
  // the scan must not be cut off by comparing the '@' position to best
  p = e.indexOf('@', start);
  while (p !== -1) {
    let s = p - 1;
    while (s >= 0) {
      const cj = e.charCodeAt(s);
      if (cj >= 128 || !EMAIL_TABLE[cj]) break;
      s--;
    }
    const runStart = s + 1;
    if (runStart >= start && runStart < p) {
      if (runStart < best) best = runStart;
      break; // later runs start even later
    }
    // runStart < start: the run began before the chunk's first char, so this
    // '@' gives no stop; a later one may
    p = e.indexOf('@', p + 1);
  }
  // hard break: a non-space char followed by 2+ spaces and 

  p = e.indexOf('  ', start);
  while (p !== -1 && p < best) {
    if (e.charCodeAt(p - 1) !== 32) {
      let k = p;
      while (k < n && e.charCodeAt(k) === 32) k++;
      if (k - p >= 2 && e.charCodeAt(k) === 10) { best = p; break; }
    }
    p = e.indexOf('  ', p + 1);
  }
  return best;
}

// ---------------------------------------------------------------- inline

// does the inline source contain a link (used while masking for em/del)?
function linkInText(e, ctx) {
  if (!e.includes('[')) return false;
  for (const n of e.matchAll(IN_BLOCK_SKIP)) {
    if (IN_LINK.test(n[0]) && e.charAt(n.index - 1) !== '!') return true;
  }
  for (const n of e.matchAll(IN_REFLINK_SEARCH)) {
    const s = n[0];
    const r = s.lastIndexOf('[');
    if (!(s.charAt(0) === '!' || !Object.hasOwn(ctx.links, normLabel(s.slice(r + 1, -1)))) && !(r > 1 && linkInText(s.slice(1, r - 1), ctx))) return true;
  }
  return false;
}

// the masked source em/del scanning reads: links become [aaa], code spans
// and punctuation become neutral, so delimiters inside them never close.
function getMask(ic, ctx) {
  if (ic.masked !== null) return ic.masked;
  let t = ic.src;
  if (ctx.linkCount > 0 && t.includes('[')) {
    const s = (r) => {
      const o = r.lastIndexOf('[');
      if (!Object.hasOwn(ctx.links, normLabel(r.slice(o + 1, -1)))) return r;
      if (o > 1 && r.charAt(0) !== '!') {
        const i = r.slice(1, o - 1);
        if (linkInText(i, ctx)) return '[' + i.replace(IN_REFLINK_SEARCH, s) + '][' + 'a'.repeat(r.length - o - 2) + ']';
      }
      return '[' + 'a'.repeat(r.length - 2) + ']';
    };
    t = t.replace(IN_REFLINK_SEARCH, s);
  }
  // the punctuation/code-span neutraliser only fires on backticks/backslash,
  // the link/code/html neutraliser only on [, ` or <; otherwise both are no-ops.
  if (t.includes('`') || t.includes('\\')) {
    t = t.replace(IN_ANY_PUNCT_OUTSIDE_CODE, (n, s, r) => r ? '+'.repeat(n.length) : s ? s + n.slice(s.length, -s.length).replace(/`/g, '+') + s : n);
  }
  if (t.includes('[') || t.includes('`') || t.includes('<')) {
    t = t.replace(IN_BLOCK_SKIP, (n, s, r) => {
      const o = r ? r.length : 0;
      return n.slice(0, o) + '[' + 'a'.repeat(n.length - o - 2) + ']';
    });
  }
  ic.masked = t;
  const lc = lastCloser(t);
  ic.emStar = lc.em['*'];
  ic.emUnder = lc.em['_'];
  ic.delIdx = lc.del;
  return t;
}

// render a link/image destination; labelHtml is the HTML rendering of the
// label, labelPlain its plain-text rendering, labelRaw the raw label text.
function renderLink(dest, isImage, labelHtml, labelPlain, labelRaw, autolink) {
  if (isImage) {
    const r = encodeHref(dest.href);
    if (r === null) return esc(labelPlain, false);
    let o = `<img src="${esc(r, false)}" alt="${esc(labelPlain, false)}"`;
    if (dest.title) o += ` title="${esc(dest.title, false)}"`;
    return o + '>';
  }
  const o = autolink ? esc(labelRaw, true) : labelHtml;
  const i = encodeHref(dest.href);
  if (i === null) return o;
  let l = '<a href="' + esc(i, autolink) + '"';
  if (dest.title) l += ' title="' + esc(dest.title, false) + '"';
  return l + '>' + o + '</a>';
}

// shared link/image construction (marked's De): tokenises the label, tracks
// whether a link was emitted inside it, and drops a link whose label holds
// another link. Returns null when no link is produced.
function makeLink(match, dest, raw, ctx, plain) {
  const text = match[1].replace(T.outputLinkReplace, '$1');
  const isImage = match[0].charAt(0) === '!';
  const p = ctx.state.inLink;
  const h = ctx.state.linkEmitted;
  const u = ctx.state.inRawBlock;
  ctx.state.inLink = true;
  ctx.state.linkEmitted = false;
  // one tokenisation only (marked's inlineTokens runs once here); the
  // single rendering serves both modes: a link's label is rendered in the
  // caller's mode, an image's alt text always as plain text.
  const inner = inlineRender(text, ctx, isImage ? true : plain);
  const k = ctx.state.linkEmitted;
  ctx.state.linkEmitted = h;
  ctx.state.inLink = p;
  if (!isImage) {
    if (k) { ctx.state.inRawBlock = u; return null; }
    ctx.state.linkEmitted = true;
  }
  return {
    len: raw.length,
    html: renderLink(dest, isImage, inner, inner, text, false),
    plain: inner,
  };
}

function tryLink(e, ctx, plain) {
  if (ctx.state.linkParenPossible === false) return null;
  const t = IN_LINK.exec(e);
  if (!t) return null;
  const n = t[0].charAt(0) === '!' ? 2 : 1;
  if (linkHasTag(e, t[1], n, { inline: { code: IN_CODE, tag: IN_TAG, autolink: IN_AUTOLINK } })) return null;
  const s = t[2].trim();
  if (T.startAngleBracket.test(s)) {
    if (!T.endAngleBracket.test(s)) return null;
    const l = trimEndChar(s.slice(0, -1), '\\');
    if ((s.length - l.length) % 2 === 0) return null;
  } else {
    const l = parenIndex(t[2], '()');
    if (l === -2) return null;
    if (l > -1) {
      const h = (t[0].indexOf('!') === 0 ? 5 : 4) + t[1].length + l;
      t[2] = t[2].substring(0, l);
      t[0] = t[0].substring(0, h).trim();
      t[3] = '';
    }
  }
  const r = trimEndChar(t[0].slice(0, -1), '\\');
  if ((t[0].length - r.length) % 2 === 0) return null;
  let o = t[2];
  const i = t[3] ? t[3].slice(1, -1) : '';
  o = o.trim();
  if (T.startAngleBracket.test(o)) o = o.slice(1, -1);
  return makeLink(t, { href: o && o.replace(IN_ANY_PUNCT, '$1'), title: i && i.replace(IN_ANY_PUNCT, '$1') }, t[0], ctx, plain);
}

function tryReflink(e, ctx, plain) {
  const n = IN_REFLINK.exec(e) || IN_NOLINK.exec(e);
  if (!n) return null;
  const s = n[0].charAt(0) === '!' ? 2 : 1;
  if (linkHasTag(e, n[1], s, { inline: { code: IN_CODE, tag: IN_TAG, autolink: IN_AUTOLINK } })) return null;
  const ref = ctx.links[normLabel(n[2] || n[1])];
  if (!ref) {
    const o = n[0].charAt(0);
    return { len: 1, html: esc(o, false), plain: o };
  }
  return makeLink(n, ref, n[0], ctx, plain);
}

function tryEmStrong(e, ctx, ic, prev, plain) {
  const s = IN_EM_STRONG_L.exec(e);
  if (!s || (!s[1] && !s[2] && !s[3] && !s[4])) return null;
  const r = s[0][0];
  const o = prev === r;
  const t = getMask(ic, ctx);
  const i = t.length - e.length;
  let l = i;
  while (l > 0 && t[l - 1] === r) l--;
  const p = lastCp(t.slice(Math.max(0, l - 2), l));
  const h = p === '*' || p === '_' || !!IN_PUNCT_START.exec(p);
  let n = prev;
  if (l < i) n = p;
  const u = l < i ? h : !!IN_PUNCT_START.exec(n);
  if (s[4] && n.match(T.unicodeAlphaNumeric)) return null;
  const d = s[1] || s[3] || '';
  if (!d || !n || u) {
    const k = cplen(s[0]) - 1;
    let g, b;
    let m = k;
    let f = 0;
    const y = i - l + k;
    const R = !!p.trim() && (!!d || (r === '*' && !h));
    if (r !== '*' && r !== '_') return null;
    const A = r === '*' ? IN_EM_R_AST : IN_EM_R_UND;
    const v = r === '*' ? ic.emStar : ic.emUnder;
    const Q = t.length - e.length + k;
    if (v < Q) return null;
    const tt = t.slice(-1 * e.length + k);
    const ee = v - Q;
    A.lastIndex = 0;
    let match;
    while ((match = A.exec(tt)) !== null && !(match.index > ee)) {
      g = match[1] || match[2] || match[3] || match[4] || match[5] || match[6];
      if (!g) continue;
      b = cplen(g);
      if (match[3] || match[4]) { m += b; continue; }
      else if (match[5] || match[6] || R) {
        if (o && (match[5] || match[6])) break;
        if (y % 3 && !((y + b) % 3)) { f += b; continue; }
      }
      m -= b;
      if (m > 0) continue;
      b = Math.min(b, b + m + f);
      const te = firstCpLen(match[0]);
      const M = e.slice(0, k + match.index + te + b);
      if (Math.min(k, b) % 2) {
        const U = M.slice(1, -1);
        const inner = inlineRender(U, ctx, plain);
        return { len: M.length, html: `<em>${inner}</em>`, plain: inner };
      }
      const ne = M.slice(2, -2);
      const inner = inlineRender(ne, ctx, plain);
      return { len: M.length, html: `<strong>${inner}</strong>`, plain: inner };
    }
  }
  return null;
}

function tryDel(e, ctx, ic, prev, plain) {
  const s = IN_DEL_L.exec(e);
  if (!s) return null;
  if (!(s[1] || '') || !prev || IN_PUNCT_START.exec(prev)) {
    const o = cplen(s[0]) - 1;
    let i, l;
    let p = o;
    const h = IN_DEL_R;
    const t = getMask(ic, ctx);
    const u = ic.delIdx;
    const d = t.length - e.length + o;
    if (u < d) return null;
    const tt = t.slice(-1 * e.length + o);
    const k = u - d;
    h.lastIndex = 0;
    let m;
    while ((m = h.exec(tt)) !== null && !(m.index > k)) {
      i = m[1] || m[2] || m[3] || m[4] || m[5] || m[6];
      if (!i) continue;
      l = cplen(i);
      if (l !== o) continue;
      if (m[3] || m[4]) { p += l; continue; }
      p -= l;
      if (p > 0) continue;
      l = Math.min(l, l + p);
      const g = firstCpLen(m[0]);
      const b = e.slice(0, o + m.index + g + l);
      const innerText = b.slice(o, -o);
      const inner = inlineRender(innerText, ctx, plain);
      return { len: b.length, html: `<del>${inner}</del>`, plain: inner };
    }
  }
  return null;
}

// render inline markdown to HTML (plain=false) or to plain text (plain=true,
// the text-renderer view used for image alt text).
function inlineRender(src, ctx, plain) {
  const savedParen = ctx.state.linkParenPossible;
  ctx.state.linkParenPossible = savedParen && src.includes(')');
  try {
    return inlineLoop(src, ctx, { src, masked: null, emStar: -1, emUnder: -1, delIdx: -1 }, plain);
  } finally {
    ctx.state.linkParenPossible = savedParen;
  }
}

// extended autolink (www., protocol://, email); null when it cannot match
function tryUrl(e, ctx, plain, mayUrl) {
  if (ctx.state.inLink || !mayUrl) return null;
  const m = IN_URL.exec(e);
  if (!m) return null;
  let n, href;
  if (m[2] === '@') { n = m[0]; href = 'mailto:' + n; }
  else {
    let rr;
    do {
      rr = m[0];
      m[0] = IN_BACKPEDAL.exec(m[0])?.[0] ?? '';
    } while (rr !== m[0]);
    n = m[0];
    href = m[1] === 'www.' ? 'http://' + m[0] : m[0];
  }
  return { len: m[0].length, html: renderLink({ href, title: '' }, false, null, n, n, true), plain: n };
}

function inlineLoop(src, ctx, ic, plain) {
  // whole-source fast path: no inline construct can start here
  if (!plain && !ctx.state.inRawBlock && !/[\\<[!*_`~@]|www\.|:\/\/|  \n/.test(src)) {
    return esc(decodeEntities(src), false);
  }
  if (plain && !ctx.state.inRawBlock && !/[\\<[!*_`~@]|www\.|:\/\/|  \n/.test(src)) {
    return decodeEntities(src);
  }
  const mayUrl = src.includes('@') || src.includes('://') || src.includes('www.');
  let out = '';
  let s = false; // previous iteration produced plain text
  let r = ''; // last char of that text
  let e = src;
  let guard = Infinity;
  while (e) {
    if (e.length < guard) guard = e.length;
    else throw new Error('Infinite loop on byte: ' + e.charCodeAt(0));
    if (!s) r = '';
    s = false;
    let m;
    const ch = e.charCodeAt(0);
    if (ch === 92) { // backslash
      if ((m = IN_ESCAPE.exec(e))) {
        e = e.substring(m[0].length);
        out += plain ? m[1] : esc(m[1], false);
        continue;
      }
      if ((m = IN_BR.exec(e))) {
        e = e.substring(m[0].length);
        if (!plain) out += '<br>';
        continue;
      }
    } else if (ch === 60) { // <
      if ((m = IN_TAG.exec(e))) {
        e = e.substring(m[0].length);
        if (!ctx.state.inLink && T.startATag.test(m[0])) ctx.state.inLink = true;
        else if (ctx.state.inLink && T.endATag.test(m[0])) ctx.state.inLink = false;
        if (!ctx.state.inRawBlock && T.startPreScriptTag.test(m[0])) ctx.state.inRawBlock = true;
        else if (ctx.state.inRawBlock && T.endPreScriptTag.test(m[0])) ctx.state.inRawBlock = false;
        out += m[0];
        continue;
      }
      if ((m = IN_AUTOLINK.exec(e))) {
        let n, href;
        if (m[2] === '@') { n = m[1]; href = 'mailto:' + n; }
        else { n = m[1]; href = n; }
        e = e.substring(m[0].length);
        out += plain ? n : renderLink({ href, title: '' }, false, null, n, n, true);
        continue;
      }
    } else if (ch === 91 || ch === 33) { // [ or !
      if ((m = tryLink(e, ctx, plain))) {
        e = e.substring(m.len);
        out += plain ? m.plain : m.html;
        continue;
      }
      if ((m = tryReflink(e, ctx, plain))) {
        e = e.substring(m.len);
        out += plain ? m.plain : m.html;
        continue;
      }
    } else if (ch === 42 || ch === 95) { // * or _
      if ((m = tryEmStrong(e, ctx, ic, r, plain))) {
        e = e.substring(m.len);
        out += plain ? m.plain : m.html;
        continue;
      }
      // an email address can start with '_', so a failed emphasis opener
      // still leaves the extended autolink to try (marked tries url here)
      if (ch === 95 && (m = tryUrl(e, ctx, plain, mayUrl))) {
        e = e.substring(m.len);
        out += plain ? m.plain : m.html;
        continue;
      }
    } else if (ch === 96) { // `
      if ((m = IN_CODE.exec(e))) {
        let n = m[2].replace(T.newLineCharGlobal, ' ');
        const s2 = T.nonSpaceChar.test(n);
        const r2 = T.startingSpaceChar.test(n) && T.endingSpaceChar.test(n);
        if (s2 && r2) n = n.substring(1, n.length - 1);
        e = e.substring(m[0].length);
        out += plain ? n : '<code>' + esc(n, true) + '</code>';
        continue;
      }
    } else if (ch === 126) { // ~
      if ((m = tryDel(e, ctx, ic, r, plain))) {
        e = e.substring(m.len);
        out += plain ? m.plain : m.html;
        continue;
      }
    } else if (ch === 32) { // space
      if ((m = IN_BR.exec(e))) {
        e = e.substring(m[0].length);
        if (!plain) out += '<br>';
        continue;
      }
    } else if ((m = tryUrl(e, ctx, plain, mayUrl))) {
      e = e.substring(m.len);
      out += plain ? m.plain : m.html;
      continue;
    }
    const tl = textLen(e);
    if (tl > 0) {
      const m0 = e.slice(0, tl);
      e = e.substring(tl);
      if (m0.slice(-1) !== '_') r = m0.slice(-1);
      s = true;
      if (plain) out += ctx.state.inRawBlock ? m0 : decodeEntities(m0);
      else out += ctx.state.inRawBlock ? m0 : esc(decodeEntities(m0), false);
      continue;
    }
    if (e) throw new Error('Infinite loop on byte: ' + e.charCodeAt(0));
  }
  return out;
}

// ---------------------------------------------------------------- block rendering

function checkboxHtml(cb) {
  return '<input ' + (cb.checked ? 'checked="" ' : '') + 'disabled="" type="checkbox"> ';
}

function renderTable(b, ctx) {
  let n = '';
  for (const cell of b.header) n += renderTableCell(cell, true, ctx);
  let t = `<tr>\n${n}</tr>\n`;
  let s = '';
  for (const row of b.rows) {
    n = '';
    for (const cell of row) n += renderTableCell(cell, false, ctx);
    s += `<tr>\n${n}</tr>\n`;
  }
  if (s) s = `<tbody>${s}</tbody>`;
  return `<table>\n<thead>\n${t}</thead>\n${s}</table>\n`;
}

function renderTableCell(cell, isHeader, ctx) {
  const tag = isHeader ? 'th' : 'td';
  return (cell.align ? `<${tag} align="${cell.align}">` : `<${tag}>`) + inlineRender(cell.text, ctx, false) + `</${tag}>\n`;
}

function renderBlocks(blocks, ctx) {
  let out = '';
  for (const b of blocks) {
    switch (b.type) {
      case 'space': break;
      case 'hr': out += '<hr>\n'; break;
      case 'heading': out += `<h${b.depth}>${inlineRender(b.text, ctx, false)}</h${b.depth}>\n`; break;
      case 'code': {
        const s = (b.lang || '').match(T.notSpaceStart)?.[0];
        const r = b.text ? b.text.replace(T.endingNewline, '') + '\n' : '';
        out += s
          ? `<pre><code class="language-${esc(s, false)}">${esc(r, true)}</code></pre>\n`
          : `<pre><code>${esc(r, true)}</code></pre>\n`;
        break;
      }
      case 'table': out += renderTable(b, ctx); break;
      case 'blockquote': out += `<blockquote>\n${renderBlocks(b.blocks, ctx)}</blockquote>\n`; break;
      case 'list': {
        const tag = b.ordered ? 'ol' : 'ul';
        const start = b.ordered && b.start !== 1 ? ` start="${b.start}"` : '';
        let s = '';
        for (const item of b.items) s += `<li>${renderBlocks(item.blocks, ctx)}</li>\n`;
        out += `<${tag}${start}>\n${s}</${tag}>\n`;
        break;
      }
      case 'html': out += b.text; break;
      case 'def': break;
      case 'paragraph': out += `<p>${b.cb ? checkboxHtml(b.cb) : ''}${inlineRender(b.text, ctx, false)}</p>\n`; break;
      case 'text': out += (b.cb ? checkboxHtml(b.cb) : '') + inlineRender(b.text, ctx, false); break;
      case 'checkbox': out += checkboxHtml(b); break;
      default: throw new Error('Token with "' + b.type + '" type was not found.');
    }
  }
  return out;
}

function renderDoc(src) {
  const ctx = newCtx();
  src = src.replace(T.carriageReturn, '\n');
  const blocks = blockTokens(src, ctx, false, []);
  return renderBlocks(blocks, ctx);
}
