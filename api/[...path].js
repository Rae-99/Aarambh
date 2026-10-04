"use strict";

const crypto = require("node:crypto");
const { list, put } = require("@vercel/blob");
const seedInventory = require("../data/inventory.json");

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const BLOB_READ_WRITE_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;
const INVENTORY_BLOB_PATH = "inventory.json";
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const MAX_BODY_BYTES = 16 * 1024;

if (!ADMIN_PASSWORD) {
  throw new Error("ADMIN_PASSWORD must be set in the Vercel project environment.");
}
if (!BLOB_READ_WRITE_TOKEN) {
  throw new Error("Connect a Vercel Blob store to provide BLOB_READ_WRITE_TOKEN.");
}

function setSecurityHeaders(res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Security-Policy", "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; img-src 'self' data:; connect-src 'self'; style-src 'self'; script-src 'self'");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
}

function sendJson(res, status, body, extraHeaders = {}) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  setSecurityHeaders(res);
  for (const [name, value] of Object.entries(extraHeaders)) {
    res.setHeader(name, value);
  }
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  const contentLength = Number(req.headers["content-length"]);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    throw Object.assign(new Error("Request body is too large."), { status: 413 });
  }

  if (req.body !== undefined) {
    if (typeof req.body === "string") {
      try {
        return req.body ? JSON.parse(req.body) : {};
      } catch {
        throw Object.assign(new Error("Invalid JSON."), { status: 400 });
      }
    }
    if (Buffer.isBuffer(req.body)) {
      try {
        return req.body.length ? JSON.parse(req.body.toString("utf8")) : {};
      } catch {
        throw Object.assign(new Error("Invalid JSON."), { status: 400 });
      }
    }
    if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
      return req.body;
    }
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) {
      throw Object.assign(new Error("Request body is too large."), { status: 413 });
    }
    chunks.push(buffer);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw Object.assign(new Error("Invalid JSON."), { status: 400 });
  }
}

function parseCookies(req) {
  return Object.fromEntries(
    (req.headers.cookie || "")
      .split(";")
      .map((entry) => {
        const separator = entry.indexOf("=");
        return separator < 0
          ? [entry.trim(), ""]
          : [entry.slice(0, separator).trim(), entry.slice(separator + 1).trim()];
      })
      .filter(([key, value]) => key && value)
  );
}

function sessionCookie(token, maxAge = SESSION_TTL_SECONDS) {
  return `inventory_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}; Secure`;
}

function createSessionToken() {
  const expiresAt = Date.now() + SESSION_TTL_SECONDS * 1000;
  const payload = `${expiresAt}.${crypto.randomBytes(16).toString("hex")}`;
  const signature = crypto.createHmac("sha256", ADMIN_PASSWORD).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function hasOwnerSession(req) {
  const token = parseCookies(req).inventory_session;
  if (!token) return false;

  const [expiresAt, nonce, signature, extra] = token.split(".");
  if (!expiresAt || !/^[a-f0-9]{32}$/.test(nonce || "") || !signature || extra !== undefined) return false;
  const expiry = Number(expiresAt);
  if (!Number.isSafeInteger(expiry) || expiry < Date.now()) return false;

  const payload = `${expiresAt}.${nonce}`;
  const expected = Buffer.from(crypto.createHmac("sha256", ADMIN_PASSWORD).update(payload).digest("base64url"));
  const actual = Buffer.from(signature);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function passwordsMatch(candidate) {
  const actual = Buffer.from(String(candidate ?? ""));
  const expected = Buffer.from(ADMIN_PASSWORD);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

async function readInventory() {
  const { blobs } = await list({ prefix: INVENTORY_BLOB_PATH, limit: 100 });
  const inventoryBlob = blobs.find((blob) => blob.pathname === INVENTORY_BLOB_PATH);
  if (!inventoryBlob) {
    await writeInventory(seedInventory);
    return structuredClone(seedInventory);
  }

  const response = await fetch(inventoryBlob.url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Unable to read inventory from Blob (HTTP ${response.status}).`);
  }
  const items = await response.json();
  if (!Array.isArray(items)) {
    throw new Error("Stored inventory must be a JSON array.");
  }
  return items;
}

async function writeInventory(items) {
  await put(INVENTORY_BLOB_PATH, JSON.stringify(items, null, 2), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json; charset=utf-8"
  });
}

function requireOwner(req, res) {
  if (hasOwnerSession(req)) return true;
  sendJson(res, 401, { error: "Owner sign-in required." });
  return false;
}

module.exports = async function handler(req, res) {
  const url = new URL(req.url, "https://localhost");

  try {
    if (req.method === "GET" && url.pathname === "/api/inventory") {
      return sendJson(res, 200, { items: await readInventory() });
    }

    if (req.method === "GET" && url.pathname === "/api/session") {
      return sendJson(res, 200, { owner: hasOwnerSession(req) });
    }

    if (req.method === "POST" && url.pathname === "/api/session") {
      const { password } = await readJson(req);
      if (!passwordsMatch(password)) {
        return sendJson(res, 401, { error: "That owner key is not correct." });
      }
      return sendJson(
        res,
        200,
        { owner: true },
        { "Set-Cookie": sessionCookie(createSessionToken()) }
      );
    }

    if (req.method === "DELETE" && url.pathname === "/api/session") {
      return sendJson(
        res,
        200,
        { owner: false },
        { "Set-Cookie": sessionCookie("", 0) }
      );
    }

    const itemMatch = url.pathname.match(/^\/api\/inventory\/(cmp-\d{3})$/);
    if (req.method === "PATCH" && itemMatch) {
      if (!requireOwner(req, res)) return;
      const { quantity } = await readJson(req);
      if (!Number.isInteger(quantity) || quantity < 0 || quantity > 100000) {
        return sendJson(res, 400, { error: "Quantity must be a whole number between 0 and 100000." });
      }

      const items = await readInventory();
      const item = items.find((entry) => entry.id === itemMatch[1]);
      if (!item) return sendJson(res, 404, { error: "Component not found." });
      item.quantity = quantity;
      await writeInventory(items);
      return sendJson(res, 200, { item });
    }

    if (!url.pathname.startsWith("/api/")) {
      return sendJson(res, 404, { error: "Not found." });
    }
    return sendJson(res, 405, { error: "Method not allowed." });
  } catch (error) {
    console.error(error);
    return sendJson(res, error.status || 500, {
      error: error.status ? error.message : "Unable to process this request."
    });
  }
};
