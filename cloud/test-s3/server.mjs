// cloud/test-s3 — FRD1 deployment wrapper（EP-1 T-O-5）。
// 合同逻辑与测试入口已收口到 cloud/durable/；本文件只负责以同一 env 启动 dev entry。
// 部署：把 cloud/{durable,worker,lib} 与本目录一起放到 /srv/dsh-mini-test。
import "../durable/dev.mjs";
