// Asyncify JS driver (canonical unwind/rewind protocol, verified empirically
// against binaryen@132 `asyncify` pass output on 2026-11-03).
// The same logic is duplicated inside mp/probe/probe.js for the sim/device lanes;
// keep the two implementations in sync — divergence is itself a finding.
//
// Buffer contract: at DATA_ADDR an 8-byte header lives in linear memory —
//   *(DATA)   = stack-top cursor, initialized to DATA + 8
//   *(DATA+4) = end of the region
// asyncify_start_unwind / stop_unwind / start_rewind / stop_rewind all trap
// `unreachable` if *DATA > *(DATA+4). An uninitialized (zeroed) buffer makes the
// cursor point at address 0: unwind writes land on application data and the
// first resume dies with RuntimeError: unreachable. Verified: this exact failure
// mode occurred before the init was added.
// asyncify_get_state(): 0 = normal, 1 = unwinding (waiting on host), 2 = rewinding.
// During rewind, ONLY the resume-point call site invokes the import (state===2)
// and must return the replayed value; earlier call sites are skipped (their
// saved results are restored from the stack, side effects do not re-execute).

export const ASYNCIFY_DATA_ADDR = 16;
export const ASYNCIFY_STACK_END = 1024;

export function wrapHostImports(instanceRef, hostFns) {
  const wrapped = {};
  for (const [name, fn] of Object.entries(hostFns)) {
    wrapped[name] = (...args) => {
      const exports = instanceRef.exports;
      if (exports.asyncify_get_state() === 2) {
        exports.asyncify_stop_rewind();
        return wrapped.replayValue;
      }
      wrapped.pending = Promise.resolve().then(() => fn(...args));
      exports.asyncify_start_unwind(ASYNCIFY_DATA_ADDR);
      return 0;
    };
  }
  return wrapped;
}

export async function driveAsyncified(instance, callName, args = []) {
  const exports = instance.exports;
  const wrapped = instance._wrapped;
  let result = exports[callName](...args);
  while (exports.asyncify_get_state() === 1) {
    exports.asyncify_stop_unwind();
    wrapped.replayValue = await wrapped.pending;
    exports.asyncify_start_rewind(ASYNCIFY_DATA_ADDR);
    result = exports[callName](...args);
  }
  return result;
}

export function instantiateAsync(moduleBytes, hostFns) {
  const ref = { exports: null };
  const wrapped = wrapHostImports(ref, hostFns);
  const instance = new WebAssembly.Instance(new WebAssembly.Module(moduleBytes), {
    env: wrapped,
  });
  ref.exports = instance.exports;
  const view = new Int32Array(instance.exports.memory.buffer);
  view[ASYNCIFY_DATA_ADDR >> 2] = ASYNCIFY_DATA_ADDR + 8;
  view[(ASYNCIFY_DATA_ADDR + 4) >> 2] = ASYNCIFY_STACK_END;
  instance._wrapped = wrapped;
  return instance;
}
