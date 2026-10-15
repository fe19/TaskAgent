# Agent instructions

Rules for every coding agent working in this repository (Claude Code, GitHub Copilot, and others).

## Working rules

- **Change files locally only.** Do not commit or push. The maintainer reviews and commits.
- **Keep code modular, clean and easy to understand.** Small modules with one job, clear names, no clever tricks. Follow the layering in [ARCHITECTURE.md](ARCHITECTURE.md).
- **Write simply and clearly, and don't be verbose.** This applies to code comments, docs and messages to the user.
- **Ask first when something is unclear.** Ask your questions before you start, rather than guessing.
- **Raise concerns.** Say so when you see a risk, e.g. security, data loss or something that breaks existing behaviour.
- **Propose better solutions.** If you find a simpler or better approach than the one asked for, suggest it.

## Project pointers

- What the app does and how to run it: [README.md](README.md)
- How to extend it: [.claude/skills/extend-agents-tasks](.claude/skills/extend-agents-tasks/SKILL.md)
- How to verify a change (`npm test` and more): [.claude/skills/verify-agents-tasks](.claude/skills/verify-agents-tasks/SKILL.md)
