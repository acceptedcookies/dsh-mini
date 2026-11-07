//! hosted —— L3/L4 取证驱动：effect 经 wasm import 交给 JS executor，
//! completion 由宿主真实执行结果（wx.storage 持久化）回填。
//! 仅 wasm32 构建（原生 probe-cli 保留纯 Rust 对照臂）。
//!
//! host_effect(kind, op, arg_ptr, arg_len) -> i32
//!   1 ReadOwner      arg=cell            ret>=0 = 持久化 epoch；-1 = absent
//!   2 CasOwner       arg="cell:epoch"    ret=0 applied
//!   3 Restore        arg=cell            ret>=0 = 持久化 state 字节数；-1 = 空库
//!   4 StartRuntime   arg=cell            ret=0 ok
//!   5 Publish        arg="cell:epoch"    ret=0 ok
//!   6 Complete       arg=route           ret=0 ok
//!   7 StorageWrite   arg="key=value"     ret=len
//!   8 StorageRead    arg=key             ret>=0 len；-1 missing

use crate::scenario::{config, jesc};
use celld_logic::isolate::HeapId;
use celld_logic::{
    on_event, CasOutcome, Effect, Event, OwnerRecord, RestoreOutcome, Route, State,
};
use std::collections::VecDeque;

const NOW_MS: u64 = 1_700_000_000_000;
const NODE: &str = "node-a";
const CELL: &str = "demo-cell";
const REQUEST: u64 = 1;
const MAX_STEPS: usize = 120;

#[link(wasm_import_module = "env")]
extern "C" {
    fn host_effect(kind: i32, op: u64, arg_ptr: *const u8, arg_len: usize) -> i32;
}

fn host(kind: i32, op: u64, arg: &str) -> i32 {
    // SAFETY: arg 在调用期间存活；宿主只读该区间。
    unsafe { host_effect(kind, op, arg.as_ptr(), arg.len()) }
}

pub fn run_hosted() -> String {
    let mut state = State::new(NODE.to_string(), config());
    let mut pending: VecDeque<Event> = VecDeque::new();
    pending.push_back(Event::Request {
        request: REQUEST,
        cell: CELL.to_string(),
    });

    let mut out = String::with_capacity(8192);
    out.push_str("{\"meta\":{\"node\":\"");
    out.push_str(NODE);
    out.push_str("\",\"cell\":\"");
    out.push_str(CELL);
    out.push_str("\"},\"mode\":\"hosted\",\"steps\":[");

    let mut step = 0usize;
    let mut first = true;
    let mut completed_local = false;
    let mut last_complete: Option<String> = None;
    let mut host_log: Vec<String> = Vec::new();
    let mut truncated = false;

    while let Some(ev) = pending.pop_front() {
        if step >= MAX_STEPS {
            truncated = true;
            break;
        }
        let ev_debug = format!("{:?}", ev);
        let effects = on_event(&mut state, ev);

        if !first {
            out.push(',');
        }
        first = false;
        out.push_str("{\"i\":");
        out.push_str(&step.to_string());
        out.push_str(",\"in\":\"");
        out.push_str(&jesc(&ev_debug));
        out.push_str("\",\"out\":[");
        host_log.clear();
        for (j, eff) in effects.iter().enumerate() {
            if j > 0 {
                out.push(',');
            }
            out.push('"');
            out.push_str(&jesc(&format!("{:?}", eff)));
            out.push('"');
            match eff {
                Effect::ReadOwner { op, cell } => {
                    let ret = host(1, *op, cell);
                    host_log.push(format!("ReadOwner->{}", ret));
                    pending.push_back(Event::OwnerRead {
                        op: *op,
                        now_ms: NOW_MS,
                        result: Ok(if ret >= 0 {
                            Some(OwnerRecord {
                                node: Some(NODE.to_string()),
                                epoch: ret as u64,
                                etag: format!("etag-{}", ret),
                            })
                        } else {
                            None
                        }),
                    });
                }
                Effect::CasOwner { op, cell, epoch, .. } => {
                    let ret = host(2, *op, &format!("{}:{}", cell, epoch));
                    host_log.push(format!("CasOwner->{}", ret));
                    pending.push_back(Event::OwnerCasCompleted {
                        op: *op,
                        result: Ok(if ret == 0 {
                            CasOutcome::Applied
                        } else {
                            CasOutcome::Rejected
                        }),
                    });
                }
                Effect::Restore { op, cell, .. } => {
                    let ret = host(3, *op, cell);
                    host_log.push(format!("Restore->{}", ret));
                    pending.push_back(Event::RestoreCompleted {
                        op: *op,
                        result: Ok(RestoreOutcome {
                            restored: ret > 0,
                            alarm: None,
                        }),
                    });
                }
                Effect::StartRuntime { op, cell, .. } => {
                    let ret = host(4, *op, cell);
                    host_log.push(format!("StartRuntime->{}", ret));
                    pending.push_back(Event::RuntimeStarted {
                        op: *op,
                        isolate: Some(HeapId::new(1)),
                        generation: 1,
                        result: Ok(()),
                    });
                }
                Effect::Publish { op, cell, epoch } => {
                    let ret = host(5, *op, &format!("{}:{}", cell, epoch));
                    host_log.push(format!("Publish->{}", ret));
                    pending.push_back(Event::Published {
                        op: *op,
                        result: Ok(()),
                    });
                }
                Effect::Complete { request, result } => {
                    let route = match result {
                        Ok(Route::Local) => "local",
                        Ok(Route::Remote { .. }) => "remote",
                        Err(_) => "error",
                    };
                    let ret = host(6, 0, route);
                    host_log.push(format!("Complete({})->{}", route, ret));
                    if *request == REQUEST && matches!(result, Ok(Route::Local)) {
                        completed_local = true;
                    }
                    last_complete = Some(format!("{:?}", result));
                }
                _ => {}
            }
        }
        out.push_str("],\"host\":[");
        for (k, h) in host_log.iter().enumerate() {
            if k > 0 {
                out.push(',');
            }
            out.push('"');
            out.push_str(&jesc(h));
            out.push('"');
        }
        out.push_str("]}");
        step += 1;
    }

    out.push_str("],\"tail\":{\"steps\":");
    out.push_str(&step.to_string());
    out.push_str(",\"completed_local\":");
    out.push_str(if completed_local { "true" } else { "false" });
    out.push_str(",\"truncated\":");
    out.push_str(if truncated { "true" } else { "false" });
    out.push_str(",\"last_complete\":");
    match last_complete {
        Some(s) => {
            out.push('"');
            out.push_str(&jesc(&s));
            out.push('"');
        }
        None => out.push_str("null"),
    }
    out.push_str("}}");
    out
}
