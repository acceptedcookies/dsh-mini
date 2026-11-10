# sim-engine-routing

## 下一步

- 在真机上改下一次会话的引擎。
- 新建会话，断言新会话带上这个引擎。

设置页与模型页可见；bio 关闭时 enroll 被拒；非白名单模型被拒；bio 开启后 challenge 可签发。

- mock：`cloud/sim` 控制面。
- live：真机只允许 `nano-agent`。`magpie` 是 devtools 指针车道（MN04），真机上不可选；
  live 断言即使存储里写了 `magpie`，新会话戳记仍是 `nano-agent`。真机 SOTER 由人按指纹。
