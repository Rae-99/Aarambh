"use strict";

const state = {
  filter: "all",
  items: [],
  owner: false,
  query: "",
  sort: "name"
};

const $ = (selector) => document.querySelector(selector);
const grid = $("#inventory-grid");
const emptyState = $("#empty-state");
const statusFlash = $("#status-flash");
const ownerDialog = $("#owner-dialog");
const number = new Intl.NumberFormat("en-IN");

function announce(message) {
  statusFlash.textContent = message;
  window.clearTimeout(announce.timeout);
  announce.timeout = window.setTimeout(() => { statusFlash.textContent = ""; }, 3200);
}

function filteredItems() {
  const normalizedQuery = state.query.trim().toLocaleLowerCase();
  const items = state.items.filter((item) => {
    const matchesQuery = !normalizedQuery || item.name.toLocaleLowerCase().includes(normalizedQuery);
    const matchesFilter = state.filter === "all"
      || (state.filter === "limited" && item.quantity <= 2)
      || (state.filter === "ready" && item.quantity >= 3);
    return matchesQuery && matchesFilter;
  });

  return items.sort((a, b) => {
    if (state.sort === "high") return b.quantity - a.quantity || a.name.localeCompare(b.name);
    if (state.sort === "low") return a.quantity - b.quantity || a.name.localeCompare(b.name);
    return a.name.localeCompare(b.name);
  });
}

function renderStats() {
  const total = state.items.reduce((sum, item) => sum + item.quantity, 0);
  const limited = state.items.filter((item) => item.quantity <= 2).length;
  $("#component-count").textContent = number.format(state.items.length);
  $("#unit-count").textContent = number.format(total);
  $("#limited-count").textContent = number.format(limited);
  $("#all-count").textContent = number.format(state.items.length);
}

function makeQuantityEditor(item) {
  const editor = document.createElement("div");
  editor.className = "quantity-editor";
  editor.setAttribute("aria-label", `Edit quantity for ${item.name}`);

  const decrement = document.createElement("button");
  decrement.type = "button";
  decrement.textContent = "−";
  decrement.setAttribute("aria-label", `Reduce ${item.name} quantity`);
  decrement.addEventListener("click", () => updateQuantity(item.id, Math.max(0, item.quantity - 1)));

  const input = document.createElement("input");
  input.type = "number";
  input.inputMode = "numeric";
  input.min = "0";
  input.max = "100000";
  input.value = item.quantity;
  input.setAttribute("aria-label", `${item.name} quantity`);
  input.addEventListener("change", () => {
    const quantity = Number(input.value);
    if (Number.isInteger(quantity) && quantity >= 0 && quantity <= 100000) {
      updateQuantity(item.id, quantity);
    } else {
      input.value = item.quantity;
      announce("Enter a whole number from 0 to 100000.");
    }
  });

  const increment = document.createElement("button");
  increment.type = "button";
  increment.textContent = "+";
  increment.setAttribute("aria-label", `Increase ${item.name} quantity`);
  increment.addEventListener("click", () => updateQuantity(item.id, item.quantity + 1));

  editor.append(decrement, input, increment);
  return editor;
}

function makeCard(item, index) {
  const card = document.createElement("article");
  card.className = "component-card";
  card.style.animationDelay = `${Math.min(index * 0.018, 0.22)}s`;

  const name = document.createElement("h3");
  name.textContent = item.name;

  const bottom = document.createElement("div");
  bottom.className = "component-bottom";
  const quantity = document.createElement("div");
  const label = document.createElement("span");
  label.className = "quantity-label";
  label.textContent = state.owner ? "AVAILABLE / EDITABLE" : "AVAILABLE UNITS";
  quantity.append(label);

  if (state.owner) {
    quantity.append(makeQuantityEditor(item));
  } else {
    const value = document.createElement("div");
    value.className = "quantity-value";
    value.append(document.createTextNode(number.format(item.quantity)));
    const units = document.createElement("small");
    units.textContent = "UNITS";
    value.append(units);
    quantity.append(value);
  }

  const mode = document.createElement("span");
  mode.className = "read-only";
  mode.textContent = state.owner ? "auto-saves" : "read-only";
  bottom.append(quantity, mode);
  card.append(name, bottom);
  return card;
}

