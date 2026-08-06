# Preferences

How this manager likes the work done — interaction style, formats, and defaults.

## Active - 2026-07-23

### [ACTIVE] Documentation deliverables default to `.docx`

**Rule**: Deliver documentation as Word (`.docx`) files by default. When a task produces a document/report deliverable, produce the `.docx` — don't wait to be asked and don't default to leaving it as plain markdown.

**Scope**: All projects on this machine. Applies to all jobs.

**Nuance**: Quick answers, in-conversation discussion, and internal working notes can still be plain markdown/chat — the `.docx` default is for documentation *deliverables*, not every message. An explicit per-artifact request for another format still overrides.

**Tooling**: pandoc is NOT installed and the FRAIM `author-docx` node fails (missing `adm-zip`). Use `scripts/md_to_docx.py` (python-docx, already present) — renders headings, native Word tables, bullets, code, and hyperlinks.

**History**: Supersedes the earlier "default to plain markdown" proposal (2026-07-19). Manager updated the default to `.docx` on 2026-07-23.
