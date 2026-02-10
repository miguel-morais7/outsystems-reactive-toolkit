# OutSystems Reactive Toolkit — Chrome Extension

A Chrome side panel extension for inspecting and editing **OutSystems Reactive** application runtime data. It provides deep visibility into client variables, screen details, roles, and producer references.

## Features

### 1. Client Variables
- **Scan & Edit**: Discover and modify client variables across all loaded modules.
- **Type Support**: Handles Text, Boolean, Integer, Decimal, Currency, Date, Time, and DateTime.
- **Normalization**: Automatically maps OutSystems internal types to user-friendly formats.

### 2. Screen Inspection & Live Editing (New)
- **Navigation**: List all application screens grouped by Flow.
- **Deep Inspection**: Expand any screen to view its:
  - **Input Parameters**
  - **Local Variables**
  - **Aggregates**
  - **Data Actions**
  - **Server Actions**
  - **Screen Actions**
- **Live Editing**: For the **currently active screen**, you can view and edit Input Parameters and Local Variables in real-time.
- **Visual Feedback**: The current screen is highlighted, and changes are instantly applied to the running application.

### 3. Role Discovery (New)
- **List Roles**: Discover and list all security roles defined in the application's modules.
- **Searchable**: Quickly find roles by name using the built-in search bar.

### 4. Producer References
- **Health Check**: List producer references from all `referencesHealth.js` modules.
- **Status Indicators**: Instantly see if a reference is "OK" or broken.

### 5. Enhanced UI/UX
- **Sticky Headers**: Search bars and section headers remain visible while scrolling.
- **Collapsible Flows**: Easily manage large applications by collapsing module/flow groups.
- **Auto-Rescan**: Extension automatically updates when you navigate or refresh the page.

## Installation

1. Clone or download this repository.
2. Open `chrome://extensions` in Chrome (or your Chromium-based browser).
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** and select the `chrome-extension` folder.
5. The extension icon will appear in the toolbar. Click it to open the side panel.

## Usage

1. Navigate to an OutSystems Reactive application in your browser.
2. Click the **OutSystems Reactive Toolkit** icon in the toolbar to open the side panel.
3. Click **Scan** to discover client variables, producers, and screens on the current page.
4. Use the search bars and module filters to locate specific items.
5. Click a variable value to edit it inline (read-only variables are marked accordingly).
6. Click a screen name to navigate to that screen.

## Project Structure

```
chrome-extension/
├── manifest.json          # MV3 extension manifest
├── background.js          # Service worker — handles fetching & script injection
├── pageScript.js          # Injected logic — accesses React Fiber & OS Runtime
├── sidepanel.html         # Main UI layout
├── sidepanel.css          # Styles (sticky headers, dark mode friendly)
├── sidepanel.js           # Orchestrator — manages sections & messaging
├── sections/              # Modular feature components
│   ├── variables.js       # Client Variables (Scan, Edit)
│   ├── screens.js         # Screens (Nav, Expand, Live Edit)
│   ├── roles.js           # Roles (Discovery)
│   └── producers.js       # Producers (Health Status)
├── utils/                 # Utilities
│   ├── helpers.js         # Debounce, escape, etc.
│   └── ui.js              # Toasts, visibility, animations
└── icons/                 # Extension icons
```

## How It Works

1. **Service Worker** (`background.js`) listens for messages from the side panel and injects `pageScript.js` into the active tab's MAIN world using `chrome.scripting.executeScript`.
2. **Page Script** (`pageScript.js`) leverages the OutSystems AMD `require()` loader and `performance.getEntriesByType("resource")` to discover `*.clientVariables.js` and `*.referencesHealth.js` modules at runtime. It exposes global functions (`_osClientVarsScan`, `_osClientVarsSet`, `_osClientVarsGet`) that the service worker invokes.
3. **Side Panel** uses a modular, section-based architecture:
   - **Orchestrator** (`sidepanel.js`) coordinates scans, distributes data to sections, and manages auto-rescan logic
   - **Section Modules** (`sections/*.js`) each handle their own rendering, state, filtering, and events — making the codebase easy to extend
   - **Utilities** (`utils/*.js`) provide shared functions for messaging, DOM manipulation, and UI feedback
   - Sections communicate with the service worker via `chrome.runtime.sendMessage`

## Architecture

The side panel follows a **modular, section-based architecture** that makes it easy to add new features without touching existing code.

### Section Modules
Each section (`sections/*.js`) is a self-contained module that exports:
- `init()` — Initialize DOM references and event listeners
- `setData(data)` — Receive and store data from scans
- `getState()` — Return current filter/search state
- `render()` — Update the UI based on current state

Sections manage their own:
- State (data, collapsed state, filters)
- DOM references and event listeners
- Rendering and filtering logic
- User interactions (editing, navigation)

### Adding a New Section
To add a new section:
1. Create `sections/newsection.js` following the same export pattern
2. Add corresponding HTML markup to `sidepanel.html`
3. Register it in the `sections` array in `sidepanel.js`
4. Update `pageScript.js` to scan the relevant data

No changes to existing sections required!

### Shared Utilities
- **`utils/helpers.js`** — Pure functions (escaping, debouncing, messaging)
- **`utils/ui.js`** — DOM manipulation (visibility, toasts, animations)

## Permissions

| Permission | Reason |
|---|---|
| `activeTab` | Access the currently active tab for script injection |
| `scripting` | Inject `pageScript.js` into the page's MAIN world |
| `sidePanel` | Render the extension UI as a Chrome side panel |
| `tabs` | Listen for tab navigation events to trigger auto-rescan |
| `host_permissions (http/https)` | Allow script injection on any HTTP/HTTPS page |

## Requirements

- Chrome 116+ (or any Chromium-based browser with Side Panel API support)
- The target page must be an OutSystems Reactive application that uses the AMD module loader

## License

This project is provided as-is for internal/development use.
