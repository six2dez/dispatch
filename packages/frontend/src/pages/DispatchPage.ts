import type { CaidoSDK } from "../types";
import { createTerminalPanel, clearTerminal } from "../components/Terminal";
import { createSettingsPanel } from "../components/ToolList";
import { createHistoryPanel } from "../components/RunHistory";
import { createHelpPanel } from "../components/HelpPanel";

export function createDispatchPage(sdk: CaidoSDK): HTMLElement {
  const container = document.createElement("div");
  container.className = "dispatch-page";

  // Tab bar
  const tabBar = document.createElement("div");
  tabBar.className = "dispatch-tabs";

  // Create panels
  const terminalPanel = createTerminalPanel(sdk);
  const settingsPanel = createSettingsPanel(sdk);
  const historyPanel = createHistoryPanel(sdk);
  const helpPanel = createHelpPanel();

  // Add clear button for terminal tab
  const terminalTabWrap = document.createElement("div");
  terminalTabWrap.style.display = "flex";
  terminalTabWrap.style.flex = "1";
  terminalTabWrap.style.flexDirection = "column";
  terminalTabWrap.style.overflow = "hidden";

  const terminalToolbar = document.createElement("div");
  terminalToolbar.style.display = "flex";
  terminalToolbar.style.justifyContent = "flex-end";
  terminalToolbar.style.padding = "4px 8px";
  terminalToolbar.style.borderBottom = "1px solid var(--c-border-default, #333)";
  terminalToolbar.style.flexShrink = "0";

  const clearBtn = document.createElement("button");
  clearBtn.className = "dispatch-btn dispatch-btn-sm";
  clearBtn.textContent = "Clear";
  clearBtn.addEventListener("click", () => clearTerminal());
  terminalToolbar.appendChild(clearBtn);

  terminalTabWrap.appendChild(terminalToolbar);
  terminalPanel.style.flex = "1";
  terminalPanel.style.overflow = "auto";
  terminalTabWrap.appendChild(terminalPanel);

  const allPanels = [terminalTabWrap, settingsPanel, historyPanel, helpPanel];

  // Create tabs
  const tabNames = ["Terminal", "Settings", "History", "Help"];
  tabNames.forEach((name, index) => {
    const tab = document.createElement("button");
    tab.className = "dispatch-tab";
    tab.textContent = name;
    tab.addEventListener("click", () => {
      tabBar
        .querySelectorAll(".dispatch-tab")
        .forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");

      allPanels.forEach((p, i) => {
        p.style.display = i === index ? (i === 0 ? "flex" : "block") : "none";
      });
    });
    tabBar.appendChild(tab);
  });

  // Default to Terminal tab
  (tabBar.children[0] as HTMLElement).classList.add("active");
  settingsPanel.style.display = "none";
  historyPanel.style.display = "none";
  helpPanel.style.display = "none";

  container.appendChild(tabBar);
  for (const p of allPanels) {
    container.appendChild(p);
  }

  return container;
}
