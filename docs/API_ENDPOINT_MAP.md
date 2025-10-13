# API Endpoint Map

## Complete API Endpoint Structure

```
Contract Ride Service API
├── /api
    ├── 🏠 Health Check
    │   └── GET / → "Contract Service is UP!"
    │
    ├── 💰 Discounts (Admin Only)
    │   ├── POST /discounts → Create discount
    │   ├── GET /discounts → List all discounts
    │   ├── GET /discounts/:id → Get discount by ID
    │   ├── PUT /discounts/:id → Update discount
    │   └── DELETE /discounts/:id → Delete discount
    │
    ├── 📝 Contracts
    │   ├── POST /contracts → Create contract (Admin)
    │   ├── GET /contracts → List contracts (Role-based)
    │   ├── GET /contracts/:id → Get contract (Admin)
    │   ├── PUT /contracts/:id → Update contract (Admin)
    │   ├── DELETE /contracts/:id → Delete contract (Admin)
    │   ├── GET /contracts/active → Get active contracts
    │   ├── GET /contracts/individual → Get individual contracts
    │   ├── GET /contracts/group → Get group contracts
    │   └── GET /contracts/institutional → Get institutional contracts
    │
    ├── 💳 Payments
    │   ├── POST /payments → Create payment (Admin/Passenger)
    │   ├── GET /payments → List payments (Role-based)
    │   ├── GET /payments/:id → Get payment (Role-based)
    │   ├── PUT /payments/:id → Update payment (Admin)
    │   └── DELETE /payments/:id → Delete payment (Admin)
    │
    ├── 🔔 Subscriptions
    │   ├── POST /subscriptions → Create subscription (Admin/Passenger)
    │   ├── GET /subscriptions → List subscriptions (Role-based)
    │   ├── GET /subscriptions/:id → Get subscription (Role-based)
    │   ├── PUT /subscriptions/:id → Update subscription (Admin)
    │   └── DELETE /subscriptions/:id → Delete subscription (Admin)
    │
    ├── 📅 Schedules
    │   ├── POST /schedules → Create schedule (Admin)
    │   ├── GET /schedules → List schedules (Admin/Driver)
    │   ├── GET /schedules/:id → Get schedule (Admin/Driver)
    │   ├── PUT /schedules/:id → Update schedule (Admin/Driver)
    │   └── DELETE /schedules/:id → Delete schedule (Admin)
    │
    ├── 🚗 Trips
    │   ├── POST /trips → Create trip (Admin)
    │   ├── GET /trips → List trips (Role-based)
    │   ├── GET /trips/:id → Get trip (Role-based)
    │   ├── PUT /trips/:id → Update trip (Role-based)
    │   └── DELETE /trips/:id → Delete trip (Admin)
    │
    ├── 👤 Passenger Endpoints
    │   ├── GET /passenger/:id/driver → Get assigned driver
    │   ├── GET /passenger/:id/trips → Get trip history
    │   ├── PATCH /passenger/trip/:id/pickup → Confirm pickup
    │   ├── PATCH /passenger/trip/:id/end → Confirm trip end
    │   └── GET /passenger/subscription/price → Calculate fare
    │
    ├── 🚛 Driver Endpoints
    │   ├── GET /driver/:id/passengers → Get subscribed passengers
    │   ├── GET /driver/:id/contracts → Get contract expirations
    │   ├── GET /driver/:id/trips → Get assigned trips
    │   └── GET /driver/:id/schedule → Get upcoming schedule
    │
    └── 🛠 Admin Endpoints
        ├── POST /admin/contract/price → Set pricing rules
        ├── GET /admin/contract/price → Get current pricing
        ├── GET /admin/pricing/history → Get pricing history
        ├── PUT /admin/pricing/:id/deactivate → Deactivate pricing
        ├── POST /admin/subscription/calculate → Calculate subscription
        └── GET /admin/dashboard/stats → Get dashboard stats
```

## Endpoint Access Matrix

| Endpoint Category | Admin | Driver | Passenger | Guest |
|------------------|-------|--------|-----------|-------|
| Health Check | ✅ | ✅ | ✅ | ✅ |
| Discounts | ✅ | ❌ | ❌ | ❌ |
| Contracts | ✅ | 📖 | 📖 | ❌ |
| Payments | ✅ | ❌ | 📖/✏️ | ❌ |
| Subscriptions | ✅ | ❌ | 📖/✏️ | ❌ |
| Schedules | ✅ | 📖/✏️ | ❌ | ❌ |
| Trips | ✅ | 📖/✏️ | 📖/✏️ | ❌ |
| Passenger Endpoints | ✅ | ❌ | ✏️ | ❌ |
| Driver Endpoints | ✅ | ✏️ | ❌ | ❌ |
| Admin Endpoints | ✅ | ❌ | ❌ | ❌ |

**Legend:**
- ✅ Full Access
- 📖 Read Only
- ✏️ Own Data Only
- ❌ No Access

## Request/Response Flow Diagram

