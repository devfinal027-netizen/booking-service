# Contract and Subscription Fixes

## Issues Identified

### 1. ✅ Contracts by Type Returning Empty Data
**Problem:** `{{baseUrl}}/contracts/type/{{contractTypeId}}` returns empty array even though contract types exist.

**Root Cause:** Contract types exist, but no actual contracts have been created using these contract types.

### 2. ✅ Subscription Creation Failing
**Problem:** `{{baseUrl}}/subscription/create` returns "Forbidden: You do not have permission to access this resource."

**Root Cause:** 
- No contracts exist to create subscriptions with
- Possible authorization issue with passenger tokens

## Solutions Implemented

### 1. Created Sample Contracts Endpoint
**New Endpoint:** `POST {{baseUrl}}/admin/contracts/sample`

This endpoint creates sample contracts for all active contract types, allowing you to test the system.

**Usage:**
```bash
curl -X POST "{{baseUrl}}/admin/contracts/sample" \
  -H "Authorization: Bearer {{authToken}}"
```

**Response:**
```json
{
  "success": true,
  "message": "Created 12 sample contracts",
  "data": {
    "contracts_created": 12,
    "summary": [
      {
        "contract_type": "GROUP",
        "contract_count": 2
      },
      {
        "contract_type": "INDIVIDUAL", 
        "contract_count": 2
      },
      {
        "contract_type": "INSTITUTIONAL",
        "contract_count": 2
      }
    ]
  }
}
```

### 2. Added Debug Information
Added debug logging to subscription creation to help identify authorization issues.

### 3. Created Standalone Script
Created `scripts/createSampleContracts.js` for manual contract creation.

## Step-by-Step Fix

### Step 1: Create Sample Contracts
1. **As Admin, create sample contracts:**
   ```bash
   POST {{baseUrl}}/admin/contracts/sample
   Authorization: Bearer {{adminToken}}
   ```

2. **Verify contracts were created:**
   ```bash
   GET {{baseUrl}}/contracts
   Authorization: Bearer {{adminToken}}
   ```

### Step 2: Test Contracts by Type
1. **Get a contract type ID from the contract types list:**
   ```bash
   GET {{baseUrl}}/contract-types/active
   ```

2. **Test contracts by type (use one of the contract type IDs):**
   ```bash
   GET {{baseUrl}}/contracts/type/87a08757-b633-40e5-b678-1f412eb941b3
   Authorization: Bearer {{authToken}}
   ```

### Step 3: Test Subscription Creation
1. **Get a contract ID from the contracts list:**
   ```bash
   GET {{baseUrl}}/contracts
   Authorization: Bearer {{adminToken}}
   ```

2. **Create subscription as passenger:**
   ```bash
   POST {{baseUrl}}/subscription/create
   Authorization: Bearer {{passengerToken}}
   Content-Type: application/json
   
   {
     "contract_id": "{{contractId}}",
     "pickup_location": "Bole International Airport",
     "dropoff_location": "Addis Ababa University", 
     "pickup_latitude": 8.9806,
     "pickup_longitude": 38.7578,
     "dropoff_latitude": 9.0365,
     "dropoff_longitude": 38.7578,
     "start_date": "2024-01-01",
     "end_date": "2024-01-31"
   }
   ```

## Expected Results

### After Creating Sample Contracts:
- `GET /contracts/type/{contractTypeId}` should return contracts
- `GET /contracts` should show multiple contracts
- Each contract type should have 2 sample contracts

### After Subscription Creation:
- Should return success with subscription details
- Should include fare calculation
- Should show passenger information

## Debugging Authorization Issues

If subscription creation still fails, check the server logs for debug information:

```
User info: {
  id: "passenger-uuid-123",
  type: "passenger", 
  roles: [...]
}
```

**Common Issues:**
1. **Missing `type` field:** Token doesn't have `type: "passenger"`
2. **Wrong token:** Using admin token instead of passenger token
3. **Invalid contract ID:** Contract doesn't exist or isn't active

## Manual Contract Creation

If you prefer to create contracts manually:

```bash
POST {{baseUrl}}/contracts
Authorization: Bearer {{adminToken}}
Content-Type: application/json

{
  "contract_type_id": "87a08757-b633-40e5-b678-1f412eb941b3",
  "start_date": "2024-01-01",
  "end_date": "2024-12-31",
  "pickup_location": "Bole International Airport",
  "dropoff_location": "Addis Ababa University",
  "cost": 125.00,
  "status": "ACTIVE"
}
```

## Testing Workflow

1. **Admin creates sample contracts** → `POST /admin/contracts/sample`
2. **Passenger views available contract types** → `GET /contract-types/active`
3. **Passenger views contracts by type** → `GET /contracts/type/{contractTypeId}`
4. **Passenger creates subscription** → `POST /subscription/create`
5. **Passenger submits payment** → `POST /subscription/{id}/payment`

## Files Modified

- `controllers/newAdminController.js` - Added sample contracts endpoint
- `routes/newAdminRoutes.js` - Added sample contracts route
- `controllers/newSubscriptionController.js` - Added debug logging
- `scripts/createSampleContracts.js` - Standalone script for contract creation
- `docs/Contract Ride Service - Complete API.postman_collection.json` - Added sample contracts endpoint

## Next Steps

1. Run the sample contracts creation endpoint
2. Test the contracts by type endpoint
3. Test subscription creation with a valid contract ID
4. Check server logs for any authorization issues
5. Verify the complete workflow works end-to-end
