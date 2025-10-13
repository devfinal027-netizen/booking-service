# Database Migration Guide - Contract Types

## Problem
The server is failing to start due to a foreign key constraint error when trying to add the `contract_type_id` column to the `contracts` table. This happens because:

1. The `contract_types` table doesn't exist yet when Sequelize tries to sync the `contracts` table
2. The sync order was incorrect - we need to create `contract_types` before `contracts`
3. Existing data needs to be migrated from the old ENUM-based `contract_type` to the new foreign key `contract_type_id`

## Solution

### 1. Fixed Sync Order
Updated `models/indexModel.js` to sync tables in the correct order:
```javascript
// Sync in correct order to respect foreign key constraints
await Discount.sync({ alter: true });
await ContractType.sync({ alter: true });  // Create contract_types first
await Contract.sync({ alter: true });      // Then contracts can reference it
```

### 2. Created Migration Script
Created `utils/migrateContractTypes.js` that:
- Creates the `contract_types` table
- Creates default contract types (INDIVIDUAL, GROUP, INSTITUTIONAL)
- Migrates existing contract data from old ENUM to new foreign key
- Drops the old `contract_type` column
- Makes `contract_type_id` required after migration

### 3. Updated Startup Process
Modified `index.js` to run migration before database sync:
```javascript
await migrateContractTypes();  // Run migration first
await syncDB();               // Then sync tables
```

### 4. Made Field Temporarily Nullable
Updated `models/contractModel.js` to allow `contract_type_id` to be null initially during migration, then make it required after migration completes.

## How to Fix the Server

### Option 1: Restart the Server (Recommended)
Simply restart the server. The migration will run automatically:

```bash
node index.js
```

The migration will:
1. Create the `contract_types` table
2. Create default contract types
3. Migrate existing contract data
4. Update the database schema
5. Start the server normally

### Option 2: Run Migration Manually
If you want to run the migration separately:

```bash
node scripts/migrate.js
```

Then start the server:
```bash
node index.js
```

### Option 3: Manual Database Fix (If needed)
If the automatic migration fails, you can manually fix the database:

1. **Connect to your MySQL database**
2. **Create the contract_types table:**
```sql
CREATE TABLE contract_types (
  id CHAR(36) BINARY NOT NULL PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  description TEXT,
  base_price_per_km DECIMAL(8,2) NOT NULL DEFAULT 0.00,
  discount_percentage DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  minimum_fare DECIMAL(8,2) NOT NULL DEFAULT 0.00,
  maximum_passengers INT,
  features JSON,
  is_active BOOLEAN DEFAULT TRUE,
  created_by CHAR(36) BINARY,
  updated_by CHAR(36) BINARY,
  createdAt DATETIME NOT NULL,
  updatedAt DATETIME NOT NULL
);
```

3. **Insert default contract types:**
```sql
INSERT INTO contract_types (id, name, description, base_price_per_km, discount_percentage, minimum_fare, maximum_passengers, features, is_active, createdAt, updatedAt) VALUES
(UUID(), 'INDIVIDUAL', 'Individual contract for single passengers', 12.50, 5.00, 40.00, 1, '{"wifi": false, "ac": true}', TRUE, NOW(), NOW()),
(UUID(), 'GROUP', 'Group contract for multiple passengers', 10.00, 15.00, 35.00, 8, '{"wifi": true, "ac": true, "group_discount": true}', TRUE, NOW(), NOW()),
(UUID(), 'INSTITUTIONAL', 'Institutional contract for organizations', 8.00, 20.00, 30.00, 12, '{"wifi": true, "ac": true, "institutional_discount": true, "monthly_billing": true}', TRUE, NOW(), NOW());
```

4. **Add contract_type_id column to contracts table:**
```sql
ALTER TABLE contracts ADD COLUMN contract_type_id CHAR(36) BINARY;
```

5. **Update existing contracts with contract type IDs:**
```sql
UPDATE contracts c 
JOIN contract_types ct ON ct.name = c.contract_type 
SET c.contract_type_id = ct.id 
WHERE c.contract_type IS NOT NULL;
```

6. **Make contract_type_id required:**
```sql
ALTER TABLE contracts MODIFY COLUMN contract_type_id CHAR(36) BINARY NOT NULL;
```

7. **Add foreign key constraint:**
```sql
ALTER TABLE contracts ADD CONSTRAINT contracts_contract_type_id_foreign_idx 
FOREIGN KEY (contract_type_id) REFERENCES contract_types(id) 
ON DELETE RESTRICT ON UPDATE CASCADE;
```

8. **Drop the old contract_type column:**
```sql
ALTER TABLE contracts DROP COLUMN contract_type;
```

## Expected Output
When the migration runs successfully, you should see:
```
🔄 Starting contract type migration...
✅ ContractType table created/verified
📝 Creating default contract types...
✅ Created contract type: INDIVIDUAL
✅ Created contract type: GROUP
✅ Created contract type: INSTITUTIONAL
🔄 Migrating contracts table...
📝 Found old contract_type column, migrating data...
✅ Updated contract [id] to use type [type]
✅ Dropped old contract_type column
✅ Made contract_type_id required
✅ Contract type migration completed successfully!
```

## Verification
After migration, you can verify the changes:

1. **Check contract_types table:**
```sql
SELECT * FROM contract_types;
```

2. **Check contracts table structure:**
```sql
DESCRIBE contracts;
```

3. **Check contracts with contract types:**
```sql
SELECT c.id, c.contract_type_id, ct.name as contract_type_name 
FROM contracts c 
JOIN contract_types ct ON c.contract_type_id = ct.id;
```

## Rollback (If Needed)
If you need to rollback the changes:

1. **Add back the old contract_type column:**
```sql
ALTER TABLE contracts ADD COLUMN contract_type ENUM('INDIVIDUAL', 'GROUP', 'INSTITUTIONAL');
```

2. **Update contracts with old values:**
```sql
UPDATE contracts c 
JOIN contract_types ct ON c.contract_type_id = ct.id 
SET c.contract_type = ct.name;
```

3. **Drop the new column and constraint:**
```sql
ALTER TABLE contracts DROP FOREIGN KEY contracts_contract_type_id_foreign_idx;
ALTER TABLE contracts DROP COLUMN contract_type_id;
```

4. **Drop the contract_types table:**
```sql
DROP TABLE contract_types;
```

## Notes
- The migration is idempotent - it can be run multiple times safely
- Existing contract data will be preserved and migrated
- Default contract types are created with reasonable default values
- The migration handles both new installations and existing databases