```mermaid
flowchart TD
    CLIENT[Client Application] --> AUTH_CHECK{Authentication Required?}
    
    AUTH_CHECK -->|No| HEALTH[Health Check Endpoint]
    AUTH_CHECK -->|Yes| JWT_VALIDATE[Validate JWT Token]
    
    JWT_VALIDATE --> VALID{Token Valid?}
    VALID -->|No| UNAUTH[401 Unauthorized]
    VALID -->|Yes| ROLE_CHECK[Check User Role]
    
    ROLE_CHECK --> AUTHORIZED{Role Authorized?}
    AUTHORIZED -->|No| FORBIDDEN[403 Forbidden]
    AUTHORIZED -->|Yes| CONTROLLER[Route to Controller]
    
    CONTROLLER --> BUSINESS_LOGIC[Execute Business Logic]
    BUSINESS_LOGIC --> DB_QUERY[Database Operations]
    BUSINESS_LOGIC --> USER_ENRICH[Enrich with User Data]
    
    DB_QUERY --> RESPONSE[Format Response]
    USER_ENRICH --> RESPONSE
    HEALTH --> RESPONSE
    
    RESPONSE --> CLIENT
    UNAUTH --> CLIENT
    FORBIDDEN --> CLIENT
```

## Data Enrichment Flow

```mermaid
flowchart LR
    subgraph "Raw Database Data"
        CONTRACTS[Contracts]
        SUBSCRIPTIONS[Subscriptions]
        TRIPS[Trips]
        PAYMENTS[Payments]
    end
    
    subgraph "User Service Calls"
        GET_PASSENGERS[Get Passenger Info]
        GET_DRIVERS[Get Driver Info]
        GET_STAFF[Get Staff Info]
    end
    
    subgraph "Enriched Response"
        ENRICHED[Data + User Details]
    end
    
    CONTRACTS --> GET_PASSENGERS
    SUBSCRIPTIONS --> GET_PASSENGERS
    TRIPS --> GET_PASSENGERS
    TRIPS --> GET_DRIVERS
    PAYMENTS --> GET_PASSENGERS
    
    GET_PASSENGERS --> ENRICHED
    GET_DRIVERS --> ENRICHED
    GET_STAFF --> ENRICHED
```

## Authentication Flow Detail

```mermaid
sequenceDiagram
    participant C as Client
    participant A as API
    participant AM as Auth Middleware
    participant AS as Auth Service
    participant DB as Database
    
    Note over C,DB: Initial Authentication
    C->>AS: POST /auth/login (credentials)
    AS->>AS: Validate credentials
    AS->>C: JWT Token
    
    Note over C,DB: API Request with Token
    C->>A: API Request + JWT Token
    A->>AM: authenticate()
    AM->>AM: Extract & verify JWT
    
    alt Token Valid
        AM->>A: Set req.user
        A->>AM: authorize(roles)
        AM->>AM: Check user role
        
        alt Role Authorized
            AM->>A: Continue to controller
            A->>DB: Execute business logic
            DB->>A: Return data
            A->>C: Success response
        else Role Not Authorized
            AM->>C: 403 Forbidden
        end
    else Token Invalid
        AM->>C: 401 Unauthorized
    end
```

## Error Handling Flow

```mermaid
flowchart TD
    REQUEST[API Request] --> TRY[Try Execute]
    TRY --> ERROR{Error Occurred?}
    
    ERROR -->|No| SUCCESS[Success Response]
    ERROR -->|Yes| ERROR_TYPE{Error Type}
    
    ERROR_TYPE -->|Validation| VALIDATION[400 Bad Request]
    ERROR_TYPE -->|Authentication| AUTH_ERROR[401 Unauthorized]
    ERROR_TYPE -->|Authorization| AUTHZ_ERROR[403 Forbidden]
    ERROR_TYPE -->|Not Found| NOT_FOUND[404 Not Found]
    ERROR_TYPE -->|Database| DB_ERROR[500 Internal Server Error]
    ERROR_TYPE -->|Unknown| UNKNOWN[500 Internal Server Error]
    
    VALIDATION --> LOG[Log Error]
    AUTH_ERROR --> LOG
    AUTHZ_ERROR --> LOG
    NOT_FOUND --> LOG
    DB_ERROR --> LOG
    UNKNOWN --> LOG
    
    LOG --> RESPONSE[Error Response]
    SUCCESS --> CLIENT[Client]
    RESPONSE --> CLIENT
```

## Pricing Calculation Workflow

```mermaid
flowchart TD
    START[Coordinates Input] --> VALIDATE[Validate Coordinates]
    VALIDATE --> DISTANCE[Calculate Distance using Haversine]
    DISTANCE --> GET_PRICING[Get Active Pricing Rules]
    
    GET_PRICING --> PRICING_FOUND{Pricing Found?}
    PRICING_FOUND -->|No| ERROR[Return Error]
    PRICING_FOUND -->|Yes| CALCULATE[Calculate Fare]
    
    CALCULATE --> FORMULA[Base Fare + (Distance × Rate/KM)]
    FORMULA --> MIN_CHECK[Check Minimum Fare]
    MIN_CHECK --> FINAL[Final Fare = MAX(Calculated, Minimum)]
    
    FINAL --> MONTHLY[Calculate Monthly Cost × 22 days]
    MONTHLY --> RESPONSE[Return Calculation Details]
    
    ERROR --> CLIENT[Client Response]
    RESPONSE --> CLIENT
```

## File Upload Process

```mermaid
sequenceDiagram
    participant C as Client
    participant A as API
    participant M as Multer Middleware
    participant FS as File System
    participant DB as Database
    
    C->>A: POST /payments (with file)
    A->>M: Process file upload
    M->>M: Validate file type & size
    
    alt File Valid
        M->>FS: Save file to /uploads/payments/
        FS->>M: File path
        M->>A: Continue with file path
        A->>DB: Save payment with file path
        DB->>A: Payment saved
        A->>C: Success with file URL
    else File Invalid
        M->>C: 400 Bad Request (file error)
    end
```

This comprehensive API endpoint map and workflow documentation provides a complete overview of the Contract Ride Service architecture, showing how all components work together to provide a robust ride management platform.