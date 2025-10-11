## Driver socket playbook

This guide distills the driver-facing portion of the booking service socket contract. Use it alongside the canonical catalog in `docs/socket-events.md` whenever you implement or debug driver features.

### Handshake & bootstrap
1. Authenticate with a driver JWT (validated by `socketAuth`).
2. The server automatically joins the connection to:
   - `driver:{driverId}` (and legacy `_id` if different)
   - Any active `booking:{bookingId}` rooms for the driver
   - The fleet broadcast room `drivers`
   - Ops room `ops:booking` for shadow updates
3. Immediately after the join the server replays:
   - Latest `booking:nearby` snapshot
   - Pending `booking:new` dispatch payloads
   - Cached `booking:driver_location` breadcrumbs for active trips

### Driver → server events
| Event | Required fields | Success response | Failure response | Notes |
|-------|-----------------|------------------|------------------|-------|
| `driver:availability` | `{ available }` | Echoed `driver:availability` with persisted state | `booking_error` (`UNAUTHORIZED`, `VALIDATION_ERROR`) | Persisted via `driverService.setAvailability`; also refreshes `booking:nearby` when switching on |
| `booking:driver_location_update` | `{ bookingId, latitude, longitude, bearing? }` | `booking:driver_location_ack` + downstream `booking:driver_location` broadcast | `booking_error` (`FORBIDDEN`, `NOT_FOUND`, `VALIDATION_ERROR`, `INTERNAL`) | Persists to `Live` model and pushes to passenger/ops rooms |
| `booking:accept` | `{ bookingId }` | `booking:update`, `booking:removed` to peers | `booking_error` | Driver must own the booking; joins booking room |
| `booking:cancel` | `{ bookingId, reason? }` | `booking:update`, `booking:removed` | `booking_error` | Accepted/ongoing bookings only |
| `trip:started` | `{ bookingId, startLocation? }` | `trip:started` | `booking_error` | Seeds trip timeline |
| `trip:ongoing` | `{ bookingId, location:{ latitude, longitude } }` | `trip:ongoing`, `pricing:update` | `booking_error` | Also recalculates fare |
| `trip:completed` | `{ bookingId, pricingOverrides? }` | `trip:completed`, `pricing:update` | `booking_error` | Triggers wallet settlement |
| `pricing:update` | `{ bookingId, location:{ latitude, longitude } }` | `pricing:update` | `pricing:error` (`FORBIDDEN`, `VALIDATION_ERROR`, `INTERNAL`) | Guards driver ownership before recompute |
| `booking:ETA_update` (live namespace) | `{ bookingId, etaMinutes, message? }` | Broadcast to `booking:{id}` | `booking_error` (`FORBIDDEN`, `VALIDATION_ERROR`) | Only while assigned to booking |

### Server → driver events
- **Dispatch & availability**: `booking:nearby`, `booking:new`, `booking:removed`, `driver:availability`
- **Lifecycle**: `booking:update`, `trip:started`, `trip:ongoing`, `trip:completed`
- **Live location**: `booking:driver_location`, `booking:driver_location_ack`
- **Pricing**: `pricing:update`, `pricing:error`
- **ETA sharing**: `booking:ETA_update`
- **Ops visibility**: Mirror broadcasts to `ops:booking` ensure dashboards match driver state

### Error handling
Always subscribe to:
- `booking_error` – Normalised contract `{ code, message, context }`
- `pricing:error` – Only emitted in response to `pricing:update`
- `auth_error` – Indicates expired or invalid driver JWT
- `booking:legacy_warning` – Advisory notice when emitting a deprecated event name; switch to the recommended topic immediately.

### Testing pointers
- Targeted unit coverage lives in `tests/driverSocket.test.js`
- Recommended manual flow:
  1. Log in to create a driver JWT.
  2. Connect, listen for `booking:nearby` and `booking:new`.
  3. Emit `driver:availability` toggles and confirm ack mirrors persisted state.
  4. Accept a booking, emit `booking:driver_location_update` repeatedly, and assert `booking:driver_location_ack.persisted === true`.
  5. Walk through trip lifecycle events and verify resulting `booking:update` fields.
  6. Emit malformed payloads to observe `booking_error` guard rails.

### Integration hints
- Use exponential backoff when retrying `booking:driver_location_update` after a `persisted === false` ack.
- Cache the latest `booking:update.status` locally; prevent duplicate lifecycle emits for already-terminal states.
- When driver status flips to unavailable, stop emitting live location and pricing updates to conserve resources.
