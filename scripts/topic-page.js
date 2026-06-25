const docsContent = window.CodexDocsContent;
const mapData = window.CodexKnowledgeMap;
const article = document.querySelector("[data-topic-article]");
const toc = document.querySelector("[data-topic-toc]");
const title = document.querySelector("[data-topic-title]");
const eyebrow = document.querySelector("[data-topic-eyebrow]");
const source = document.querySelector("[data-topic-source]");
let imageLightbox;
const LIGHTBOX_MIN_SCALE = 0.55;
const LIGHTBOX_MAX_SCALE = 6;

function element(tagName, className, text) {
  const node = document.createElement(tagName);

  if (className) {
    node.className = className;
  }

  if (text) {
    node.textContent = text;
  }

  return node;
}

function getRequestedSlug() {
  const params = new URLSearchParams(window.location.search);
  return params.get("doc") || window.CodexTopicDocSlug || "plan-tools";
}

function normalizeTitle(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/_/g, "-");
}

function slugify(value) {
  const normalized = normalizeTitle(value).replace(/[^\p{L}\p{N}-]/gu, "");
  return normalized || `section-${Math.random().toString(16).slice(2, 8)}`;
}

function findDoc(slug) {
  const docs = docsContent?.docs || [];
  const normalizedSlug = normalizeTitle(slug);

  return (
    docs.find((doc) => normalizeTitle(doc.slug) === normalizedSlug) ||
    docs.find((doc) => normalizeTitle(doc.title) === normalizedSlug) ||
    docs.find((doc) => (doc.aliases || []).some((alias) => normalizeTitle(alias) === normalizedSlug))
  );
}

function findMapNodeForDoc(doc) {
  const nodes = mapData?.nodes || [];
  const normalizedSlug = normalizeTitle(doc.slug);
  const normalizedTitle = normalizeTitle(doc.title);

  return nodes.find((node) => normalizeTitle(node.docSlug) === normalizedSlug) ||
    nodes.find((node) => normalizeTitle(node.title) === normalizedTitle);
}

function getChildDocs(doc) {
  const node = findMapNodeForDoc(doc);

  return (node?.childDocSlugs || [])
    .map((slug) => findDoc(slug))
    .filter(Boolean);
}

function getChildLinksBeforeHeading(doc) {
  const node = findMapNodeForDoc(doc);
  return node?.childLinksBeforeHeading || "";
}

