// Checks that a Zcash testnet transaction is mined, without trusting a block explorer.
// Asks a public lightwalletd server over gRPC (no dependencies, Node 22+):
//   1. CompactTxStreamer/GetTransaction(TxFilter{hash}) -> the block height it was mined at
//   2. CompactTxStreamer/GetBlock(BlockID{height})      -> that block's hash and time, and its txids
// Usage: node scripts/verify-testnet-tx.mjs <txid> [https://testnet.zec.rocks:443]
// Message and field numbers are from zcash/lightwalletd walletrpc/service.proto and compact_formats.proto.

import http2 from "node:http2";

const [txid, server = "https://testnet.zec.rocks:443"] = process.argv.slice(2);
if (!/^[0-9a-f]{64}$/.test(txid ?? "")) {
  console.error("Usage: node scripts/verify-testnet-tx.mjs <64-hex txid> [lightwalletd URL]");
  process.exit(2);
}

function varintBytes(n) {
  const out = [];
  let v = BigInt(n);
  do {
    let b = Number(v & 0x7fn);
    v >>= 7n;
    if (v) b |= 0x80;
    out.push(b);
  } while (v);
  return Buffer.from(out);
}

/** Minimal protobuf decoder: [fieldNumber, value] pairs (varint as BigInt, bytes as Buffer). */
function decode(buf) {
  const fields = [];
  let i = 0;
  const varint = () => {
    let r = 0n;
    let s = 0n;
    let b;
    do {
      b = buf[i++];
      r |= BigInt(b & 0x7f) << s;
      s += 7n;
    } while (b & 0x80);
    return r;
  };
  while (i < buf.length) {
    const key = Number(varint());
    const field = key >> 3;
    const wireType = key & 7;
    if (wireType === 0) fields.push([field, varint()]);
    else if (wireType === 2) {
      const len = Number(varint());
      fields.push([field, buf.subarray(i, i + len)]);
      i += len;
    } else if (wireType === 5) i += 4;
    else if (wireType === 1) i += 8;
    else break;
  }
  return fields;
}

function grpc(method, message) {
  return new Promise((resolve, reject) => {
    const client = http2.connect(server);
    client.on("error", reject);
    const req = client.request({
      ":method": "POST",
      ":path": `/cash.z.wallet.sdk.rpc.CompactTxStreamer/${method}`,
      "content-type": "application/grpc",
      te: "trailers",
    });
    const frame = Buffer.alloc(5 + message.length);
    frame.writeUInt32BE(message.length, 1);
    message.copy(frame, 5);
    const chunks = [];
    let status = "0";
    let detail = "";
    req.on("trailers", (h) => {
      status = String(h["grpc-status"] ?? "0");
      detail = decodeURIComponent(String(h["grpc-message"] ?? ""));
    });
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      client.close();
      if (status !== "0") reject(new Error(`${method}: ${detail || `grpc-status ${status}`}`));
      else resolve(decode(Buffer.concat(chunks).subarray(5)));
    });
    req.setTimeout(20_000, () => reject(new Error(`${method}: timed out`)));
    req.end(frame);
  });
}

const get = (fields, n) => fields.find(([f]) => f === n)?.[1];
// Hashes travel in internal byte order; explorers and wallets display them reversed.
const display = (bytes) => Buffer.from(bytes).reverse().toString("hex");
const internal = Buffer.from(txid, "hex").reverse();

try {
  const tx = await grpc("GetTransaction", Buffer.concat([Buffer.from([0x1a, 0x20]), internal]));
  const height = get(tx, 2);
  if (!height) throw new Error("the server returned the transaction without a block height (still in the mempool?)");
  const block = await grpc("GetBlock", Buffer.concat([Buffer.from([0x08]), varintBytes(height)]));
  const txids = block.filter(([f]) => f === 7).map(([, v]) => display(get(decode(v), 2)));
  const tip = get(await grpc("GetLatestBlock", Buffer.alloc(0)), 1);
  console.log(`server        ${server}`);
  console.log(`transaction   ${txid}`);
  console.log(`mined in      block ${height} (${tip ? `${BigInt(tip) - BigInt(height) + 1n} confirmations` : "tip unknown"})`);
  console.log(`block hash    ${display(get(block, 3))}`);
  console.log(`block time    ${new Date(Number(get(block, 5)) * 1000).toISOString()}`);
  console.log(`in block list ${txids.includes(txid) ? "yes" : "no"} (${txids.length} shielded transactions in the block)`);
  process.exit(txids.includes(txid) ? 0 : 1);
} catch (err) {
  console.error(`not verified: ${err.message}`);
  process.exit(1);
}
