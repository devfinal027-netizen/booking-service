## Booking Service Socket Event Catalog

This guide is the canonical reference for every Socket.IO event exposed by the booking service. It explains when each event fires, who should consume it, and the payload contract developers must preserve.

### Shared conventions
- **Namespaces** – All apps connect to the default namespace configured via `sockets/index.js`; the same connection hosts driver, passenger, and live handlers. The `socketAuth` middleware validates JWTs on every handshake.
- **Rooms** – The server scopes broadcasts through predictable room names:
	| Room name | Who joins | Purpose |
	|-----------|-----------|---------|
	| `booking:{bookingId}` | Assigned driver, passenger, ops dashboards | Lifecycle + live location stream for a single booking |
	| `driver:{driverId}` | Individual driver sockets | Targeted dispatches and driver-specific notices |
	| `passenger:{passengerId}` | Individual passenger sockets | Booking confirmations and lifecycle updates |
	| `drivers` | All connected drivers | Low-fi broadcast fallback for dispatch |
	| `ops:booking` | Operations dashboards | Fleet-wide telemetry (lifecycle, pricing, live positions) |
- **Payload notation** – Tables below use `?` to mark optional fields and `<>` to describe nested objects.
- **Error contract** – Handlers raise `emitSocketError`, yielding a `booking_error` (or `pricing:error`) payload shaped as `{ code, message, context }`. Clients must always listen for error events in addition to success events.
- **Legacy guard** – Any client still emitting deprecated names such as `booking_status` or `pricing_update` triggers a `socket.legacy_event_received` metric and receives a `booking:legacy_warning` advisory with the replacement event name. Update integrations to the events described in this document.

---

## Quick-reference matrix

### Client → Server
| Event | Emitted by | Handler | Required fields | Side effects |
|-------|------------|---------|-----------------|--------------|
| `booking:request` | Passenger app | `sockets/bookingSocket.js` | `vehicleType`, `pickup`, `dropoff` | Creates booking, joins `booking:{id}`, dispatches to nearest drivers |
| `booking:join_room` | Passenger app | `sockets/bookingSocket.js` | `bookingId` | Adds caller to `booking:{id}` and replies with `booking:joined` |
| `booking:cancel` | Passenger or driver | `sockets/bookingSocket.js` | `bookingId`, `reason?` | Updates lifecycle to `canceled`, emits `booking:update` + `booking:removed` |
| `booking:accept` | Driver app | `sockets/bookingSocket.js` | `bookingId` | Transitions lifecycle to `accepted`, joins booking room |
| `driver:availability` | Driver app | `sockets/driverSocket.js` | `available` (boolean) | Persists availability, refreshes `booking:nearby` when `true` |
| `booking:driver_location_update` | Driver app | `sockets/driverSocket.js` | `bookingId`, `latitude`, `longitude`, `bearing?` | Saves to `Live` collection, emits `booking:driver_location` |
| `trip:started` | Driver app | `sockets/bookingSocket.js` | `bookingId`, `startLocation?` | Marks trip as started, emits `trip:started` and first `trip:ongoing` |
| `trip:ongoing` | Driver app | `sockets/bookingSocket.js` | `bookingId`, `location.latitude`, `location.longitude` | Emits `trip:ongoing` and recalculates pricing |
| `trip:completed` | Driver app | `sockets/bookingSocket.js` | `bookingId`, optional pricing overrides | Finalises trip, emits `trip:completed` + lifecycle update |
| `pricing:update` | Driver app | `sockets/driverSocket.js` | `bookingId`, `location.latitude`, `location.longitude` | Recomputes fare, replies with `pricing:update` or `pricing:error` |
| `booking:status_request` | Any authenticated client | `sockets/liveSocket.js` | `bookingId` | Replies with immediate `booking:update` snapshot |
| `booking:ETA_update` | Driver app | `sockets/liveSocket.js` | `bookingId`, `etaMinutes`, `message?` | Broadcasts ETA to `booking:{id}` room |

