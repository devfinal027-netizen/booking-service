# Contract Type Update Summary

## ✅ **Changes Completed**

I have successfully updated the Contract Ride Service to use the correct contract types and integrate with the existing contract model as requested.

## 🔄 **Key Changes Made**

### **1. Contract Type Enum Updated**
**From:**
```javascript
contract_type: {
  type: DataTypes.ENUM("DAILY", "WEEKLY", "MONTHLY", "YEARLY"),
  allowNull: false,
}
```

**To:**
```javascript
contract_type: {
  type: DataTypes.ENUM("INDIVIDUAL", "GROUP", "INSTITUTIONAL"),
  allowNull: false,
}
```

### **2. Subscription Model Integration**
- ✅ **Added `contract_id` field** to link subscriptions with contracts
- ✅ **Restored Contract ↔ Subscription relationship** in indexModel.js
- ✅ **Updated fare calculation multipliers**:
  - `INDIVIDUAL`: 1 (per trip)
  - `GROUP`: 7 (weekly rate)
  - `INSTITUTIONAL`: 30 (monthly rate)

### **3. Service Layer Updates**
- ✅ **Updated subscription service** to work with contract entities
- ✅ **Added `getAvailableContracts()` function** to fetch active contracts
- ✅ **Modified fare calculation** to use correct contract type multipliers

### **4. Controller Updates**
- ✅ **Updated subscription controller** to require `contract_id` in requests
- ✅ **Added contract validation** before subscription creation
- ✅ **Added new endpoint** `GET /api/subscription/contracts` to get available contracts
- ✅ **Updated admin controller** to use correct contract types

### **5. API Workflow Changes**

#### **New Passenger Workflow:**
1. **Get Available Contracts**: `GET /api/subscription/contracts?contract_type=INSTITUTIONAL`
2. **Create Subscription**: `POST /api/subscription/create` (now requires `contract_id`)
3. **Process Payment**: `POST /api/subscription/:id/payment`
4. **View Subscriptions**: `GET /api/passenger/:id/subscriptions`

#### **Request Format Updated:**
```json
{
  "contract_id": "contract-uuid-123",
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

### **6. Updated Files**

#### **Models:**
- `models/subscriptionModel.js` - Added contract_id, updated enum
- `models/contractSettingsModel.js` - Updated enum
- `models/indexModel.js` - Restored contract-subscription relationship

#### **Services:**
- `services/subscriptionService.js` - Updated multipliers, added contract fetching

#### **Controllers:**
- `controllers/newSubscriptionController.js` - Added contract validation and new endpoint
- `controllers/newAdminController.js` - Updated contract type validation

#### **Routes:**
- `routes/newSubscriptionRoutes.js` - Added contracts endpoint

#### **Documentation:**
- `docs/Contract Ride Service - New Workflow.postman_collection.json` - Updated with new workflow
- `docs/NEW_WORKFLOW_DOCUMENTATION.md` - Updated contract types and workflow

## 🎯 **Contract Type Mapping**

| Contract Type | Description | Multiplier | Use Case |
|---------------|-------------|------------|----------|
| **INDIVIDUAL** | Per trip | 1x | Single rides, personal use |
| **GROUP** | Weekly rate | 7x | Small groups, weekly commitments |
| **INSTITUTIONAL** | Monthly rate | 30x | Companies, institutions, monthly contracts |

## 📊 **Fare Calculation Example**

**Route:** Bole Airport → University (6.25 km)  
**Settings:** 25 ETB/km, 10% discount, 50 ETB minimum  
**Contract:** INSTITUTIONAL

```javascript
baseFare = 6.25 × 25.00 = 156.25 ETB
discount = 156.25 × 10% = 15.63 ETB
dailyFare = 156.25 - 15.63 = 140.62 ETB
institutionalFare = 140.62 × 30 = 4,218.60 ETB
```

## 🔗 **Database Relationships**

```
Contract (1) ←→ (N) Subscription
    ↓
Contract.contract_type determines fare multiplier
Subscription.contract_id links to specific contract
```

## 📱 **Updated Postman Collection**

### **New Endpoints Added:**
- `GET /api/subscription/contracts` - Get available contracts for subscription

### **Updated Requests:**
- **Create Subscription** now requires `contract_id` parameter
- **Contract Settings** use INDIVIDUAL/GROUP/INSTITUTIONAL types
- **All examples** updated with correct contract types

### **Collection Variables:**
- Added `contractId` variable for dynamic contract selection

## ✅ **Validation & Testing**

- ✅ **Syntax Check Passed**: No errors in application startup
- ✅ **Model Relationships**: Contract-Subscription association restored
- ✅ **API Validation**: Contract type validation updated
- ✅ **Documentation**: All docs updated with correct types
- ✅ **Postman Collection**: Updated with new workflow

## 🚀 **Ready for Use**

The system now correctly:
1. **Uses existing contracts** from the contract model
2. **Validates contract types** as INDIVIDUAL/GROUP/INSTITUTIONAL
3. **Links subscriptions to contracts** via contract_id
4. **Calculates fares** based on contract type multipliers
5. **Provides contract selection** endpoint for passengers

The refactored workflow maintains all the benefits of the new system while properly integrating with the existing contract entities as requested! 🎉