function renderInventory() {
  const items = filteredItems();
  grid.replaceChildren();
  items.forEach((item, index) => grid.append(makeCard(item, index)));
  grid.setAttribute("aria-busy", "false");
  emptyState.hidden = items.length !== 0;
  $("#results-count").textContent = `${number.format(items.length)} ${items.length === 1 ? "component" : "components"} in view`;
  renderStats();
}

function renderSession() {
  const sessionLabel = $("#session-label");
  const ownerButton = $("#owner-button");
  sessionLabel.textContent = state.owner ? "Owner controls live" : "Public read mode";
  ownerButton.textContent = state.owner ? "Sign out" : "Owner access";
  document.body.dataset.owner = String(state.owner);
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || "Something went wrong.");
    error.status = response.status;
    throw error;
  }
  return data;
}

async function updateQuantity(id, quantity) {
  try {
    const { item } = await api(`/api/inventory/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ quantity })
    });
    const index = state.items.findIndex((entry) => entry.id === item.id);
    state.items[index] = item;
    renderInventory();
    announce(`${item.name}: quantity saved.`);
  } catch (error) {
    if (error.status === 401) {
      state.owner = false;
      renderSession();
      renderInventory();
      announce("Owner session ended. Please sign in again.");
      return;
    }
    announce(error.message);
  }
}

async function signIn(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const password = new FormData(form).get("password");
  const submit = form.querySelector("button[type=submit]");
  const errorBox = $("#form-error");
  errorBox.textContent = "";
  submit.disabled = true;
  submit.textContent = "Checking key...";
  try {
    await api("/api/session", { method: "POST", body: JSON.stringify({ password }) });
    state.owner = true;
    renderSession();
    renderInventory();
    ownerDialog.close();
    form.reset();
    announce("Owner controls unlocked. Changes save immediately.");
  } catch (error) {
    errorBox.textContent = error.message;
    $("#owner-key").focus();
  } finally {
    submit.disabled = false;
    submit.innerHTML = 'Unlock quantity controls <span aria-hidden="true">→</span>';
  }
}

async function toggleOwner() {
  if (!state.owner) {
    $("#form-error").textContent = "";
    ownerDialog.showModal();
    window.setTimeout(() => $("#owner-key").focus(), 50);
    return;
  }
  try {
    await api("/api/session", { method: "DELETE" });
  } catch {
    // The local UI should still leave owner mode even if a session has already expired.
  }
  state.owner = false;
  renderSession();
  renderInventory();
  announce("Owner controls locked.");
}

function bindControls() {
  $("#search-input").addEventListener("input", (event) => {
    state.query = event.target.value;
    renderInventory();
  });

  document.querySelectorAll("[data-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.filter = button.dataset.filter;
      document.querySelectorAll("[data-filter]").forEach((chip) => chip.classList.toggle("is-active", chip === button));
      renderInventory();
    });
  });

  $("#sort-select").addEventListener("change", (event) => {
    state.sort = event.target.value;
    renderInventory();
  });

  $("#owner-button").addEventListener("click", toggleOwner);
  $("#owner-form").addEventListener("submit", signIn);
  $("#dialog-close").addEventListener("click", () => ownerDialog.close());
  $("#theme-toggle").addEventListener("click", () => {
    const nextTheme = document.body.dataset.theme === "sunset" ? "" : "sunset";
    document.body.dataset.theme = nextTheme;
    localStorage.setItem("hack-stock-theme", nextTheme);
    announce(nextTheme ? "Signal palette activated." : "Circuit palette activated.");
  });
}

async function start() {
  try {
    const [inventory, session] = await Promise.all([api("/api/inventory"), api("/api/session")]);
    state.items = inventory.items;
    state.owner = session.owner;
    document.body.dataset.theme = localStorage.getItem("hack-stock-theme") || "";
    bindControls();
    renderSession();
    renderInventory();
  } catch (error) {
    grid.setAttribute("aria-busy", "false");
    $("#results-count").textContent = "Unable to load inventory.";
    announce(error.message);
  }
}

start();
