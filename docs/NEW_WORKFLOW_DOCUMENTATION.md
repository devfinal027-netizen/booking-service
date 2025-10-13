# Contract Ride Service - New Workflow Documentation

## Overview

The Contract Ride Service has been refactored to implement a streamlined subscription-based workflow that eliminates the need for separate contract management and focuses on direct passenger-to-subscription creation with automatic fare calculation.

## Key Changes

### 1. **Simplified Subscription Model**
- Subscriptions are now independent entities (no longer tied to contracts)
- Direct passenger creation with pickup/dropoff locations
- Automatic fare calculation based on admin-configured pricing
- Built-in payment processing workflow

### 2. **New Database Schema**

```sql
-- Updated Subscriptions Table
CREATE TABLE subscriptions (
  id UUID PRIMARY KEY,
  passenger_id UUID NOT NULL,
  driver_id UUID NULL, -- Assigned by admin
  pickup_location VARCHAR(255) NOT NULL,
  dropoff_location VARCHAR(255) NOT NULL,
  pickup_latitude DECIMAL(10,8),
  pickup_longitude DECIMAL(11,8),
  dropoff_latitude DECIMAL(10,8),
  dropoff_longitude DECIMAL(11,8),
  contract_type ENUM('INDIVIDUAL', 'GROUP', 'INSTITUTIONAL') NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  fare DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  discount_applied DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  final_fare DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  distance_km DECIMAL(8,2),
  status ENUM('PENDING', 'ACTIVE', 'COMPLETED', 'CANCELLED') DEFAULT 'PENDING',
  payment_status ENUM('PENDING', 'PAID', 'FAILED', 'REFUNDED') DEFAULT 'PENDING',
  payment_reference VARCHAR(255),
  notes TEXT,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);

-- New Contract Settings Table
CREATE TABLE contract_settings (
  id UUID PRIMARY KEY,
  contract_type ENUM('INDIVIDUAL', 'GROUP', 'INSTITUTIONAL') UNIQUE NOT NULL,
  base_price_per_km DECIMAL(8,2) NOT NULL DEFAULT 0.00,
  discount_percentage DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  minimum_fare DECIMAL(8,2) NOT NULL DEFAULT 0.00,
  is_active BOOLEAN DEFAULT TRUE,
  created_by UUID,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);
```

## Workflow Documentation

### 🔄 **Passenger Workflow**

#### 1. Get Available Contracts
```http
GET /api/subscription/contracts?contract_type=INSTITUTIONAL
Authorization: Bearer {passenger_token}
```

#### 2. Create Subscription with Fare Estimation
```http
POST /api/subscription/create
Authorization: Bearer {passenger_token}
Content-Type: application/json

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

**Response:**
```json
{
  "success": true,
  "message": "Subscription created successfully with fare estimation",
  "data": {
    "subscription": {
      "id": "uuid-here",
      "passenger_id": "passenger-uuid",
      "pickup_location": "Bole International Airport",
      "dropoff_location": "Addis Ababa University",
      "contract_type": "INSTITUTIONAL",
      "start_date": "2024-01-01",
      "end_date": "2024-01-31",
      "fare": 150.00,
      "discount_applied": 15.00,
      "final_fare": 4050.00,
      "distance_km": 6.25,
      "status": "PENDING",
      "payment_status": "PENDING"
    },
    "fare_estimation": {
      "distance_km": 6.25,
      "base_price_per_km": 25.00,
      "base_fare": 150.00,
      "discount_percentage": 10.00,
      "discount_amount": 15.00,
      "daily_fare": 135.00,
      "multiplier": 30,
      "total_fare": 4050.00
    }
  }
}
```

#### 3. Process Payment
```http
POST /api/subscription/{id}/payment
Authorization: Bearer {passenger_token}
Content-Type: application/json

{
  "payment_reference": "PAY-123456789",
  "payment_method": "BANK_TRANSFER"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Payment processed successfully. Subscription is now active.",
  "data": {
    "subscription": {
      "id": "uuid-here",
      "status": "ACTIVE",
      "payment_status": "PAID",
      "payment_reference": "PAY-123456789"
    }
  }
}
```

#### 4. View Subscriptions (Active & History)
```http
GET /api/passenger/{id}/subscriptions
Authorization: Bearer {passenger_token}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "active_subscriptions": [...],
    "subscription_history": [...],
    "total_subscriptions": 5,
    "active_count": 2,
    "history_count": 3
  }
}
```

### 🛠 **Admin Workflow**

#### 1. Set Contract Base Price & Discounts
```http
POST /api/admin/contract/settings
Authorization: Bearer {admin_token}
Content-Type: application/json

{
  "contract_type": "INSTITUTIONAL",
  "base_price_per_km": 25.00,
  "discount_percentage": 10.00,
  "minimum_fare": 50.00
}
```

**Response:**
```json
{
  "success": true,
  "message": "Contract settings created successfully",
  "data": {
    "id": "uuid-here",
    "contract_type": "INSTITUTIONAL",
    "base_price_per_km": 25.00,
    "discount_percentage": 10.00,
    "minimum_fare": 50.00,
    "is_active": true
  }
}
```

#### 2. Assign Driver to Subscription
```http
POST /api/admin/subscription/{id}/assign-driver
Authorization: Bearer {admin_token}
Content-Type: application/json

