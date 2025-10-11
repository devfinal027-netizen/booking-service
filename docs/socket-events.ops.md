## Operations & analytics socket playbook

Operations dashboards and monitoring services consume a subset of booking events for fleet visibility. This guide highlights the sockets and rooms ops applications must wire up, derived from the canonical reference `docs/socket-events.md`.

### Connection strategy
- Authenticate with an ops-issued JWT (same gateway as other personas) to satisfy `socketAuth`.
- Join the shared `ops:booking` room immediately after connecting. Dashboards may optionally subscribe to:
  - `driver:{driverId}` for focused supervision
  - `booking:{bookingId}` when drilling into a specific trip
  - Global legacy feeds `driver:location` and `driver:position`
- Maintain read-only posture—ops sockets should **not** emit lifecycle events.

### Critical server → ops events
| Event | Source | Room(s) | Payload highlights |
|-------|--------|---------|--------------------|
| `booking:update` | `events/bookingEvents.js` | `ops:booking`, selected booking rooms | Canonical lifecycle snapshot including passenger, driver, pricing, timestamps |
| `trip:started` / `trip:ongoing` / `trip:completed` | `events/bookingEvents.js` | `ops:booking`, booking rooms | Mirrors trip milestones for analytics |
| `booking:driver_location` | `services/positionUpdate.js`, `sockets/driverSocket.js` | `ops:booking`, `driver:{id}`, `booking:{id}` | Latest GPS point with metadata (`locationStatus`, `recordedAt`) |
| `booking:ETA_update` | `sockets/liveSocket.js` | `booking:{id}` | ETA broadcast with optional driver message |
| `pricing:update` | `services/bookingPricingService.js` | `ops:booking`, booking rooms | Fare recalculation (base, surge, discounts, payable) |
| `driver:availability` | `events/driverEvents.js` | `driver:{id}` | Persisted availability flag |
| `driver:location` / `driver:position` | `events/driverEvents.js` | Global broadcast | Fleet-wide coordinate stream for map overlays |
| `driver:pricing:updated` | `controllers/driverPricing.controller.js` | Global broadcast | Manual pricing adjustments applied by ops or finance |
| `booking:new` / `booking:removed` | Dispatch registry | `drivers`, `driver:{id}` | Useful for monitoring dispatch churn |

### Error & observability signals
- `booking_error` – Emitted to the initiator; subscribe for completeness when building diagnostic dashboards.
- `auth_error` – Triggered on failed handshake; log and show actionable remediation.
- Metrics only: `socket.legacy_event_received` helps detect outdated clients still using deprecated event names.

### Dashboards & analytics guidance
- Use `booking:update.status` to drive state machines in dashboards; rely on `booking:update.timeline` (if present) for historical audit.
- Persist live GPS feeds sparingly—each `booking:driver_location` payload already includes `bookingId`, `driverId`, and timestamps.
- Cross-check pricing adjustments by diffing successive `pricing:update` payloads; unexpected changes should flag manual review.
- Subscribe to `driver:pricing:updated` to keep UI forms in sync when back-office edits pricing bands.

### Testing and monitoring
- Automated socket tests: see `tests/liveSocket.test.js` (status/ETA snapshots) and `tests/driverSocket.test.js` (location ack propagation).
- Recommended manual checks:
  1. Connect an ops socket, join `ops:booking`, and verify you receive `booking:update` after a driver accepts a ride.
  2. During a live trip, chart `booking:driver_location` points to confirm frequency and ordering.
  3. Trigger a pricing override from the admin UI and confirm the socket receives both `pricing:update` and `driver:pricing:updated`.
  4. Validate error surfacing by forcing a driver to emit malformed payloads; ensure ops dashboards can surface the resulting `booking_error` context.

### Operational safeguards
- Rate-limit downstream processing of `booking:driver_location` to avoid overwhelming analytics pipelines.
- When dashboards reconnect, replay any filters and rejoin relevant rooms; request snapshots via REST if a gap exceeds retention window.
- Mirror socket payloads into structured logs (e.g., Kafka, ELK) for after-action review and anomaly detection.
