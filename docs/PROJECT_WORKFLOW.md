# Contract Ride Service - Complete Workflow Documentation

## Table of Contents
1. [System Overview](#system-overview)
2. [Architecture Diagram](#architecture-diagram)
3. [Database Schema](#database-schema)
4. [User Authentication Flow](#user-authentication-flow)
5. [Core Business Workflows](#core-business-workflows)
6. [API Request Flow](#api-request-flow)
7. [Data Flow Diagrams](#data-flow-diagrams)
8. [Sequence Diagrams](#sequence-diagrams)

## System Overview

The Contract Ride Service is a comprehensive ride management platform that handles:
- **Contract Management**: Creating and managing ride contracts
- **Subscription Management**: Passenger subscriptions to contracts
- **Trip Management**: Individual trip tracking and confirmation
- **Payment Processing**: Payment tracking and verification
- **User Management**: Integration with external auth service
- **Pricing Management**: Dynamic fare calculation

## Architecture Diagram

```mermaid
graph TB
    subgraph "Client Layer"
        WEB[Web Client]
        MOBILE[Mobile App]
        POSTMAN[Postman/API Client]
    end
    
    subgraph "API Gateway"
        NGINX[Nginx/Load Balancer]
    end
    
    subgraph "Contract Ride Service"
        EXPRESS[Express.js Server]
        AUTH[Auth Middleware]
        ROUTES[Route Handlers]
        CONTROLLERS[Controllers]
        SERVICES[Services]
        MODELS[Sequelize Models]
    end
    
    subgraph "External Services"
        AUTH_SERVICE[Auth Service]
        USER_SERVICE[User Service]
    end
    
    subgraph "Database"
        MYSQL[(MySQL Database)]
    end
    
    subgraph "File Storage"
        UPLOADS[File Uploads]
    end
    
    WEB --> NGINX
    MOBILE --> NGINX
    POSTMAN --> NGINX
    
    NGINX --> EXPRESS
    EXPRESS --> AUTH
    AUTH --> ROUTES
    ROUTES --> CONTROLLERS
    CONTROLLERS --> SERVICES
    SERVICES --> MODELS
    MODELS --> MYSQL
    
    AUTH --> AUTH_SERVICE
    SERVICES --> USER_SERVICE
    CONTROLLERS --> UPLOADS
```

## Database Schema

```mermaid
erDiagram
    CONTRACTS {
        uuid id PK
        enum contract_type
        date start_date
        date end_date
        string pickup_location
        string dropoff_location
        decimal cost
        enum status
        boolean has_discount
        uuid discount_id FK
        timestamps created_at
    }
    
    DISCOUNTS {
        uuid id PK
        decimal discount_percentage
        string description
        enum status
        timestamps created_at
    }
    
    SUBSCRIPTIONS {
        uuid id PK
        uuid contract_id FK
        uuid passenger_id
        decimal amount_paid
        date start_date
        date end_date
        enum status
        text calculated_fare
        timestamp created_at
    }
    
    PAYMENTS {
        uuid id PK
        uuid contract_id FK
        uuid passenger_id
        enum payment_method
        date due_date
        string transaction_reference
        enum status
        string receipt_image
        timestamps created_at
    }
    
    RIDE_SCHEDULES {
        uuid id PK
        uuid contract_id FK
        uuid driver_id
        decimal pickup_latitude
        decimal pickup_longitude
        decimal dropoff_latitude
        decimal dropoff_longitude
        enum pattern_type
        time pickup_time
        string days_of_week
        boolean is_active
        enum status
        timestamps created_at
    }
    
    TRIPS {
        uuid id PK
        uuid contract_id FK
        uuid subscription_id FK
        uuid passenger_id
        uuid driver_id
        string pickup_location
        string dropoff_location
        decimal pickup_latitude
        decimal pickup_longitude
        decimal dropoff_latitude
        decimal dropoff_longitude
        decimal distance_km
        decimal fare_amount
        enum status
        datetime scheduled_pickup_time
        datetime actual_pickup_time
        datetime actual_dropoff_time
        boolean pickup_confirmed_by_passenger
        boolean trip_ended_by_passenger
        text notes
        timestamps created_at
    }
    
    PRICING {
        uuid id PK
        enum contract_type
        decimal price_per_km
        decimal base_fare
        decimal minimum_fare
        boolean is_active
        date effective_from
        date effective_until
        uuid created_by
        timestamps created_at
    }
    
    CONTRACTS ||--o{ SUBSCRIPTIONS : "has many"
    CONTRACTS ||--o{ PAYMENTS : "has many"
    CONTRACTS ||--o{ RIDE_SCHEDULES : "has many"
    CONTRACTS ||--o{ TRIPS : "has many"
    CONTRACTS }o--|| DISCOUNTS : "belongs to"
    SUBSCRIPTIONS ||--o{ TRIPS : "has many"
```

## User Authentication Flow

```mermaid
sequenceDiagram
    participant Client
    participant API
    participant AuthMiddleware
    participant AuthService
    participant Controller
    
    Client->>API: Request with JWT Token
    API->>AuthMiddleware: authenticate()
    AuthMiddleware->>AuthMiddleware: Extract token from header
    AuthMiddleware->>AuthMiddleware: Verify JWT signature
    
    alt Token Valid
        AuthMiddleware->>API: req.user = decoded
        API->>AuthMiddleware: authorize(roles)
        AuthMiddleware->>AuthMiddleware: Check user.type in roles
        
        alt Role Authorized
            AuthMiddleware->>Controller: Process request
            Controller->>Client: Response
        else Role Not Authorized
            AuthMiddleware->>Client: 403 Forbidden
        end
    else Token Invalid
        AuthMiddleware->>Client: 401 Unauthorized
    end
```

## Core Business Workflows

### 1. Contract Creation Workflow

```mermaid
flowchart TD
    START([Admin Creates Contract]) --> VALIDATE[Validate Contract Data]
    VALIDATE --> DISCOUNT{Has Discount?}
    
    DISCOUNT -->|Yes| CHECK_DISCOUNT[Check Discount Status]
    DISCOUNT -->|No| CREATE_CONTRACT[Create Contract]
    
    CHECK_DISCOUNT --> DISCOUNT_ACTIVE{Discount Active?}
    DISCOUNT_ACTIVE -->|Yes| APPLY_DISCOUNT[Apply Discount to Cost]
    DISCOUNT_ACTIVE -->|No| CREATE_CONTRACT
    
    APPLY_DISCOUNT --> CREATE_CONTRACT
    CREATE_CONTRACT --> SAVE_DB[(Save to Database)]
    SAVE_DB --> SUCCESS([Contract Created])
```

### 2. Subscription Creation Workflow

```mermaid
flowchart TD
    START([Passenger Creates Subscription]) --> INPUT[Input: Contract ID, Passenger ID, Coordinates]
    INPUT --> VALIDATE_CONTRACT[Validate Contract Exists]
    VALIDATE_CONTRACT --> COORDINATES{Coordinates Provided?}
    
    COORDINATES -->|Yes| CALC_DISTANCE[Calculate Distance]
    COORDINATES -->|No| USE_CONTRACT_COST[Use Existing Contract Cost]
    
    CALC_DISTANCE --> GET_PRICING[Get Active Pricing Rules]
    GET_PRICING --> CALC_FARE[Calculate Fare]
    CALC_FARE --> MONTHLY_COST[Calculate Monthly Cost (22 days)]
    MONTHLY_COST --> UPDATE_CONTRACT[Update Contract Cost]
    UPDATE_CONTRACT --> DETERMINE_STATUS[Determine Subscription Status]
    
    USE_CONTRACT_COST --> DETERMINE_STATUS
    
    DETERMINE_STATUS --> PAID_FULL{Amount >= Cost?}
    PAID_FULL -->|Yes| ACTIVE[Status: ACTIVE]
    PAID_FULL -->|No| PARTIAL{Amount > 0?}
    
    PARTIAL -->|Yes| PARTIAL_STATUS[Status: PARTIAL]
    PARTIAL -->|No| PENDING[Status: PENDING]
    
    ACTIVE --> SAVE_SUB[(Save Subscription)]
    PARTIAL_STATUS --> SAVE_SUB
    PENDING --> SAVE_SUB
    
    SAVE_SUB --> SUCCESS([Subscription Created])
```

### 3. Trip Lifecycle Workflow

```mermaid
stateDiagram-v2
    [*] --> SCHEDULED : Trip Created
    SCHEDULED --> PICKUP_CONFIRMED : Passenger Confirms Pickup
    PICKUP_CONFIRMED --> IN_PROGRESS : Driver Starts Trip
    IN_PROGRESS --> COMPLETED : Passenger Confirms End
    
    SCHEDULED --> CANCELLED : Trip Cancelled
    PICKUP_CONFIRMED --> CANCELLED : Trip Cancelled
    IN_PROGRESS --> CANCELLED : Trip Cancelled
    
    COMPLETED --> [*]
    CANCELLED --> [*]
    
    note right of PICKUP_CONFIRMED
        - actual_pickup_time recorded
        - pickup_confirmed_by_passenger = true
    end note
    
    note right of COMPLETED
        - actual_dropoff_time recorded
        - trip_ended_by_passenger = true
    end note
```

## API Request Flow

```mermaid
sequenceDiagram
    participant Client
    participant Express
    participant AuthMiddleware
    participant RouteHandler
    participant Controller
    participant Service
    participant Database
    participant UserService
    
    Client->>Express: HTTP Request
    Express->>AuthMiddleware: authenticate()
    AuthMiddleware->>AuthMiddleware: Verify JWT
    AuthMiddleware->>RouteHandler: authorize(roles)
    RouteHandler->>Controller: Call controller method
    
    Controller->>Service: Business logic
    Service->>Database: Query/Update data
    Database->>Service: Return data
    
    alt User Info Needed
        Service->>UserService: Get user details
        UserService->>Service: Return user info
    end
    
    Service->>Controller: Processed data
    Controller->>Client: JSON Response
```

## Data Flow Diagrams

### 1. Passenger Trip History Flow

```mermaid
flowchart LR
    subgraph "Input"
        PASSENGER_ID[Passenger ID]
        AUTH_TOKEN[Auth Token]
    end
    
    subgraph "Processing"
        VALIDATE[Validate Access]
        QUERY_TRIPS[Query Trips]
        GET_DRIVERS[Get Driver Info]
        ENRICH[Enrich Data]
    end
    
    subgraph "Output"
        TRIP_LIST[Trip List with Driver Details]
    end
    
    PASSENGER_ID --> VALIDATE
    AUTH_TOKEN --> VALIDATE
    VALIDATE --> QUERY_TRIPS
    QUERY_TRIPS --> GET_DRIVERS
    GET_DRIVERS --> ENRICH
    ENRICH --> TRIP_LIST
```

### 2. Pricing Calculation Flow

```mermaid
flowchart TD
    INPUT[Pickup/Dropoff Coordinates] --> DISTANCE[Calculate Distance]
    DISTANCE --> PRICING[Get Active Pricing]
    PRICING --> BASE[Base Fare]
    PRICING --> RATE[Rate per KM]
    PRICING --> MIN[Minimum Fare]
    
    BASE --> CALC[Calculate: Base + (Distance × Rate)]
    RATE --> CALC
    DISTANCE --> CALC
    
    CALC --> COMPARE[Compare with Minimum]
    MIN --> COMPARE
    COMPARE --> FINAL[Final Fare = MAX(Calculated, Minimum)]
```

## Sequence Diagrams

### 1. Complete Subscription Creation Process

```mermaid
sequenceDiagram
    participant P as Passenger
    participant API as API Server
    participant DB as Database
    participant PS as Pricing Service
    participant US as User Service
    
    P->>API: POST /subscriptions (with coordinates)
    API->>DB: Validate contract exists
    DB->>API: Contract details
    
    API->>PS: Calculate fare from coordinates
    PS->>PS: Calculate distance (Haversine)
    PS->>DB: Get active pricing rules
    DB->>PS: Pricing rules
    PS->>PS: Calculate fare
    PS->>API: Fare calculation result
    
    API->>DB: Update contract cost (if needed)
    API->>DB: Create subscription
    DB->>API: Subscription created
    
    API->>US: Get passenger details
    US->>API: Passenger info
    
    API->>P: Subscription + fare calculation
```

### 2. Driver Schedule Retrieval

```mermaid
sequenceDiagram
    participant D as Driver
    participant API as API Server
    participant DB as Database
    participant US as User Service
    
    D->>API: GET /driver/:id/schedule
    API->>DB: Get upcoming trips for driver
    DB->>API: Trip list
    
    API->>DB: Get recurring schedules
    DB->>API: Schedule list
    
    API->>US: Get passenger details (batch)
    US->>API: Passenger info map
    
    API->>API: Enrich trips with passenger info
    API->>D: Schedule with passenger details
```

### 3. Trip Confirmation Flow

```mermaid
sequenceDiagram
    participant P as Passenger
    participant API as API Server
    participant DB as Database
    participant D as Driver (via notification)
    
    Note over P,D: Pickup Confirmation
    P->>API: PATCH /passenger/trip/:id/pickup
    API->>DB: Update trip status
    DB->>API: Trip updated
    API->>P: Confirmation success
    API-->>D: Notification (pickup confirmed)
    
    Note over P,D: Trip End Confirmation
    P->>API: PATCH /passenger/trip/:id/end
    API->>DB: Update trip status to COMPLETED
    DB->>API: Trip completed
    API->>P: Trip ended successfully
    API-->>D: Notification (trip completed)
```

## File Structure and Component Flow

```
Contract Ride Service/
├── index.js                    # Entry point
├── config/
│   └── dbconfig.js             # Database configuration
├── middleware/
│   ├── auth.js                 # Authentication & Authorization
│   ├── errorHandler.js         # Error handling
│   └── dateValidation.js       # Date validation
├── models/                     # Database models
│   ├── indexModel.js           # Model exports & associations
│   ├── contractModel.js
│   ├── subscriptionModel.js
│   ├── tripModel.js
│   └── pricingModel.js
├── controllers/                # Business logic
│   ├── contractController.js
│   ├── passengerController.js
│   ├── driverController.js
│   └── adminController.js
├── routes/                     # Route definitions
│   ├── indexRoutes.js          # Main router
│   ├── contractRoutes.js
│   ├── passengerRoutes.js
│   └── driverRoutes.js
├── utils/                      # Utility functions
│   ├── userService.js          # External user API calls
│   ├── pricingService.js       # Fare calculation
│   └── fileHelper.js           # File operations
└── docs/                       # Documentation
    ├── PROJECT_WORKFLOW.md
    └── NEW_ENDPOINTS.md
```

## Key Integration Points

### 1. External Auth Service Integration
- **Purpose**: User authentication and profile data
- **Endpoints**: `/auth/admin/login`, `/auth/passenger/login`, `/auth/driver/login`
- **Integration**: JWT token validation and user profile enrichment

### 2. User Service Integration
- **Purpose**: Fetch detailed user information
- **Functions**: `getPassengerById()`, `getDriverById()`, `getStaffById()`
- **Usage**: Enrich API responses with user details

### 3. File Upload Integration
- **Purpose**: Handle payment receipt uploads
- **Storage**: Local filesystem under `/uploads`
- **Types**: Images (JPEG, PNG, GIF, WebP)

## Environment Configuration

```bash
# Database
DB_HOST=localhost
DB_NAME=contract_service_db
DB_USER=root
DB_PASSWORD=123

# Server
PORT=3000

# JWT
JWT_SECRET=your_jwt_secret
JWT_EXPIRES_IN=7d

# Auth Service Integration
AUTH_BASE_URL=https://authservice.capitalinvestmenttradingplc.com/api
PASSENGER_LOOKUP_URL_TEMPLATE=${AUTH_BASE_URL}/passengers/{id}
DRIVER_LOOKUP_URL_TEMPLATE=${AUTH_BASE_URL}/drivers/{id}
AUTH_SERVICE_BEARER=your_service_bearer_token

# JWT Verification
JWT_ISSUER=https://authservice.capitalinvestmenttradingplc.com/
JWT_AUDIENCE=my-api
```

## Deployment Flow

```mermaid
flowchart TD
    DEV[Development] --> TEST[Testing]
    TEST --> BUILD[Build & Package]
    BUILD --> DEPLOY[Deploy to Server]
    DEPLOY --> MIGRATE[Run DB Migrations]
    MIGRATE --> START[Start Service]
    START --> HEALTH[Health Check]
    HEALTH --> LIVE[Service Live]
    
    HEALTH -->|Failed| ROLLBACK[Rollback]
    ROLLBACK --> INVESTIGATE[Investigate Issues]
```

This comprehensive workflow documentation provides a complete understanding of how the Contract Ride Service operates, from high-level architecture to detailed sequence flows. Each diagram illustrates different aspects of the system's operation and can be used for development, debugging, and system understanding.