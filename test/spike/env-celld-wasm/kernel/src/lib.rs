//! env-celld-wasm 探针内核：celld-logic 决策核的 wasm 边界。
//!
//! 导出面刻意做薄——整段 scenario 在 Rust 侧自闭环（effect→event 应答器
//! 即 spike 版 executor），JS 侧只负责实例化、调用、取回转录文本。
//! 真实 executor 的逐 effect 异步桥接是后续 spike，本目录只证
//! 「celld-logic 在 WXWebAssembly 内语义等价运行」。

pub mod scenario;
#[cfg(target_arch = "wasm32")]
pub mod hosted;

/// 探针状态：scenario 转录文本的持有者。
pub struct ProbeState {
    transcript: String,
}

#[no_mangle]
pub extern "C" fn probe_create() -> *mut ProbeState {
    Box::into_raw(Box::new(ProbeState {
        transcript: String::new(),
    }))
}

#[no_mangle]
pub extern "C" fn probe_run(ptr: *mut ProbeState) {
    if ptr.is_null() {
        return;
    }
    // SAFETY: ptr comes from probe_create and is not used after probe_destroy.
    let state = unsafe { &mut *ptr };
    state.transcript = scenario::run();
}

/// L3/L4 宿主桥驱动：effect 经 import 交 JS executor，完成事件按宿主真实结果回填。
#[cfg(target_arch = "wasm32")]
#[no_mangle]
pub extern "C" fn probe_run_hosted(ptr: *mut ProbeState) {
    if ptr.is_null() {
        return;
    }
    let state = unsafe { &mut *ptr };
    state.transcript = hosted::run_hosted();
}

#[no_mangle]
pub extern "C" fn probe_output_ptr(ptr: *const ProbeState) -> *const u8 {
    if ptr.is_null() {
        return std::ptr::null();
    }
    // SAFETY: same ownership contract as probe_run.
    let state = unsafe { &*ptr };
    state.transcript.as_ptr()
}

#[no_mangle]
pub extern "C" fn probe_output_len(ptr: *const ProbeState) -> usize {
    if ptr.is_null() {
        return 0;
    }
    // SAFETY: same ownership contract as probe_run.
    let state = unsafe { &*ptr };
    state.transcript.len()
}

#[no_mangle]
pub extern "C" fn probe_destroy(ptr: *mut ProbeState) {
    if ptr.is_null() {
        return;
    }
    // SAFETY: ptr was produced by probe_create and is destroyed exactly once.
    drop(unsafe { Box::from_raw(ptr) });
}