### Server → Client
| Event | Delivered to | Source | Rooms | Notes |
|-------|--------------|--------|-------|-------|
| `booking:created` | Booking passenger | `sockets/bookingSocket.js` | Direct emit | Booking successfully created |
| `booking:joined` | Passenger | `sockets/bookingSocket.js` | Direct emit | Confirms room subscription |
| `booking:nearby` | Driver | `sockets/driverSocket.js` | `driver:{id}` | Init + incremental snapshots of nearby requests |
| `booking:new` | Driver | Dispatch registry | `driver:{id}`, `drivers` | Targeted dispatch payload |
| `booking:removed` | Driver | Dispatch registry | `drivers`, `driver:{id}` | Drop job after assignment/cancel |
| `booking:update` | Driver, passenger, ops | `events/bookingEvents.js` | `booking:{id}`, `driver:{id}`, `passenger:{id}`, `ops:booking` | Canonical lifecycle payload |
| `booking:assigned` | Ops, driver, passenger | `controllers/booking.controller.js` | `booking:{id}`, `driver:{id}`, `passenger:{id}`, `ops:booking` | Only fired for manual assignment path |
| `booking:driver_location` | Driver, passenger, ops | `services/positionUpdate.js`, `sockets/driverSocket.js` | `booking:{id}`, `driver:{id}`, `passenger:{id}`, `ops:booking` | Live GPS trace |
| `booking:driver_location_ack` | Driver | `sockets/driverSocket.js` | Direct emit | Ack payload describing persistence status for the last location update |
| `trip:started` | Driver, passenger, ops | `events/bookingEvents.js` | Booking + persona rooms | Trip milestone |
| `trip:ongoing` | Driver, passenger | `events/bookingEvents.js` | Booking + persona rooms | Breadcrumb updates |
| `trip:completed` | Driver, passenger, ops | `events/bookingEvents.js` | Booking + persona rooms | Settlement payload |
| `pricing:update` | Driver, passenger, ops | `services/bookingPricingService.js` | Booking + persona + ops rooms | Fare recompute result |
| `pricing:error` | Driver | `sockets/driverSocket.js` | Direct emit | Failure details for pricing requests |
| `booking:ETA_update` | Driver & passenger | `sockets/liveSocket.js` | `booking:{id}` | ETA payload with timestamp |
| `booking_error` | Any caller | `utils/socketErrors.js` | Direct emit | Normalised error surface |
| `auth_error` | Any caller | `sockets/socketAuth.js` | Direct emit | Handshake/auth failure |
| `driver:availability` | Driver | `events/driverEvents.js` | `driver:{id}` | Reflects persisted availability status |
| `driver:location` | Ops dashboards | `events/driverEvents.js` | Global broadcast | Fleet-wide position feed |
| `driver:location:{driverId}` | Ops dashboards | `events/driverEvents.js` | Patterned channel | Position feed per driver |
| `driver:position` | Ops dashboards | `events/driverEvents.js` | Global broadcast | Duplicate of `driver:location` for compatibility |
| `driver:pricing:updated` | Drivers, ops | `controllers/driverPricing.controller.js` | Global broadcast | Announces manual pricing edits |

---

## Driver channel

### Connection bootstrap
1. Authenticate with a valid driver JWT (enforced by `socketAuth`).
2. Server joins the socket to `driver:{tokenId}`, the resolved Mongo `_id` (if different), `drivers`, and any active `booking:{bookingId}` records.
3. During bootstrap the server rehydrates:
	 - Initial `booking:nearby` snapshot with finance-filtered, geo-filtered bookings.
	 - Any pending `booking:new` dispatch payloads recorded in the dispatch registry.
	 - `booking:driver_location` history stored in the `Live` collection.

### Driver → server event details

#### `driver:availability`
- **Handler**: `sockets/driverSocket.js`
- **Payload**:
	| Field | Type | Notes |
	|-------|------|-------|
	| `available` | boolean | Required. Toggles persistent availability via `driverService.setAvailability` |
