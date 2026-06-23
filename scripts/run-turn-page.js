const SVG_NS = "http://www.w3.org/2000/svg";
const XHTML_NS = "http://www.w3.org/1999/xhtml";
const diagramData = window.CodexRunTurnDiagram;
const svg = document.querySelector("[data-run-turn-svg]");
const detailStep = document.querySelector("[data-run-turn-step]");
const detailTitle = document.querySelector("[data-run-turn-title]");
const detailBody = document.querySelector("[data-run-turn-body]");

function svgElement(tagName, attributes = {}) {
  const node = document.createElementNS(SVG_NS, tagName);

  Object.entries(attributes).forEach(([key, value]) => {
    node.setAttribute(key, value);
  });

  return node;
}

function parseStyle(styleText = "") {
  return Object.fromEntries(
    styleText
      .split(";")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const [key, ...value] = item.split("=");
        return [key, value.join("=")];
      })
  );
}

function cleanCellText(value = "") {
  const holder = document.createElement("div");
  holder.innerHTML = value;
  return holder.textContent.replace(/\s+/g, " ").trim();
}

function getGeometry(cell) {
  const geometry = cell.querySelector("mxGeometry");

  if (!geometry) return null;

  return {
    x: Number(geometry.getAttribute("x") || 0),
    y: Number(geometry.getAttribute("y") || 0),
    width: Number(geometry.getAttribute("width") || 0),
    height: Number(geometry.getAttribute("height") || 0)
  };
}

function nodeCenter(node) {
  return {
    x: node.x + node.width / 2,
    y: node.y + node.height / 2
  };
}

function anchorPoint(source, target) {
  const a = nodeCenter(source);
  const b = nodeCenter(target);
  const dx = b.x - a.x;
  const dy = b.y - a.y;

  if (Math.abs(dx) > Math.abs(dy)) {
    return {
      from: { x: a.x + Math.sign(dx || 1) * source.width / 2, y: a.y },
      to: { x: b.x - Math.sign(dx || 1) * target.width / 2, y: b.y },
      horizontal: true
    };
  }

  return {
    from: { x: a.x, y: a.y + Math.sign(dy || 1) * source.height / 2 },
    to: { x: b.x, y: b.y - Math.sign(dy || 1) * target.height / 2 },
    horizontal: false
  };
}

function connectorPath(source, target) {
  const { from, to, horizontal } = anchorPoint(source, target);

  if (horizontal) {
    const midX = (from.x + to.x) / 2;
    return `M ${from.x} ${from.y} C ${midX} ${from.y} ${midX} ${to.y} ${to.x} ${to.y}`;
  }

  const midY = (from.y + to.y) / 2;
  return `M ${from.x} ${from.y} C ${from.x} ${midY} ${to.x} ${midY} ${to.x} ${to.y}`;
}

function shapeElement(node) {
  const style = node.style;
  const common = { class: "run-turn-node-shape" };

  if ((style.shape || "").includes("decision")) {
    const cx = node.x + node.width / 2;
    const cy = node.y + node.height / 2;
    return svgElement("path", {
      ...common,
      d: `M ${cx} ${node.y} L ${node.x + node.width} ${cy} L ${cx} ${node.y + node.height} L ${node.x} ${cy} Z`
    });
  }

  if ((style.shape || "").includes("terminator")) {
    return svgElement("rect", {
      ...common,
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      rx: node.height / 2,
      ry: node.height / 2
    });
  }

  return svgElement("rect", {
    ...common,
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    rx: style.rounded === "1" ? 10 : 3,
    ry: style.rounded === "1" ? 10 : 3
  });
}

function renderLabel(group, node) {
  const foreignObject = svgElement("foreignObject", {
    x: node.x + 5,
    y: node.y + 5,
    width: Math.max(1, node.width - 10),
    height: Math.max(1, node.height - 10)
  });
  const label = document.createElementNS(XHTML_NS, "div");
  label.className = "run-turn-node-label";
  label.textContent = node.text;
  foreignObject.appendChild(label);
  group.appendChild(foreignObject);
}

function parseDiagram(xml) {
  const parsed = new DOMParser().parseFromString(xml || "", "text/xml");
  const cells = Array.from(parsed.querySelectorAll("mxCell"));
  const nodeById = new Map();
  const regions = [];
  const nodes = [];
  const edgeLabels = new Map();

  cells.forEach((cell) => {
    const geometry = getGeometry(cell);
    const text = cleanCellText(cell.getAttribute("value") || "");
    const parent = cell.getAttribute("parent") || "";
    const width = geometry?.width || 0;
    const height = geometry?.height || 0;

    if (cell.getAttribute("vertex") !== "1") return;

    if (parent !== "1") {
      if (text) {
        edgeLabels.set(parent, text);
      }
      return;
    }

    if (!geometry || width <= 0 || height <= 0) return;

    const item = {
      id: cell.getAttribute("id"),
      text,
      x: geometry.x,
      y: geometry.y,
      width,
      height,
      style: parseStyle(cell.getAttribute("style") || "")
    };

    if (text) {
      nodes.push(item);
      nodeById.set(item.id, item);
      return;
    }

    regions.push(item);
  });

  const edges = cells
    .filter((cell) => cell.getAttribute("edge") === "1")
    .map((cell) => ({
      id: cell.getAttribute("id"),
      source: cell.getAttribute("source"),
      target: cell.getAttribute("target"),
      label: cleanCellText(cell.getAttribute("value") || "") || edgeLabels.get(cell.getAttribute("id")) || ""
    }))
    .filter((edge) => nodeById.has(edge.source) && nodeById.has(edge.target));

  return { nodes, regions, edges, nodeById };
}

