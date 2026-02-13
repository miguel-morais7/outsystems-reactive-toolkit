/**
 * sections/screens.js — Screens section
 *
 * Manages state, rendering, and event delegation for the
 * screen-navigation panel. Supports expandable screen rows
 * that display screen variables, aggregates, and actions.
 * For the current screen, variables show live runtime values
 * and can be edited inline.
 */

import { esc, escAttr, debounce, sendMessage } from '../utils/helpers.js';
import { show, hide, flashRow, toast } from '../utils/ui.js';

/* ================================================================== */
/*  State                                                              */
/* ================================================================== */
let allScreens = [];
let screenBaseUrl = "";
let moduleName = "";
let currentScreen = "";
let collapsedScreenFlows = {};
let expandedScreens = {};  // screenUrl -> true/false
let loadingScreens = {};  // screenUrl -> true (while fetching)

/* ================================================================== */
/*  DOM references                                                     */
/* ================================================================== */
const inputSearch = document.getElementById("input-search-screens");
const screenList = document.getElementById("screen-list");
const screenCount = document.getElementById("screen-count");
const emptyState = document.getElementById("empty-state");
const popupOverlay = document.getElementById("var-popup-overlay");

/** The root section element (exported for the orchestrator). */
export const sectionEl = document.getElementById("screen-section");

/* ================================================================== */
/*  Read-only data types                                               */
/* ================================================================== */
const READ_ONLY_TYPES = ["RecordList", "Record", "Object", "BinaryData"];

/* ================================================================== */
/*  Public API                                                         */
/* ================================================================== */

