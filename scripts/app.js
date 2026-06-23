const SVG_NS = "http://www.w3.org/2000/svg";
const mapData = window.CodexKnowledgeMap;
const docsContent = window.CodexDocsContent;
const note = document.querySelector(".node-note");
const svg = document.querySelector(".knowledge-map");
const backgroundLayer = document.querySelector("[data-map-background]");
const connectorLayer = document.querySelector("[data-map-connectors]");
const nodeLayer = document.querySelector("[data-map-nodes]");
const frontConnectorLayer = document.querySelector("[data-map-front-connectors]");

function createSvgElement(tagName, attributes = {}) {
  const element = document.createElementNS(SVG_NS, tagName);

  Object.entries(attributes).forEach(([key, value]) => {
    element.setAttribute(key, value);
  });

  return element;
}

function normalizeTitle(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/_/g, "-");
}

function findDocForNode(node) {
  const docs = docsContent?.docs || [];
  const nodeSlug = normalizeTitle(node.docSlug);
  const nodeTitle = normalizeTitle(node.title);

  return (
    docs.find((doc) => normalizeTitle(doc.slug) === nodeSlug) ||
    docs.find((doc) => normalizeTitle(doc.title) === nodeTitle) ||
    docs.find((doc) => (doc.aliases || []).some((alias) => normalizeTitle(alias) === nodeTitle))
  );
}

function getNodeUrl(node) {
  if (node.url) {
    return node.url;
  }

  const doc = findDocForNode(node);

  if (!doc) {
    return "";
  }

  return `pages/topic.html?doc=${encodeURIComponent(doc.slug)}`;
}

function roughRectPath(node) {
  const { x, y, width, height, level } = node;
  const offset = level === "core" ? 13 : 8;

  return [
    `M ${x + offset} ${y + offset}`,
    `L ${x + width - offset * 0.7} ${y + 3}`,
    `L ${x + width + offset * 0.55} ${y + height - offset * 0.45}`,
    `L ${x - offset * 0.45} ${y + height + offset * 0.5}`,
    "Z"
  ].join(" ");
}

function coreHaloPath(node) {
  const { x, y, width, height } = node;
  const left = x - 28;
  const right = x + width + 26;
  const top = y - 28;
  const bottom = y + height + 26;
  const cx = x + width / 2;

  return [
    `M ${left + 18} ${top + 40}`,
    `C ${left + 72} ${top - 10} ${right - 86} ${top - 4} ${right - 32} ${top + 42}`,
    `C ${right + 16} ${top + 84} ${right - 10} ${bottom - 22} ${right - 72} ${bottom - 8}`,
    `C ${cx + 60} ${bottom + 28} ${left + 44} ${bottom + 8} ${left + 20} ${bottom - 56}`,
    `C ${left - 12} ${bottom - 122} ${left - 6} ${top + 82} ${left + 18} ${top + 40}`,
    "Z"
  ].join(" ");
}

function renderTextLines(group, node) {
  const lines = node.labelLines || [node.title];
  const lineGap = node.level === "core" ? 36 : 29;
  const text = createSvgElement("text", {
    class: "node-label",
    x: node.x + node.width / 2,
    y: node.y + node.height / 2 - ((lines.length - 1) * lineGap) / 2,
    "text-anchor": "middle"
  });

  lines.forEach((line, index) => {
    const tspan = createSvgElement("tspan", {
      x: node.x + node.width / 2,
      y: node.y + node.height / 2 - ((lines.length - 1) * lineGap) / 2 + index * lineGap
    });
    tspan.textContent = line;
    text.appendChild(tspan);
  });

  group.appendChild(text);
}

function renderNode(node) {
  const group = createSvgElement("g", {
    class: `map-node node-${node.level}`,
    tabindex: "0",
    role: "button",
    "aria-label": node.title,
    "data-node-id": node.id,
    "data-title": node.title,
    "data-tier": node.tier,
    "data-note": node.note
  });

  const nodeUrl = getNodeUrl(node);

  if (nodeUrl) {
    group.setAttribute("data-url", nodeUrl);
  }

  const title = createSvgElement("title");
  title.textContent = node.title;
  group.appendChild(title);

  if (node.level === "core") {
    group.appendChild(createSvgElement("path", { class: "node-halo", d: coreHaloPath(node) }));
  }

  group.appendChild(createSvgElement("path", { class: "node-shape", d: roughRectPath(node) }));
  renderTextLines(group, node);

  if (node.stamp) {
    const stamp = createSvgElement("text", {
      class: "stamp",
      x: node.x + node.width - 48,
      y: node.y + 31,
      transform: `rotate(-8 ${node.x + node.width - 48} ${node.y + 31})`
    });
    stamp.textContent = node.stamp;
    group.appendChild(stamp);
  }

  return group;
}

function setActiveNode(nodeElement) {
  if (!nodeElement || !note) return;

  document.querySelectorAll(".map-node").forEach((item) => {
    item.classList.toggle("is-active", item === nodeElement);
  });

  note.querySelector(".note-tier").textContent = nodeElement.dataset.tier || "";
  note.querySelector("h2").textContent = nodeElement.dataset.title || "";
  note.querySelector("h2 + p").textContent = nodeElement.dataset.note || "";
}

function openNode(nodeElement) {
  const url = nodeElement?.dataset?.url;

  if (url) {
    window.location.href = url;
  }
}

function bindNodeEvents() {
  const nodes = Array.from(document.querySelectorAll(".map-node"));

  nodes.forEach((node) => {
    node.addEventListener("mouseenter", () => setActiveNode(node));
    node.addEventListener("focus", () => setActiveNode(node));
    node.addEventListener("click", () => {
      setActiveNode(node);
      openNode(node);
    });
    node.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        setActiveNode(node);
        openNode(node);
      }
    });
  });

  const initialNode =
    nodes.find((node) => node.dataset.nodeId === mapData.initialNodeId) ||
    nodes.find((node) => node.classList.contains("node-core")) ||
    nodes[0];

  setActiveNode(initialNode);
}

function renderMap() {
  if (!mapData || !svg || !backgroundLayer || !connectorLayer || !nodeLayer) return;

  svg.setAttribute("viewBox", mapData.viewBox);

  mapData.backgroundPaths.forEach((path) => {
    backgroundLayer.appendChild(createSvgElement("path", { d: path }));
  });

  mapData.connectors.forEach((connector) => {
    const targetLayer = connector.front && frontConnectorLayer ? frontConnectorLayer : connectorLayer;
    const attributes = {
      class: [
        "connector",
        connector.kind === "core" ? "core-flow" : "main-flow",
        connector.emphasis ? "connector-emphasis" : ""
      ]
        .filter(Boolean)
        .join(" "),
      d: connector.d
    };

    if (connector.id) {
      attributes["data-connector-id"] = connector.id;
    }

    targetLayer.appendChild(createSvgElement("path", attributes));
  });

  mapData.nodes.forEach((node) => {
    nodeLayer.appendChild(renderNode(node));
  });

  bindNodeEvents();
}

renderMap();
