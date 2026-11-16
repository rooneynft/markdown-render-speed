[![markdown-render-speed-02](https://make.fun/badge/markdown-render-speed-02.svg)](https://make.fun/bounty/markdown-render-speed-02)
[![rank](https://make.fun/badge/markdown-render-speed-02/rooneynft/markdown-render-speed/rank.svg)](https://make.fun/bounty/markdown-render-speed-02)
[![reward](https://make.fun/badge/markdown-render-speed-02/rooneynft/markdown-render-speed/reward.svg)](https://make.fun/bounty/markdown-render-speed-02)

# markdown-render-speed

A dependency-free, byte-exact reimplementation of [marked](https://github.com/markedjs/marked) 18.1.3 (default options, GFM on) that renders the same HTML, faster.

Built for the [markdown-render-speed-02](https://make.fun/bounty/markdown-render-speed-02) competition on [make.fun](https://make.fun/bounty/markdown-render-speed-02): `parse(markdown)` must return exactly the HTML marked 18.1.3 renders with its default options, on every CommonMark 0.31.2 and GFM 0.29 example plus generated README documents — and then be faster than marked itself.

## How it works

`parse.js` is a direct-render port of marked's grammars and renderer, written from scratch (no vendored marked, no dependencies):

- Block parsing produces small block nodes holding raw text; link reference definitions are collected during the full block lexing pass, then inline rendering runs — exactly as marked does, so a definition later in a document still applies to earlier paragraphs.
- Inline rendering returns HTML strings directly (recursive for emphasis, strong, strikethrough and link text), with a parallel plain-text mode for image alt text. Link text is tokenized exactly once per link and reused for both modes.
- State (`inLink`, `inRawBlock`, `linkEmitted`, …) is mutated exactly as marked does, including its quirks, so edge cases match byte for byte.

Speed comes from fast paths, not shortcuts:

- First-character dispatch at block level (only the tokenizers that can match are tried, in marked's order) and inside list items.
- Table gate (the delimiter row must contain `-` and `:` or `|`), a fast `splitRow` path when no backslash is present, and an `encodeHref` fast path for URI-safe hrefs.
- Guarded masking (reference-link, punctuation/code and block-skip neutralisers only run when the source can contain them) and allocation-free helpers (`firstLine`, `firstNonSpace`, `isTrimBlank`).
- A jump-based inline-text scanner that uses native regex/`indexOf` scans for the next stop instead of walking character by character.

No caching across cases, no case-text or hash lookup, no dependencies.

## Layout

- `parse.js` — the renderer: `parse(markdown)` returns the HTML string.
- `main.ts` — the harness entrypoint: reads `/input/cases.json` (or `$MAKEFUN_INPUT_DIR`), writes `/output/html.json` (or `$MAKEFUN_OUTPUT_DIR`).

## Verify

```sh
# practice set, through the driver, against the reference output
MAKEFUN_INPUT_DIR=../markdown-render-speed-02-kit/practice/input \
MAKEFUN_OUTPUT_DIR=/tmp/mrs-out node main.ts
node -e "const a=require('/tmp/mrs-out/html.json'),b=require('../markdown-render-speed-02-kit/practice/reference/expected.json');console.log(a.length===b.length&&a.every((x,i)=>x===b[i])?'720/720 identical':'MISMATCH')"
```

## Performance

On the practice set (720 cases, ~2.9M markdown chars), local medians over interleaved A/B runs on this VM: this entry ~600 ms CPU per full run vs marked ~825 ms CPU — about **1.37× faster than marked**. Single-run numbers on a shared VM are noisy; the A/B median is the honest figure.

## License

MIT — see [LICENSE](LICENSE).