{
  "driver_id": "driver-uuid-123"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Driver assigned to subscription successfully",
  "data": {
    "subscription": {
      "id": "subscription-uuid",
      "driver_id": "driver-uuid-123",
      "passenger_name": "Jane Smith",
      "driver_name": "John Doe",
      "vehicle_info": {
        "car_model": "Toyota Corolla",
        "car_plate": "AA-12345",
        "car_color": "White"
      }
    }
  }
}
```

### 🚗 **Driver Workflow**

#### 1. View Assignments
```http
GET /api/driver/{id}/assignments
Authorization: Bearer {driver_token}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "active_assignments": [...],
    "pending_assignments": [...],
    "total_assignments": 5,
    "active_count": 3,
    "pending_count": 2
  }
}
```

#### 2. View Schedule & Subscription Details
```http
GET /api/driver/{id}/schedule?date=2024-01-15&contract_type=MONTHLY
Authorization: Bearer {driver_token}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "schedule": [...],
    "schedule_by_type": {
      "MONTHLY": [...],
      "DAILY": [...]
    },
    "statistics": {
      "total_active_subscriptions": 10,
      "monthly_subscriptions": 7,
      "daily_subscriptions": 3
    }
  }
}
```

## Fare Calculation Logic

### **Formula:**
```javascript
// 1. Calculate base fare from distance
baseFare = distance_km * base_price_per_km

// 2. Apply discount
discountAmount = baseFare * (discount_percentage / 100)
fareAfterDiscount = baseFare - discountAmount

// 3. Ensure minimum fare
dailyFare = Math.max(fareAfterDiscount, minimum_fare)

// 4. Apply contract type multiplier
multipliers = {
  INDIVIDUAL: 1,
  GROUP: 7,
  INSTITUTIONAL: 30
}

finalFare = dailyFare * multipliers[contract_type]
```

### **Example Calculation:**
- **Distance:** 6.25 km
- **Base Price:** 25.00 ETB/km
- **Discount:** 10%
- **Contract Type:** INSTITUTIONAL

```
baseFare = 6.25 * 25.00 = 156.25 ETB
discountAmount = 156.25 * 0.10 = 15.63 ETB
fareAfterDiscount = 156.25 - 15.63 = 140.62 ETB
dailyFare = Math.max(140.62, 50.00) = 140.62 ETB
finalFare = 140.62 * 30 = 4,218.60 ETB
```

## API Endpoints Summary

### **Passenger Endpoints**
- `GET /api/subscription/contracts` - Get available contracts
- `POST /api/subscription/create` - Create subscription with fare estimation
- `POST /api/subscription/:id/payment` - Process payment
- `GET /api/passenger/:id/subscriptions` - View subscriptions

### **Admin Endpoints**
- `POST /api/admin/contract/settings` - Set pricing rules
- `GET /api/admin/contract/settings` - Get pricing rules
- `POST /api/admin/subscription/:id/assign-driver` - Assign driver
- `GET /api/admin/subscriptions` - View all subscriptions

### **Driver Endpoints**
- `GET /api/driver/:id/assignments` - View assignments
- `GET /api/driver/:id/schedule` - View schedule
- `GET /api/driver/:id/earnings` - View earnings

## Status Flow

### **Subscription Status:**
```
PENDING → ACTIVE → COMPLETED
    ↓        ↓
CANCELLED ← CANCELLED
```

### **Payment Status:**
```
PENDING → PAID → REFUNDED
    ↓
  FAILED
```

## Security & Authorization

### **Role-Based Access:**
- **Passengers:** Can only access their own subscriptions
- **Drivers:** Can only access their assigned subscriptions
- **Admins:** Full access to all data and settings

### **Authentication:**
- JWT token required for all endpoints
- Token contains user ID and role information
- External auth service integration for user details

## Error Handling

### **Common Error Responses:**
```json
{
  "success": false,
  "message": "Error description",
  "error": "Technical error details"
}
```

### **HTTP Status Codes:**
- `200` - Success
- `201` - Created
- `400` - Bad Request (validation errors)
- `401` - Unauthorized (invalid token)
- `403` - Forbidden (insufficient permissions)
- `404` - Not Found
- `500` - Internal Server Error

## Migration from Old System

### **Data Migration Steps:**
1. Export existing contracts and subscriptions
2. Create contract settings based on existing pricing
3. Update subscription records with new schema
4. Migrate payment references
5. Update driver assignments

### **Backward Compatibility:**
- Old endpoints remain functional during transition
- Gradual migration of frontend clients
- Data synchronization between old and new schemas

## Testing with Postman

The updated Postman collection includes:
- **Authentication flows** for all user types
- **Complete passenger workflow** (create → pay → view)
- **Admin management** (settings → assignment)
- **Driver operations** (assignments → schedule → earnings)
- **Example requests and responses**
- **Environment variables** for easy testing

Import the collection: `Contract Ride Service - New Workflow.postman_collection.json`

## Performance Considerations

### **Optimizations:**
- Database indexing on frequently queried fields
- Caching of contract settings
- Batch user information retrieval
- Efficient distance calculations

### **Monitoring:**
- Subscription creation rates
- Payment success rates
- Driver assignment efficiency
- System response times

This new workflow provides a more streamlined, user-friendly experience while maintaining the flexibility and power needed for a comprehensive ride management system.