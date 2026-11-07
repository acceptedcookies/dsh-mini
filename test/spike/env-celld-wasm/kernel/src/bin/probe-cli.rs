//! 原生对照臂：同一 scenario::run() 在 host target 上执行，
//! stdout 即 canonical 转录。wasm 臂（WXWebAssembly/Node）必须逐字节一致。
fn main() {
    print!("{}", env_celld_probe::scenario::run());
}
