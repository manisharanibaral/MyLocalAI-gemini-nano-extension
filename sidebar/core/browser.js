// Which browser the panel runs in (used to explain setup problems).
"use strict";

// ===================== BROWSER DETECTION =====================
async function detectBrowser() {
  if (navigator.brave && await navigator.brave.isBrave()) return "brave";
  const ua = navigator.userAgent;
  if (ua.includes("Edg/")) return "edge";
  if (ua.includes("OPR/") || ua.includes("Opera")) return "opera";
  if (ua.includes("Vivaldi")) return "vivaldi";
  if (ua.includes("Chrome/")) return "chrome";
  return "unknown";
}

let browserName = "unknown";
