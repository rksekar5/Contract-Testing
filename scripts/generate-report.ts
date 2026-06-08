import fs from "fs";
import path from "path";

const BROKER_URL = process.env.PACT_BROKER_BASE_URL ?? "http://localhost:9292";
const USER = process.env.PACT_BROKER_USERNAME ?? "pact";
const PASS = process.env.PACT_BROKER_PASSWORD ?? "pact";
const OUTPUT = path.resolve(__dirname, "../reports/pact-report.html");
const AUTH = "Basic " + Buffer.from(`${USER}:${PASS}`).toString("base64");

async function get(url: string): Promise<any> {
  const res = await fetch(url, {
    headers: { Authorization: AUTH, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return res.json();
}

interface Interaction {
  description: string;
  providerStates?: { name: string }[];
  request: { method: string; path: string };
  response: { status: number };
}

interface TestResult {
  interactionDescription: string;
  success: boolean;
  mismatches?: { description: string }[];
}

interface Verification {
  success: boolean;
  providerApplicationVersion: string;
  verificationDate: string;
  testResults?: TestResult[];
}

interface PactReport {
  consumer: string;
  provider: string;
  consumerVersion: string;
  interactions: Interaction[];
  verification: Verification | null;
}

async function main() {
  console.log(`Fetching pacts from ${BROKER_URL}...`);

  const latest = await get(`${BROKER_URL}/pacts/latest`);
  const pacts: any[] = latest.pacts ?? [];
  const reports: PactReport[] = [];

  for (const pact of pacts) {
    const consumer: string = pact._embedded.consumer.name;
    const provider: string = pact._embedded.provider.name;
    const consumerVersion: string = pact._embedded.consumer._embedded.version.number;
    const href: string = Array.isArray(pact._links.self)
      ? pact._links.self[0].href
      : pact._links.self.href;

    const detail = await get(href);
    const interactions: Interaction[] = detail.interactions ?? [];

    let verification: Verification | null = null;
    const verUrl: string | undefined = detail._links?.["pb:latest-verification-results"]?.href;
    if (verUrl) {
      try { verification = await get(verUrl); } catch { /* not yet verified */ }
    }

    reports.push({ consumer, provider, consumerVersion, interactions, verification });
  }

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, buildHtml(reports), "utf8");
  console.log(`✅ Report written → ${OUTPUT}`);
}

function buildHtml(reports: PactReport[]): string {
  const total = reports.length;
  const passing = reports.filter(r => r.verification?.success === true).length;
  const failing = reports.filter(r => r.verification?.success === false).length;
  const unverified = total - passing - failing;
  const generatedAt = new Date().toLocaleString();

  const cards = reports.map((r, i) => {
    const status = r.verification === null ? "unverified" : r.verification.success ? "pass" : "fail";
    const statusLabel = status === "pass" ? "✓ Verified" : status === "fail" ? "✗ Failed" : "? Unverified";
    const verDate = r.verification?.verificationDate
      ? new Date(r.verification.verificationDate).toLocaleString()
      : "Never";
    const verProvider = r.verification?.providerApplicationVersion ?? "—";

    const rows = r.interactions.map(ix => {
      const tr = r.verification?.testResults?.find(t => t.interactionDescription === ix.description);
      const iStatus = tr ? (tr.success ? "pass" : "fail") : "pending";
      const mismatch = tr?.mismatches?.map(m => m.description).join("; ") ?? "";
      return `<tr class="ir-${iStatus}">
        <td><span class="m-${ix.request.method.toLowerCase()}">${ix.request.method}</span></td>
        <td class="mono">${ix.request.path}</td>
        <td>${ix.description}</td>
        <td class="muted italic">${ix.providerStates?.[0]?.name ?? "—"}</td>
        <td><span class="badge b-${iStatus}">${iStatus === "pass" ? "✓ Pass" : iStatus === "fail" ? "✗ Fail" : "? Pending"}</span></td>
        <td>${mismatch ? `<span class="mismatch">${mismatch}</span>` : ""}</td>
      </tr>`;
    }).join("");

    return `<div class="card s-${status}" id="c${i}">
      <div class="card-head" onclick="toggle(${i})">
        <div class="pair">
          <span class="consumer">${r.consumer}</span>
          <span class="arrow">→</span>
          <span class="provider">${r.provider}</span>
        </div>
        <div class="meta">
          <span class="pill">consumer v${r.consumerVersion}</span>
          <span class="pill">provider v${verProvider}</span>
          <span class="muted small">verified ${verDate}</span>
        </div>
        <div class="right">
          <span class="sbadge sb-${status}">${statusLabel}</span>
          <span class="chev" id="chev${i}">▼</span>
        </div>
      </div>
      <div class="card-body" id="b${i}">
        <table><thead><tr>
          <th>Method</th><th>Path</th><th>Description</th>
          <th>Provider State</th><th>Status</th><th>Mismatch</th>
        </tr></thead><tbody>${rows}</tbody></table>
      </div>
    </div>`;
  }).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pact Report</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f1f5f9;color:#1e293b;min-height:100vh}

/* ── Header ── */
.header{background:linear-gradient(135deg,#0f172a 0%,#1e3a5f 50%,#1e293b 100%);color:#fff;padding:36px 48px;display:flex;align-items:center;justify-content:space-between}
.header h1{font-size:26px;font-weight:700;letter-spacing:-0.5px;display:flex;align-items:center;gap:12px}
.header h1 .icon{font-size:28px}
.header .sub{color:#94a3b8;font-size:13px;margin-top:4px}
.header .broker-link{color:#60a5fa;font-size:13px;text-decoration:none;border:1px solid #1e40af;padding:6px 14px;border-radius:8px;transition:background 0.2s}
.header .broker-link:hover{background:#1e3a5f}

/* ── Summary ── */
.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:20px;padding:28px 48px}
.sc{background:#fff;border-radius:14px;padding:22px 24px;border:1px solid #e2e8f0;box-shadow:0 1px 4px rgba(0,0,0,0.05);transition:transform 0.15s,box-shadow 0.15s}
.sc:hover{transform:translateY(-2px);box-shadow:0 6px 16px rgba(0,0,0,0.08)}
.sc .lbl{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#64748b}
.sc .val{font-size:44px;font-weight:800;line-height:1;margin-top:10px}
.sc.total .val{color:#3b82f6}
.sc.passing .val{color:#10b981}
.sc.failing .val{color:#ef4444}
.sc.pending .val{color:#f59e0b}
.sc .bar{height:4px;border-radius:2px;margin-top:14px;background:#e2e8f0}
.sc.total .bar{background:#3b82f6}
.sc.passing .bar{background:#10b981}
.sc.failing .bar{background:#ef4444}
.sc.pending .bar{background:#f59e0b}

/* ── Content ── */
.content{padding:0 48px 48px}
.sec-title{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#94a3b8;margin-bottom:16px}

/* ── Pact Cards ── */
.card{background:#fff;border-radius:14px;border:1px solid #e2e8f0;margin-bottom:14px;box-shadow:0 1px 4px rgba(0,0,0,0.04);overflow:hidden;transition:box-shadow 0.2s}
.card:hover{box-shadow:0 4px 14px rgba(0,0,0,0.07)}
.card.s-pass{border-left:5px solid #10b981}
.card.s-fail{border-left:5px solid #ef4444}
.card.s-unverified{border-left:5px solid #f59e0b}

.card-head{display:flex;align-items:center;gap:20px;padding:18px 24px;cursor:pointer;user-select:none}
.card-head:hover{background:#f8fafc}
.pair{display:flex;align-items:center;gap:10px;font-size:16px;font-weight:600;min-width:280px}
.consumer{color:#2563eb}.provider{color:#7c3aed}.arrow{color:#94a3b8}
.meta{display:flex;align-items:center;gap:8px;flex:1;flex-wrap:wrap}
.pill{background:#f1f5f9;border:1px solid #e2e8f0;padding:3px 10px;border-radius:999px;font-size:11px;color:#64748b;font-family:monospace}
.right{display:flex;align-items:center;gap:10px;margin-left:auto}
.chev{color:#94a3b8;font-size:11px;transition:transform 0.2s}
.chev.open{transform:rotate(180deg)}

/* ── Status badges ── */
.sbadge{padding:5px 14px;border-radius:999px;font-size:12px;font-weight:700;letter-spacing:0.3px}
.sb-pass{background:#d1fae5;color:#065f46}
.sb-fail{background:#fee2e2;color:#991b1b}
.sb-unverified{background:#fef3c7;color:#92400e}

/* ── Table ── */
.card-body{display:none;border-top:1px solid #f1f5f9}
.card-body.open{display:block}
table{width:100%;border-collapse:collapse;font-size:13px}
th{background:#f8fafc;padding:10px 16px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:#94a3b8;border-bottom:1px solid #e2e8f0}
td{padding:13px 16px;border-bottom:1px solid #f8fafc;vertical-align:middle}
tr:last-child td{border-bottom:none}
.ir-fail{background:#fff5f5}
.ir-fail:hover{background:#fee2e2}
.ir-pass:hover{background:#f0fdf4}

/* ── Method badges ── */
.m-get{color:#059669;font-family:monospace;font-weight:700;font-size:12px;background:#d1fae5;padding:2px 8px;border-radius:4px}
.m-post{color:#2563eb;font-family:monospace;font-weight:700;font-size:12px;background:#dbeafe;padding:2px 8px;border-radius:4px}
.m-put{color:#d97706;font-family:monospace;font-weight:700;font-size:12px;background:#fef3c7;padding:2px 8px;border-radius:4px}
.m-delete{color:#dc2626;font-family:monospace;font-weight:700;font-size:12px;background:#fee2e2;padding:2px 8px;border-radius:4px}
.m-patch{color:#7c3aed;font-family:monospace;font-weight:700;font-size:12px;background:#ede9fe;padding:2px 8px;border-radius:4px}

/* ── Interaction badges ── */
.badge{padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700}
.b-pass{background:#d1fae5;color:#065f46}
.b-fail{background:#fee2e2;color:#991b1b}
.b-pending{background:#fef3c7;color:#92400e}
.mismatch{font-size:11px;color:#dc2626;background:#fff1f2;padding:3px 9px;border-radius:5px;font-family:monospace;display:inline-block;max-width:360px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* ── Util ── */
.muted{color:#64748b}.small{font-size:12px}.italic{font-style:italic}.mono{font-family:monospace;color:#334155}

/* ── Footer ── */
.footer{text-align:center;padding:28px;color:#94a3b8;font-size:12px;border-top:1px solid #e2e8f0;margin-top:8px}
.footer a{color:#3b82f6;text-decoration:none}
.footer a:hover{text-decoration:underline}
</style>
</head>
<body>

<div class="header">
  <div>
    <h1><span class="icon">📋</span>Pact Contract Test Report</h1>
    <div class="sub">Generated ${generatedAt} · ${total} pact${total !== 1 ? "s" : ""} across all services</div>
  </div>
  <a class="broker-link" href="${BROKER_URL}" target="_blank">Open Broker →</a>
</div>

<div class="summary">
  <div class="sc total"><div class="lbl">Total Pacts</div><div class="val">${total}</div><div class="bar"></div></div>
  <div class="sc passing"><div class="lbl">Verified</div><div class="val">${passing}</div><div class="bar"></div></div>
  <div class="sc failing"><div class="lbl">Failed</div><div class="val">${failing}</div><div class="bar"></div></div>
  <div class="sc pending"><div class="lbl">Unverified</div><div class="val">${unverified}</div><div class="bar"></div></div>
</div>

<div class="content">
  <div class="sec-title">Contract Relationships</div>
  ${cards}
</div>

<div class="footer">
  Pact Contract Testing &nbsp;·&nbsp;
  <a href="${BROKER_URL}" target="_blank">Broker Dashboard</a> &nbsp;·&nbsp;
  <a href="${BROKER_URL}/matrix" target="_blank">Compatibility Matrix</a>
</div>

<script>
function toggle(i){
  const b=document.getElementById('b'+i);
  const c=document.getElementById('chev'+i);
  b.classList.toggle('open');
  c.classList.toggle('open');
}
// Auto-expand failed pacts
document.querySelectorAll('.card.s-fail').forEach(card=>{
  const id=card.id.replace('c','');
  document.getElementById('b'+id)?.classList.add('open');
  document.getElementById('chev'+id)?.classList.add('open');
});
</script>
</body>
</html>`;
}

main().catch(e => { console.error("Report generation failed:", e.message); process.exit(1); });
