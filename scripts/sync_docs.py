from __future__ import annotations

import json
import re
import shutil
from datetime import datetime
from pathlib import Path


BLOG_ROOT = Path(__file__).resolve().parents[1]
EXTERNAL_DOCS = BLOG_ROOT.parent / "final_docs"
SNAPSHOT_DOCS = BLOG_ROOT / "content" / "final_docs"
SNAPSHOT_DIAGRAMS = BLOG_ROOT / "content" / "diagrams"
OUTPUT_FILE = BLOG_ROOT / "data" / "docs-content.js"
FLOW_DIAGRAMS = {
    "run_turn": {
        "source_file": "run_turn.drawio",
        "output_file": BLOG_ROOT / "data" / "run-turn-diagram.js",
        "window_var": "CodexRunTurnDiagram",
    },
    "run_sampling_request": {
        "source_file": "run_sampling_request.drawio",
        "output_file": BLOG_ROOT / "data" / "run-sampling-request-diagram.js",
        "window_var": "CodexRunSamplingRequestDiagram",
    },
}

KNOWN_DOCS = {
    "plan模式与plan工具": {
        "slug": "plan-tools",
        "aliases": ["plan模式与plan工具"],
    },
    "goal工具": {
        "slug": "goal-tool",
        "aliases": ["goal工具"],
    },
    "hook点": {
        "slug": "hooks",
        "aliases": ["HOOK点", "hook点"],
    },
    "pending_input": {
        "slug": "pending-input",
        "aliases": ["pending_input"],
    },
    "tool call": {
        "slug": "tool-call",
        "aliases": ["tool call"],
    },
    "命令执行工具": {
        "slug": "exec-tool",
        "aliases": ["命令执行工具"],
    },
    "多agent工具": {
        "slug": "multi-agent",
        "aliases": ["多agent 工具", "多agent工具", "多agent能力"],
    },
    "特殊接口汇总": {
        "slug": "special-apis",
        "aliases": ["特殊接口汇总", "特殊接口"],
    },
    "app-server": {
        "slug": "app-server",
        "aliases": ["app-server", "app server"],
    },
    "rollout文件": {
        "slug": "rollout",
        "aliases": ["rollout文件", "rollout 文件"],
    },
    "上下文压缩": {
        "slug": "context-compaction",
        "aliases": ["上下文压缩", "context compaction"],
    },
    "thread & session": {
        "slug": "thread-session",
        "aliases": ["thread & session", "thread session"],
    },
    "turn & run_turn": {
        "slug": "run-turn",
        "aliases": ["turn & run_turn", "turn run_turn", "run_turn", "turn"],
    },
    "run_sampling_request": {
        "slug": "run-sampling-request",
        "aliases": ["run_sampling_request", "run sampling request", "run-sampling-request"],
    },
    "submission_loop": {
        "slug": "submission-loop",
        "aliases": ["submission_loop", "submission loop"],
    },
    "通信": {
        "slug": "communication",
        "aliases": ["通信", "thread 通信"],
    },
    "MCP & skill": {
        "slug": "mcp-skill",
        "aliases": ["MCP & skill", "MCP 和 skill", "MCP与skill"],
    },
    "MCP": {
        "slug": "mcp",
        "aliases": ["MCP"],
    },
    "skill": {
        "slug": "skill",
        "aliases": ["skill", "Skill"],
    },
    "记忆系统": {
        "slug": "memory",
        "aliases": ["记忆系统"],
    },
    "长期记忆": {
        "slug": "long-memory",
        "aliases": ["长期记忆", "长期记忆系统"],
    },
    "静态记忆": {
        "slug": "static-memory",
        "aliases": ["静态记忆"],
    },
    "动态记忆": {
        "slug": "dynamic-memory",
        "aliases": ["动态记忆"],
    },
}

GENERATED_DOCS = {
    "动态记忆": {
        "markdown": "## 动态记忆\n\n动态记忆就是模型当前上下文。\n",
    },
}


def fallback_slug(text: str) -> str:
    slug = re.sub(r"\s+", "-", text.strip().lower())
    slug = re.sub(r"[^\w\-\u4e00-\u9fff]", "", slug)
    return slug or "doc"


def first_heading(markdown: str, fallback: str) -> str:
    for line in markdown.splitlines():
        match = re.match(r"^\s{0,3}#{1,6}\s+(.+?)\s*$", line)
        if match:
            return match.group(1).strip()
    return fallback


