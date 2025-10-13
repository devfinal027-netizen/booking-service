const express = require("express");
const path = require("path");
const cors = require("cors");
require("dotenv").config();
const { createDatabase } = require("./config/dbconfig.js");
const { syncDB } = require("./models/indexModel.js");
// const { migrateContractTypes } = require("./utils/migrateContractTypes.js");
const { errorHandler, notFound } = require("./middleware/errorHandler.js");
const logger = require("./middleware/logger.js");

const PORT = process.env.PORT
const routes = require("./routes/indexRoutes.js");

const app = express();
app.use(logger); // Add logger middleware first
app.use(express.json());

const corsOptions = {
  origin: ["*"],
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
};

app.use(cors(corsOptions));
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

// Health check endpoint
app.get("/", (_, res) =>
  res.status(200).json({ message: "Contract Service is UP!", status: "OK" })
);

// --- API Route Mounting ---
app.use("/api", routes);

// Error handling middleware
app.use(notFound);
app.use(errorHandler);

// --- Server Startup Function ---
const startServer = async () => {
  try {
    console.log(
      "Attempting to connect to database and create if not exists..."
    );
    await createDatabase();

    // console.log("Attempting to migrate contract types...");
    // await migrateContractTypes();

    console.log("Attempting to sync database tables with local models...");
    await syncDB();

    app.listen(PORT, () => {
      console.log(`✅ Contract Service running successfully on PORT: ${PORT}`);
    });
  } catch (error) {
    console.error(
      "❌ Critical Error: Failed to initialize database or start server."
    );
    console.error(error.message);
    if (error.stack) console.error(error.stack);
    process.exit(1);
  }
};

startServer();
