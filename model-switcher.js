/**
 * MyLocalAI — model switcher (the pill beside the send button).
 *
 * This file only owns the *presentation*: the pill, the upward menu, keyboard handling and
 * the pure helpers that turn "what models exist" into menu options. It never touches a
 * backend. sidebar.js (or a provider file) decides which models exist and how to switch to
 * one, and hands those in as `loadOptions` / `onSelect`.
 *
 * An option is { id, label, detail }. `id` is opaque to this file.
 */
(() => {
  "use strict";

  // ===================== OPTION BUILDERS (pure) =====================
  const NANO_ID = "nano";
  const OLLAMA_ID_PREFIX = "ollama:";

  function nanoOption() {
    return { id: NANO_ID, label: "Gemini Nano", detail: "On-device · private" };
  }

  // Ollama routes ":cloud" / "-cloud" models through its hosted service, so say so.
  function isCloudOllamaModel(name) {
    return name.includes(":cloud") || name.includes("-cloud");
  }

  function ollamaModelId(name) {
    return `${OLLAMA_ID_PREFIX}${name}`;
  }

  // The configured model is always offered, even when Ollama can't be reached to list models,
  // so the pill never shows a model that is missing from its own menu.
  function ollamaOptions(installedNames, currentModel) {
    const names = new Set(installedNames);
    if (currentModel) names.add(currentModel);
    return [...names].sort((a, b) => a.localeCompare(b)).map((name) => ({
      id: ollamaModelId(name),
      label: name,
      detail: isCloudOllamaModel(name) ? "Ollama · cloud" : "Ollama · local",
    }));
  }

  // Inverse of the ids above: { backend: "nano" } or { backend: "ollama", model }.
  function parseModelId(id) {
    if (id === NANO_ID) return { backend: "nano" };
    if (typeof id === "string" && id.startsWith(OLLAMA_ID_PREFIX) && id.length > OLLAMA_ID_PREFIX.length) {
      return { backend: "ollama", model: id.slice(OLLAMA_ID_PREFIX.length) };
    }
    return null;
  }

  // ===================== MENU =====================
  // opts: { root, button, labelEl, menu, loadOptions(), onSelect(id) }
  //   loadOptions() -> Promise<{ options, currentId }>   called each time the menu opens
  //   onSelect(id)  -> Promise                            reject with an Error to show it in the menu
  function create({ root, button, labelEl, menu, loadOptions, onSelect }) {
    let options = [];
    let currentId = null;
    let switchingTo = null; // id being switched to, while onSelect is pending
    let errorText = "";

    const isOpen = () => !menu.classList.contains("hidden");

    function renderItem(option) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "model-menu-item";
      item.setAttribute("role", "menuitemradio");
      item.setAttribute("aria-checked", String(option.id === currentId));
      item.dataset.modelId = option.id;
      item.disabled = switchingTo !== null;

      const name = document.createElement("span");
      name.className = "model-menu-name";
      name.textContent = option.label;
      const detail = document.createElement("span");
      detail.className = "model-menu-detail";
      detail.textContent = option.id === switchingTo ? "Switching…" : option.detail || "";
      item.append(name, detail);

      item.addEventListener("click", () => choose(option.id));
      return item;
    }

    function render() {
      const children = options.map(renderItem);
      if (options.length === 0) {
        const loading = document.createElement("p");
        loading.className = "model-menu-note";
        loading.textContent = "Looking for models…";
        children.push(loading);
      }
      if (errorText) {
        const error = document.createElement("p");
        error.className = "model-menu-note model-menu-error";
        error.setAttribute("role", "alert");
        error.textContent = errorText;
        children.push(error);
      }
      menu.replaceChildren(...children);
    }

    async function refresh() {
      try {
        const loaded = await loadOptions();
        options = loaded.options;
        currentId = loaded.currentId;
      } catch (err) {
        errorText = err.message || "Could not list models.";
      }
      render();
    }

    async function choose(id) {
      if (switchingTo !== null) return;
      if (id === currentId) {
        close();
        return;
      }
      switchingTo = id;
      errorText = "";
      render();
      try {
        await onSelect(id);
        currentId = id;
        close();
      } catch (err) {
        errorText = err.message || "Could not switch models.";
      } finally {
        switchingTo = null;
        render();
      }
    }

    function open() {
      errorText = "";
      menu.classList.remove("hidden");
      button.setAttribute("aria-expanded", "true");
      render();
      refresh().then(focusCurrentItem);
    }

    function close() {
      menu.classList.add("hidden");
      button.setAttribute("aria-expanded", "false");
    }

    function enabledItems() {
      return [...menu.querySelectorAll(".model-menu-item")].filter((item) => !item.disabled);
    }

    function focusCurrentItem() {
      if (!isOpen()) return;
      const items = enabledItems();
      (items.find((item) => item.dataset.modelId === currentId) || items[0])?.focus();
    }

    function onMenuKeydown(event) {
      if (event.key === "Escape") {
        close();
        button.focus();
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const items = enabledItems();
      if (items.length === 0) return;
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      const at = items.indexOf(document.activeElement);
      items[(at + step + items.length) % items.length].focus();
    }

    button.addEventListener("click", () => (isOpen() ? close() : open()));
    menu.addEventListener("keydown", onMenuKeydown);
    document.addEventListener("click", (event) => {
      // Stay open while a switch is running so its error can still be shown.
      if (switchingTo === null && !root.contains(event.target)) close();
    });

    return {
      // The pill always names the model that is answering right now.
      setCurrent(label, title = "") {
        labelEl.textContent = label;
        button.title = title || `Model: ${label} — click to switch`;
      },
      // Switching mid-answer would pull the model out from under the stream.
      setDisabled(disabled) {
        button.disabled = disabled;
        if (disabled) close();
      },
      setVisible(visible) {
        root.classList.toggle("hidden", !visible);
      },
    };
  }

  window.MyLocalAIModelSwitcher = {
    create,
    nanoOption,
    ollamaOptions,
    ollamaModelId,
    parseModelId,
    NANO_ID,
  };
})();
