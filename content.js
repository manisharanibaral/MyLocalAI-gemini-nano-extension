/**
 * MyLocalAI — Content Script
 * Returns selected text only when explicitly requested by the extension.
 */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "GET_SELECTED_TEXT") return false;

  const text = window.getSelection().toString().trim();
  sendResponse({ text });
  return false;
});
