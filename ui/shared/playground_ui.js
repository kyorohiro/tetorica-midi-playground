export function createPlaygroundUi(
  options
) {
  const {
    status,
    runtimeState,
    consoleOutput,
    codeTab,
    consoleTab,
    helpersTab,
    operatorTabButton,
    keyboardTab,
    consolePanel,
    codePanel,
    helpersPanel,
    operatorPanel,
    keyboardPanel,
  } = options;

  function setStatus(message) {
    status.textContent = message;
  }

  function setRuntimeState(message) {
    runtimeState.textContent = message;
  }

  function logLine(message) {
    consoleOutput.textContent += `${message}\n`;
    consoleOutput.scrollTop =
      consoleOutput.scrollHeight;
  }

  function clearConsole() {
    consoleOutput.textContent = "";
  }

  function formatLogArgs(args) {
    return args
      .map((value) => formatLogValue(value))
      .join(" ");
  }

  function formatLogValue(value) {
    if (typeof value === "string") {
      return value;
    }
    if (value instanceof ArrayBuffer) {
      return formatBinaryLogValue(
        new Uint8Array(value),
        "ArrayBuffer"
      );
    }
    if (ArrayBuffer.isView(value)) {
      return formatBinaryLogValue(
        new Uint8Array(
          value.buffer,
          value.byteOffset,
          value.byteLength
        ),
        value.constructor.name
      );
    }
    return JSON.stringify(value);
  }

  function formatBinaryLogValue(bytes, label) {
    const preview = Array.from(
      bytes.subarray(0, 16),
      (value) => value.toString(16).padStart(2, "0")
    ).join(" ");
    const suffix = bytes.byteLength > 16 ? " ..." : "";
    return `${label}(${bytes.byteLength}) [${preview}${suffix}]`;
  }

  const bottomTabs = [
    {
      name: "code",
      button: codeTab,
      panel: codePanel,
    },
    {
      name: "console",
      button: consoleTab,
      panel: consolePanel,
    },
    {
      name: "operator",
      button: operatorTabButton,
      panel: operatorPanel,
    },
    {
      name: "keyboard",
      button: keyboardTab,
      panel: keyboardPanel,
    },
    {
      name: "helpers",
      button: helpersTab,
      panel: helpersPanel,
    },
    ...(options.extraTabs || []),
  ];

  const primaryTabs = new Set(options.primaryTabs ?? ["code", "operator", "synthA", "synthB", "mixer"]);
  const hasTab = name => bottomTabs.some(tab => tab.name === name && (tab.button || tab.panel));
  let primaryTab = hasTab(options.initialPrimaryTab) && primaryTabs.has(options.initialPrimaryTab)
    ? options.initialPrimaryTab : "code";
  let bottomTab = hasTab(options.initialBottomTab) && !primaryTabs.has(options.initialBottomTab)
    ? options.initialBottomTab : "console";
  let dockOpen = options.initialDockOpen ?? true;
  let activeTab = "code";

  function getTabState() {
    return {primaryTab, bottomTab, dockOpen};
  }

  function renderTabs(tabName) {
    for (const tab of bottomTabs) {
      const isSelected =
        options.dockedPanels
          ? tab.name === (primaryTabs.has(tab.name) ? primaryTab : bottomTab)
          : tab.name === activeTab;
      tab.button?.setAttribute(
        "aria-selected",
        isSelected ? "true" : "false"
      );
      tab.button?.setAttribute("tabindex", isSelected ? "0" : "-1");
      if (tab.panel) {
        tab.panel.hidden =
          !isSelected || Boolean(options.dockedPanels && !primaryTabs.has(tab.name) && !dockOpen);
      }
    }
    if (options.dockedPanels) {
      if (options.dock) options.dock.hidden = !dockOpen;
      if (options.dockDivider) options.dockDivider.hidden = !dockOpen;
      options.dockToggle?.setAttribute("aria-expanded", String(dockOpen));
      options.dockToggle?.setAttribute("aria-label", dockOpen ? "Hide bottom panel" : "Show bottom panel");
    }
    options.onBottomTabChange?.(tabName, options.dockedPanels ? getTabState() : null);
  }

  function setBottomTab(tabName) {
    if (!hasTab(tabName)) return;
    if (options.dockedPanels) {
      if (primaryTabs.has(tabName)) primaryTab = tabName;
      else {bottomTab = tabName; dockOpen = true;}
    } else activeTab = tabName;
    renderTabs(tabName);
  }

  function setDockVisible(value) {
    dockOpen = Boolean(value);
    renderTabs(primaryTab);
  }

  function toggleDockVisible() {
    setDockVisible(!dockOpen);
  }

  function moveBottomTabFocus(
    activeTab,
    direction
  ) {
    const current = bottomTabs.find(tab => tab.button === activeTab);
    const tabs = bottomTabs.filter(tab => Boolean(tab.button) && !tab.button.hidden &&
      (!options.dockedPanels || primaryTabs.has(tab.name) === primaryTabs.has(current?.name)));
    if (options.dockedPanels) {
      const order = primaryTabs.has(current?.name) ? [...primaryTabs] : ["console", "shell", "keyboard", "helpers"];
      tabs.sort((a, b) => {
        const position = a.button.compareDocumentPosition?.(b.button) ?? 0;
        return position & 2 ? 1 : position & 4 ? -1 : order.indexOf(a.name) - order.indexOf(b.name);
      });
    }
    const currentIndex = tabs.findIndex(
      (tab) => tab.button === activeTab
    );

    if (currentIndex === -1) {
      return;
    }

    const nextIndex = direction === "first" ? 0 : direction === "last" ? tabs.length - 1 :
      (currentIndex + direction + tabs.length) % tabs.length;
    tabs[nextIndex]?.button?.focus();
    setBottomTab(tabs[nextIndex].name);
  }

  let handlersInstalled = false;
  function installBottomTabHandlers() {
    if (handlersInstalled) return;
    handlersInstalled = true;
    options.dockToggle?.addEventListener("click", toggleDockVisible);
    options.dockClose?.addEventListener("click", () => {
      setDockVisible(false);
      options.dockToggle?.focus();
    });
    for (const { name, button } of bottomTabs) {
      const tabButton = button;
      tabButton?.addEventListener(
        "click",
        () => {
          setBottomTab(name);
        }
      );
      tabButton?.addEventListener(
        "keydown",
        (event) => {
          if (event.key === "ArrowRight") {
            event.preventDefault();
            moveBottomTabFocus(
              tabButton,
              1
            );
          }

          if (event.key === "ArrowLeft") {
            event.preventDefault();
            moveBottomTabFocus(
              tabButton,
              -1
            );
          }
          if (event.key === "Home" || event.key === "End") {
            event.preventDefault();
            moveBottomTabFocus(tabButton, event.key === "Home" ? "first" : "last");
          }
        }
      );
    }
  }

  return {
    setStatus,
    setRuntimeState,
    logLine,
    clearConsole,
    formatLogArgs,
    setBottomTab,
    setDockVisible,
    toggleDockVisible,
    getTabState,
    moveBottomTabFocus,
    installBottomTabHandlers,
  };
}
