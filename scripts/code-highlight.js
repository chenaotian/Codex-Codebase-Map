(function () {
  const KEYWORDS = [
    "as",
    "async",
    "await",
    "break",
    "case",
    "class",
    "const",
    "continue",
    "def",
    "else",
    "enum",
    "false",
    "fn",
    "for",
    "from",
    "function",
    "if",
    "impl",
    "import",
    "in",
    "let",
    "loop",
    "match",
    "mod",
    "mut",
    "pub",
    "return",
    "self",
    "static",
    "struct",
    "switch",
    "this",
    "trait",
    "true",
    "type",
    "use",
    "var",
    "while"
  ];

  const LANGUAGE_ALIASES = {
    bash: "shell",
    console: "shell",
    javascript: "js",
    jsonc: "json",
    powershell: "shell",
    ps1: "shell",
    py: "python",
    rs: "rust",
    sh: "shell",
    text: "text",
    ts: "js",
    typescript: "js"
  };

  function appendToken(parent, text, className = "") {
    if (!text) return;

    if (!className) {
      parent.appendChild(document.createTextNode(text));
      return;
    }

    const span = document.createElement("span");
    span.className = `syntax-token ${className}`;
    span.textContent = text;
    parent.appendChild(span);
  }

  function normalizeLanguage(language, code) {
    const raw = String(language || "")
      .trim()
      .split(/\s+/)[0]
      .toLowerCase();

    if (raw) {
      return LANGUAGE_ALIASES[raw] || raw;
    }

    const trimmed = String(code || "").trim();
    if (/^[\[{]/.test(trimmed)) {
      try {
        JSON.parse(trimmed);
        return "json";
      } catch (_) {
        return "text";
      }
    }

    if (/^\s*\[[^\]]+\]/m.test(trimmed) || /^\s*[\w.-]+\s*=/.test(trimmed)) {
      return "toml";
    }

    return "text";
  }

  function highlightWithMatcher(code, matcher, handlers) {
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    let match;

    matcher.lastIndex = 0;
    while ((match = matcher.exec(code)) !== null) {
      appendToken(fragment, code.slice(cursor, match.index));
      handlers(fragment, match);
      cursor = matcher.lastIndex;
    }

    appendToken(fragment, code.slice(cursor));
    return fragment;
  }

  function highlightJson(code) {
    const matcher = /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b|([{}\[\],:])/g;

    return highlightWithMatcher(code, matcher, (fragment, match) => {
      if (match[1]) {
        appendToken(fragment, match[1], match[2] ? "syntax-key" : "syntax-string");
        appendToken(fragment, match[2], "syntax-punctuation");
        return;
      }

      if (match[3]) {
        appendToken(fragment, match[3], "syntax-number");
        return;
      }

      if (match[4]) {
        appendToken(fragment, match[4], "syntax-literal");
        return;
      }

      appendToken(fragment, match[5], "syntax-punctuation");
    });
  }

  function genericMatcher() {
    const keywordPattern = KEYWORDS.join("|");

    return new RegExp(
      "(\\/\\/.*|#.*|\\/\\*[\\s\\S]*?\\*\\/)" +
        "|(\"(?:\\\\.|[^\"\\\\])*\"|'(?:\\\\.|[^'\\\\])*'|`(?:\\\\.|[^`\\\\])*`)" +
        "|(\\b(?:true|false|null|undefined|None|Some|Ok|Err)\\b)" +
        "|(\\b(?:" + keywordPattern + ")\\b)" +
        "|(-?\\b\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?\\b)" +
        "|([{}()[\\],.:;=<>+*\\/!&|?%-]+)",
      "g"
    );
  }

  function highlightGeneric(code) {
    return highlightWithMatcher(code, genericMatcher(), (fragment, match) => {
      if (match[1]) {
        appendToken(fragment, match[1], "syntax-comment");
      } else if (match[2]) {
        appendToken(fragment, match[2], "syntax-string");
      } else if (match[3]) {
        appendToken(fragment, match[3], "syntax-literal");
      } else if (match[4]) {
        appendToken(fragment, match[4], "syntax-keyword");
      } else if (match[5]) {
        appendToken(fragment, match[5], "syntax-number");
      } else {
        appendToken(fragment, match[6], "syntax-punctuation");
      }
    });
  }

  function splitTomlComment(line) {
    let quote = "";
    let escaped = false;

    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];

      if (escaped) {
        escaped = false;
        continue;
      }

      if (quote && char === "\\") {
        escaped = true;
        continue;
      }

      if (quote && char === quote) {
        quote = "";
        continue;
      }

      if (!quote && (char === "\"" || char === "'")) {
        quote = char;
        continue;
      }

      if (!quote && char === "#") {
        return [line.slice(0, index), line.slice(index)];
      }
    }

    return [line, ""];
  }

  function highlightTomlLine(fragment, line) {
    const [body, comment] = splitTomlComment(line);
    const section = body.match(/^(\s*)(\[[^\]]+\])(.*)$/);

    if (section) {
      appendToken(fragment, section[1]);
      appendToken(fragment, section[2], "syntax-section");
      fragment.appendChild(highlightGeneric(section[3]));
      appendToken(fragment, comment, "syntax-comment");
      return;
    }

    const assignment = body.match(/^(\s*)([A-Za-z0-9_.-]+)(\s*=)(.*)$/);
    if (assignment) {
      appendToken(fragment, assignment[1]);
      appendToken(fragment, assignment[2], "syntax-key");
      appendToken(fragment, assignment[3], "syntax-punctuation");
      fragment.appendChild(highlightGeneric(assignment[4]));
      appendToken(fragment, comment, "syntax-comment");
      return;
    }

    fragment.appendChild(highlightGeneric(body));
    appendToken(fragment, comment, "syntax-comment");
  }

  function highlightToml(code) {
    const fragment = document.createDocumentFragment();

    code.split(/(\r?\n)/).forEach((part) => {
      if (/^\r?\n$/.test(part)) {
        appendToken(fragment, part);
      } else {
        highlightTomlLine(fragment, part);
      }
    });

    return fragment;
  }

  function highlight(code, language = "") {
    const normalized = normalizeLanguage(language, code);

    if (normalized === "json") {
      return highlightJson(code);
    }

    if (normalized === "toml") {
      return highlightToml(code);
    }

    return highlightGeneric(code);
  }

  window.CodexCodeHighlight = { highlight, normalizeLanguage };
})();