function diagramBounds(items) {
  const bounds = items.reduce(
    (acc, item) => ({
      minX: Math.min(acc.minX, item.x),
      minY: Math.min(acc.minY, item.y),
      maxX: Math.max(acc.maxX, item.x + item.width),
      maxY: Math.max(acc.maxY, item.y + item.height)
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  );

  return {
    x: bounds.minX - 70,
    y: bounds.minY - 80,
    width: bounds.maxX - bounds.minX + 140,
    height: bounds.maxY - bounds.minY + 160
  };
}

function stepText(node) {
  const step = node.text.match(/^\[(\d+)\]/);
  return step ? `Step ${step[1]}` : "run_turn node";
}

function setActiveNode(group, node) {
  document.querySelectorAll(".run-turn-node").forEach((item) => {
    item.classList.toggle("is-active", item === group);
  });

  detailStep.textContent = stepText(node);
  detailTitle.textContent = node.text;
  detailBody.textContent = "详情待补充。";
}

function renderDiagram(diagram) {
  const bounds = diagramBounds([...diagram.nodes, ...diagram.regions]);
  svg.setAttribute("viewBox", `${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`);

  const defs = svgElement("defs");
  const roughen = svgElement("filter", {
    id: "roughen",
    x: "-8%",
    y: "-8%",
    width: "116%",
    height: "116%"
  });
  roughen.appendChild(svgElement("feTurbulence", {
    type: "fractalNoise",
    baseFrequency: "0.018",
    numOctaves: "2",
    seed: "11"
  }));
  roughen.appendChild(svgElement("feDisplacementMap", {
    in: "SourceGraphic",
    scale: "1.8"
  }));
  const marker = svgElement("marker", {
    id: "run-turn-arrow",
    markerWidth: "10",
    markerHeight: "10",
    refX: "8",
    refY: "5",
    orient: "auto"
  });
  marker.appendChild(svgElement("path", { d: "M 1 1 L 9 5 L 1 9", class: "run-turn-arrow-mark" }));
  defs.appendChild(roughen);
  defs.appendChild(marker);
  svg.appendChild(defs);

  const regionLayer = svgElement("g", { class: "run-turn-regions" });
  const edgeLayer = svgElement("g", { class: "run-turn-edges" });
  const nodeLayer = svgElement("g", { class: "run-turn-nodes" });

  diagram.regions.forEach((region) => {
    regionLayer.appendChild(svgElement("rect", {
      class: "run-turn-region",
      x: region.x,
      y: region.y,
      width: region.width,
      height: region.height
    }));
  });

  diagram.edges.forEach((edge) => {
    const source = diagram.nodeById.get(edge.source);
    const target = diagram.nodeById.get(edge.target);
    const path = svgElement("path", {
      class: "run-turn-edge",
      d: connectorPath(source, target)
    });
    edgeLayer.appendChild(path);

    if (edge.label) {
      const a = nodeCenter(source);
      const b = nodeCenter(target);
      const label = svgElement("text", {
        class: "run-turn-edge-label",
        x: (a.x + b.x) / 2,
        y: (a.y + b.y) / 2 - 8,
        "text-anchor": "middle"
      });
      label.textContent = edge.label;
      edgeLayer.appendChild(label);
    }
  });

  diagram.nodes.forEach((node) => {
    const group = svgElement("g", {
      class: [
        "run-turn-node",
        (node.style.shape || "").includes("decision") ? "is-decision" : "",
        (node.style.shape || "").includes("terminator") ? "is-terminator" : "",
        node.style.strokeColor ? "is-accent" : ""
      ].filter(Boolean).join(" "),
      tabindex: "0",
      role: "button",
      "aria-label": node.text,
      "data-node-id": node.id
    });
    group.appendChild(shapeElement(node));
    renderLabel(group, node);
    group.addEventListener("click", () => setActiveNode(group, node));
    group.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        setActiveNode(group, node);
      }
    });
    nodeLayer.appendChild(group);
  });

  svg.appendChild(regionLayer);
  svg.appendChild(edgeLayer);
  svg.appendChild(nodeLayer);

  const firstNode = diagram.nodes.find((node) => node.text.includes("[0]")) || diagram.nodes[0];
  const firstGroup = firstNode
    ? Array.from(nodeLayer.querySelectorAll(".run-turn-node")).find((item) => item.dataset.nodeId === firstNode.id)
    : null;
  if (firstNode && firstGroup) {
    setActiveNode(firstGroup, firstNode);
  }
}

function renderError(message) {
  detailTitle.textContent = "流程图未加载";
  detailBody.textContent = message;
}

if (!diagramData?.xml) {
  renderError("未找到 run_turn.drawio。");
} else {
  renderDiagram(parseDiagram(diagramData.xml));
}
