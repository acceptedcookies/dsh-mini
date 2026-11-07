(module
  (import "env" "missing" (func $missing (result i32)))
  (func (export "run") (result i32)
    (call $missing)))