function renderInline(text) {
  const fragment = document.createDocumentFragment();
  const tokens = String(text).split(/(`[^`]+`|\*\*[^*]+\*\*)/g);

  tokens.forEach((token) => {
    if (!token) return;

    if (token.startsWith("`") && token.endsWith("`")) {
      fragment.appendChild(element("code", "inline-code", token.slice(1, -1)));
      return;
    }

    if (token.startsWith("**") && token.endsWith("**")) {
      fragment.appendChild(element("strong", "", token.slice(2, -2)));
      return;
    }

    fragment.appendChild(document.createTextNode(token));
  });

  return fragment;
}

function resolveImagePath(doc, rawPath) {
  const normalized = rawPath.trim().replace(/^<|>$/g, "");
  const filename = normalized.split(/[\\/]/).pop();

  if (/^[A-Za-z]:[\\/]/.test(normalized) || normalized.includes(".assets")) {
    return encodeURI(`${doc.assetsBase}${filename}`);
  }

  if (/^https?:\/\//i.test(normalized) || normalized.startsWith("../") || normalized.startsWith("./")) {
    return encodeURI(normalized);
  }

  return encodeURI(`${doc.assetsBase}${filename}`);
}

function appendParagraph(parent, lines) {
  if (!lines.length) return;

  const p = element("p", "topic-paragraph");
  p.appendChild(renderInline(lines.join(" ").trim()));
  parent.appendChild(p);
}

function appendCode(parent, codeLines, language) {
  const pre = element("pre", `topic-code language-${language || "text"}`);
  const code = element("code");
  const text = codeLines.join("\n");

  if (window.CodexCodeHighlight) {
    code.appendChild(window.CodexCodeHighlight.highlight(text, language));
  } else {
    code.textContent = text;
  }

  pre.appendChild(code);
  parent.appendChild(pre);
}

function appendImage(parent, doc, alt, src) {
  const figure = element("figure", "taped-figure");
  const tapeA = element("span", "figure-tape tape-left");
  const tapeB = element("span", "figure-tape tape-right");
  const img = document.createElement("img");
  img.src = resolveImagePath(doc, src);
  img.alt = alt || doc.title;
  img.loading = "lazy";
  img.tabIndex = 0;
  img.setAttribute("role", "button");
  img.setAttribute("aria-label", `放大图片：${img.alt}`);
  img.addEventListener("click", () => openImageLightbox(img.src, img.alt));
  img.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openImageLightbox(img.src, img.alt);
    }
  });

  figure.appendChild(tapeA);
  figure.appendChild(tapeB);
  figure.appendChild(img);
  parent.appendChild(figure);
}

function ensureImageLightbox() {
  if (imageLightbox) return imageLightbox;

  const overlay = element("div", "image-lightbox");
  const frame = element("figure", "image-lightbox-frame");
  const viewport = element("div", "image-lightbox-viewport");
  const media = element("div", "image-lightbox-media");
  const closeButton = element("button", "image-lightbox-close", "×");
  const img = document.createElement("img");
  const state = {
    baseWidth: 0,
    baseHeight: 0,
    scale: 1,
    dragging: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    startScrollLeft: 0,
    startScrollTop: 0
  };

  overlay.hidden = true;
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "放大图片预览");
  closeButton.type = "button";
  closeButton.setAttribute("aria-label", "关闭放大图片");
  img.draggable = false;

  media.appendChild(img);
  viewport.appendChild(media);
  frame.appendChild(closeButton);
  frame.appendChild(viewport);
  overlay.appendChild(frame);
  document.body.appendChild(overlay);

  function close() {
    overlay.hidden = true;
    document.body.classList.remove("is-lightbox-open");
  }

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      close();
    }
  });
  closeButton.addEventListener("click", close);
  viewport.addEventListener("wheel", (event) => {
    event.preventDefault();
    zoomLightboxAtPoint(imageLightbox, event);
  }, { passive: false });
  viewport.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;

    state.dragging = true;
    state.pointerId = event.pointerId;
    state.startX = event.clientX;
    state.startY = event.clientY;
    state.startScrollLeft = viewport.scrollLeft;
    state.startScrollTop = viewport.scrollTop;
    viewport.classList.add("is-dragging");
    viewport.setPointerCapture(event.pointerId);
  });
  viewport.addEventListener("pointermove", (event) => {
    if (!state.dragging || state.pointerId !== event.pointerId) return;

    viewport.scrollLeft = state.startScrollLeft - (event.clientX - state.startX);
    viewport.scrollTop = state.startScrollTop - (event.clientY - state.startY);
  });
  viewport.addEventListener("pointerup", (event) => stopLightboxDrag(imageLightbox, event));
  viewport.addEventListener("pointercancel", (event) => stopLightboxDrag(imageLightbox, event));
  document.addEventListener("keydown", (event) => {
    if (!overlay.hidden && event.key === "Escape") {
      close();
    }
  });

  imageLightbox = { overlay, frame, viewport, media, img, closeButton, state };
  return imageLightbox;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function applyLightboxScale(lightbox) {
  const { media, img, state } = lightbox;
  const width = Math.max(1, state.baseWidth * state.scale);

  media.style.width = `${width}px`;
  img.style.width = "100%";
}

function resetLightboxImage(lightbox) {
  const { viewport, img, state } = lightbox;
  const naturalWidth = img.naturalWidth || 1;
  const naturalHeight = img.naturalHeight || 1;
  const availableWidth = Math.max(280, viewport.clientWidth - 48);
  const availableHeight = Math.max(220, viewport.clientHeight - 28);
  const fitScale = Math.min(1, availableWidth / naturalWidth, availableHeight / naturalHeight);

  state.baseWidth = Math.max(1, naturalWidth * fitScale);
  state.baseHeight = Math.max(1, naturalHeight * fitScale);
  state.scale = 1;
  applyLightboxScale(lightbox);

  requestAnimationFrame(() => {
    viewport.scrollLeft = Math.max(0, (viewport.scrollWidth - viewport.clientWidth) / 2);
    viewport.scrollTop = Math.max(0, (viewport.scrollHeight - viewport.clientHeight) / 2);
  });
}

function zoomLightboxAtPoint(lightbox, event) {
  if (!lightbox || lightbox.overlay.hidden) return;

  const { viewport, img, state } = lightbox;
  if (!img.naturalWidth || !img.naturalHeight) return;

  const oldScale = state.scale;
  const oldWidth = state.baseWidth * oldScale;
  const oldHeight = state.baseHeight * oldScale;
  const rect = viewport.getBoundingClientRect();
  const localX = event.clientX - rect.left;
  const localY = event.clientY - rect.top;
  const imageX = clamp((viewport.scrollLeft + localX) / oldWidth, 0, 1);
  const imageY = clamp((viewport.scrollTop + localY) / oldHeight, 0, 1);
  const zoomFactor = event.deltaY < 0 ? 1.14 : 0.88;

  state.scale = clamp(oldScale * zoomFactor, LIGHTBOX_MIN_SCALE, LIGHTBOX_MAX_SCALE);
  applyLightboxScale(lightbox);

  const newWidth = state.baseWidth * state.scale;
  const newHeight = state.baseHeight * state.scale;
  viewport.scrollLeft = imageX * newWidth - localX;
  viewport.scrollTop = imageY * newHeight - localY;
}

function stopLightboxDrag(lightbox, event) {
  if (!lightbox || !lightbox.state.dragging || lightbox.state.pointerId !== event.pointerId) return;

  lightbox.state.dragging = false;
  lightbox.state.pointerId = null;
  lightbox.viewport.classList.remove("is-dragging");
  if (lightbox.viewport.hasPointerCapture(event.pointerId)) {
    lightbox.viewport.releasePointerCapture(event.pointerId);
  }
}

function openImageLightbox(src, alt) {
  const lightbox = ensureImageLightbox();

  lightbox.img.onload = () => resetLightboxImage(lightbox);
  lightbox.img.alt = alt;
  lightbox.overlay.hidden = false;
  document.body.classList.add("is-lightbox-open");
  lightbox.img.src = src;
  if (lightbox.img.complete) {
    resetLightboxImage(lightbox);
  }
  lightbox.closeButton.focus();
}

function createTopicList(item, depth) {
  const list = element(item.ordered ? "ol" : "ul", "topic-list");
  list.dataset.depth = String(Math.min(depth, 4));

  if (item.ordered && item.number > 1) {
    list.start = item.number;
  }

  return list;
}

function appendList(parent, items) {
  if (!items.length) return;

  const baseIndent = Math.min(...items.map((item) => item.indent));
  const stack = [];

  items.forEach((item) => {
    let depth = Math.max(0, item.indent - baseIndent);

    if (depth > stack.length) {
      depth = stack.length;
    }

    while (stack.length > depth + 1) {
      stack.pop();
    }

    let context = stack[depth];

    if (!context || context.ordered !== item.ordered) {
      const list = createTopicList(item, depth);
      context = { list, ordered: item.ordered, lastItem: null };
      stack[depth] = context;
      stack.length = depth + 1;

      if (depth === 0) {
        parent.appendChild(list);
      } else {
        const parentContext = stack[depth - 1];

        if (parentContext?.lastItem) {
          parentContext.lastItem.appendChild(list);
        } else {
          parent.appendChild(list);
        }
      }
    }

    const li = element("li", `topic-list-item topic-list-depth-${Math.min(depth, 4)}`);
    li.appendChild(renderInline(item.text));
    context.list.appendChild(li);
    context.lastItem = li;
  });
}

function splitTableRow(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isTableDivider(line) {
  const cells = splitTableRow(line || "");

  return cells.length > 1 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function isTableRow(line) {
  return splitTableRow(line || "").length > 1 && (line || "").includes("|");
}

function getTableAlignments(line) {
  return splitTableRow(line).map((cell) => {
    const starts = cell.startsWith(":");
    const ends = cell.endsWith(":");

    if (starts && ends) return "center";
    if (ends) return "right";
    return "left";
  });
}

function appendTable(parent, headerCells, bodyRows, alignments) {
  const columnCount = Math.max(headerCells.length, ...bodyRows.map((row) => row.length));
  const wrap = element("div", "topic-table-wrap");
  const table = element("table", "topic-table");
  const thead = element("thead");
  const headRow = element("tr");
  const tbody = element("tbody");

  function appendCell(row, tagName, text, index) {
    const cell = element(tagName);
    const alignment = alignments[index] || "left";
    cell.style.textAlign = alignment;
    cell.appendChild(renderInline(text || ""));
    row.appendChild(cell);
  }

  for (let index = 0; index < columnCount; index += 1) {
    appendCell(headRow, "th", headerCells[index], index);
  }

  thead.appendChild(headRow);
  table.appendChild(thead);

  bodyRows.forEach((cells) => {
    const row = element("tr");

    for (let index = 0; index < columnCount; index += 1) {
      appendCell(row, "td", cells[index], index);
    }

    tbody.appendChild(row);
  });

  table.appendChild(tbody);
  wrap.appendChild(table);
  parent.appendChild(wrap);
}

function renderMarkdown(doc) {
  const lines = doc.markdown.replace(/^\uFEFF/, "").split(/\r?\n/);
  const headings = [];
  const childLinksBeforeHeading = normalizeTitle(getChildLinksBeforeHeading(doc));
  let childLinksInserted = false;
  let paragraph = [];
  let listItems = [];
  let codeLines = [];
  let codeLanguage = "";
  let inCode = false;
  let firstHeadingSkipped = false;

  function flushParagraph() {
    appendParagraph(article, paragraph);
    paragraph = [];
  }

  function flushList() {
    if (listItems.length) {
      appendList(article, listItems);
      listItems = [];
    }
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      if (inCode) {
        appendCode(article, codeLines, codeLanguage);
        codeLines = [];
        codeLanguage = "";
        inCode = false;
        continue;
      }

      flushParagraph();
      flushList();
      inCode = true;
      codeLanguage = trimmed.slice(3).trim();
      continue;
    }

    if (inCode) {
      codeLines.push(line);
      continue;
    }

    if (/^\[toc\]$/i.test(trimmed)) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*$/);
    if (heading) {
      flushParagraph();
      flushList();

      const level = heading[1].length;
      const text = heading[2].trim();

      if (!firstHeadingSkipped && level <= 2) {
        firstHeadingSkipped = true;
        continue;
      }

      if (
        childLinksBeforeHeading &&
        !childLinksInserted &&
        normalizeTitle(text) === childLinksBeforeHeading
      ) {
        childLinksInserted = appendChildLinks(doc);
      }

      const id = slugify(text);
      headings.push({ id, title: text });

      const headingTag = level >= 4 ? "h3" : "h2";
      const node = element(headingTag, "topic-heading", text);
      node.id = id;
      article.appendChild(node);
      continue;
    }

    const image = line.match(/!\[([^\]]*)\]\((.+?)\)/);
    if (image) {
      flushParagraph();
      flushList();
      appendImage(article, doc, image[1], image[2]);
      continue;
    }

    if (isTableRow(line) && isTableDivider(lines[index + 1])) {
      const headerCells = splitTableRow(line);
      const alignments = getTableAlignments(lines[index + 1]);
      const bodyRows = [];

      flushParagraph();
      flushList();
      index += 2;

      while (index < lines.length && isTableRow(lines[index]) && !isTableDivider(lines[index])) {
        bodyRows.push(splitTableRow(lines[index]));
        index += 1;
      }

      appendTable(article, headerCells, bodyRows, alignments);
      index -= 1;
      continue;
    }

    const unordered = line.match(/^(\s*)[-*]\s+(.+)$/);
    const ordered = line.match(/^(\s*)(\d+)\.\s+(.+)$/);
    if (unordered || ordered) {
      flushParagraph();
      const match = unordered || ordered;
      const isOrdered = Boolean(ordered);
      listItems.push({
        indent: Math.floor((match[1] || "").length / 2),
        ordered: isOrdered,
        number: ordered ? Number(match[2]) : undefined,
        text: (ordered ? match[3] : match[2]).trim()
      });
      continue;
    }

    if (!trimmed) {
      flushParagraph();
      continue;
    }

    flushList();
    paragraph.push(trimmed);
  }

  if (inCode) {
    appendCode(article, codeLines, codeLanguage);
  }
  flushParagraph();
  flushList();

  return { headings, childLinksInserted };
}

function renderToc(headings) {
  toc.innerHTML = "";

  headings.forEach((item) => {
    const link = element("a", "", item.title);
    link.href = `#${item.id}`;
    toc.appendChild(link);
  });
}

