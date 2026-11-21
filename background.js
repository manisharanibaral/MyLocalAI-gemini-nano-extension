const MENU_USE_SELECTION = "mylocalai-use-selection";
let pendingSelectedContext = "";

// Open the sidebar when the extension action icon is clicked
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error("[MyLocalAI] Side panel error:", error));

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_USE_SELECTION,
      title: "Use selection as MyLocalAI context",
      contexts: ["selection"]
    });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_USE_SELECTION) return;

  pendingSelectedContext = (info.selectionText || "").trim();
  if (!pendingSelectedContext) return;

  chrome.runtime.sendMessage({
    type: "TEXT_SELECTED",
    text: pendingSelectedContext
  }).catch(() => {
    // Side panel may not be open yet; it will request pending context on load.
  });

  if (tab?.id && chrome.sidePanel?.open) {
    chrome.sidePanel
      .open({ tabId: tab.id })
      .catch((error) => console.warn("[MyLocalAI] Could not open side panel:", error));
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "GET_SELECTED_CONTEXT") return false;

  const text = pendingSelectedContext;
  pendingSelectedContext = "";
  sendResponse({ text });
  return false;
});
