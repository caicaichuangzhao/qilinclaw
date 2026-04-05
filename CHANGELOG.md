# QilinClaw - Changelog

## [1.1.0] - 2026-04-05

### 🚀 New Features

- **Built-In 1-Click System Sync**: Implemented a robust GUI feature via Settings allowing users to compare the local branch against the upstream GitHub repository (`caicaichuangzhao/qilinclaw`) and pull in new changes with an intelligent auto-stash mechanism to prevent conflicts without any command-line experience.
- **Agentic Loop Orchestrator Stabilization**: A new top-to-bottom global `AbortController` pipeline.
    - Double-layered process management now listens actively for `req.on('close')` drops (e.g. user leaves the UI and breaks the stream, or clicks "stop generation").
    - True hard-kill capability: when an abort signal is issued, all background LLM requests, GUI automation hooks, and agent processes are forcefully terminated.
- **Continuous Persistence Rescue Mechanism**: The engine now handles unexpected interruptions. When an orchestrator abort or network disconnection occurs mid-sentence, the system performs an emergency buffer flush. The generated tokens up to that point are safely saved to the database to prevent total generation loss, appended with an `*(已终止)*` mark.

### 🐛 Bug Fixes & Refactors

- Refactored `chat-orchestrator.ts` into a unified pipeline instead of scattered stream / non-stream blocks, dramatically reducing code duplication and making maintenance easier.
- Resolved Windows filesystem locking issues when attempting to handle hot persistence updates during agent streaming.

---

## [1.0.0] - Initial Open-Source Release
