// Writes the test modules: FUNCS exported functions (i32) -> i32, each a straight run of OPS arithmetic
// steps with its own constants. Calling each function once makes V8 compile it lazily with
// Liftoff. No dependencies; the output is the same on every run.
//
// It writes three modules that differ only in their constants, one per service: hot.wasm,
// hot-others.wasm and hot-control.wasm. V8 shares compiled code between modules with the same bytes,
// so separate modules make each service start from uncompiled code.
//
// Usage: node gen-wasm.mjs [funcs=4000] [ops=40]
import { writeFileSync } from "node:fs";

const FUNCS = Number(process.argv[2] ?? 4000);
const OPS = Number(process.argv[3] ?? 40);

const uleb = (n) => {
  const out = [];
  do {
    let b = n & 0x7f;
    n >>>= 7;
    if (n) b |= 0x80;
    out.push(b);
  } while (n);
  return out;
};
const sleb = (n) => {
  const out = [];
  for (;;) {
    const b = n & 0x7f;
    n >>= 7;
    if ((n === 0 && !(b & 0x40)) || (n === -1 && b & 0x40)) return [...out, b];
    out.push(b | 0x80);
  }
};
const vec = (items) => [...uleb(items.length), ...items.flat()];
const section = (id, bytes) => [id, ...uleb(bytes.length), ...bytes];
const name = (s) => [...uleb(s.length), ...Buffer.from(s)];

// i32.add, i32.mul, i32.xor, i32.rotl
const OPCODES = [0x6a, 0x6c, 0x73, 0x77];
const body = (f, seed) => {
  const code = [0x00]; // no extra locals; the parameter is local 0
  for (let j = 0; j < OPS; j++) {
    const k = ((f * 2654435761 + j * 40503 + seed) >>> 0) & 0xfffff;
    code.push(0x20, 0x00, 0x41, ...sleb(k), OPCODES[(f + j) % 4], 0x21, 0x00);
  }
  code.push(0x20, 0x00, 0x0b);
  return [...uleb(code.length), ...code];
};

const funcs = Array.from({ length: FUNCS }, (_, f) => f);
const module = (seed) => [
  ...[0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00],
  ...section(1, vec([[0x60, 0x01, 0x7f, 0x01, 0x7f]])), // type 0: (i32) -> i32
  ...section(3, vec(funcs.map(() => [0x00]))),
  ...section(7, vec(funcs.map((f) => [...name(`f${f}`), 0x00, ...uleb(f)]))),
  ...section(10, vec(funcs.map((f) => body(f, seed)))),
];
for (const [file, seed] of [["hot.wasm", 0], ["hot-control.wasm", 1], ["hot-others.wasm", 2]]) {
  const bytes = module(seed);
  writeFileSync(new URL(`./${file}`, import.meta.url), Uint8Array.from(bytes));
  console.error(`${file}: ${FUNCS} functions x ${OPS} ops, ${bytes.length} bytes`);
}
