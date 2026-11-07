// durable production entry（EP-1 T-O-5）—— 无测试身份面、不读 admin 凭证。
//
// env：TICKET_SECRET S3_ENDPOINT S3_BUCKET S3_REGION
//      S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY API_PORT API_BIND PUBLIC_BASE
import { createServer } from "node:http";
import { createGateway } from "./core.mjs";

const env = process.env;
const TICKET_SECRET = env.TICKET_SECRET ?? "";
const S3_ENDPOINT = (env.S3_ENDPOINT ?? "").replace(/\/$/, "");
const S3_BUCKET = env.S3_BUCKET ?? "";
const S3_REGION = env.S3_REGION ?? "us-east-1";
const ACCESS_KEY = env.S3_ACCESS_KEY_ID ?? "";
const SECRET_KEY = env.S3_SECRET_ACCESS_KEY ?? "";
const API_PORT = Number(env.API_PORT ?? 9095);
const API_BIND = env.API_BIND ?? "127.0.0.1";
const PUBLIC_BASE = (env.PUBLIC_BASE ?? `http://${API_BIND}:${API_PORT}`).replace(/\/$/, "");

const log = (...a) => console.log(`[durable ${new Date().toISOString().slice(11, 19)}]`, ...a);

function refuse(reason) {
  console.error(`[durable] ${reason} — refuse to start`);
  process.exit(1);
}

if (TICKET_SECRET === "") refuse("TICKET_SECRET missing");
if (S3_ENDPOINT === "" || S3_BUCKET === "") refuse("S3 endpoint/bucket missing");
if (ACCESS_KEY === "" || SECRET_KEY === "") refuse("S3 credentials missing");

let gateway;
try {
  gateway = createGateway({
    ticketSecret: TICKET_SECRET,
    s3: { endpoint: S3_ENDPOINT, bucket: S3_BUCKET, region: S3_REGION, accessKey: ACCESS_KEY, secretKey: SECRET_KEY },
    publicBase: PUBLIC_BASE,
    role: "durable",
    log,
  });
} catch (e) {
  refuse(String(e?.message ?? e));
}

const apiServer = createServer(gateway.handler);
apiServer.listen(API_PORT, API_BIND, () => {
  log(`api listening http://${API_BIND}:${API_PORT} bucket=${S3_BUCKET} s3=${S3_ENDPOINT}`);
});
