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

function numberOrZero(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function geometryPoint(element) {
  return {
    x: numberOrZero(element.getAttribute("x")),
    y: numberOrZero(element.getAttribute("y"))
  };
}

function readGeometryPoints(geometry) {
  const points = [];

  Array.from(geometry.children).forEach((child) => {
    if (child.tagName === "Array" && child.getAttribute("as") === "points") {
      Array.from(child.querySelectorAll("mxPoint")).forEach((point) => {
        points.push(geometryPoint(point));
      });
    }
  });

  return points;
}

function getGeometry(cell) {
  const geometry = cell.querySelector("mxGeometry");

  if (!geometry) return null;

  const sourcePoint = Array.from(geometry.children).find((child) => child.getAttribute("as") === "sourcePoint");
  const targetPoint = Array.from(geometry.children).find((child) => child.getAttribute("as") === "targetPoint");
  const offsetPoint = Array.from(geometry.children).find((child) => child.getAttribute("as") === "offset");

  return {
    x: numberOrZero(geometry.getAttribute("x")),
    y: numberOrZero(geometry.getAttribute("y")),
    width: numberOrZero(geometry.getAttribute("width")),
    height: numberOrZero(geometry.getAttribute("height")),
    relative: geometry.getAttribute("relative") === "1",
    points: readGeometryPoints(geometry),
    sourcePoint: sourcePoint ? geometryPoint(sourcePoint) : null,
    targetPoint: targetPoint ? geometryPoint(targetPoint) : null,
    offsetPoint: offsetPoint ? geometryPoint(offsetPoint) : null
  };
}

function nodeCenter(node) {
  return {
    x: node.x + node.width / 2,
    y: node.y + node.height / 2
  };
}

function styleNumber(style, key) {
  if (!(key in style)) return null;

  const parsed = Number(style[key]);
  return Number.isFinite(parsed) ? parsed : null;
}

function styleAnchor(node, style, prefix) {
  const relX = styleNumber(style, `${prefix}X`);
  const relY = styleNumber(style, `${prefix}Y`);

  if (relX === null || relY === null) return null;

  return {
    x: node.x + node.width * relX,
    y: node.y + node.height * relY
  };
}

function isDecision(node) {
  return (node.style.shape || "").includes("decision");
}

function isTerminator(node) {
  return (node.style.shape || "").includes("terminator");
}

function boundaryPoint(node, toward) {
  const center = nodeCenter(node);
  const dx = toward.x - center.x;
  const dy = toward.y - center.y;

  if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return center;

  if (isDecision(node)) {
    const scale = 1 / (Math.abs(dx) / (node.width / 2) + Math.abs(dy) / (node.height / 2));
    return {
      x: center.x + dx * scale,
      y: center.y + dy * scale
    };
  }

  const scaleX = Math.abs(dx) < 0.001 ? Infinity : node.width / 2 / Math.abs(dx);
  const scaleY = Math.abs(dy) < 0.001 ? Infinity : node.height / 2 / Math.abs(dy);
  const scale = Math.min(scaleX, scaleY);

  return {
    x: center.x + dx * scale,
    y: center.y + dy * scale
  };
}

function edgeEndpoint(node, edge, prefix, toward) {
  const explicit = prefix === "exit" ? edge.geometry.sourcePoint : edge.geometry.targetPoint;
  if (!node) return explicit || toward || { x: 0, y: 0 };

  return styleAnchor(node, edge.style, prefix) || explicit || boundaryPoint(node, toward);
}

function samePoint(a, b) {
  return Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5;
}

function compactPoints(points) {
  return points.reduce((result, point) => {
    if (!result.length || !samePoint(result[result.length - 1], point)) {
      result.push(point);
    }

    return result;
  }, []);
}

function makeOrthogonalRoute(start, end) {
  if (Math.abs(start.x - end.x) < 4 || Math.abs(start.y - end.y) < 4) {
    return [start, end];
  }

  if (Math.abs(end.y - start.y) >= Math.abs(end.x - start.x)) {
    const midY = (start.y + end.y) / 2;
    return [start, { x: start.x, y: midY }, { x: end.x, y: midY }, end];
  }

  const midX = (start.x + end.x) / 2;
  return [start, { x: midX, y: start.y }, { x: midX, y: end.y }, end];
}

function orthogonalize(points) {
  const routed = [points[0]];

  points.slice(1).forEach((point) => {
    const previous = routed[routed.length - 1];
    const isAligned = Math.abs(previous.x - point.x) < 4 || Math.abs(previous.y - point.y) < 4;

    if (!isAligned) {
      const verticalFirst = Math.abs(point.y - previous.y) >= Math.abs(point.x - previous.x);
      routed.push(verticalFirst ? { x: previous.x, y: point.y } : { x: point.x, y: previous.y });
    }

    routed.push(point);
  });

  return compactPoints(routed);
}

function connectorPoints(edge, diagram) {
  const source = edge.source ? diagram.nodeById.get(edge.source) : null;
  const target = edge.target ? diagram.nodeById.get(edge.target) : null;
  const waypoints = edge.geometry.points || [];
  const fallbackStart = edge.geometry.sourcePoint || waypoints[0] || (target ? nodeCenter(target) : edge.geometry.targetPoint);
  const fallbackEnd = edge.geometry.targetPoint || waypoints[waypoints.length - 1] || (source ? nodeCenter(source) : edge.geometry.sourcePoint);
  const firstToward = waypoints[0] || fallbackEnd;
  const lastToward = waypoints[waypoints.length - 1] || fallbackStart;
  const start = edgeEndpoint(source, edge, "exit", firstToward);
  const end = edgeEndpoint(target, edge, "entry", lastToward);

  if (waypoints.length) {
    return orthogonalize(compactPoints([start, ...waypoints, end]));
  }

  return compactPoints(makeOrthogonalRoute(start, end));
}

function trimSegmentEnd(a, b, distance) {
  if (!distance) return b;

  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (length <= distance + 1) return b;

  return {
    x: b.x - (b.x - a.x) * (distance / length),
    y: b.y - (b.y - a.y) * (distance / length)
  };
}

function trimRoute(points, startTrim = 0, endTrim = 0) {
  const route = compactPoints(points);

  if (route.length < 2) return route;

  const trimmed = [...route];
  trimmed[0] = trimSegmentEnd(trimmed[1], trimmed[0], startTrim);
  trimmed[trimmed.length - 1] = trimSegmentEnd(trimmed[trimmed.length - 2], trimmed[trimmed.length - 1], endTrim);

  return compactPoints(trimmed);
}

function roundedPolyline(points, radius = 18) {
  const route = compactPoints(points);

  if (route.length < 2) return "";
  if (route.length === 2) return `M ${route[0].x} ${route[0].y} L ${route[1].x} ${route[1].y}`;

  const commands = [`M ${route[0].x} ${route[0].y}`];

  for (let index = 1; index < route.length - 1; index += 1) {
    const previous = route[index - 1];
    const current = route[index];
    const next = route[index + 1];
    const previousLength = Math.hypot(current.x - previous.x, current.y - previous.y);
    const nextLength = Math.hypot(next.x - current.x, next.y - current.y);

    if (previousLength < 1 || nextLength < 1) continue;

    const curveRadius = Math.min(radius, previousLength / 2, nextLength / 2);
    const before = {
      x: current.x + (previous.x - current.x) * (curveRadius / previousLength),
      y: current.y + (previous.y - current.y) * (curveRadius / previousLength)
    };
    const after = {
      x: current.x + (next.x - current.x) * (curveRadius / nextLength),
      y: current.y + (next.y - current.y) * (curveRadius / nextLength)
    };

    commands.push(`L ${before.x} ${before.y}`);
    commands.push(`Q ${current.x} ${current.y} ${after.x} ${after.y}`);
  }

  const last = route[route.length - 1];
  commands.push(`L ${last.x} ${last.y}`);

  return commands.join(" ");
}

function midpointOnRoute(points) {
  const route = compactPoints(points);
  const lengths = [];
  let total = 0;

  for (let index = 1; index < route.length; index += 1) {
    const length = Math.hypot(route[index].x - route[index - 1].x, route[index].y - route[index - 1].y);
    lengths.push(length);
    total += length;
  }

  let distance = total / 2;

  for (let index = 1; index < route.length; index += 1) {
    const length = lengths[index - 1];
    if (distance <= length) {
      const ratio = length ? distance / length : 0;
      return {
        x: route[index - 1].x + (route[index].x - route[index - 1].x) * ratio,
        y: route[index - 1].y + (route[index].y - route[index - 1].y) * ratio
      };
    }

    distance -= length;
  }

  return route[Math.floor(route.length / 2)] || { x: 0, y: 0 };
}

function pointAtRouteRatio(points, ratio = 0.5) {
  const route = compactPoints(points);
  const safeRatio = Math.max(0, Math.min(1, ratio));
  const total = routeLength(route);
  let remaining = total * safeRatio;

  for (let index = 1; index < route.length; index += 1) {
    const start = route[index - 1];
    const end = route[index];
    const length = Math.hypot(end.x - start.x, end.y - start.y);

    if (remaining <= length) {
      const localRatio = length ? remaining / length : 0;
      return {
        x: start.x + (end.x - start.x) * localRatio,
        y: start.y + (end.y - start.y) * localRatio
      };
    }

    remaining -= length;
  }

  return route[route.length - 1] || { x: 0, y: 0 };
}

function routeLength(points) {
  const route = compactPoints(points);
  let total = 0;

  for (let index = 1; index < route.length; index += 1) {
    total += Math.hypot(route[index].x - route[index - 1].x, route[index].y - route[index - 1].y);
  }

  return total;
}

function labelPosition(edge, points) {
  const geometry = edge.labelGeometry;

  if (!geometry) {
    const center = midpointOnRoute(points);
    return { x: center.x, y: center.y - 8 };
  }

  const hasRelativeX = Number.isFinite(geometry.x) && geometry.x !== 0;
  const ratio = hasRelativeX ? Math.max(0.08, Math.min(0.92, (geometry.x + 1) / 2)) : 0.5;
  const base = pointAtRouteRatio(points, ratio);

  return {
    x: base.x + (geometry.offsetPoint?.x || 0),
    y: base.y + (geometry.offsetPoint?.y || geometry.y || -8)
  };
}

function shapeElement(node) {
  const common = { class: "run-turn-node-shape" };

  if (isDecision(node)) {
    const cx = node.x + node.width / 2;
    const cy = node.y + node.height / 2;
    return svgElement("path", {
      ...common,
      d: `M ${cx} ${node.y} L ${node.x + node.width} ${cy} L ${cx} ${node.y + node.height} L ${node.x} ${cy} Z`
    });
  }

  if (isTerminator(node)) {
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
    rx: node.style.rounded === "1" ? 10 : 3,
    ry: node.style.rounded === "1" ? 10 : 3
  });
}

