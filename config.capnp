using Workerd = import "/workerd/workerd.capnp";

# Run with `node gen-wasm.mjs && workerd test --experimental config.capnp`
# (--experimental because Worker Loader bindings are experimental).
const config :Workerd.Config = (
  services = [
    # The bug: every child is a new isolate, and each one compiles the shared module again.
    ( name = "new-isolate-per-child",
      worker = (
        modules = [
          (name = "worker", esModule = embed "worker.js"),
          (name = "hot.wasm", wasm = embed "hot.wasm"),
        ],
        compatibilityDate = "2026-11-01",
        bindings = [
          (name = "LOADER", workerLoader = ()),
          (name = "MODE", text = "new-isolate"),
        ],
      )
    ),
    # The bug hits existing isolates too: one reused isolate compiles its module again every time an
    # unrelated isolate without any wasm starts.
    ( name = "reused-isolate-while-others-start",
      worker = (
        modules = [
          (name = "worker", esModule = embed "worker.js"),
          (name = "hot.wasm", wasm = embed "hot-others.wasm"),
        ],
        compatibilityDate = "2026-11-01",
        bindings = [
          (name = "LOADER", workerLoader = ()),
          (name = "MODE", text = "same-isolate-others-start"),
        ],
      )
    ),
    # Control: one reused isolate and no other isolate starting. Nothing is dropped.
    ( name = "control-same-isolate",
      worker = (
        modules = [
          (name = "worker", esModule = embed "worker.js"),
          (name = "hot.wasm", wasm = embed "hot-control.wasm"),
        ],
        compatibilityDate = "2026-11-01",
        bindings = [
          (name = "LOADER", workerLoader = ()),
          (name = "MODE", text = "same-isolate"),
        ],
      )
    ),
  ],
);
