# fixture — a project with custom triggers, carrying all three debt kinds

## Project memory (llmwiki)
- Wiki root: wiki/
- Journal: notes/
- Kind: research
- Trigger cutoff: 2026-08-01
- Trigger: payload-in | payload/incoming/*/ | marker:RETURN.txt
- Trigger: payload-out | payload/outgoing/*/ | mention
- Trigger: exports | exports/*.csv | mention