function appendChildLinks(doc) {
  const childDocs = getChildDocs(doc);

  if (!childDocs.length) return false;

  const section = element("nav", "topic-child-links");
  section.setAttribute("aria-label", "子节点页面");
  section.appendChild(element("h2", "topic-child-heading", "子节点"));

  const grid = element("div", "topic-child-grid");

  childDocs.forEach((childDoc, index) => {
    const link = element("a", "topic-child-card");
    link.href = `topic.html?doc=${encodeURIComponent(childDoc.slug)}`;
    link.style.setProperty("--tilt", `${index % 2 === 0 ? -0.35 : 0.35}deg`);

    const tier = element("span", "topic-child-tier", "进入");
    const label = element("span", "topic-child-title", childDoc.title);

    link.appendChild(tier);
    link.appendChild(label);
    grid.appendChild(link);
  });

  section.appendChild(grid);
  article.appendChild(section);
  return true;
}

function renderTopic() {
  const doc = findDoc(getRequestedSlug());

  if (!doc) {
    title.textContent = "未找到知识节点";
    eyebrow.textContent = "Missing Node";
    source.textContent = "data/docs-content.js";
    article.appendChild(element("p", "topic-empty", "没有在同步后的文档清单中找到这个知识节点。请先运行 start-blog.ps1 同步 final_docs。"));
    return;
  }

  document.title = `${doc.title} | Codex 源码知识地图`;
  title.textContent = doc.title;
  eyebrow.textContent = "Knowledge Node";
  source.textContent = doc.sourceFile;

  const { headings, childLinksInserted } = renderMarkdown(doc);
  if (!childLinksInserted) {
    appendChildLinks(doc);
  }
  renderToc(headings);
}

renderTopic();
