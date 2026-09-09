import net from "node:net";
import { syncBuiltinESMExports } from "node:module";

const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  let options = args[0];
  if (Array.isArray(options)) options = options[0];
  const host = typeof options === "object" && options !== null
    ? options.host ?? "localhost"
    : typeof args[1] === "string" ? args[1] : "localhost";
  const pipe = typeof options === "object" && options !== null && options.path;
  if (!pipe && !["localhost", "127.0.0.1", "::1"].includes(host)) {
    throw new Error("Isolated verification blocked a non-loopback network connection.");
  }
  return connect.apply(this, args);
};
syncBuiltinESMExports();
const originalFetch = globalThis.fetch;
globalThis.fetch = function (input, init) {
  const url = new URL(typeof input === "object" && input !== null && "url" in input ? input.url : String(input));
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    throw new Error("Isolated verification blocked an external fetch.");
  }
  return originalFetch(input, init);
};
