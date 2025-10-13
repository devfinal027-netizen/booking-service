// const { sequelize, ContractType, Contract } = require("../models/indexModel");

// const migrateContractTypes = async () => {
//   try {
//     console.log("🔄 Starting contract type migration...");

//     // First, create the contract_types table if it doesn't exist
//     await ContractType.sync({ force: false });
//     console.log("✅ ContractType table created/verified");

//     // Check if we need to create default contract types
//     const existingTypes = await ContractType.count();
    
//     if (existingTypes === 0) {
//       console.log("📝 Creating default contract types...");
      
//       // Create default contract types based on the old ENUM values
//       const defaultTypes = [
//         {
//           name: "INDIVIDUAL",
//           description: "Individual contract for single passengers",
//           base_price_per_km: 12.50,
//           discount_percentage: 5.00,
//           minimum_fare: 40.00,
//           maximum_passengers: 1,
//           features: {
//             wifi: false,
//             ac: true
//           },
//           is_active: true
//         },
//         {
//           name: "GROUP",
//           description: "Group contract for multiple passengers",
//           base_price_per_km: 10.00,
//           discount_percentage: 15.00,
//           minimum_fare: 35.00,
//           maximum_passengers: 8,
//           features: {
//             wifi: true,
//             ac: true,
//             group_discount: true
//           },
//           is_active: true
//         },
//         {
//           name: "INSTITUTIONAL",
//           description: "Institutional contract for organizations",
//           base_price_per_km: 8.00,
//           discount_percentage: 20.00,
//           minimum_fare: 30.00,
//           maximum_passengers: 12,
//           features: {
//             wifi: true,
//             ac: true,
//             institutional_discount: true,
//             monthly_billing: true
//           },
//           is_active: true
//         }
//       ];

//       for (const typeData of defaultTypes) {
//         await ContractType.create(typeData);
//         console.log(`✅ Created contract type: ${typeData.name}`);
//       }
//     }

//     // Now handle the contracts table migration
//     console.log("🔄 Migrating contracts table...");
    
//     // Check if the old contract_type column exists
//     const [results] = await sequelize.query(`
//       SELECT COLUMN_NAME 
//       FROM INFORMATION_SCHEMA.COLUMNS 
//       WHERE TABLE_SCHEMA = DATABASE() 
//       AND TABLE_NAME = 'contracts' 
//       AND COLUMN_NAME = 'contract_type'
//     `);

//     if (results.length > 0) {
//       console.log("📝 Found old contract_type column, migrating data...");
      
//       // Get all contract types for mapping
//       const contractTypes = await ContractType.findAll();
//       const typeMap = {};
//       contractTypes.forEach(type => {
//         typeMap[type.name] = type.id;
//       });

//       // Get all contracts with old contract_type values
//       const [contracts] = await sequelize.query(`
//         SELECT id, contract_type 
//         FROM contracts 
//         WHERE contract_type IS NOT NULL
//       `);

//       // Update each contract with the new contract_type_id
//       for (const contract of contracts) {
//         const typeId = typeMap[contract.contract_type];
//         if (typeId) {
//           await sequelize.query(`
//             UPDATE contracts 
//             SET contract_type_id = ? 
//             WHERE id = ?
//           `, {
//             replacements: [typeId, contract.id]
//           });
//           console.log(`✅ Updated contract ${contract.id} to use type ${contract.contract_type}`);
//         } else {
//           console.warn(`⚠️  No matching contract type found for: ${contract.contract_type}`);
//         }
//       }

//       // Drop the old contract_type column
//       await sequelize.query(`
//         ALTER TABLE contracts DROP COLUMN contract_type
//       `);
//       console.log("✅ Dropped old contract_type column");

//       // Make contract_type_id required after migration
//       await sequelize.query(`
//         ALTER TABLE contracts MODIFY COLUMN contract_type_id CHAR(36) BINARY NOT NULL
//       `);
//       console.log("✅ Made contract_type_id required");
//     }

//     console.log("✅ Contract type migration completed successfully!");
    
//   } catch (error) {
//     console.error("❌ Error during contract type migration:", error);
//     throw error;
//   }
// };

// module.exports = { migrateContractTypes };
