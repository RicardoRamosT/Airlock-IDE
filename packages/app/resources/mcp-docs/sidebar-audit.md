# Sidebar · Audit

## What it shows
A chronological log of sensitive operations airlock has performed for this project — for
example secret writes/deletes and secret injection (including injections that were *blocked*
because the env name was dangerous). It refreshes whenever a broker operation runs. It is a
transparency record of what airlock did with credentials, not a record of your terminal
commands.

There is no MCP tool for the audit log; it is a human-facing trail.

## When it's useful
Useful for any project where credentials are managed through airlock — i.e. wherever the
Secrets section is in play. It gives the human a verifiable history of every secret
operation, which is core to airlock's trust model. Keep it available for credential-bearing
projects; it defaults to collapsed, so it stays unobtrusive. For a project with no secrets
and no broker activity it will simply be empty, and can be hidden.