/** Wire up event listeners. Call once at startup. */
export function init() {
  inputSearch.addEventListener("input", debounce(render, 150));

  screenList.addEventListener("click", (e) => {
    // Inspect popup icon for complex types
    const popupBtn = e.target.closest(".btn-var-popup");
    if (popupBtn) {
      e.stopPropagation();
      openVarPopup(popupBtn.dataset.internalName, popupBtn.dataset.name, popupBtn.dataset.type);
      return;
    }

    // Navigate button
    const navBtn = e.target.closest(".btn-navigate");
    if (navBtn) {
      e.stopPropagation();
      sendMessage({ action: "NAVIGATE", url: navBtn.dataset.url });
      return;
    }

    // Boolean toggle for screen vars
    const boolBtn = e.target.closest(".screen-var-toggle:not([disabled])");
    if (boolBtn) {
      e.stopPropagation();
      const isActive = boolBtn.classList.contains("active");
      const newVal = !isActive;
      boolBtn.classList.toggle("active", newVal);
      const row = boolBtn.closest(".screen-var-row");
      doSetScreenVar(boolBtn.dataset.internalName, newVal, "Boolean", row);
      return;
    }

    // Screen row expand/collapse (click on the row itself, not navigate button)
    const screenRow = e.target.closest(".screen-row");
    if (screenRow && !e.target.closest(".btn-navigate")) {
      const screenUrl = screenRow.dataset.screenUrl;
      const flow = screenRow.dataset.flow;
      const name = screenRow.dataset.name;
      toggleScreenExpand(screenUrl, flow, name);
      return;
    }

    // Module header collapse
    const header = e.target.closest(".module-header");
    if (header) {
      const mod = header.dataset.module;
      const body = header.nextElementSibling;
      const isCollapsed = header.classList.toggle("collapsed");
      body.classList.toggle("collapsed", isCollapsed);
      collapsedScreenFlows[mod] = isCollapsed;
    }
  });

  /* Keyboard: Enter → save, Escape → revert */
  screenList.addEventListener("keydown", (e) => {
    const input = e.target.closest("input.screen-var-input:not([readonly])");
    if (!input) return;
    if (e.key === "Enter") {
      e.preventDefault();
      commitScreenVarInput(input);
    }
    if (e.key === "Escape") {
      input.value = input.dataset.original;
      input.blur();
    }
  });

  /* Blur → save if value changed */
  screenList.addEventListener("focusout", (e) => {
    const input = e.target.closest("input.screen-var-input:not([readonly])");
    if (!input) return;
    if (input.value !== input.dataset.original) {
      commitScreenVarInput(input);
    }
  });

  /* Date/time/datetime pickers fire "change" */
  screenList.addEventListener("change", (e) => {
    const input = e.target.closest("input.screen-var-date:not([readonly])");
    if (!input) return;
    if (input.value !== input.dataset.original) {
      commitScreenVarInput(input);
    }
  });

  /* ---- Popup event listeners ---- */

  /* Close popup: click backdrop or close button */
  popupOverlay.addEventListener("click", (e) => {
    if (e.target === popupOverlay || e.target.closest(".var-popup-close")) {
      closeVarPopup();
      return;
    }

    // Append new record to list
    const appendBtn = e.target.closest(".btn-list-append");
    if (appendBtn) {
      e.stopPropagation();
      handleListAppendClick(appendBtn);
      return;
    }

    // Delete record from list
    const deleteBtn = e.target.closest(".btn-list-delete");
    if (deleteBtn) {
      e.stopPropagation();
      handleListDeleteClick(deleteBtn);
      return;
    }

    // Tree node expand/collapse
    const treeHeader = e.target.closest(".var-tree-header");
    if (treeHeader) {
      treeHeader.classList.toggle("collapsed");
      const children = treeHeader.nextElementSibling;
      if (children && children.classList.contains("var-tree-children")) {
        children.classList.toggle("collapsed");
      }
      return;
    }

    // Boolean toggle in tree
    const treeBool = e.target.closest(".bool-toggle");
    if (treeBool) {
      e.stopPropagation();
      const isActive = treeBool.classList.contains("active");
      const newVal = !isActive;
      treeBool.classList.toggle("active", newVal);
      const leaf = treeBool.closest(".var-tree-leaf");
      commitTreeLeaf(leaf, String(newVal));
      return;
    }
  });

  /* Tree leaf editing: Enter → save, Escape → revert */
  popupOverlay.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      // If an input is focused, revert it; otherwise close popup
      const input = e.target.closest(".var-tree-leaf-input");
      if (input && input.value !== input.dataset.original) {
        input.value = input.dataset.original;
        input.blur();
      } else {
        closeVarPopup();
      }
      return;
    }

    const input = e.target.closest(".var-tree-leaf-input");
    if (!input) return;
    if (e.key === "Enter") {
      e.preventDefault();
      const leaf = input.closest(".var-tree-leaf");
      commitTreeLeaf(leaf, input.value);
    }
  });

  /* Tree leaf editing: blur → save if changed */
  popupOverlay.addEventListener("focusout", (e) => {
    const input = e.target.closest(".var-tree-leaf-input");
    if (!input) return;
    if (input.value !== input.dataset.original) {
      const leaf = input.closest(".var-tree-leaf");
      commitTreeLeaf(leaf, input.value);
    }
  });
}

/** Replace section data after a scan. */
export function setData(screens, baseUrl, modName, current) {
  allScreens = screens;
  screenBaseUrl = baseUrl || "";
  moduleName = modName || "";
  currentScreen = current || "";
}

/** Return counts for the status-bar summary. */
export function getState() {
  return { count: allScreens.length };
}

