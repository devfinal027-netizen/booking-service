## Passenger socket playbook

This document extracts the passenger-facing events from `docs/socket-events.md`. Pair it with REST booking flows to build a complete passenger client experience.

### Handshake & room membership
1. Authenticate using a passenger JWT. The `socketAuth` middleware rejects anonymous connections with `auth_error`.
2. On connect the server joins the socket to:
   - `passenger:{passengerId}` for personal notifications
   - Every active `booking:{bookingId}` linked to the passenger
3. The server replays the latest `booking:driver_location` breadcrumbs for each active booking so the UI can hydrate immediately.

### Passenger → server events
| Event | Required fields | Success response | Failure response | Notes |
|-------|-----------------|------------------|------------------|-------|
| `booking:request` | `{ vehicleType, pickup, dropoff }` | `booking:created` (direct emit) | `booking_error` | Creates booking, triggers dispatch; server auto-joins booking room |
| `booking:join_room` | `{ bookingId }` | `booking:joined` | `booking_error` | Idempotent; safe to re-emit after reconnect |
| `booking:cancel` | `{ bookingId, reason? }` | `booking:update`, `booking:removed` | `booking_error` (`FORBIDDEN`, `NOT_FOUND`) | Only for passenger-owned bookings |
| `booking:status_request` (live namespace) | `{ bookingId }` | `booking:update` snapshot | `booking_error` (`NOT_FOUND`, `FORBIDDEN`) | Fetches enriched lifecycle payload on demand |

### Server → passenger events
- **Creation & room confirmation**: `booking:created`, `booking:joined`
- **Lifecycle timeline**: `booking:update`, `trip:started`, `trip:ongoing`, `trip:completed` (includes `distanceTraveled` in km)
- **Live tracking**: `booking:driver_location` (continuous GPS feed)
- **ETA updates**: `booking:ETA_update`
- **Pricing**: `pricing:update` reflects fare recalculations as trip advances
- **Errors & advisories**: `booking_error`, `auth_error`, `booking:legacy_warning`

### UI integration cheatsheet
- Hydrate state from the initial `booking:created` payload; expect enriched driver data once assignment occurs via `booking:update`.
- Durable components (e.g., map view) should buffer the latest `booking:driver_location` point; when disconnected, request a snapshot with `booking:status_request` after reconnecting.
- Display `booking:ETA_update` prominently; drivers may include a short `{ message }` string for passenger-facing explanations.
- Treat `pricing:update.amountPayable` as the canonical rider fare.

### Testing pointers
- Manual regression script:
  1. Log in to obtain passenger JWT.
  2. Connect, emit `booking:request`, and assert `booking:created` contains the booking `_id`.
  3. Listen for `booking:new` on a driver client to ensure dispatch triggered.
  4. When the driver emits lifecycle events, verify passenger socket receives matching `booking:update` transitions.
  5. Challenge validation by sending `booking:status_request` without `bookingId` and confirm `booking_error` surfaces with `code: 'VALIDATION_ERROR'`.
- Automated coverage: refer to the live namespace tests in `tests/liveSocket.test.js` for assertions around `booking:status_request` and `booking:ETA_update`.

### Resilience tips
- Retry joining rooms after reconnect by replaying saved `booking:join_room` emits.
- De-duplicate lifecycle payloads by storing `booking:update.version` or timestamp; this prevents unnecessary re-renders.
- When you receive `booking_error` with `code: 'UNAUTHORIZED'`, force logout and re-authenticate the passenger.
- Treat `booking:legacy_warning` as actionable; swap to the recommended event name before retrying the emit.
