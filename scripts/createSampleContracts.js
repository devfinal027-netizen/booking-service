#!/usr/bin/env node

const { Contract, ContractType } = require("../models/indexModel");
const { sequelize } = require("../config/dbconfig");

const createSampleContracts = async () => {
  try {
    console.log("🚀 Creating sample contracts...");

    // Get all active contract types
    const contractTypes = await ContractType.findAll({
      where: { is_active: true }
    });

    if (contractTypes.length === 0) {
      console.log("❌ No contract types found. Please create contract types first.");
      return;
    }

    console.log(`📋 Found ${contractTypes.length} contract types`);

    // Create sample contracts for each contract type
    const sampleContracts = [];

    for (const contractType of contractTypes) {
      // Create 2-3 sample contracts per type
      const contractsToCreate = [
        {
          contract_type_id: contractType.id,
          start_date: "2024-01-01",
          end_date: "2024-12-31",
          pickup_location: "Bole International Airport",
          dropoff_location: "Addis Ababa University",
          cost: parseFloat(contractType.base_price_per_km) * 10, // Sample cost
          status: "ACTIVE"
        },
        {
          contract_type_id: contractType.id,
          start_date: "2024-01-01",
          end_date: "2024-12-31",
          pickup_location: "Mercato",
          dropoff_location: "Bole",
          cost: parseFloat(contractType.base_price_per_km) * 8, // Sample cost
          status: "ACTIVE"
        }
      ];

      for (const contractData of contractsToCreate) {
        try {
          const contract = await Contract.create(contractData);
          sampleContracts.push(contract);
          console.log(`✅ Created contract for ${contractType.name}: ${contract.id}`);
        } catch (error) {
          console.error(`❌ Error creating contract for ${contractType.name}:`, error.message);
        }
      }
    }

    console.log(`✅ Created ${sampleContracts.length} sample contracts`);
    
    // Show summary
    console.log("\n📊 Contract Summary:");
    for (const contractType of contractTypes) {
      const contractsForType = await Contract.count({
        where: { contract_type_id: contractType.id }
      });
      console.log(`  ${contractType.name}: ${contractsForType} contracts`);
    }

  } catch (error) {
    console.error("❌ Error creating sample contracts:", error);
  } finally {
    await sequelize.close();
  }
};

createSampleContracts();
