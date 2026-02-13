/**
 * sections/screens.js — Screens section
 *
 * Manages state, rendering, and event delegation for the
 * screen-navigation panel. Supports expandable screen rows
 * that display screen variables, aggregates, and actions.
 * For the current screen, variables show live runtime values
 * and can be edited inline.
 */

import { esc, escAttr, debounce, sendMessage, formatDateForInput } from '../utils/helpers.js';
import { show, hide, flashRow, toast } from '../utils/ui.js';
import { initPopupListeners, openVarPopup } from './screenVarPopup.js';

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

    // Trigger action button
    const triggerBtn = e.target.closest(".btn-trigger-action");
    if (triggerBtn) {
      e.stopPropagation();
      invokeScreenAction(triggerBtn);
      return;
    }

    // Boolean toggle for action params
    const actionParamToggle = e.target.closest(".action-param-toggle");
    if (actionParamToggle) {
      e.stopPropagation();
      actionParamToggle.classList.toggle("active");
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

  /* ---- Popup event listeners (delegated to screenVarPopup module) ---- */
  initPopupListeners(document.getElementById("var-popup-overlay"));
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
      if (isCurrent && ca.methodName) {
        html += buildScreenActionItem(ca);
      } else {
        html += `<div class="screen-detail-item">
          <span class="screen-detail-name">${esc(ca.name)}</span>
        </div>`;
      }
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
 * Build an interactive action item for the current screen.
 * Shows the action name, a trigger button, and expandable param inputs.
 */
function buildScreenActionItem(action) {
  const hasParams = action.params && action.params.length > 0;
  let html = `<div class="screen-action-item" data-method="${escAttr(action.methodName)}">`;
  html += `<div class="screen-action-header">`;
  html += `<span class="screen-detail-name">${esc(action.name)}</span>`;
  html += `<button class="btn-trigger-action" data-method="${escAttr(action.methodName)}" title="Trigger ${esc(action.name)}">`;
  html += `<svg class="action-play-icon" width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
  html += `<span class="action-btn-label">Run</span>`;
  html += `</button>`;
  html += `</div>`;

  if (hasParams) {
    html += `<div class="screen-action-params">`;
    for (const p of action.params) {
      html += buildActionParamInput(p, action.methodName);
    }
    html += `</div>`;
  }

  html += `</div>`;
  return html;
}

/**
 * Build an input control for a single action parameter.
 */
function buildActionParamInput(param, methodName) {
  const inputId = `action-param-${methodName}-${param.attrName || param.name}`;
  let inputHtml = "";

  if (param.dataType === "Boolean") {
    inputHtml = `<button class="bool-toggle action-param-toggle"
                         data-param-name="${escAttr(param.name)}"
                         data-type="Boolean">
                   <span class="knob"></span>
                 </button>`;
  } else if (param.dataType === "Date" || param.dataType === "Time" || param.dataType === "Date Time") {
    const inputType = param.dataType === "Date" ? "date" : param.dataType === "Time" ? "time" : "datetime-local";
    inputHtml = `<input class="var-value action-param-input ${param.dataType === "Date" || param.dataType === "Time" || param.dataType === "Date Time" ? "var-value-date" : ""}"
                        type="${inputType}" id="${escAttr(inputId)}"
                        data-param-name="${escAttr(param.name)}"
                        data-type="${escAttr(param.dataType)}"
                        ${param.dataType === "Time" ? 'step="1"' : ""} />`;
  } else {
    const inputType = ["Integer", "Decimal", "Currency", "Long Integer"].includes(param.dataType) ? "number" : "text";
    const step = param.dataType === "Decimal" || param.dataType === "Currency" ? 'step="any"' : "";
    inputHtml = `<input class="var-value action-param-input" type="${inputType}" id="${escAttr(inputId)}"
                        data-param-name="${escAttr(param.name)}"
                        data-type="${escAttr(param.dataType)}"
                        ${step}
                        placeholder="${escAttr(param.name)}" />`;
  }

  return `<div class="screen-action-param">
    <label class="action-param-label" for="${escAttr(inputId)}">
      ${esc(param.name)}${param.mandatory ? '<span class="action-param-required">*</span>' : ""}
    </label>
    <div class="action-param-control">
      ${inputHtml}
      <span class="screen-detail-type">${esc(param.dataType)}</span>
    </div>
  </div>`;
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

/**
 * Invoke a screen action via the trigger button.
 * Collects param values from sibling inputs and sends INVOKE_SCREEN_ACTION.
 */
async function invokeScreenAction(triggerBtn) {
  const methodName = triggerBtn.dataset.method;
  const actionItem = triggerBtn.closest(".screen-action-item");
  if (!actionItem) return;

  // Collect parameter values in DOM order to preserve correct param positions
  const paramValues = [];
  const paramRows = actionItem.querySelectorAll(".screen-action-param");

  paramRows.forEach(row => {
    const input = row.querySelector(".action-param-input");
    const toggle = row.querySelector(".action-param-toggle");
    if (input) {
      paramValues.push({
        value: input.value,
        dataType: input.dataset.type || "Text",
      });
    } else if (toggle) {
      paramValues.push({
        value: toggle.classList.contains("active"),
        dataType: "Boolean",
      });
    }
  });

  // Visual feedback: show loading state
  triggerBtn.disabled = true;
  const label = triggerBtn.querySelector(".action-btn-label");
  const origLabel = label ? label.textContent : "";
  if (label) label.textContent = "...";
  triggerBtn.classList.add("running");

  try {
    const result = await sendMessage({
      action: "INVOKE_SCREEN_ACTION",
      methodName,
      paramValues,
    });

    if (!result || !result.ok) {
      throw new Error(result?.error || "Action failed.");
    }

    flashRow(actionItem, "saved");
    toast("Action triggered", "success");
  } catch (err) {
    flashRow(actionItem, "error");
    toast(err.message, "error");
  } finally {
    triggerBtn.disabled = false;
    if (label) label.textContent = origLabel;
    triggerBtn.classList.remove("running");
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

      // If this is the current screen, fetch live runtime values and action metadata
      if (isCurrent) {
        await fetchLiveValues(details);
        await enrichScreenActions(details);
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
 * Enrich screen actions with runtime metadata from the live controller.
 * This provides accurate parameter type info and ensures methodName is set.
 */
async function enrichScreenActions(details) {
  if (!details.screenActions || details.screenActions.length === 0) return;

  try {
    const result = await sendMessage({ action: "GET_SCREEN_ACTIONS" });
    if (!result || !result.ok || !result.actions) return;

    // Build a map of runtime actions by normalized name
    const runtimeMap = {};
    for (const a of result.actions) {
      runtimeMap[a.name.toLowerCase()] = a;
    }

    // Merge runtime data into statically-parsed actions
    for (const action of details.screenActions) {
      const runtime = runtimeMap[action.name.toLowerCase()];
      if (runtime) {
        action.methodName = runtime.methodName;
        // Use runtime params if they have richer type info
        if (runtime.params && runtime.params.length > 0) {
          action.params = runtime.params;
        }
      }
    }
  } catch (e) {
    console.warn("[Screens] Failed to enrich screen actions:", e.message);
  }
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

