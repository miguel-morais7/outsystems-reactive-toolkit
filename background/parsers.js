/**
 * background/parsers.js — OutSystems module parsers
 *
 * Fetch and parse OutSystems runtime files (moduleinfo, controller.js,
 * mvc.js) to extract screen lists, roles, and screen details.
 * These functions are pure fetch+parse — no Chrome extension APIs.
 */

/* ------------------------------------------------------------------ */
/*  FETCH SCREENS (via moduleinfo)                                     */
/* ------------------------------------------------------------------ */
export async function fetchScreens(pageUrl) {
  if (!pageUrl || !pageUrl.startsWith("http")) {
    return { ok: false, error: "Cannot access tab URL." };
  }

  const url = new URL(pageUrl);
  const pathParts = url.pathname.split("/").filter(Boolean);
  if (pathParts.length === 0) {
    return { ok: false, error: "Cannot determine module name from URL." };
  }

  const moduleName = pathParts[0];
  const moduleInfoUrl = `${url.origin}/${moduleName}/moduleservices/moduleinfo?${Date.now()}`;
  const currentScreen = pathParts.length > 1 ? pathParts[1] : "";

  let response;
  try {
    response = await fetch(moduleInfoUrl, { credentials: "include" });
  } catch (e) {
    return { ok: false, error: `Network error: ${e.message}` };
  }

  if (!response.ok) {
    return { ok: false, error: `Failed to fetch moduleinfo (HTTP ${response.status}).` };
  }

  let data;
  try {
    data = await response.json();
  } catch (e) {
    return { ok: false, error: "Invalid JSON in moduleinfo response." };
  }

  // Extract screens from urlMappings
  const urlMappings = data?.manifest?.urlMappings || {};
  const prefix = `/${moduleName}/`;
  const screenUrlSet = new Set();

  for (const key of Object.keys(urlMappings)) {
    if (!key.startsWith(prefix)) continue;
    const rest = key.substring(prefix.length);
    // Skip empty (root), files (.html), sub-paths, query params
    if (!rest || rest.includes("/") || rest.includes(".") || rest.includes("?")) continue;
    screenUrlSet.add(rest);
  }

  // Enrich with flow info from data.modules.screens
  const screenMap = {};
  const modules = data?.data?.modules || {};
  for (const moduleData of Object.values(modules)) {
    if (moduleData.screens) {
      for (const screen of moduleData.screens) {
        screenMap[screen.screenUrl] = screen.screenName;
      }
    }
  }

  const screens = [...screenUrlSet].sort().map((screenUrl) => {
    const fullName = screenMap[screenUrl] || screenUrl;
    const nameParts = fullName.split(".");
    return {
      screenUrl,
      name: nameParts.length > 1 ? nameParts.slice(1).join(".") : fullName,
      flow: nameParts.length > 1 ? nameParts[0] : "",
    };
  });

  return {
    ok: true,
    screens,
    moduleName,
    baseUrl: `${url.origin}/${moduleName}`,
    currentScreen,
  };
}

/* ------------------------------------------------------------------ */
/*  FETCH ROLES (via controller.js)                                    */
/* ------------------------------------------------------------------ */
export async function fetchRoles(pageUrl) {
  if (!pageUrl || !pageUrl.startsWith("http")) {
    return { ok: false, error: "Cannot access tab URL." };
  }

  const url = new URL(pageUrl);
  const pathParts = url.pathname.split("/").filter(Boolean);
  if (pathParts.length === 0) {
    return { ok: false, error: "Cannot determine module name from URL." };
  }

  const moduleName = pathParts[0];
  // Convert module name to the controller script format
  const controllerFileName = moduleName.charAt(0).toUpperCase() + moduleName.slice(1).toLowerCase() + ".controller.js";
  const controllerUrl = `${url.origin}/${moduleName}/scripts/${controllerFileName}?${Date.now()}`;

  let response;
  try {
    response = await fetch(controllerUrl, { credentials: "include" });
  } catch (e) {
    return { ok: false, error: `Network error: ${e.message}` };
  }

  if (!response.ok) {
    return { ok: false, error: `Failed to fetch controller.js (HTTP ${response.status}).` };
  }

  let scriptText;
  try {
    scriptText = await response.text();
  } catch (e) {
    return { ok: false, error: "Failed to read controller.js content." };
  }

  // Extract roles from Controller.prototype.roles = { ... }
  // Check if roles block exists
  if (!scriptText.includes("Controller.prototype.roles")) {
    return { ok: true, roles: [], moduleName };
  }

  const roles = [];

  // Match each role entry: RoleName: { roleKey: "...", roleException: new OS.Exceptions.Exceptions.NotRegisteredException("...", "message") }
  const rolePattern = /(\w+)\s*:\s*\{\s*roleKey\s*:\s*"[^"]*"\s*,\s*roleException\s*:\s*new\s+OS\.Exceptions\.Exceptions\.NotRegisteredException\s*\([^)]*\)/g;
  let match;
  while ((match = rolePattern.exec(scriptText)) !== null) {
    roles.push({
      name: match[1]
    });
  }

  return {
    ok: true,
    roles,
    moduleName,
  };
}

