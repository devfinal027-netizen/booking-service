# New Endpoints and Features

This document outlines all the new endpoints and features added to the Contract Ride Service.

## New Models

### Trip Model
- **Table**: `trips`
- **Purpose**: Track individual trips for passengers
- **Key Fields**: 
  - `passenger_id`, `driver_id`, `contract_id`, `subscription_id`
  - `pickup_location`, `dropoff_location`, coordinates
  - `status` (SCHEDULED, PICKUP_CONFIRMED, IN_PROGRESS, COMPLETED, CANCELLED)
  - `fare_amount`, `distance_km`
  - Confirmation flags and timestamps

### Pricing Model
- **Table**: `pricing`
- **Purpose**: Admin-configurable pricing rules
- **Key Fields**:
  - `contract_type` (INDIVIDUAL, GROUP, INSTITUTIONAL)
  - `price_per_km`, `base_fare`, `minimum_fare`
  - `is_active`, `effective_from`, `effective_until`

## Passenger Endpoints

### Authentication Required: `passenger` or `admin` role

1. **GET /api/passenger/:id/driver**
   - Get assigned driver for active trip/subscription
   - Returns driver details, vehicle info, and schedule

2. **PATCH /api/passenger/trip/:id/pickup**
   - Passenger confirms pickup
   - Updates trip status to IN_PROGRESS

3. **PATCH /api/passenger/trip/:id/end**
   - Passenger confirms end of trip
   - Updates trip status to COMPLETED

4. **GET /api/passenger/:id/trips**
   - Get trip history for passenger
   - Returns trips with driver details, fare, status, timestamps

5. **GET /api/passenger/subscription/price**
   - Calculate subscription price based on coordinates
   - Query params: `pickup_lat`, `pickup_lon`, `dropoff_lat`, `dropoff_lon`, `contract_type`
   - Returns distance, fare breakdown, estimated monthly cost

## Driver Endpoints

### Authentication Required: `driver` or `admin` role

1. **GET /api/driver/:id/passengers**
   - Get subscribed passengers with payment status
   - Returns passenger details, subscription status, payment history

2. **GET /api/driver/:id/contracts**
   - Get contract expiration dates
   - Returns contract details and nearest subscription expiry dates

3. **GET /api/driver/:id/trips**
   - Get all assigned trips with details
   - Query params: `status`, `date_from`, `date_to`
   - Returns trips with passenger information

4. **GET /api/driver/:id/schedule**
   - Get upcoming trips with passenger details
   - Query params: `date` (optional, defaults to today and future)
   - Returns upcoming trips and recurring schedules

## Admin Endpoints

### Authentication Required: `admin` role

1. **POST /api/admin/contract/price**
   - Set/update price per kilometer for contracts
   - Body: `contract_type`, `price_per_km`, `base_fare`, `minimum_fare`
   - Deactivates old pricing and creates new active pricing

2. **GET /api/admin/contract/price**
   - Get current pricing for all contract types
   - Query params: `contract_type` (optional)

3. **GET /api/admin/pricing/history**
   - Get pricing history
   - Query params: `contract_type` (optional)

4. **PUT /api/admin/pricing/:id/deactivate**
   - Deactivate a pricing rule

5. **POST /api/admin/subscription/calculate**
   - Calculate subscription price for admin review
   - Body: coordinates, `contract_type`, `passenger_id`, `monthly_trips`
   - Returns detailed fare calculation with monthly/yearly estimates

6. **GET /api/admin/dashboard/stats**
   - Get admin dashboard statistics
   - Returns contract, subscription, trip, and revenue statistics

## Trip Management Endpoints

### Authentication Required: Role-based access

1. **POST /api/trips** (Admin only)
   - Create a new trip

2. **GET /api/trips** (All authenticated users)
   - Get trips (filtered by user role)
   - Admin sees all, drivers/passengers see only their own

3. **GET /api/trips/:id** (Role-based access)
   - Get single trip details
   - Access controlled by user role and ownership

4. **PUT /api/trips/:id** (Role-based access)
   - Update trip details
   - Access controlled by user role and ownership

5. **DELETE /api/trips/:id** (Admin only)
   - Delete a trip

## Enhanced Subscription Creation

The existing **POST /api/subscriptions** endpoint has been enhanced:

- **New Optional Fields**: `pickup_lat`, `pickup_lon`, `dropoff_lat`, `dropoff_lon`
- **Automatic Fare Calculation**: If coordinates are provided, the system:
  1. Calculates distance using Haversine formula
  2. Applies admin-set pricing rules
  3. Updates contract cost with calculated monthly fare (22 working days)
  4. Returns fare calculation details in response

## Pricing Service Utilities

### Distance Calculation
- Uses Haversine formula for accurate distance calculation
- Returns distance in kilometers with 2 decimal precision

### Fare Calculation
- Retrieves active pricing rules for contract type
- Applies formula: `base_fare + (distance_km * price_per_km)`
- Ensures minimum fare is met
- Returns detailed breakdown

## User Information Enrichment

All endpoints now include enriched user information:
- **Passenger endpoints**: Include driver details (name, phone, email, vehicle info)
- **Driver endpoints**: Include passenger details (name, phone, email)
- **Trip endpoints**: Include both passenger and driver information
- **Contract endpoints**: Include user details in nested relationships

## Security and Access Control

- All endpoints require authentication
- Role-based authorization implemented:
  - **Passengers**: Can only access their own data
  - **Drivers**: Can only access their assigned trips/passengers
  - **Admins**: Have full access to all data
- Proper error handling with centralized error middleware

## Database Changes

### New Tables
- `trips` - Individual trip records
- `pricing` - Admin-configurable pricing rules

### Modified Tables
- `subscriptions` - Added `calculated_fare` field for storing fare calculation details

### New Associations
- Trip ↔ Contract (N:1)
- Trip ↔ Subscription (N:1)

## Environment Variables

No new environment variables required. The system uses existing user service configuration for user information enrichment.

## Testing

All endpoints can be tested using the provided Postman collection, which has been reorganized into user-type folders:
- 👤 Passenger
- 🚗 Driver  
- 🛠 Admin

Each folder contains relevant authentication and endpoint tests for that user type.