/** Render (or re-render) the screens list. */
export function render() {
  const query = inputSearch.value.toLowerCase().trim();

  let filtered = allScreens;
  if (query) {
    filtered = filtered.filter(
      (s) =>
        s.name.toLowerCase().includes(query) ||
        s.screenUrl.toLowerCase().includes(query) ||
        s.flow.toLowerCase().includes(query)
    );
  }

  screenCount.textContent = filtered.length;

  if (filtered.length === 0 && allScreens.length > 0) {
    screenList.innerHTML = `<div class="no-results">No screens match your filter.</div>`;
    show(sectionEl);
    return;
  }

  if (filtered.length === 0) {
    hide(sectionEl);
    return;
  }

  // Group by flow
  const groups = {};
  filtered.forEach((s) => {
    const flow = s.flow || "Other";
    if (!groups[flow]) groups[flow] = [];
    groups[flow].push(s);
  });

  let html = "";
  for (const flow of Object.keys(groups).sort()) {
    const screens = groups[flow];
    const isCollapsed = !!collapsedScreenFlows[flow];

    html += `<div class="module-group" data-module="${esc(flow)}">`;
    html += `<div class="module-header ${isCollapsed ? "collapsed" : ""}" data-module="${esc(flow)}">`;
    html += `<svg class="chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;
    html += `<span>${esc(flow)}</span>`;
    html += `<span class="count-badge">${screens.length}</span>`;
    html += `</div>`;

    html += `<div class="module-body ${isCollapsed ? "collapsed" : ""}">`;
    for (const s of screens) {
      html += buildScreenRow(s);
    }
    html += `</div>`;
    html += `</div>`;
  }

  screenList.innerHTML = html;
  show(sectionEl);
  hide(emptyState);
}

/* ================================================================== */
/*  Private helpers                                                    */
/* ================================================================== */

function buildScreenRow(s) {
  const isCurrent = s.screenUrl === currentScreen;
  const isExpanded = !!expandedScreens[s.screenUrl];
  const isLoading = !!loadingScreens[s.screenUrl];
  const navUrl = screenBaseUrl + "/" + s.screenUrl;

  let html = `
    <div class="var-row screen-row screen-row-expandable ${isCurrent ? "screen-current" : ""} ${isExpanded ? "expanded" : ""}" 
         data-screen-url="${esc(s.screenUrl)}" data-flow="${esc(s.flow)}" data-name="${esc(s.name)}">
      <div class="var-info">
        <svg class="screen-expand-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        <span class="var-name">${esc(s.name)}</span>
        ${isCurrent ? '<span class="var-type screen-current-badge">CURRENT</span>' : ''}
      </div>
      <div class="var-value-wrap">
        <button class="btn-icon btn-navigate" data-url="${escAttr(navUrl)}" title="Navigate to ${esc(s.name)}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
            <polyline points="15 3 21 3 21 9"/>
            <line x1="10" y1="14" x2="21" y2="3"/>
          </svg>
        </button>
      </div>
    </div>`;

  // Add details panel if expanded
  if (isExpanded) {
    html += `<div class="screen-details">`;
    if (isLoading) {
      html += `<div class="screen-details-loading"><span class="mini-spinner"></span> Loading...</div>`;
    } else if (s.details) {
      html += buildScreenDetails(s.details, isCurrent);
    }
    html += `</div>`;
  }

  return html;
}

function buildScreenDetails(details, isCurrent) {
  let html = "";

  // Input Parameters
  if (details.inputParameters.length > 0) {
    html += `<div class="screen-detail-section">`;
    html += `<div class="screen-detail-header">Input Parameters</div>`;
    for (const v of details.inputParameters) {
      html += buildScreenVarItem(v, isCurrent);
    }
    html += `</div>`;
  }

  // Local Variables
  if (details.localVariables.length > 0) {
    html += `<div class="screen-detail-section">`;
    html += `<div class="screen-detail-header">Local Variables</div>`;
    for (const v of details.localVariables) {
      html += buildScreenVarItem(v, isCurrent);
    }
    html += `</div>`;
  }

  // Aggregates
  if (details.aggregates.length > 0) {
    html += `<div class="screen-detail-section">`;
    html += `<div class="screen-detail-header">Aggregates</div>`;
    for (const a of details.aggregates) {
      html += `<div class="screen-detail-item">
        <span class="screen-detail-name">${esc(a.name)}</span>
      </div>`;
    }
    html += `</div>`;
  }

  // Data Actions
  if (details.dataActions && details.dataActions.length > 0) {
    html += `<div class="screen-detail-section">`;
    html += `<div class="screen-detail-header">Data Actions</div>`;
    for (const da of details.dataActions) {
      html += `<div class="screen-detail-item">
        <span class="screen-detail-name">${esc(da.name)}</span>
      </div>`;
    }
    html += `</div>`;
  }

  // Server Actions
  if (details.serverActions.length > 0) {
    html += `<div class="screen-detail-section">`;
    html += `<div class="screen-detail-header">Server Actions</div>`;
    for (const sa of details.serverActions) {
      html += `<div class="screen-detail-item">
        <span class="screen-detail-name">${esc(sa.name)}</span>
      </div>`;
    }
    html += `</div>`;
  }

  // Screen Actions
  if (details.screenActions.length > 0) {
    html += `<div class="screen-detail-section">`;
    html += `<div class="screen-detail-header">Screen Actions</div>`;
    for (const ca of details.screenActions) {
      html += `<div class="screen-detail-item">
        <span class="screen-detail-name">${esc(ca.name)}</span>
      </div>`;
    }
    html += `</div>`;
  }

  // If no details at all
  const hasDataActions = details.dataActions && details.dataActions.length > 0;
  if (details.inputParameters.length === 0 && details.localVariables.length === 0 &&
    details.aggregates.length === 0 && !hasDataActions && details.serverActions.length === 0 &&
    details.screenActions.length === 0) {
    html += `<div class="screen-details-empty">No details found for this screen.</div>`;
  }

  return html;
}

/**
 * Build a single variable/input param item.
 * If isCurrent is true and the variable has a live value, show editable controls.
 */
function buildScreenVarItem(v, isCurrent) {
  const isReadOnly = READ_ONLY_TYPES.includes(v.type);
  const hasLiveValue = isCurrent && v.value !== undefined;

  // If not the current screen or no live value, show simple display
  if (!hasLiveValue) {
    return `<div class="screen-detail-item">
      <span class="screen-detail-name">${esc(v.name)}</span>
      <span class="screen-detail-type">${esc(v.type)}</span>
    </div>`;
  }

  // Current screen with live value — show editable control
  let valueControl = "";

  if (v.type === "Boolean" && !isReadOnly) {
    const active = v.value === true || v.value === "true" || v.value === "True";
    valueControl = `
      <button class="bool-toggle screen-var-toggle ${active ? "active" : ""}"
              data-internal-name="${escAttr(v.internalName)}" data-type="Boolean"
              ${isReadOnly ? "disabled" : ""}>
        <span class="knob"></span>
      </button>`;
  } else if ((v.type === "Date" || v.type === "Time" || v.type === "Date Time") && !isReadOnly) {
    const inputType = v.type === "Date" ? "date" : v.type === "Time" ? "time" : "datetime-local";
    const displayValue = formatDateForInput(v.value, v.type);
    valueControl = `
      <input class="var-value var-value-date screen-var-date"
             type="${inputType}"
             value="${escAttr(displayValue)}"
             data-internal-name="${escAttr(v.internalName)}"
             data-type="${esc(v.type)}"
             data-original="${escAttr(displayValue)}"
             ${isReadOnly ? "readonly" : ""}
             ${v.type === "Time" ? 'step="1"' : ""}
             title="${isReadOnly ? "Read-only" : "Edit to save"}" />`;
  } else if (isReadOnly) {
    // Complex types — show inspect icon instead of read-only input
    valueControl = `
      <button class="btn-icon btn-var-popup"
              data-internal-name="${escAttr(v.internalName)}"
              data-type="${esc(v.type)}"
              data-name="${escAttr(v.name)}"
              title="Inspect ${esc(v.name)}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M15 3h6v6"/>
          <path d="M10 14L21 3"/>
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
        </svg>
      </button>`;
  } else {
    const displayValue = v.value === null ? "" : String(v.value);
    valueControl = `
      <input class="var-value screen-var-input"
             type="text"
             value="${escAttr(displayValue)}"
             data-internal-name="${escAttr(v.internalName)}"
             data-type="${esc(v.type)}"
             data-original="${escAttr(displayValue)}"
             title="Press Enter to save" />`;
  }

  return `<div class="screen-detail-item screen-var-row" data-internal-name="${escAttr(v.internalName)}">
    <div class="screen-var-info">
      <span class="screen-detail-name">${esc(v.name)}</span>
      <span class="screen-detail-type">${esc(v.type)}</span>
    </div>
    <div class="screen-var-value-wrap">
      ${valueControl}
    </div>
  </div>`;
}

/**
 * Convert an ISO date string to the format required by HTML date/time inputs.
 */
function formatDateForInput(isoString, type) {
  if (!isoString) return "";
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return "";
    if (type === "Date") {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    } else if (type === "Time") {
      const h = String(d.getHours()).padStart(2, "0");
      const min = String(d.getMinutes()).padStart(2, "0");
      const s = String(d.getSeconds()).padStart(2, "0");
      return `${h}:${min}:${s}`;
    } else {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      const h = String(d.getHours()).padStart(2, "0");
      const min = String(d.getMinutes()).padStart(2, "0");
      return `${y}-${m}-${day}T${h}:${min}`;
    }
  } catch {
    return "";
  }
}

/** Send a SET_SCREEN_VAR message and handle the response. */
async function doSetScreenVar(internalName, rawValue, dataType, rowEl) {
  try {
    const result = await sendMessage({
      action: "SET_SCREEN_VAR",
      internalName,
      value: rawValue,
      dataType,
    });

    if (!result || !result.ok) {
      throw new Error(result?.error || "Failed to set value.");
    }

    // Update cached live value
    updateCachedVarValue(internalName, result.newValue);

    flashRow(rowEl, "saved");
    toast(`Variable updated`, "success");
    return true;
  } catch (err) {
    flashRow(rowEl, "error");
    toast(err.message, "error");
    return false;
  }
}

/** Commit an input's value to the runtime. */
async function commitScreenVarInput(input) {
  const row = input.closest(".screen-var-row");
  const ok = await doSetScreenVar(
    input.dataset.internalName, input.value, input.dataset.type, row
  );
  if (ok) {
    input.dataset.original = input.value;
  } else {
    input.value = input.dataset.original;
  }
}

/** Update the cached variable value in the screen's details. */
function updateCachedVarValue(internalName, newValue) {
  for (const screen of allScreens) {
    if (screen.details) {
      for (const v of [...screen.details.inputParameters, ...screen.details.localVariables]) {
        if (v.internalName === internalName) {
          v.value = newValue;
          return;
        }
      }
    }
  }
}

async function toggleScreenExpand(screenUrl, flow, screenName) {
  // Toggle expansion
  expandedScreens[screenUrl] = !expandedScreens[screenUrl];

  // If collapsing, clear details and re-render
  if (!expandedScreens[screenUrl]) {
    const screen = allScreens.find(s => s.screenUrl === screenUrl);
    if (screen) {
      delete screen.details;  // Clear cached details
    }
    render();
    return;
  }

  const isCurrent = screenUrl === currentScreen;

  // Always fetch fresh details when expanding
  loadingScreens[screenUrl] = true;
  render();

  try {
    const response = await sendMessage({
      action: "FETCH_SCREEN_DETAILS",
      baseUrl: screenBaseUrl,
      moduleName: moduleName,
      flow: flow,
      screenName: screenName,
    });

    if (response.ok) {
      const details = {
        inputParameters: response.inputParameters || [],
        localVariables: response.localVariables || [],
        aggregates: response.aggregates || [],
        dataActions: response.dataActions || [],
        serverActions: response.serverActions || [],
        screenActions: response.screenActions || [],
      };

      // If this is the current screen, fetch live runtime values
      if (isCurrent) {
        await fetchLiveValues(details);
      }

      // Store details directly on the screen object
      const screen = allScreens.find(s => s.screenUrl === screenUrl);
      if (screen) {
        screen.details = details;
      }
    } else {
      // Store error details
      const screen = allScreens.find(s => s.screenUrl === screenUrl);
      if (screen) {
        screen.details = {
          inputParameters: [],
          localVariables: [],
          aggregates: [],
          dataActions: [],
          serverActions: [],
          screenActions: [],
          error: response.error,
        };
      }
    }
  } catch (e) {
    // Store error details
    const screen = allScreens.find(s => s.screenUrl === screenUrl);
    if (screen) {
      screen.details = {
        inputParameters: [],
        localVariables: [],
        aggregates: [],
        dataActions: [],
        serverActions: [],
        screenActions: [],
        error: e.message,
      };
    }
  }

  loadingScreens[screenUrl] = false;
  render();
}

/**
 * Fetch live runtime values for the current screen's variables.
 * Merges the live values back into the details object.
 */
async function fetchLiveValues(details) {
  // Build varDefs from parsed metadata
  const varDefs = [
    ...details.inputParameters.map(v => ({
      name: v.name,
      internalName: v.internalName,
      type: v.type,
      isInput: true,
    })),
    ...details.localVariables.map(v => ({
      name: v.name,
      internalName: v.internalName,
      type: v.type,
      isInput: false,
    })),
  ];

  if (varDefs.length === 0) return;

  try {
    const result = await sendMessage({
      action: "GET_SCREEN_VARS",
      varDefs,
    });

    if (result && result.ok && result.variables) {
      // Merge live values back into details
      const valueMap = {};
      for (const v of result.variables) {
        valueMap[v.internalName] = v;
      }

      for (const v of details.inputParameters) {
        const live = valueMap[v.internalName];
        if (live) {
          v.value = live.value;
          v.readOnly = live.readOnly;
        }
      }

      for (const v of details.localVariables) {
        const live = valueMap[v.internalName];
        if (live) {
          v.value = live.value;
          v.readOnly = live.readOnly;
        }
      }
    }
  } catch (e) {
    // Silently fail — the screen details will still show without live values
    console.warn("[Screens] Failed to fetch live values:", e.message);
  }
}

/* ================================================================== */
/*  Variable Inspect Popup                                             */
/* ================================================================== */

/** State for the currently open popup */
let popupState = null; // { internalName, name, type }

/**
 * Open the inspect popup for a complex type variable.
 * Sends INTROSPECT_SCREEN_VAR and renders the tree view.
 */
async function openVarPopup(internalName, name, type) {
  popupState = { internalName, name, type };

  // Show popup with loading state
  popupOverlay.innerHTML = `
    <div class="var-popup">
      <div class="var-popup-header">
        <div class="var-popup-header-info">
          <div class="var-popup-title">${esc(name)}</div>
          <div class="var-popup-subtitle">${esc(type)}</div>
        </div>
        <button class="var-popup-close" title="Close">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
      <div class="var-popup-body">
        <div class="var-popup-loading"><span class="mini-spinner"></span> Inspecting…</div>
      </div>
    </div>`;
  popupOverlay.classList.remove("hidden");

  // Fetch the introspected tree
  try {
    const result = await sendMessage({
      action: "INTROSPECT_SCREEN_VAR",
      internalName,
    });

    if (!result || !result.ok) {
      renderPopupError(result?.error || "Failed to introspect variable.");
      return;
    }

    // Render the tree view
    const body = popupOverlay.querySelector(".var-popup-body");
    if (body) {
      body.innerHTML = `<div class="var-tree">${buildTreeNode(result.tree, [], 0)}</div>`;
    }
  } catch (e) {
    renderPopupError(e.message);
  }
}

/** Close the popup and clear state. */
function closeVarPopup() {
  popupOverlay.classList.add("hidden");
  popupOverlay.innerHTML = "";
  popupState = null;
}

/** Render an error message in the popup body. */
function renderPopupError(msg) {
  const body = popupOverlay.querySelector(".var-popup-body");
  if (body) {
    body.innerHTML = `<div class="var-popup-error">${esc(msg)}</div>`;
  }
}

/**
 * Recursively build HTML for a tree node.
 *
 * @param {Object} node - Tree node from _osScreenVarIntrospect
 * @param {Array} path - Path of steps from root to this node
 * @param {number} depth - Current depth for auto-collapse
 * @returns {string} HTML string
 */
function buildTreeNode(node, path, depth) {
  if (!node) return "";

  // Clean up the display name: strip trailing "Attr", "Var", "Out" suffixes
  const displayKey = cleanAttrName(node.key);

  if (node.kind === "primitive") {
    return buildTreeLeaf(node, path, displayKey);
  }

  if (node.kind === "list") {
    const isCollapsed = depth > 1 ? " collapsed" : "";
    const childrenCollapsed = depth > 1 ? " collapsed" : "";
    const listPathJson = escAttr(JSON.stringify(path));
    let html = `<div class="var-tree-node ${depth === 0 ? "var-tree-root" : ""}">`;
    html += `<div class="var-tree-header${isCollapsed}">`;
    html += `<svg class="var-tree-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;
    html += `<span class="var-tree-key">${esc(displayKey)}</span>`;
    html += `<span class="var-tree-badge">${node.count} item${node.count !== 1 ? "s" : ""}</span>`;
    html += `</div>`;
    html += `<div class="var-tree-children${childrenCollapsed}">`;
    for (const item of node.items) {
      const itemIndex = parseInt(item.key, 10);
      const itemPath = [...path, { index: itemIndex }];
      // Wrap each list item with a delete button
      html += `<div class="var-tree-list-item">`;
      html += `<button class="btn-list-delete" data-path="${listPathJson}" data-index="${itemIndex}" title="Delete item ${itemIndex}">`;
      html += `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
      html += `</button>`;
      html += buildTreeNode(item, itemPath, depth + 1);
      html += `</div>`;
    }
    if (node.truncated) {
      html += `<div class="var-tree-leaf"><span class="var-tree-leaf-name" style="font-style:italic;color:var(--text-muted)">… more items</span></div>`;
    }
    // Append button at the bottom of the list
    html += `<button class="btn-list-append" data-path="${listPathJson}">`;
    html += `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
    html += ` Add record</button>`;
    html += `</div></div>`;
    return html;
  }

  if (node.kind === "record") {
    const isCollapsed = depth > 2 ? " collapsed" : "";
    const childrenCollapsed = depth > 2 ? " collapsed" : "";
    let html = `<div class="var-tree-node ${depth === 0 ? "var-tree-root" : ""}">`;
    html += `<div class="var-tree-header${isCollapsed}">`;
    html += `<svg class="var-tree-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;
    html += `<span class="var-tree-key">${esc(displayKey)}</span>`;
    html += `<span class="var-tree-badge">${node.fields.length} field${node.fields.length !== 1 ? "s" : ""}</span>`;
    html += `</div>`;
    html += `<div class="var-tree-children${childrenCollapsed}">`;
    for (const field of node.fields) {
      const fieldPath = [...path, field.key];
      html += buildTreeNode(field, fieldPath, depth + 1);
    }
    html += `</div></div>`;
    return html;
  }

  // Fallback
  return `<div class="var-tree-leaf"><span class="var-tree-leaf-name">${esc(displayKey)}</span><span class="var-tree-badge">${esc(String(node.value || ""))}</span></div>`;
}

/**
 * Build an inline-editable leaf node for a primitive value.
 */
function buildTreeLeaf(node, path, displayKey) {
  const val = node.value === null || node.value === undefined ? "" : String(node.value);
  const pathJson = escAttr(JSON.stringify(path));

  // Boolean: show toggle
  if (node.type === "boolean" || val === "true" || val === "false") {
    const active = val === "true" ? " active" : "";
    return `<div class="var-tree-leaf" data-path="${pathJson}" data-type="Boolean">
      <span class="var-tree-leaf-name">${esc(displayKey)}:</span>
      <button class="bool-toggle${active}"><span class="knob"></span></button>
    </div>`;
  }

  // Default: text input
  return `<div class="var-tree-leaf" data-path="${pathJson}" data-type="${escAttr(node.type || "Text")}">
    <span class="var-tree-leaf-name">${esc(displayKey)}:</span>
    <input class="var-tree-leaf-input" type="text"
           value="${escAttr(val)}"
           data-original="${escAttr(val)}" />
    ${node.type ? `<span class="var-tree-leaf-type">${esc(node.type)}</span>` : ""}
  </div>`;
}

/**
 * Clean up OutSystems internal attribute names for display.
 * Strips common suffixes like "Attr", "Var", "Out" and converts to readable form.
 */
function cleanAttrName(name) {
  if (!name) return "";
  // Strip "Attr" suffix
  let clean = name.replace(/Attr$/, "");
  // Strip "Var" suffix
  clean = clean.replace(/Var$/, "");
  // Strip "Out" suffix for aggregate outputs
  clean = clean.replace(/Out$/, "");
  // Convert camelCase to Title Case with spaces
  clean = clean.replace(/([a-z])([A-Z])/g, "$1 $2");
  // Capitalize first letter
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

/**
 * Commit a tree leaf value change via SET_SCREEN_VAR_DEEP.
 */
async function commitTreeLeaf(leafEl, newValue) {
  if (!popupState) return;

  const pathJson = leafEl.dataset.path;
  const dataType = leafEl.dataset.type || "Text";
  let path;
  try {
    path = JSON.parse(pathJson);
  } catch (e) {
    toast("Invalid path data", "error");
    return;
  }

  try {
    const result = await sendMessage({
      action: "SET_SCREEN_VAR_DEEP",
      internalName: popupState.internalName,
      path,
      value: newValue,
      dataType,
    });

    if (!result || !result.ok) {
      throw new Error(result?.error || "Failed to set value.");
    }

    // Update the input's original value for future change detection
    const input = leafEl.querySelector(".var-tree-leaf-input");
    if (input) {
      input.dataset.original = input.value;
    }

    flashRow(leafEl, "saved");
    toast("Value updated", "success");
  } catch (err) {
    flashRow(leafEl, "error");
    toast(err.message, "error");

    // Revert the input
    const input = leafEl.querySelector(".var-tree-leaf-input");
    if (input) {
      input.value = input.dataset.original;
    }
  }
}

/**
 * Handle clicking the "Add record" button on a list node.
 * Sends LIST_APPEND, then re-renders the popup tree.
 */
async function handleListAppendClick(btn) {
  if (!popupState) return;

  let path;
  try {
    path = JSON.parse(btn.dataset.path);
  } catch (e) {
    toast("Invalid path data", "error");
    return;
  }

  btn.disabled = true;
  const origText = btn.textContent;
  btn.textContent = "Adding…";

  try {
    const result = await sendMessage({
      action: "LIST_APPEND",
      internalName: popupState.internalName,
      path,
    });

    if (!result || !result.ok) {
      throw new Error(result?.error || "Failed to append record.");
    }

    // Re-render the entire tree with the updated data
    const body = popupOverlay.querySelector(".var-popup-body");
    if (body) {
      body.innerHTML = `<div class="var-tree">${buildTreeNode(result.tree, [], 0)}</div>`;
    }

    toast("Record added", "success");
  } catch (err) {
    toast(err.message, "error");
    btn.disabled = false;
    btn.textContent = origText;
  }
}

/**
 * Handle clicking the delete button on a list item.
 * Sends LIST_DELETE, then re-renders the popup tree.
 */
async function handleListDeleteClick(btn) {
  if (!popupState) return;

  let path;
  try {
    path = JSON.parse(btn.dataset.path);
  } catch (e) {
    toast("Invalid path data", "error");
    return;
  }

  const index = parseInt(btn.dataset.index, 10);
  if (isNaN(index)) {
    toast("Invalid item index", "error");
    return;
  }

  // Visual feedback — fade the item
  const listItem = btn.closest(".var-tree-list-item");
  if (listItem) listItem.style.opacity = "0.5";

  try {
    const result = await sendMessage({
      action: "LIST_DELETE",
      internalName: popupState.internalName,
      path,
      index,
    });

    if (!result || !result.ok) {
      throw new Error(result?.error || "Failed to delete record.");
    }

    // Re-render the entire tree with the updated data
    const body = popupOverlay.querySelector(".var-popup-body");
    if (body) {
      body.innerHTML = `<div class="var-tree">${buildTreeNode(result.tree, [], 0)}</div>`;
    }

    toast("Record deleted", "success");
  } catch (err) {
    toast(err.message, "error");
    if (listItem) listItem.style.opacity = "1";
  }
}