function renderLabel(group, node) {
  const foreignObject = svgElement("foreignObject", {
    x: node.x + 7,
    y: node.y + 6,
    width: Math.max(1, node.width - 14),
    height: Math.max(1, node.height - 12)
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
      if (text && !edgeLabels.has(parent)) {
        edgeLabels.set(parent, { text, geometry });
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
    .map((cell) => {
      const label = cleanCellText(cell.getAttribute("value") || "");
      const labelData = edgeLabels.get(cell.getAttribute("id"));
      const geometry = getGeometry(cell) || {
        points: [],
        sourcePoint: null,
        targetPoint: null,
        offsetPoint: null
      };

      return {
        id: cell.getAttribute("id"),
        source: cell.getAttribute("source"),
        target: cell.getAttribute("target"),
        label: label || labelData?.text || "",
        labelGeometry: labelData?.geometry || null,
        style: parseStyle(cell.getAttribute("style") || ""),
        geometry
      };
    })
    .filter((edge) => {
      const hasSource = edge.source ? nodeById.has(edge.source) : Boolean(edge.geometry.sourcePoint);
      const hasTarget = edge.target ? nodeById.has(edge.target) : Boolean(edge.geometry.targetPoint);
      return hasSource && hasTarget;
    });

  return { nodes, regions, edges, nodeById };
}

function edgeBoundsItems(edges) {
  return edges.flatMap((edge) => {
    const points = [
      edge.geometry.sourcePoint,
      ...(edge.geometry.points || []),
      edge.geometry.targetPoint
    ].filter(Boolean);

    return points.map((point) => ({
      x: point.x,
      y: point.y,
      width: 1,
      height: 1
    }));
  });
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
  const bounds = diagramBounds([...diagram.nodes, ...diagram.regions, ...edgeBoundsItems(diagram.edges)]);
  svg.replaceChildren();
  svg.setAttribute("viewBox", `${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMin meet");

  const defs = svgElement("defs");
  const roughen = svgElement("filter", {
    id: "roughen",
    x: "-6%",
    y: "-6%",
    width: "112%",
    height: "112%"
  });
  roughen.appendChild(svgElement("feTurbulence", {
    type: "fractalNoise",
    baseFrequency: "0.014",
    numOctaves: "2",
    seed: "11"
  }));
  roughen.appendChild(svgElement("feDisplacementMap", {
    in: "SourceGraphic",
    scale: "1.15"
  }));
  const marker = svgElement("marker", {
    id: "run-turn-arrow",
    markerWidth: "12",
    markerHeight: "12",
    refX: "9",
    refY: "6",
    orient: "auto",
    markerUnits: "strokeWidth"
  });
  marker.appendChild(svgElement("path", { d: "M 2 2 L 10 6 L 2 10", class: "run-turn-arrow-mark" }));
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
    const rawPoints = connectorPoints(edge, diagram);
    const points = trimRoute(
      rawPoints,
      edge.source && diagram.nodeById.has(edge.source) ? 2 : 0,
      edge.target && diagram.nodeById.has(edge.target) ? 7 : 0
    );
    const d = roundedPolyline(points);
    const isShortBridge = points.length === 2 && routeLength(points) < 95;
    const isAbsoluteRoute = !edge.source || !edge.target;
    const halo = svgElement("path", {
      class: [
        "run-turn-edge-halo",
        isShortBridge ? "is-short-bridge" : "",
        isAbsoluteRoute ? "is-absolute-route" : ""
      ].filter(Boolean).join(" "),
      d
    });
    const path = svgElement("path", {
      class: [
        "run-turn-edge",
        isShortBridge ? "is-short-bridge" : "",
        isAbsoluteRoute ? "is-absolute-route" : ""
      ].filter(Boolean).join(" "),
      d
    });
    edgeLayer.appendChild(halo);
    edgeLayer.appendChild(path);

    if (edge.label) {
      const labelPoint = labelPosition(edge, rawPoints);
      const label = svgElement("text", {
        class: "run-turn-edge-label",
        x: labelPoint.x,
        y: labelPoint.y,
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
        isDecision(node) ? "is-decision" : "",
        isTerminator(node) ? "is-terminator" : "",
        node.text.includes("[0]") ? "is-start-node" : ""
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
