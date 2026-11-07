//! scenario —— celld-logic 冷启动 DO 激活链的确定性驱动。
//!
//! 输入：一个 `Request`（未路由到任何 cell 的入站请求）。
//! 驱动：`on_event` → effects → 按 celld executor 契约补 completion events。
//! 应答策略全部是「happy-path executor」：owner absent→自 claim、CAS applied、
//! restore 空库、runtime 立即起来、publish 成功。任何偏离都如实进转录，
//! 由对照臂判读——本文件不做断言。
//!
//! 确定性：无时钟、无随机；全程固定常量。原生 probe-cli 与 wasm 导出
//! 共用本函数，产出必须逐字节一致。

use celld_logic::isolate::HeapId;
use celld_logic::pressure::PressureConfig;
use celld_logic::{
    on_event, AdoptedCell, CasOutcome, Config, Effect, Event, LeaseCasOutcome,
    OwnershipOnEvict, ProofSource, RestoreOutcome, State,
};
use std::collections::VecDeque;

const NOW_MS: u64 = 1_700_000_000_000;
const NOW_MONO: u64 = 10_000;
const NODE: &str = "node-a";
const CELL: &str = "demo-cell";
const REQUEST: u64 = 1;
const HEAP: u64 = 1;
const MAX_STEPS: usize = 200;

pub(crate) fn config() -> Config {
    Config {
        max_resident: 8,
        max_activations: 8,
        max_evictions: 4,
        max_releases: 4,
        max_outbound_websockets: 8,
        ownership_on_evict: OwnershipOnEvict::Release,
        // spike 不演练节点租约权威面；关闭后 node_authoritative() 恒真，
        // Request 直进 request_authorized（celld 自留的 deterministic-slice 开关）。
        require_node_lease: false,
        peer_protocol: 1,
        operation_deadline_ms: Some(30_000),
        owner_log_recovery_backoff_ms: 1_000,
        owner_log_recovery_attempts: 3,
        alarm_resident_ms: 60_000,
        idle_evict_ms: None,
        pressure: PressureConfig::default(),
    }
}

/// effect → completion event 应答表。返回 None 表示该 effect 不需要
/// core 侧应答（指令性效果/终态/纯通知），由转录如实记录。
fn completion(effect: &Effect) -> Option<Event> {
    match effect {
        Effect::ReadOwner { op, .. } => Some(Event::OwnerRead {
            op: *op,
            now_ms: NOW_MS,
            result: Ok(None),
        }),
        Effect::CasOwner { op, .. } => Some(Event::OwnerCasCompleted {
            op: *op,
            result: Ok(CasOutcome::Applied),
        }),
        Effect::Restore { op, .. } => Some(Event::RestoreCompleted {
            op: *op,
            result: Ok(RestoreOutcome {
                restored: false,
                alarm: None,
            }),
        }),
        Effect::StartRuntime { op, .. } => Some(Event::RuntimeStarted {
            op: *op,
            isolate: Some(HeapId::new(HEAP)),
            generation: 1,
            result: Ok(()),
        }),
        Effect::Publish { op, .. } => Some(Event::Published {
            op: *op,
            result: Ok(()),
        }),
        Effect::StopRuntime { op, .. } => Some(Event::RuntimeStopped { op: *op }),
        Effect::EnsureDurable { op, .. } => Some(Event::DurabilityChecked {
            op: *op,
            result: Ok(()),
        }),
        Effect::AwaitDurable { op, .. } => Some(Event::DurableReached {
            op: *op,
            result: Ok(0),
            source: ProofSource::Bucket,
        }),
        Effect::VerifyOwnership { op, .. } => Some(Event::OwnershipVerified {
            op: *op,
            result: Ok(()),
        }),
        Effect::ReadSelfNodeLease { op, .. } => Some(Event::SelfNodeLeaseRead {
            op: *op,
            now_ms: NOW_MS,
            now_mono_ms: NOW_MONO,
            result: Ok(None),
        }),
        Effect::CasNodeLease { op, .. } => Some(Event::NodeLeaseCasCompleted {
            op: *op,
            now_mono_ms: NOW_MONO,
            result: Ok(LeaseCasOutcome::Applied {
                etag: "etag-1".to_string(),
            }),
            stamped_log_state: None,
        }),
        Effect::ReadLocalCells => Some(Event::LocalCellsRead {
            result: Ok(Vec::new()),
        }),
        Effect::ReadNodeLease { op, .. } => Some(Event::NodeLeaseRead {
            op: *op,
            now_ms: NOW_MS,
            result: Ok(None),
        }),
        Effect::ReadCapacityPeers { op, .. } => Some(Event::CapacityPeersRead {
            op: *op,
            now_ms: NOW_MS,
            result: Ok(Vec::new()),
        }),
        Effect::RecoverNodeLog { op, .. } => Some(Event::NodeLogRecovered {
            op: *op,
            result: Ok(()),
        }),
        Effect::ReleaseOwner { op, .. } => Some(Event::OwnerReleased {
            op: *op,
            result: Ok(CasOutcome::Applied),
        }),
        Effect::AdoptReleased {
            op, released_epoch, ..
        } => Some(Event::SuccessorAdopted {
            op: *op,
            result: Ok(AdoptedCell {
                node: NODE.to_string(),
                addr: "local".to_string(),
                epoch: released_epoch + 1,
                peer_protocol: 1,
            }),
        }),
        _ => None,
    }
}

pub(crate) fn jesc(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 8);
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out
}

/// 跑完整条冷激活场景，产出 canonical JSON 转录。
/// 结构：{"meta":{...},"steps":[{"i","in","out":[...]},...],"tail":{...}}
pub fn run() -> String {
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
    out.push_str("\",\"request\":");
    out.push_str(&REQUEST.to_string());
    out.push_str("},\"steps\":[");

    let mut step = 0usize;
    let mut first = true;
    let mut completed_local = false;
    let mut completed_any = false;
    let mut last_complete: Option<String> = None;
    let mut halted = false;
    let mut truncated = false;

    while let Some(ev) = pending.pop_front() {
        if step >= MAX_STEPS {
            truncated = true;
            break;
        }
        // 转录必须在 move 进 on_event 之前取样。
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
        for (j, eff) in effects.iter().enumerate() {
            if j > 0 {
                out.push(',');
            }
            out.push('"');
            out.push_str(&jesc(&format!("{:?}", eff)));
            out.push('"');
            if let Effect::Complete { request, result } = eff {
                completed_any = true;
                last_complete = Some(format!("{:?}", result));
                if result.is_ok() && *request == REQUEST {
                    completed_local = true;
                }
            }
            if matches!(eff, Effect::Halt { .. }) {
                halted = true;
            }
            if let Some(next) = completion(eff) {
                pending.push_back(next);
            }
        }
        out.push_str("]}");
        step += 1;
        if halted {
            break;
        }
    }

    out.push_str("],\"tail\":{\"steps\":");
    out.push_str(&step.to_string());
    out.push_str(",\"completed_local\":");
    out.push_str(if completed_local { "true" } else { "false" });
    out.push_str(",\"completed_any\":");
    out.push_str(if completed_any { "true" } else { "false" });
    out.push_str(",\"halted\":");
    out.push_str(if halted { "true" } else { "false" });
    out.push_str(",\"truncated\":");
    out.push_str(if truncated { "true" } else { "false" });
    out.push_str(",\"pending\":");
    out.push_str(&pending.len().to_string());
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
