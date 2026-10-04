"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const PUBLIC_DIR = ROOT;
const SEED_INVENTORY_FILE = path.join(ROOT, "data", "inventory.json");
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, "data");
const INVENTORY_FILE = path.join(DATA_DIR, "inventory.json");
const isProduction = process.env.NODE_ENV === "production";
if (isProduction && !process.env.ADMIN_PASSWORD) {
  throw new Error("ADMIN_PASSWORD must be set when NODE_ENV=production.");
}
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "hackathon-owner";
const sessions = new Map();
const maxBodyBytes = 16 * 1024;

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

function headers(type) {
  return {
    "Content-Type": type,
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; img-src 'self' data:; connect-src 'self'; style-src 'self'; script-src 'self'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY"
  };
}

function sendJson(res, status, body, extraHeaders = {}) {
  res.writeHead(status, { ...headers("application/json; charset=utf-8"), ...extraHeaders });
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      raw += chunk;
      if (Buffer.byteLength(raw, "utf8") > maxBodyBytes) {
        reject(new Error("Request body is too large."));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("Invalid JSON."));
      }
    });
    req.on("error", reject);
  });
}

function readInventory() {
  return JSON.parse(fs.readFileSync(INVENTORY_FILE, "utf8"));
}

function ensureInventoryStore() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(INVENTORY_FILE)) {
    fs.copyFileSync(SEED_INVENTORY_FILE, INVENTORY_FILE);
  }
}

function writeInventory(items) {
  const temporaryPath = `${INVENTORY_FILE}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(items, null, 2)}\n`, "utf8");
  fs.renameSync(temporaryPath, INVENTORY_FILE);
}

function cookies(req) {
  return Object.fromEntries(
    (req.headers.cookie || "")
      .split(";")
      .map((entry) => entry.trim().split("="))
      .filter(([key, value]) => key && value)
  );
}

function sessionFrom(req) {
  const token = cookies(req).inventory_session;
  const session = token && sessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    if (token) sessions.delete(token);
    return null;
  }
  return session;
}

function requireOwner(req, res) {
  if (sessionFrom(req)) return true;
  sendJson(res, 401, { error: "Owner sign-in required." });
  return false;
}

function passwordsMatch(candidate) {
  const a = Buffer.from(String(candidate));
  const b = Buffer.from(ADMIN_PASSWORD);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function sessionCookie(token, maxAge = 8 * 60 * 60) {
  return `inventory_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${isProduction ? "; Secure" : ""}`;
}

function cleanExpiredSessions() {
  for (const [token, session] of sessions) {
    if (session.expiresAt < Date.now()) sessions.delete(token);
  }
}

function serveStatic(res, urlPath) {
  const pathname = urlPath === "/" ? "/index.html" : urlPath;
  if (!["/index.html", "/styles.css", "/app.js"].includes(pathname)) {
    sendJson(res, 404, { error: "Not found." });
    return;
  }
  const safePath = path.join(PUBLIC_DIR, pathname.slice(1));

  fs.readFile(safePath, (error, file) => {
    if (error) {
      sendJson(res, error.code === "ENOENT" ? 404 : 500, { error: "Not found." });
      return;
    }
    const extension = path.extname(safePath).toLowerCase();
    res.writeHead(200, headers(mimeTypes[extension] || "application/octet-stream"));
    res.end(file);
  });
}

ensureInventoryStore();

const server = http.createServer(async (req, res) => {
  cleanExpiredSessions();
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  try {
    if (req.method === "GET" && url.pathname === "/api/inventory") {
      return sendJson(res, 200, { items: readInventory() });
    }

    if (req.method === "GET" && url.pathname === "/api/session") {
      return sendJson(res, 200, { owner: Boolean(sessionFrom(req)) });
    }

    if (req.method === "POST" && url.pathname === "/api/session") {
      const { password } = await readJson(req);
      if (!passwordsMatch(password)) {
        return sendJson(res, 401, { error: "That owner key is not correct." });
      }
      const token = crypto.randomBytes(32).toString("hex");
      sessions.set(token, { expiresAt: Date.now() + 8 * 60 * 60 * 1000 });
      return sendJson(res, 200, { owner: true }, { "Set-Cookie": sessionCookie(token) });
    }

    if (req.method === "DELETE" && url.pathname === "/api/session") {
      const token = cookies(req).inventory_session;
      if (token) sessions.delete(token);
      return sendJson(res, 200, { owner: false }, { "Set-Cookie": sessionCookie("", 0) });
    }

    const itemMatch = url.pathname.match(/^\/api\/inventory\/(cmp-\d{3})$/);
    if (req.method === "PATCH" && itemMatch) {
      if (!requireOwner(req, res)) return;
      const { quantity } = await readJson(req);
      if (!Number.isInteger(quantity) || quantity < 0 || quantity > 100000) {
        return sendJson(res, 400, { error: "Quantity must be a whole number between 0 and 100000." });
      }
      const items = readInventory();
      const item = items.find((entry) => entry.id === itemMatch[1]);
      if (!item) return sendJson(res, 404, { error: "Component not found." });
      item.quantity = quantity;
      writeInventory(items);
      return sendJson(res, 200, { item });
    }

    if (req.method === "GET") return serveStatic(res, decodeURIComponent(url.pathname));
    return sendJson(res, 405, { error: "Method not allowed." });
  } catch (error) {
    console.error(error);
    return sendJson(res, 400, { error: error.message || "Unable to process this request." });
  }
});

server.listen(PORT, () => {
  console.log(`Hackathon Inventory is running at http://localhost:${PORT}`);
  if (!process.env.ADMIN_PASSWORD) {
    console.log("Local preview owner key: hackathon-owner (set ADMIN_PASSWORD before deployment)");
  }
});

