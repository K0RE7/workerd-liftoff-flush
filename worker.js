// Creating an isolate makes V8 drop the Liftoff code of every wasm module in the process, so wasm
// code that was already compiled has to be compiled again.
//
// The parent starts child Workers through the Worker Loader and passes each one its compiled wasm
// module. A child instantiates the module and calls every export once; the parent times that call.
// The first child that calls the exports has to compile them: its time is the baseline. The later
// calls should find the code compiled. The test passes when their median is below half the
// baseline.
//
// MODE (a text binding) selects how the children run:
//   new-isolate                 every child is a new isolate, sharing the parent's module
//   same-isolate                every child is one reused isolate
//   same-isolate-others-start   one reused isolate, but before each call an unrelated isolate
//                               without any wasm is started

import hot from './hot.wasm';

const CALLS = 20;
// Without the flush, later calls take about a third of the baseline (new isolates) or a tenth
// (reused isolate). With the flush they take about as long as the baseline.
const MAX_RATIO = 0.5;

const childSource = `
import { WorkerEntrypoint } from 'cloudflare:workers';
import hot from './hot.wasm';
export default class extends WorkerEntrypoint {
  run(callExports) {
    const { exports } = new WebAssembly.Instance(hot, {});
    let sum = 0;
    if (callExports) for (const f of Object.values(exports)) sum = (sum + f(sum)) | 0;
    return sum;
  }
}
`;

const code = {
  compatibilityDate: '2026-11-01',
  mainModule: 'main.js',
  modules: { 'main.js': childSource, 'hot.wasm': hot },
};

const unrelated = {
  compatibilityDate: '2026-11-01',
  mainModule: 'main.js',
  modules: {
    'main.js': `import { WorkerEntrypoint } from 'cloudflare:workers';
export default class extends WorkerEntrypoint { ping() { return 1; } }`,
  },
};

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

export default {
  async test(controller, env) {
    // An unnamed load() always creates a new isolate; a named get() reuses the one it created.
    const child = () => (env.MODE === 'new-isolate' ? env.LOADER.load(code) : env.LOADER.get('shared', () => code));

    const time = async (callExports) => {
      if (env.MODE === 'same-isolate-others-start') await env.LOADER.load(unrelated).getEntrypoint().ping();
      const stub = child();
      const t0 = Date.now();
      await stub.getEntrypoint().run(callExports);
      return Date.now() - t0;
    };

    // Three calls that instantiate the module but call nothing: one-time start-up costs, and what
    // a call costs without any compiling.
    const warmUp = [await time(false), await time(false), await time(false)];
    const baseline = await time(true);
    const later = [];
    for (let i = 0; i < CALLS; i++) later.push(await time(true));

    const ratio = median(later) / baseline;
    console.log(`without calling the exports: ${warmUp.join(', ')} ms`);
    console.log(`first call of the exports (compiles them): ${baseline} ms`);
    console.log(`next ${CALLS}: median ${median(later)} ms (${later.join(', ')})`);
    console.log(`median / first: ${ratio.toFixed(2)}`);
    if (ratio >= MAX_RATIO) {
      throw new Error(`later calls took ${ratio.toFixed(2)}x the first call's time: the module was compiled again`);
    }
  },
};
