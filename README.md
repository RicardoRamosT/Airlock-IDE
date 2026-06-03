# airlock

> Working title. A terminal-first AI IDE where the agent can build, run, and
> debug your app — but is structurally unable to read your secrets.

**Status:** walking skeleton (weeks 1–2 of the v1 roadmap). Terminal, file
tree, and read-only viewer work. Agent + secret broker land in weeks 3–5.

Spec: `docs/superpowers/specs/2026-06-03-airlock-v1-design.md`

## Dev

```bash
npm install
npm run rebuild   # rebuild node-pty for Electron's ABI
npm run dev       # launch the app
npm test          # agent-core + renderer unit tests
npm run typecheck
npm run lint
```

macOS only for now (by design — see spec §2).
