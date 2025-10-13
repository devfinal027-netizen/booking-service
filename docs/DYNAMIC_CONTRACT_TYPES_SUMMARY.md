# Dynamic Contract Types Implementation Summary

## Overview
This implementation adds dynamic contract type functionality to the Technova User Service, allowing admins to create custom contract types and passengers to view available contract types.

## Changes Made

### 1. New Model: ContractType
**File:** `models/contractTypeModel.js`

- Created a new `ContractType` model with the following fields:
  - `id`: UUID primary key
  - `name`: Unique contract type name (e.g., "Premium Individual", "Group", "Institutional")
  - `description`: Optional description of the contract type
  - `base_price_per_km`: Base pricing per kilometer
  - `discount_percentage`: Default discount percentage for this type
  - `minimum_fare`: Minimum fare amount
  - `maximum_passengers`: Maximum number of passengers allowed
  - `features`: JSON object for additional features (wifi, ac, etc.)
  - `is_active`: Boolean to enable/disable contract type
  - `created_by`/`updated_by`: Admin user tracking
  - `createdAt`/`updatedAt`: Timestamps

### 2. Updated Contract Model
**File:** `models/contractModel.js`

- Replaced hardcoded `contract_type` ENUM with `contract_type_id` foreign key
- Now references the `contract_types` table instead of using fixed values

### 3. New Controller: ContractTypeController
**File:** `controllers/contractTypeController.js`

**Admin Endpoints:**
- `POST /contract-types` - Create new contract type
- `GET /contract-types` - Get all contract types (admin sees all, passengers see only active)
- `GET /contract-types/active` - Get only active contract types
- `GET /contract-types/:id` - Get specific contract type
- `PUT /contract-types/:id` - Update contract type
- `DELETE /contract-types/:id` - Delete contract type (with validation)

**Features:**
- Validation to prevent duplicate names
- Protection against deleting contract types in use
- Role-based access control (admins can see all, passengers only active)
- Comprehensive error handling

### 4. Updated Contract Controller
**File:** `controllers/contractController.js`

- Added contract type validation in contract creation
- Updated all contract queries to include contract type relationship
- Added new endpoint: `GET /contracts/type/:typeId` - Get contracts by type
- Removed hardcoded contract type filters (individual, group, institutional)

### 5. New Routes
**File:** `routes/contractTypeRoutes.js`

- Complete route definitions for contract type management
- Proper authorization middleware for admin vs passenger access

**File:** `routes/contractRoutes.js`
- Added new route: `GET /contracts/type/:typeId`
- Removed hardcoded contract type routes

**File:** `routes/indexRoutes.js`
- Added contract type routes: `/contract-types`

### 6. Updated Database Associations
**File:** `models/indexModel.js`

- Added ContractType model import and export
- Created association: Contract belongsTo ContractType
- Added ContractType to database sync process

### 7. Updated Postman Collection
**File:** `docs/Contract Ride Service - Complete API.postman_collection.json`

**Admin Workflow Section:**
- Create Contract Type
- Get All Contract Types
- Get Active Contract Types
- Get Contract Type by ID
- Update Contract Type
- Delete Contract Type

**Passenger Workflow Section:**
- Get Available Contract Types (active only)
- Get Contracts by Type

## API Endpoints Summary

### Admin Endpoints
```
POST   /contract-types              - Create contract type
GET    /contract-types              - Get all contract types
GET    /contract-types/active       - Get active contract types
GET    /contract-types/:id          - Get contract type by ID
PUT    /contract-types/:id          - Update contract type
DELETE /contract-types/:id          - Delete contract type
```

### Passenger Endpoints
```
GET    /contract-types/active       - Get available contract types
GET    /contracts/type/:typeId      - Get contracts by type
```

### Updated Contract Endpoints
```
POST   /contracts                   - Create contract (now requires contract_type_id)
GET    /contracts                   - Get contracts (includes contract type info)
GET    /contracts/:id               - Get contract (includes contract type info)
GET    /contracts/type/:typeId      - Get contracts by type
```

## Example Usage

### 1. Admin Creates Contract Type
```json
POST /contract-types
{
  "name": "Premium Individual",
  "description": "Premium individual contract with enhanced features",
  "base_price_per_km": 15.50,
  "discount_percentage": 10.00,
  "minimum_fare": 50.00,
  "maximum_passengers": 1,
  "features": {
    "wifi": true,
    "ac": true,
    "premium_seats": true,
    "priority_support": true
  },
  "is_active": true
}
```

### 2. Passenger Views Available Contract Types
```json
GET /contract-types/active
Response:
{
  "success": true,
  "data": [
    {
      "id": "ct-uuid-1",
      "name": "Individual",
      "description": "Standard individual contract",
      "base_price_per_km": "12.50",
      "discount_percentage": "5.00",
      "minimum_fare": "40.00",
      "maximum_passengers": 1,
      "features": {
        "wifi": false,
        "ac": true
      },
      "is_active": true
    }
  ]
}
```

### 3. Create Contract with Dynamic Type
```json
POST /contracts
{
  "contract_type_id": "ct-uuid-1",
  "start_date": "2024-01-01",
  "end_date": "2024-01-31",
  "pickup_location": "Airport",
  "dropoff_location": "University",
  "cost": 1000.00
}
```

## Benefits

1. **Flexibility**: Admins can create unlimited contract types with custom pricing and features
2. **Scalability**: Easy to add new contract types without code changes
3. **User Experience**: Passengers can see all available contract options with detailed information
4. **Maintainability**: Centralized contract type management
5. **Data Integrity**: Foreign key relationships ensure data consistency
6. **Role-based Access**: Proper separation between admin and passenger functionality

## Migration Notes

- Existing contracts with hardcoded contract types will need to be migrated to use the new contract_type_id
- The old ENUM-based contract_type field has been replaced with contract_type_id
- Database sync will create the new contract_types table
- Consider creating default contract types (Individual, Group, Institutional) to maintain backward compatibility

## Security Considerations

- Only admins can create, update, or delete contract types
- Passengers can only view active contract types
- Contract type deletion is prevented if contracts are using that type
- All endpoints require proper authentication and authorization
