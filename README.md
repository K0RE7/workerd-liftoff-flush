# workerd: creating an isolate flushes the Liftoff code of every wasm module in the process

Every time workerd creates an isolate, V8 drops the Liftoff code of **all** wasm modules in the
process. Any isolate that runs wasm afterwards compiles it again:

- a new isolate that gets a module another isolate already compiled;
- an existing isolate running its own module, whenever an unrelated isolate starts.

The cause is the `MemoryPressureNotification(kModerate)` call in `Worker::Isolate::Isolate`. Since V8
14.7, any pressure level above `kNone` runs `WasmEngine::FlushLiftoffCode()`.

## Run it

```sh
npm install
npm run repro                                   # the npm release pinned in package.json
npm run repro:no-flush                          # the same with --no-flush-liftoff-code
node gen-wasm.mjs && <path to a built workerd> test --experimental config.capnp
```

`workerd test` exits with 1 when the bug is present: the first two tests fail and the control
passes. `--experimental` is needed for the Worker Loader binding. The tests time compilation, so
run them on an otherwise idle machine.

## Results

| Runtime | `new-isolate-per-child` | `reused-isolate-while-others-start` | `control-same-isolate` | Log |
| --- | --- | --- | --- | --- |
| workerd npm `1.20261118.1` (latest on 2026-11-18) | **FAIL** | **FAIL** | PASS | `results/npm-1.20261118.1.log` |
| workerd npm `1.20261118.1`, `--no-flush-liftoff-code` | PASS | PASS | PASS | `results/npm-1.20261118.1-no-flush-liftoff-code.log` |
| workerd `main` at `6ee5f1717` (2026-11-18), built locally | **FAIL** | **FAIL** | PASS | `results/main-6ee5f1717.log` |
| workerd `main` at `6ee5f1717`, built locally with the patch below | PASS | PASS | PASS | `results/main-6ee5f1717-patched.log` |

## How the repro works

`worker.js` is the test. The parent Worker passes its compiled wasm module to child Workers through
a Worker Loader binding. Each child calls every export once, and the parent times that call:

- The first call compiles the exports. Its time is the baseline.
- The next 20 calls should find the code compiled.
- The test passes when their median is below half the baseline.

`gen-wasm.mjs` writes one module per service: 4,000 small functions each, which differ only in
their constants, so no service reuses code another one compiled.

`config.capnp` runs the test as three services:

| Service | Children | Expected | Got |
| --- | --- | --- | --- |
| `new-isolate-per-child` | a new isolate each time | PASS | **FAIL** |
| `reused-isolate-while-others-start` | one reused isolate; an unrelated isolate without wasm starts before each call | PASS | **FAIL** |
| `control-same-isolate` | one reused isolate, nothing else starts | PASS | PASS |

`config-no-flush.capnp` is the same with `v8Flags = ["--no-flush-liftoff-code"]`.

## Output on workerd

npm `1.20261118.1`:

```
[ TEST ] new-isolate-per-child
first call of the exports (compiles them): 35 ms
next 20: median 39 ms (36, 35, 36, 37, 38, 38, 38, 37, 38, 37, 39, 40, 49, 44, 43, 51, 46, 44, 46, 45)
[ FAIL ] new-isolate-per-child

[ TEST ] reused-isolate-while-others-start
first call of the exports (compiles them): 31 ms
next 20: median 35 ms (30, 29, 30, 30, 30, 31, 36, 37, 37, 36, 35, 36, 39, 35, 37, 33, 30, 34, 36, 32)
[ FAIL ] reused-isolate-while-others-start

[ TEST ] control-same-isolate
first call of the exports (compiles them): 32 ms
next 20: median 4 ms (4, 3, 3, 4, 3, 5, 3, 3, 3, 5, 3, 4, 4, 5, 4, 6, 4, 3, 3, 3)
[ PASS ] control-same-isolate
```

With the patch, the later calls drop to about a quarter of the first one in
`new-isolate-per-child` (124 → 32 ms on the local build), and to 11–15% of it in the other two.

## Fix

`0001-Do-not-signal-memory-pressure-for-every-new-isolate.patch` deletes the call. Apply it to
`main` at `6ee5f1717` with `git am`:

```diff
-    // By default, V8's memory pressure level is "none". This tells V8 that no one else on the
-    // machine is competing for memory so it might as well use all it wants and be lazy about GC.
-    //
-    // In our production environment, however, we can safely assume that there is always memory
-    // pressure, because every machine is handling thousands of tenants all the time. So we might
-    // as well just throw the switch to "moderate" right away.
-    lock->v8Isolate->MemoryPressureNotification(v8::MemoryPressureLevel::kModerate);
```

## Files

- `worker.js`: the test.
- `gen-wasm.mjs`: writes the three wasm modules.
- `config.capnp`: the three services.
- `config-no-flush.capnp`: the same services with `--no-flush-liftoff-code`.
- `0001-Do-not-signal-memory-pressure-for-every-new-isolate.patch`: the fix.
- `package.json`, `package-lock.json`: pin the npm `workerd` release.
- `results/`: the saved outputs of the four runs in the table above.