- **Guards**: Requires driver token. Emits `booking_error` (`UNAUTHORIZED` / `VALIDATION_ERROR`) when invalid.
- **Server actions**:
	- Updates driver record and runtime availability cache.
	- Emits updated state to both the driver’s personal room and the ops dashboard room (`ops:booking`).
	- When switching to available, recomputes nearby bookings and emits a non-init `booking:nearby` snapshot.

#### `booking:driver_location_update`
- **Handler**: `sockets/driverSocket.js`
- **Payload**:
	| Field | Type | Notes |
	|-------|------|-------|
	| `bookingId` | string | Must belong to the driver and be in `accepted/ongoing` |
	| `latitude` | number | Required |
	| `longitude` | number | Required |
	| `bearing` | number? | Optional heading in degrees |
- **Server actions**: Stores snapshot via `Live` model, emits `booking:driver_location` to booking/driver/passenger/ops rooms, increments metrics.
- **Response**: Always emits `booking:driver_location_ack` summarising processed bookings and persistence status; emits `booking_error` when persistence fails.

#### `booking:accept`
- **Handler**: `sockets/bookingSocket.js`
- **Payload**: `{ bookingId }`
- **Server actions**: Validates assignment, transitions lifecycle to `accepted`, joins booking room, removes dispatch entries, emits `booking:update` + `booking:removed` to other drivers.

#### `booking:cancel`
- **Handler**: `sockets/bookingSocket.js`
- **Payload**: `{ bookingId, reason? }`
- **Server actions**: Validates role (driver or passenger), updates lifecycle to `canceled`, emits `booking:update`, and notifies drivers via `booking:removed`.

#### `trip:started`, `trip:ongoing`, `trip:completed`
- **Handlers**: `sockets/bookingSocket.js`
- **Shared guards**: Driver token required, booking must belong to the caller.
- **Payload specifics**:
	| Event | Required fields | Additional behaviour |
	|-------|-----------------|----------------------|
	| `trip:started` | `bookingId`, `startLocation?` | Emits `trip:started`, seeds `trip:ongoing` with first point |
	| `trip:ongoing` | `bookingId`, `location` | Emits `trip:ongoing`, triggers pricing refresh |
	| `trip:completed` | `bookingId`, optional pricing overrides | Emits `trip:completed`, runs pricing settlement + wallet syncing |
### Server → driver events
- **`booking:nearby`** – Sent on connect and availability toggles. Contains `{ init, driverId, bookings[], currentBookings[], user }`.
- **`booking:new`** – Targeted dispatch with `{ booking, patch, user }` payload. Broadcast to `driver:{id}` channels; a fallback emit to the shared `drivers` room fires only when no targeted delivery succeeds.
- **`booking:removed`** – Instructs clients to drop a booking due to assignment or cancellation.
- **Lifecycle events** (`booking:update`, `trip:*`) – Always trust these as the source of truth for booking status, timestamps, and pricing fields.
- **`booking:driver_location`** – Live GPS feed referencing both booking and driver/passenger IDs.
- **`booking:driver_location_ack`** – Single-socket acknowledgement detailing the bookings processed and whether persistence succeeded (`persisted`, `failed`, or `skipped`).
- **`pricing:update` / `pricing:error`** – Result of driver pricing recalculations.
- **`booking:ETA_update`** – Distributed to booking rooms through the live namespace.
- **`driver:availability`** – Reflects the persisted availability state after updates.

---

## Passenger channel

### Connection bootstrap
1. Authenticate with a passenger JWT.
2. Server joins `passenger:{id}` and every open `booking:{bookingId}` linked to the passenger.
3. Replays `booking:driver_location` history for active bookings to avoid losing the breadcrumb trail.

### Passenger → server event details
- **`booking:request`** – Creates a booking via `bookingService.createBooking`, replies with `booking:created`, then dispatches drivers.
- **`booking:join_room`** – Adds the socket to `booking:{bookingId}` and emits `booking:joined`.
- **`booking:cancel`** – Shares handler with driver; only allowed for bookings owned by the passenger.
- **`booking:status_request`** – Routed through `liveSocket`; emits a fresh `booking:update` snapshot including enriched driver and passenger blocks.

