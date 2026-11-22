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

// ===== Page watcher (scroll + selection events for the side panel) =====
// Site access is optional, so the watcher is registered only while the user has granted it,
// and removed again if they revoke it. Registration persists across browser restarts.
const PAGE_WATCH_SCRIPT_ID = "mylocalai-page-watch";
const TAB_ACCESS = { origins: ["<all_urls>"] };

async function syncPageWatchScript() {
  if (!chrome.scripting?.registerContentScripts) return;
  try {
    const granted = await chrome.permissions.contains(TAB_ACCESS);
    const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [PAGE_WATCH_SCRIPT_ID] });
    if (granted && registered.length === 0) {
      await chrome.scripting.registerContentScripts([{
        id: PAGE_WATCH_SCRIPT_ID,
        js: ["page-watch.js"],
        matches: ["<all_urls>"],
        runAt: "document_idle",
        persistAcrossSessions: true
      }]);
    } else if (!granted && registered.length > 0) {
      await chrome.scripting.unregisterContentScripts({ ids: [PAGE_WATCH_SCRIPT_ID] });
    }
  } catch (error) {
    console.warn("[MyLocalAI] Page watcher registration failed:", error);
  }
}

chrome.runtime.onInstalled.addListener(syncPageWatchScript);
chrome.runtime.onStartup.addListener(syncPageWatchScript);
chrome.permissions.onAdded.addListener(syncPageWatchScript);
chrome.permissions.onRemoved.addListener(syncPageWatchScript);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "GET_SELECTED_CONTEXT") return false;

  const text = pendingSelectedContext;
  pendingSelectedContext = "";
  sendResponse({ text });
  return false;
});
