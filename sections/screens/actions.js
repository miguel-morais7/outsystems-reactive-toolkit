/**
 * sections/screens/actions.js — Screen action and data action invocation.
 *
 * Collects parameter values from the UI and triggers screen/data actions.
 */

import { sendMessage } from '../../utils/helpers.js';
import { flashRow, toast } from '../../utils/ui.js';
import { state } from './state.js';
import { buildDataActionOutputRow, buildAggregateOutputRow, buildServerActionOutputRow } from './builders.js';

/**
 * Invoke a screen action via the trigger button.
 * Collects param values from input parameter rows and sends INVOKE_SCREEN_ACTION.
 */
export async function invokeScreenAction(triggerBtn) {
  const methodName = triggerBtn.dataset.method;
  const actionItem = triggerBtn.closest(".screen-action-item");
  if (!actionItem) return;

  // Collect parameter values from the inputs section only (not locals)
  const paramValues = [];
  const inputsSection = actionItem.querySelector(".screen-action-inputs");
  if (inputsSection) {
    const paramRows = inputsSection.querySelectorAll(".screen-action-param-row");
    paramRows.forEach(row => {
      const input = row.querySelector(".action-param-input");
      const toggle = row.querySelector(".action-param-toggle");
      const popupBtn = row.querySelector(".btn-action-param-popup");

      if (popupBtn) {
        // Complex type — value is stored in page's temp map
        paramValues.push({
          value: null,
          dataType: popupBtn.dataset.type || "Record",
          attrName: popupBtn.dataset.attrName,
          isComplex: true,
        });
      } else if (input) {
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
  }

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

/**
 * Refresh a data action and update its output values in the UI.
 */
export async function refreshDataAction(triggerBtn) {
  const refreshMethodName = triggerBtn.dataset.refreshMethod;
  const actionItem = triggerBtn.closest(".data-action-item");
  if (!actionItem || !refreshMethodName) return;

  // Visual feedback: show loading state
  triggerBtn.disabled = true;
  const label = triggerBtn.querySelector(".action-btn-label");
  const origLabel = label ? label.textContent : "";
  if (label) label.textContent = "...";
  triggerBtn.classList.add("running");

  try {
    const result = await sendMessage({
      action: "REFRESH_DATA_ACTION",
      refreshMethodName,
    });

    if (!result || !result.ok) {
      throw new Error(result?.error || "Data action failed.");
    }

    // Re-fetch output values to update the UI
    const liveResult = await sendMessage({ action: "GET_DATA_ACTIONS" });
    if (liveResult?.ok && liveResult.dataActions) {
      const updated = liveResult.dataActions.find(
        da => da.refreshMethodName === refreshMethodName
      );
      if (updated && updated.outputs) {
        // Update cached details
        for (const screen of state.allScreens) {
          if (screen.details?.dataActions) {
            const da = screen.details.dataActions.find(
              d => d.refreshMethodName === refreshMethodName
            );
            if (da) {
              da.outputs = updated.outputs;
              da.varAttrName = updated.varAttrName || da.varAttrName;
            }
          }
        }

        // Re-render the output rows in place
        const bodyWrap = actionItem.querySelector(".screen-action-body-wrap");
        if (bodyWrap && updated.varAttrName) {
          let outputsHtml = `<div class="screen-action-body screen-action-inputs">`;
          outputsHtml += `<div class="screen-action-sub-header">Output Parameters</div>`;
          for (const o of updated.outputs) {
            outputsHtml += buildDataActionOutputRow(o, updated.varAttrName);
          }
          outputsHtml += `</div>`;
          bodyWrap.innerHTML = outputsHtml;
        }
      }
    }

    flashRow(actionItem, "saved");
    toast("Data action refreshed", "success");
  } catch (err) {
    flashRow(actionItem, "error");
    toast(err.message, "error");
  } finally {
    triggerBtn.disabled = false;
    if (label) label.textContent = origLabel;
    triggerBtn.classList.remove("running");
  }
}

/**
 * Refresh an aggregate and update its output values in the UI.
 */
export async function refreshAggregate(triggerBtn) {
  const refreshMethodName = triggerBtn.dataset.refreshMethod;
  const actionItem = triggerBtn.closest(".aggregate-item");
  if (!actionItem || !refreshMethodName) return;

  // Visual feedback: show loading state
  triggerBtn.disabled = true;
  const label = triggerBtn.querySelector(".action-btn-label");
  const origLabel = label ? label.textContent : "";
  if (label) label.textContent = "...";
  triggerBtn.classList.add("running");

  try {
    const result = await sendMessage({
      action: "REFRESH_AGGREGATE",
      refreshMethodName,
    });

    if (!result || !result.ok) {
      throw new Error(result?.error || "Aggregate refresh failed.");
    }

    // Re-fetch output values to update the UI
    const liveResult = await sendMessage({ action: "GET_AGGREGATES" });
    if (liveResult?.ok && liveResult.aggregates) {
      const updated = liveResult.aggregates.find(
        a => a.refreshMethodName === refreshMethodName
      );
      if (updated) {
        // Update cached details
        for (const screen of state.allScreens) {
          if (screen.details?.aggregates) {
            const aggr = screen.details.aggregates.find(
              a => a.refreshMethodName === refreshMethodName
            );
            if (aggr) {
              aggr.outputs = updated.outputs;
              aggr.varAttrName = updated.varAttrName || aggr.varAttrName;
            }
          }
        }

        // Re-render the output in place
        const bodyWrap = actionItem.querySelector(".screen-action-body-wrap");
        if (bodyWrap && updated.outputs && updated.outputs.length > 0 && updated.varAttrName) {
          let bodyHtml = `<div class="screen-action-body screen-action-inputs">`;
          bodyHtml += `<div class="screen-action-sub-header">Output</div>`;
          for (const o of updated.outputs) {
            bodyHtml += buildAggregateOutputRow(o, updated.varAttrName);
          }
          bodyHtml += `</div>`;
          bodyWrap.innerHTML = bodyHtml;
        }
      }
    }

    flashRow(actionItem, "saved");
    toast("Aggregate refreshed", "success");
  } catch (err) {
    flashRow(actionItem, "error");
    toast(err.message, "error");
  } finally {
    triggerBtn.disabled = false;
    if (label) label.textContent = origLabel;
    triggerBtn.classList.remove("running");
  }
}

/**
 * Invoke a server action via the trigger button.
 * Collects input param values and sends INVOKE_SERVER_ACTION.
 * On success, updates output parameter rows with returned values.
 */
export async function invokeServerAction(triggerBtn) {
  const methodName = triggerBtn.dataset.method;
  const actionItem = triggerBtn.closest(".server-action-item");
  if (!actionItem) return;

  // Collect parameter values from the inputs section
  const paramValues = [];
  const inputsSection = actionItem.querySelector(".screen-action-inputs");
  if (inputsSection) {
    const paramRows = inputsSection.querySelectorAll(".screen-action-param-row");
    paramRows.forEach(row => {
      const input = row.querySelector(".action-param-input");
      const toggle = row.querySelector(".action-param-toggle");
      const popupBtn = row.querySelector(".btn-action-param-popup");

      if (popupBtn) {
        paramValues.push({
          value: null,
          dataType: popupBtn.dataset.type || "Record",
          attrName: popupBtn.dataset.attrName,
          isComplex: true,
        });
      } else if (input) {
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
  }

  // Visual feedback: show loading state
  triggerBtn.disabled = true;
  const label = triggerBtn.querySelector(".action-btn-label");
  const origLabel = label ? label.textContent : "";
  if (label) label.textContent = "...";
  triggerBtn.classList.add("running");

  try {
    const result = await sendMessage({
      action: "INVOKE_SERVER_ACTION",
      methodName,
      paramValues,
    });

    if (!result || !result.ok) {
      throw new Error(result?.error || "Server action failed.");
    }

    // Update output parameter rows with returned values
    if (result.outputs && result.outputs.length > 0) {
      // Update cached details
      for (const screen of state.allScreens) {
        if (screen.details?.serverActions) {
          const sa = screen.details.serverActions.find(
            s => s.methodName === methodName
          );
          if (sa) {
            sa.outputs = result.outputs;
          }
        }
      }

      // Re-render the output rows in place
      const outputsSection = actionItem.querySelector(".server-action-outputs");
      if (outputsSection) {
        let outputsHtml = `<div class="screen-action-sub-header">Output Parameters</div>`;
        for (const o of result.outputs) {
          outputsHtml += buildServerActionOutputRow(o);
        }
        outputsSection.innerHTML = outputsHtml;
      }
    }

    flashRow(actionItem, "saved");
    toast("Server action completed", "success");
  } catch (err) {
    flashRow(actionItem, "error");
    toast(err.message, "error");
  } finally {
    triggerBtn.disabled = false;
    if (label) label.textContent = origLabel;
    triggerBtn.classList.remove("running");
  }
}