def copy_external_docs() -> tuple[Path, str]:
    SNAPSHOT_DOCS.mkdir(parents=True, exist_ok=True)

    if EXTERNAL_DOCS.exists():
        for item in EXTERNAL_DOCS.iterdir():
            destination = SNAPSHOT_DOCS / item.name
            if item.is_dir():
                shutil.copytree(item, destination, dirs_exist_ok=True)
            else:
                shutil.copy2(item, destination)
        return EXTERNAL_DOCS, "external"

    if SNAPSHOT_DOCS.exists():
        return SNAPSHOT_DOCS, "snapshot"

    raise FileNotFoundError(f"No final_docs source found: {EXTERNAL_DOCS} or {SNAPSHOT_DOCS}")


def read_text_with_fallback(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8-sig")
    except UnicodeDecodeError:
        return path.read_text(encoding="gb18030")


def sync_flow_diagram(config: dict) -> tuple[Path | None, str]:
    SNAPSHOT_DIAGRAMS.mkdir(parents=True, exist_ok=True)
    source_file = config["source_file"]
    external_diagram = BLOG_ROOT.parent / source_file
    snapshot_diagram = SNAPSHOT_DIAGRAMS / source_file

    if external_diagram.exists():
        shutil.copy2(external_diagram, snapshot_diagram)
        return snapshot_diagram, "external"

    if snapshot_diagram.exists():
        return snapshot_diagram, "snapshot"

    return None, "missing"


def write_flow_diagram(config: dict, diagram_path: Path | None, source_kind: str) -> None:
    payload = {
        "generatedAt": datetime.now().isoformat(timespec="seconds"),
        "sourceKind": source_kind,
        "sourceFile": config["source_file"],
        "xml": read_text_with_fallback(diagram_path) if diagram_path else "",
    }
    write_window_payload(config["output_file"], config["window_var"], payload)


def payload_without_generated_at(payload: dict) -> dict:
    return {key: value for key, value in payload.items() if key != "generatedAt"}


def read_window_payload(path: Path) -> dict | None:
    if not path.exists():
        return None

    text = path.read_text(encoding="utf-8")
    _, separator, raw_payload = text.partition("=")
    if not separator:
        return None

    try:
        return json.loads(raw_payload.strip().rstrip(";"))
    except json.JSONDecodeError:
        return None


def write_window_payload(path: Path, window_var: str, payload: dict) -> None:
    existing = read_window_payload(path)
    if existing and payload_without_generated_at(existing) == payload_without_generated_at(payload):
        return

    js = f"window.{window_var} = " + json.dumps(payload, ensure_ascii=False, indent=2) + ";\n"
    path.write_text(js, encoding="utf-8")


def build_docs(source: Path) -> list[dict]:
    docs: list[dict] = []

    for markdown_path in sorted(source.glob("*.md"), key=lambda path: path.name.lower()):
        base_name = markdown_path.stem
        markdown = markdown_path.read_text(encoding="utf-8")
        heading = first_heading(markdown, base_name)
        known = KNOWN_DOCS.get(base_name)
        assets_dir_name = f"{base_name}.assets"
        assets_path = source / assets_dir_name
        assets = sorted([path.name for path in assets_path.iterdir() if path.is_file()]) if assets_path.exists() else []

        docs.append(
            {
                "slug": known["slug"] if known else fallback_slug(base_name),
                "title": heading,
                "fileTitle": base_name,
                "aliases": known["aliases"] if known else [base_name, heading],
                "sourceFile": f"{base_name}.md",
                "assetsBase": f"../content/final_docs/{assets_dir_name}/",
                "assets": assets,
                "markdown": markdown,
            }
        )

    existing_slugs = {doc["slug"] for doc in docs}

    for base_name, generated in GENERATED_DOCS.items():
        known = KNOWN_DOCS[base_name]
        if known["slug"] in existing_slugs:
            continue

        markdown = generated["markdown"]
        heading = first_heading(markdown, base_name)
        assets_dir_name = f"{base_name}.assets"
        docs.append(
            {
                "slug": known["slug"],
                "title": heading,
                "fileTitle": base_name,
                "aliases": known["aliases"],
                "sourceFile": f"{base_name}.md",
                "assetsBase": f"../content/final_docs/{assets_dir_name}/",
                "assets": [],
                "markdown": markdown,
            }
        )

    return docs


def main() -> None:
    source, source_kind = copy_external_docs()
    docs = build_docs(source)
    payload = {
        "generatedAt": datetime.now().isoformat(timespec="seconds"),
        "sourceKind": source_kind,
        "docs": docs,
    }
    write_window_payload(OUTPUT_FILE, "CodexDocsContent", payload)
    print(f"Synced {len(docs)} docs from {source_kind} source into {SNAPSHOT_DOCS}")

    for name, config in FLOW_DIAGRAMS.items():
        diagram_path, diagram_source_kind = sync_flow_diagram(config)
        write_flow_diagram(config, diagram_path, diagram_source_kind)
        print(f"Synced {config['source_file']} from {diagram_source_kind} source into {SNAPSHOT_DIAGRAMS}")


if __name__ == "__main__":
    main()
