# Commercial licensing

AirLock is **dual-licensed**. The source is the same either way; only the grant
differs.

| | Default grant | Commercial licence |
| --- | --- | --- |
| Licence | [PolyForm Strict 1.0.0](LICENSE.md) | separate written agreement |
| Read the source | ✓ | ✓ |
| Noncommercial use | ✓ | ✓ |
| Commercial use | **—** | ✓ |
| Redistribute or modify | — | — |
| Cost | free | see below |

## Do I need one?

**You do not** if your use is noncommercial. PolyForm Strict already covers
personal study, hobby projects, research and experimentation, and use by
charities, educational institutions, public research bodies and government.

**You do** if AirLock is used by or for a for-profit organisation. That includes
the common case: a developer at a company, running AirLock while working on that
company's code. It does not matter whether AirLock itself is sold or shipped —
using it commercially is what needs the licence.

If you are unsure which side of the line you are on, ask. A short email is
cheaper than a wrong guess for both of us.

## What it grants

The right to use AirLock for commercial purposes, per developer.

It deliberately does **not** grant redistribution or the right to make modified
versions. That restriction is not a pricing lever — it exists so there is one
canonical, auditable build of a tool people trust with credentials. A forked
AirLock with an altered secret broker would carry the name without the
guarantees, which is the one outcome worth preventing at any price.

## How to get one

Email **<ricardoramostrevino@hotmail.com>** with:

- your company name,
- how many developers need it,
- anything unusual about your setup (air-gapped, managed devices, procurement
  requirements).

You will get the agreement and an invoice back. No procurement theatre.

## Pricing

Per developer, per year, agreed directly — tell me the team size and I will send
a quote. It is not a published number because the right one differs for a
two-person startup and a fifty-engineer company, and I would rather quote you
honestly than have you self-select out of a list price that was never aimed at
you.

Ask, and you get a figure in the reply. There is no discovery call.

## Security review before purchase

Reasonable requests are welcome, and answering them is not a favour — it is the
product. Start with the [threat model](docs/threat-model.md), which states what
AirLock does **not** protect against as precisely as what it does. The
build-enforced no-secret-value invariant is
[this test](packages/app/src/main/mcp/tools.test.ts).

---

*This page describes the licensing structure. It is not itself a licence — a
commercial grant exists only once there is a signed agreement between us.*
