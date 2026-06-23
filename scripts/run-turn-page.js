const SVG_NS = "http://www.w3.org/2000/svg";
const XHTML_NS = "http://www.w3.org/1999/xhtml";
const diagramData = window.CodexRunTurnDiagram;
const docsContent = window.CodexDocsContent;
const svg = document.querySelector("[data-run-turn-svg]");
const detailStep = document.querySelector("[data-run-turn-step]");
const detailTitle = document.querySelector("[data-run-turn-title]");
const detailBody = document.querySelector("[data-run-turn-body]");
const DETAIL_JUMP_ALIASES = {
  "压缩上下文": "context-compaction",
  "上下文压缩": "context-compaction",
  "MCP & skill": "mcp-skill",
  "MCP和skill": "mcp-skill",
  "hook": "hooks",
  "hook点": "hooks",
  "pending_input": "pending-input",
  "tool call": "tool-call"
};

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

function htmlElement(tagName, className = "", text = "") {
  const node = document.createElement(tagName);

  if (className) {
    node.className = className;
  }

  if (text) {
    node.textContent = text;
  }

  return node;
}

function normalizeLookup(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/_/g, "-")
    .replace(/[：:，,。.、]/g, "");
}

function findDoc(value) {
  const docs = docsContent?.docs || [];
  const normalized = normalizeLookup(value);

  return docs.find((doc) => normalizeLookup(doc.slug) === normalized) ||
    docs.find((doc) => normalizeLookup(doc.title) === normalized) ||
    docs.find((doc) => normalizeLookup(doc.fileTitle) === normalized) ||
    docs.find((doc) => (doc.aliases || []).some((alias) => normalizeLookup(alias) === normalized));
}

function findRunTurnDoc() {
  return findDoc("run-turn") || findDoc("turn & run_turn") || findDoc("run_turn");
}

function findJumpDoc(label) {
  const direct = findDoc(label);
  if (direct) return direct;

  const aliasSlug = DETAIL_JUMP_ALIASES[label] || DETAIL_JUMP_ALIASES[normalizeLookup(label)];
  return aliasSlug ? findDoc(aliasSlug) : null;
}