/* ------------------------------------------------------------------ */
/*  FETCH SCREEN DETAILS (via mvc.js)                                  */
/* ------------------------------------------------------------------ */
export async function fetchScreenDetails(baseUrl, moduleName, flow, screenName) {
  // Construct the MVC file URL: {baseUrl}/scripts/{Module}.{Flow}.{Screen}.mvc.js
  const mvcUrl = `${baseUrl}/scripts/${moduleName}.${flow}.${screenName}.mvc.js?${Date.now()}`;

  let response;
  try {
    response = await fetch(mvcUrl, { credentials: "include" });
  } catch (e) {
    return { ok: false, error: `Network error: ${e.message}` };
  }

  if (!response.ok) {
    return { ok: false, error: `Failed to fetch MVC file (HTTP ${response.status}).` };
  }

  let scriptText;
  try {
    scriptText = await response.text();
  } catch (e) {
    return { ok: false, error: "Failed to read MVC file content." };
  }

  const result = {
    ok: true,
    inputParameters: [],
    localVariables: [],
    aggregates: [],
    dataActions: [],
    serverActions: [],
    screenActions: [],
  };

  // ----------------------------------------------------------------
  // Extract Input Parameter names from Model.prototype.setInputs
  // Pattern: if("ParamName" in inputs) { ... }
  // ----------------------------------------------------------------
  const inputParamNames = new Set();
  const setInputsMatch = scriptText.match(/Model\.prototype\.setInputs\s*=\s*function\s*\([^)]*\)\s*\{([\s\S]*?)\n\};/);
  if (setInputsMatch) {
    const setInputsBody = setInputsMatch[1];
    const inputPattern = /if\s*\(\s*"([^"]+)"\s*in\s+inputs\s*\)/g;
    let inputMatch;
    while ((inputMatch = inputPattern.exec(setInputsBody)) !== null) {
      inputParamNames.add(inputMatch[1]);
    }
  }

  // ----------------------------------------------------------------
  // Parse Screen Variables from VariablesRecord.attributesToDeclare
  // Pattern: this.attr("DisplayName", "internalName", "...", true, false, OS.DataTypes.DataTypes.TypeName, ...)
  // ----------------------------------------------------------------
  const varPattern = /this\.attr\s*\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*"[^"]*"\s*,\s*(?:true|false)\s*,\s*(?:true|false)\s*,\s*OS\.DataTypes\.DataTypes\.(\w+)/g;
  let match;
  const seenVars = new Set();
  while ((match = varPattern.exec(scriptText)) !== null) {
    const displayName = match[1];
    const internalName = match[2];
    const rawType = match[3];
    // Normalize OutSystems DataTypes to display names (e.g. "DateTime" → "Date Time")
    const TYPE_MAP = { DateTime: "Date Time", LongInteger: "Long Integer", PhoneNumber: "Phone Number" };
    const dataType = TYPE_MAP[rawType] || rawType;
    // Skip aggregate/data action outputs (they have "Aggr" or "DataAct" in internal name)
    // Skip internal DataFetchStatus variables
    if (!seenVars.has(displayName) && !internalName.includes("Aggr") && !internalName.includes("DataAct") && !displayName.startsWith("_")) {
      if (inputParamNames.has(displayName)) {
        result.inputParameters.push({ name: displayName, internalName, type: dataType });
      } else {
        result.localVariables.push({ name: displayName, internalName, type: dataType });
      }
      seenVars.add(displayName);
    }
  }

  // ----------------------------------------------------------------
  // Parse Aggregates and Data Actions from dataFetchActionNames
  // Pattern: Controller.prototype.dataFetchActionNames = ["name1$AggrRefresh", "name2$DataActRefresh"];
  // ----------------------------------------------------------------
  const dataFetchMatch = scriptText.match(/dataFetchActionNames\s*=\s*\[([\s\S]*?)\]/);
  if (dataFetchMatch) {
    const namesStr = dataFetchMatch[1];
    const namePattern = /"([^"]+)"/g;
    while ((match = namePattern.exec(namesStr)) !== null) {
      const rawName = match[1];
      const isAggregate = rawName.endsWith("$AggrRefresh");
      const isDataAction = rawName.endsWith("$DataActRefresh");
      // Clean up the name (remove suffix)
      let name = rawName.replace(/\$AggrRefresh$/, "").replace(/\$DataActRefresh$/, "");
      // Convert camelCase to readable: getProducts -> GetProducts
      name = name.charAt(0).toUpperCase() + name.slice(1);
      if (isAggregate) {
        result.aggregates.push({ name });
      } else if (isDataAction) {
        result.dataActions.push({ name });
      }
    }
  }

  // ----------------------------------------------------------------
  // Parse Server Actions
  // Pattern: Controller.prototype.actionName$ServerAction = function
  // ----------------------------------------------------------------
  const serverActionPattern = /Controller\.prototype\.(\w+)\$ServerAction\s*=/g;
  while ((match = serverActionPattern.exec(scriptText)) !== null) {
    const name = match[1].charAt(0).toUpperCase() + match[1].slice(1);
    result.serverActions.push({ name });
  }

  // ----------------------------------------------------------------
  // Parse Screen Actions (Client Actions)
  // Pattern: Controller.prototype._actionName$Action = function (implementation)
  //          Controller.prototype.actionName$Action = function(params..., callContext) (proxy)
  // ----------------------------------------------------------------

  // Build a map of action name → input param attr names by matching proxy
  // params to internal function assignments (vars.value.ATTR = PARAM)
  const actionInputAttrNames = {};
  const proxyPattern = /Controller\.prototype\.(\w+)\$Action\s*=\s*function\s*\(([^)]*)\)/g;
  let proxyMatch;
  while ((proxyMatch = proxyPattern.exec(scriptText)) !== null) {
    const actionName = proxyMatch[1];
    const sigParams = proxyMatch[2].split(",").map(p => p.trim()).filter(p => p && p !== "callContext");
    // Find the internal function body to map proxy params → attrNames
    const internalRe = new RegExp("Controller\\.prototype\\._" + actionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "\\$Action\\s*=\\s*function\\s*\\([^)]*\\)\\s*\\{([\\s\\S]*?)\\n\\};");
    const internalMatch = internalRe.exec(scriptText);
    const resolvedAttrNames = new Set();
    if (internalMatch) {
      const body = internalMatch[1];
      for (const param of sigParams) {
        const assignRe = new RegExp("vars\\.value\\.(\\w+)\\s*=\\s*" + param + "(?:\\.|;|\\s|\\))");
        const assignMatch = assignRe.exec(body);
        if (assignMatch) {
          resolvedAttrNames.add(assignMatch[1]);
        }
      }
    }
    // Use resolved attrNames if found, otherwise fall back to proxy param names
    actionInputAttrNames[actionName.toLowerCase()] = resolvedAttrNames.size > 0 ? resolvedAttrNames : new Set(sigParams);
  }

  // Parse actual action implementations (underscore-prefixed)
  const screenActionPattern = /Controller\.prototype\._(\w+)\$Action\s*=/g;
  while ((match = screenActionPattern.exec(scriptText)) !== null) {
    const name = match[1];
    // Convert camelCase: onSort -> OnSort
    const displayName = name.charAt(0).toUpperCase() + name.slice(1);
    // The public proxy method name (without underscore prefix)
    const methodName = name + "$Action";
    result.screenActions.push({ name: displayName, methodName, inputs: [], locals: [] });
  }

  // ----------------------------------------------------------------
  // Enrich Screen Actions with parameter metadata
  // Pattern: Controller.registerVariableGroupType("...ActionName$vars", [{
  //   name: "ParamDisplay", attrName: "paramInternal", mandatory: bool,
  //   dataType: OS.DataTypes.DataTypes.TypeName, defaultValue: fn
  // }]);
  // ----------------------------------------------------------------
  const TYPE_MAP_ACTIONS = { DateTime: "Date Time", LongInteger: "Long Integer", PhoneNumber: "Phone Number" };
  const varGroupPattern = /Controller\.registerVariableGroupType\s*\(\s*"([^"]+\$vars)"\s*,\s*\[([\s\S]*?)\]\s*\)/g;
  let varGroupMatch;
  while ((varGroupMatch = varGroupPattern.exec(scriptText)) !== null) {
    const varGroupKey = varGroupMatch[1];
    const entriesStr = varGroupMatch[2];

    // Extract action name from key: "Module.Flow.Screen.ActionName$vars" → "ActionName"
    const keyParts = varGroupKey.replace("$vars", "").split(".");
    const actionNameFromKey = keyParts[keyParts.length - 1];

    // Find the matching screen action
    const action = result.screenActions.find(
      a => a.name.toLowerCase() === actionNameFromKey.toLowerCase()
    );
    if (!action) continue;

    // Get the set of input param attr names for this action
    const inputSet = actionInputAttrNames[actionNameFromKey.toLowerCase()] || new Set();

    // Parse individual entries and classify as input or local
    const paramPattern = /name:\s*"([^"]+)"[\s\S]*?attrName:\s*"([^"]+)"[\s\S]*?mandatory:\s*(true|false)[\s\S]*?dataType:\s*OS\.DataTypes\.DataTypes\.(\w+)/g;
    let paramMatch;
    while ((paramMatch = paramPattern.exec(entriesStr)) !== null) {
      const rawType = paramMatch[4];
      const dataType = TYPE_MAP_ACTIONS[rawType] || rawType;
      const entry = {
        name: paramMatch[1],
        attrName: paramMatch[2],
        dataType,
        mandatory: paramMatch[3] === "true",
      };
      if (inputSet.has(entry.attrName)) {
        action.inputs.push(entry);
      } else {
        action.locals.push(entry);
      }
    }
  }

  return result;
}