### Server → passenger events
- **`booking:created` / `booking:joined`** – Confirmation events emitted immediately by `bookingSocket`.
- **Lifecycle events** – Same payload as drivers receive. Always subscribe to `booking:update`, `trip:*`, `pricing:update`, and `booking:driver_location`.
- **`booking:ETA_update`** – Populated by the assigned driver via live namespace.
- **`booking_error` / `auth_error`** – Must be handled for UX messaging.
- **`booking:legacy_warning`** – Indicates the client emitted a deprecated event name; swap to the recommended topic immediately.

---

## Shared booking rooms (`booking:{bookingId}`)

All parties inside a booking room receive:
- **`booking:update`** – Canonical lifecycle payload built by `events/bookingEvents.buildLifecyclePayload`.
- **`booking:driver_location`** – Stream of GPS points (with `locationStatus` when available).
- **`booking:ETA_update`** – ETA push from live namespace.
- **`trip:started` / `trip:ongoing` / `trip:completed`** – Lifecycle milestones with timestamps and fare context.
- **`pricing:update`** – Fare recalculation result broadcast to passenger, driver, and ops simultaneously.

---

## Operations & observability
- **Rooms** – Ops dashboards join `ops:booking` for lifecycle/pricing feeds and may subscribe to `drivers` or individual `driver:{id}` rooms as needed.
- **Events** – Monitor `booking:update`, `trip:*`, `booking:driver_location`, `pricing:update`, `driver:location`, `driver:position`, and `driver:pricing:updated` for fleet oversight.
- **Live snapshots** – `services/positionUpdate.js` pushes `booking:driver_location` to ops even when no passenger or driver is actively connected to the room.

---

## Live namespace specifics
- **`booking:status_request`** – Accepts `{ bookingId }`, fetches booking + participant documents, and emits a single `booking:update` snapshot back to the caller.
- **`booking:ETA_update`** – Only drivers assigned to the booking may emit. Payload `{ bookingId, etaMinutes, message? }` is relayed to the booking room. Validation failures respond with `booking_error` (`UNAUTHORIZED`, `VALIDATION_ERROR`, `NOT_FOUND`, or `FORBIDDEN`).

---

## Error & telemetry events
| Event | When emitted | Payload |
|-------|--------------|---------|
| `booking_error` | Any socket validation/auth/runtime failure | `{ code, message, context:{ source, bookingId?, extras?, details? } }` |
| `pricing:error` | Pricing recalculation failures | `{ code, message, context:{ source:'pricing:update', bookingId, extras? } }` |
| `auth_error` | JWT missing/expired/invalid during handshake or periodic checks | `{ code:'UNAUTHORIZED', message, context }` |
| `booking:legacy_warning` | Client emitted a deprecated event name | `{ legacyEvent, recommendedEvent, message }` |
| `socket.legacy_event_received` *(metric only)* | Client emitted legacy event name | No client payload, surfaced via metrics for monitoring |

---

## Testing checklist
1. Acquire passenger and driver JWTs through REST login endpoints.
2. Connect both clients, subscribe to the events relevant to each persona, and assert `auth_error` is never fired.
3. Passenger emits `booking:request`; observe `booking:created`, driver receives `booking:new` and `booking:nearby` refresh.
4. Driver accepts (`booking:accept`) and toggles `driver:availability`; confirm lifecycle and dispatch cleanup events.
5. Exercise trip lifecycle (`trip:started` → `trip:ongoing` → `trip:completed`) and verify matching `booking:update` transitions plus pricing updates.
6. Emit malformed payloads (missing `bookingId`, wrong role) to ensure `booking_error` / `pricing:error` contract is respected.
7. Confirm canonical clients never receive `booking:legacy_warning`; legacy simulators should display the advisory when emitting old event names.
8. For ops monitoring, confirm `driver:location` and `driver:pricing:updated` reach a dashboard socket joined to `ops:booking`.

---

## Maintenance notes
- Automated socket coverage lives in `tests/liveSocket.test.js` and `tests/driverSocket.test.js`. Update these suites whenever event payloads change to keep contract verification in sync.

