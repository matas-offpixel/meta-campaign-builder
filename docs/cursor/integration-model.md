---
alwaysApply: true
---

Dashboard / Creator integration model

- Dashboard is source of truth for clients, events, workflow, reporting context.
- Creator is source of truth for campaign setup, launch execution, Meta outputs.
- Dashboard initiates campaign creation.
- Creator should not own client/event management.
- Products connect through event_id / linked draft records.
- Avoid tight coupling between dashboard UI and creator internals.
- If cross-product changes are needed, keep interfaces minimal and explicit.
