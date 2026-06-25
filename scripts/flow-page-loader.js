(async function loadFlowPage() {
  const config = window.CodexFlowAssets || {};
  const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

  function withStamp(src) {
    const separator = src.includes("?") ? "&" : "?";
    return `${src}${separator}live=${encodeURIComponent(stamp)}`;
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = withStamp(src);
      script.async = false;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.body.appendChild(script);
    });
  }

  try {
    await loadScript(config.docsScript || "../data/docs-content.js");
    await loadScript(config.diagramScript);

    if (typeof config.configure === "function") {
      config.configure();
    }

    await loadScript(config.highlightScript || "../scripts/code-highlight.js");
    await loadScript(config.mainScript || "../scripts/run-turn-page.js");
  } catch (error) {
    const title = document.querySelector("[data-run-turn-title]");
    const body = document.querySelector("[data-run-turn-body]");
    if (title) title.textContent = "流程图未加载";
    if (body) body.textContent = error.message;
  }
})();