function renderInlineMarkdown(text) {
  const fragment = document.createDocumentFragment();
  const tokens = String(text).split(/(`[^`]+`|\*\*[^*]+\*\*)/g);

  tokens.forEach((token) => {
    if (!token) return;

    if (token.startsWith("`") && token.endsWith("`")) {
      fragment.appendChild(htmlElement("code", "inline-code", token.slice(1, -1)));
      return;
    }

    if (token.startsWith("**") && token.endsWith("**")) {
      fragment.appendChild(htmlElement("strong", "", token.slice(2, -2)));
      return;
    }

    fragment.appendChild(document.createTextNode(token));
  });

  return fragment;
}

function appendDetailParagraph(parent, lines) {
  if (!lines.length) return;

  const paragraph = htmlElement("p", "run-turn-detail-paragraph");
  paragraph.appendChild(renderInlineMarkdown(lines.join(" ").trim()));
  parent.appendChild(paragraph);
}

function appendDetailCode(parent, codeLines, language = "") {
  const pre = htmlElement("pre", `run-turn-detail-code language-${language || "text"}`);
  pre.appendChild(htmlElement("code", "", codeLines.join("\n")));
  parent.appendChild(pre);
}

function appendDetailList(parent, items, ordered) {
  if (!items.length) return;

  const list = htmlElement(ordered ? "ol" : "ul", "run-turn-detail-list");

  items.forEach((item) => {
    const li = htmlElement("li");
    li.appendChild(renderInlineMarkdown(item.text));
    if (item.indent) {
      li.style.marginLeft = `${Math.min(item.indent * 14, 42)}px`;
    }
    list.appendChild(li);
  });

  parent.appendChild(list);
}

function appendDetailJump(parent, label) {
  const doc = findJumpDoc(label);
  const link = htmlElement("a", "run-turn-detail-link", `详情跳转：${label}`);
  link.href = doc ? `topic.html?doc=${encodeURIComponent(doc.slug)}` : "#";

  if (!doc) {
    link.classList.add("is-missing");
    link.setAttribute("aria-disabled", "true");
    link.addEventListener("click", (event) => event.preventDefault());
  }

  parent.appendChild(link);
}

function renderDetailMarkdown(markdown, parent) {
  const lines = String(markdown || "").split(/\r?\n/);
  let paragraph = [];
  let listItems = [];
  let listOrdered = false;
  let codeLines = [];
  let codeLanguage = "";
  let inCode = false;

  function flushParagraph() {
    appendDetailParagraph(parent, paragraph);
    paragraph = [];
  }

  function flushList() {
    appendDetailList(parent, listItems, listOrdered);
    listItems = [];
  }

  lines.forEach((line) => {
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      if (inCode) {
        appendDetailCode(parent, codeLines, codeLanguage);
        codeLines = [];
        codeLanguage = "";
        inCode = false;
        return;
      }

      flushParagraph();
      flushList();
      inCode = true;
      codeLanguage = trimmed.slice(3).trim();
      return;
    }

    if (inCode) {
      codeLines.push(line);
      return;
    }

    const jump = trimmed.match(/^\[详情跳转(?:到)?(.+?)\]$/);
    if (jump) {
      flushParagraph();
      flushList();
      appendDetailJump(parent, jump[1].trim());
      return;
    }

    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      const node = htmlElement(level >= 5 ? "h4" : "h3", "run-turn-detail-heading", heading[2].trim());
      parent.appendChild(node);
      return;
    }

    const unordered = line.match(/^(\s*)[-*]\s+(.+)$/);
    const ordered = line.match(/^(\s*)(\d+)\.\s+(.+)$/);
    if (unordered || ordered) {
      flushParagraph();
      const match = unordered || ordered;
      const isOrdered = Boolean(ordered);

      if (listItems.length && listOrdered !== isOrdered) {
        flushList();
      }

      listOrdered = isOrdered;
      listItems.push({
        indent: Math.floor((match[1] || "").length / 2),
        text: (ordered ? match[3] : match[2]).trim()
      });
      return;
    }

    if (!trimmed) {
      flushParagraph();
      flushList();
      return;
    }

    flushList();
    paragraph.push(trimmed);
  });

  if (inCode) {
    appendDetailCode(parent, codeLines, codeLanguage);
  }
  flushParagraph();
  flushList();
}

function parseRunTurnDetails() {
  const doc = findRunTurnDoc();
  const sections = new Map();

  if (!doc?.markdown) return sections;

  const lines = doc.markdown.replace(/^\uFEFF/, "").split(/\r?\n/);
  let active = null;
  let inCode = false;

  function storeActive() {
    if (active) {
      sections.set(active.number, active);
    }
  }

  lines.forEach((line) => {
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      if (active) {
        active.lines.push(line);
      }
      inCode = !inCode;
      return;
    }

    const heading = !inCode ? line.match(/^\s{0,3}(#{1,6})\s+\[(\d+)\]\s*(.+?)\s*$/) : null;
    if (heading) {
      storeActive();
      active = {
        number: heading[2],
        title: heading[3].trim(),
        level: heading[1].length,
        lines: []
      };
      return;
    }

    if (active) {
      active.lines.push(line);
    }
  });

  storeActive();
  return sections;
}

const runTurnDetails = parseRunTurnDetails();

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
  const shape = node.style.shape || "";
  return shape.includes("decision") ||
    shape.includes("rhombus") ||
    Object.prototype.hasOwnProperty.call(node.style, "rhombus");
}

function isTerminator(node) {
  return (node.style.shape || "").includes("terminator");
}

function isImportantNode(node) {
  return node.text.includes("⭐");
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

function stepNumber(node) {
  const match = String(node?.text || "").match(/\[(\d+)\]/);
  return match ? Number(match[1]) : null;
}

function isProcessLike(node) {
  return Boolean(node) && !isDecision(node) && !isTerminator(node);
}

function isNeighboringStep(source, target) {
  const sourceStep = stepNumber(source);
  const targetStep = stepNumber(target);

  if (sourceStep === null || targetStep === null) return true;

  return Math.abs(targetStep - sourceStep) <= 1;
}

function nodeType(node) {
  if (isTerminator(node)) return "terminator";
  if (isDecision(node)) return "decision";
  if (node.width >= 360) return "process-wide";
  if (node.width >= 220) return "process-mid";
  return "process-small";
}

function textWeight(text) {
  return Array.from(String(text || "")).reduce((total, char) => {
    if (/[\u4e00-\u9fff]/.test(char)) return total + 15;
    if (/[A-Z]/.test(char)) return total + 8.8;
    if (/[a-z0-9_/-]/.test(char)) return total + 7.6;
    if (/\s/.test(char)) return total + 4.6;
    return total + 6.5;
  }, 0);
}

function layoutRulesForType(type) {
  if (type === "decision") {
    return { minWidth: 116, maxWidth: 210, minHeight: 92, paddingX: 36, paddingY: 30, lineHeight: 20 };
  }

  if (type === "terminator") {
    return { minWidth: 108, maxWidth: 170, minHeight: 58, paddingX: 30, paddingY: 18, lineHeight: 20 };
  }

  if (type === "process-wide") {
    return { minWidth: 360, maxWidth: 470, minHeight: 58, paddingX: 34, paddingY: 20, lineHeight: 20 };
  }

  if (type === "process-mid") {
    return { minWidth: 240, maxWidth: 340, minHeight: 58, paddingX: 32, paddingY: 20, lineHeight: 20 };
  }

  return { minWidth: 150, maxWidth: 230, minHeight: 58, paddingX: 28, paddingY: 18, lineHeight: 20 };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function estimatedWidth(node, rules) {
  const weighted = textWeight(node.text) + rules.paddingX;
  return clamp(Math.ceil(weighted / 10) * 10, rules.minWidth, rules.maxWidth);
}

function estimatedHeight(node, width, rules) {
  const usableWidth = Math.max(1, width - rules.paddingX);
  const lines = Math.max(1, Math.ceil(textWeight(node.text) / usableWidth));
  return Math.max(rules.minHeight, Math.ceil((lines * rules.lineHeight + rules.paddingY) / 2) * 2);
}

function normalizeNodeDimensions(diagram) {
  const groups = new Map();

  diagram.nodes.forEach((node) => {
    const type = nodeType(node);
    const rules = layoutRulesForType(type);
    const width = estimatedWidth(node, rules);
    const group = groups.get(type) || { type, rules, width: 0, height: 0, nodes: [] };
    group.width = Math.max(group.width, width);
    group.nodes.push(node);
    groups.set(type, group);
  });

  groups.forEach((group) => {
    group.nodes.forEach((node) => {
      group.height = Math.max(group.height, estimatedHeight(node, group.width, group.rules));
    });

    group.nodes.forEach((node) => {
      const center = nodeCenter(node);
      const nextWidth = group.width;
      const nextHeight = group.type === "decision" || group.type === "terminator"
        ? group.height
        : estimatedHeight(node, nextWidth, group.rules);

      node.x = center.x - nextWidth / 2;
      node.y = center.y - nextHeight / 2;
      node.width = nextWidth;
      node.height = nextHeight;
      node.layoutType = group.type;
    });
  });
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

function edgeRouteKind(edge, diagram) {
  const source = edge.source ? diagram.nodeById.get(edge.source) : null;
  const target = edge.target ? diagram.nodeById.get(edge.target) : null;

  if (!source || !target || edge.geometry.points?.length) return "";

  const sourceCenter = nodeCenter(source);
  const targetCenter = nodeCenter(target);
  const verticalGap = target.y - (source.y + source.height);
  const horizontalGap = Math.abs(targetCenter.x - sourceCenter.x);

  if (
    isDecision(source) &&
    isProcessLike(target) &&
    isNeighboringStep(source, target) &&
    verticalGap > 18 &&
    horizontalGap > 74
  ) {
    return "decision-fanout";
  }

  if (
    isProcessLike(source) &&
    isDecision(target) &&
    isNeighboringStep(source, target) &&
    verticalGap > 34 &&
    horizontalGap > 62
  ) {
    return "decision-merge";
  }

  return "";
}

function routeDecisionFanout(edge, source, target) {
  const sourceCenter = nodeCenter(source);
  const targetCenter = nodeCenter(target);
  const start = edgeEndpoint(source, edge, "exit", { x: targetCenter.x, y: target.y });
  const end = edgeEndpoint(target, edge, "entry", sourceCenter);
  const corner = { x: end.x, y: start.y };

  return compactPoints([
    start,
    corner,
    end
  ]);
}

function decisionUpperShoulder(node, side) {
  const center = nodeCenter(node);

  return {
    x: center.x + side * node.width * 0.24,
    y: node.y + node.height * 0.26
  };
}

function routeDecisionMerge(edge, source, target) {
  const sourceCenter = nodeCenter(source);
  const targetCenter = nodeCenter(target);
  const side = sourceCenter.x < targetCenter.x ? -1 : 1;
  const hasCustomStart = Boolean(edge.geometry.sourcePoint || styleAnchor(source, edge.style, "exit"));
  const start = hasCustomStart
    ? edgeEndpoint(source, edge, "exit", targetCenter)
    : { x: sourceCenter.x, y: source.y + source.height };
  const end = styleAnchor(target, edge.style, "entry") ||
    edge.geometry.targetPoint ||
    decisionUpperShoulder(target, side);
  const laneY = clamp(
    start.y + Math.max(42, (end.y - start.y) * 0.55),
    start.y + 34,
    target.y - 28
  );

  return compactPoints([
    start,
    { x: start.x, y: laneY },
    { x: end.x, y: laneY },
    end
  ]);
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

  const routeKind = edgeRouteKind(edge, diagram);
  if (routeKind === "decision-fanout") {
    return routeDecisionFanout(edge, source, target);
  }

  if (routeKind === "decision-merge") {
    return routeDecisionMerge(edge, source, target);
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

function shapeElement(node, className = "run-turn-node-shape", padding = 0) {
  const common = { class: className };
  const x = node.x - padding;
  const y = node.y - padding;
  const width = node.width + padding * 2;
  const height = node.height + padding * 2;

  if (isDecision(node)) {
    const cx = x + width / 2;
    const cy = y + height / 2;
    return svgElement("path", {
      ...common,
      d: `M ${cx} ${y} L ${x + width} ${cy} L ${cx} ${y + height} L ${x} ${cy} Z`
    });
  }

  if (isTerminator(node)) {
    return svgElement("rect", {
      ...common,
      x,
      y,
      width,
      height,
      rx: height / 2,
      ry: height / 2
    });
  }

  return svgElement("rect", {
    ...common,
    x,
    y,
    width,
    height,
    rx: node.style.rounded === "1" ? 10 : 3,
    ry: node.style.rounded === "1" ? 10 : 3
  });
}

function importantMarkerElement(node) {
  const cx = node.x + node.width - 10;
  const cy = node.y - 5;
  const points = [];

  for (let index = 0; index < 10; index += 1) {
    const radius = index % 2 === 0 ? 13 : 5.5;
    const angle = -Math.PI / 2 + index * Math.PI / 5;
    points.push(`${cx + Math.cos(angle) * radius},${cy + Math.sin(angle) * radius}`);
  }

  return svgElement("polygon", {
    class: "run-turn-important-marker",
    points: points.join(" ")
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

  const diagram = { nodes, regions, edges, nodeById };
  normalizeNodeDimensions(diagram);
  return diagram;
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
  const step = stepNumber(node);
  return step ? `Step ${step}` : "run_turn node";
}

function stepNumber(node) {
  return node.text.match(/^\[(\d+)\]/)?.[1] || "";
}

function setActiveNode(group, node) {
  document.querySelectorAll(".run-turn-node").forEach((item) => {
    item.classList.toggle("is-active", item === group);
  });

  const step = stepNumber(node);
  const detail = step ? runTurnDetails.get(step) : null;

  detailStep.textContent = stepText(node);
  detailTitle.textContent = detail ? `[${step}] ${detail.title}` : node.text;
  detailBody.replaceChildren();

  if (detail) {
    renderDetailMarkdown(detail.lines.join("\n"), detailBody);
    return;
  }

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
    const routeKind = edgeRouteKind(edge, diagram);
    const rawPoints = connectorPoints(edge, diagram);
    const points = trimRoute(
      rawPoints,
      edge.source && diagram.nodeById.has(edge.source) ? 2 : 0,
      edge.target && diagram.nodeById.has(edge.target) ? 7 : 0
    );
    const isShortBridge = points.length === 2 && routeLength(points) < 95;
    const isAbsoluteRoute = !edge.source || !edge.target;
    const d = roundedPolyline(points);
    const halo = svgElement("path", {
      class: [
        "run-turn-edge-halo",
        isShortBridge ? "is-short-bridge" : "",
        isAbsoluteRoute ? "is-absolute-route" : "",
        routeKind ? `is-${routeKind}` : ""
      ].filter(Boolean).join(" "),
      d
    });
    const path = svgElement("path", {
      class: [
        "run-turn-edge",
        isShortBridge ? "is-short-bridge" : "",
        isAbsoluteRoute ? "is-absolute-route" : "",
        routeKind ? `is-${routeKind}` : ""
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
        isImportantNode(node) ? "is-important-node" : "",
        node.text.includes("[0]") ? "is-start-node" : ""
      ].filter(Boolean).join(" "),
      tabindex: "0",
      role: "button",
      "aria-label": node.text,
      "data-node-id": node.id
    });
    if (isImportantNode(node)) {
      group.appendChild(shapeElement(node, "run-turn-node-highlight", 9));
      group.appendChild(importantMarkerElement(node));
    }
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
