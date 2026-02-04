/**
 * Migration script to upload video-schedule.json to Azure Table Storage
 * 
 * Prerequisites:
 * 1. Install Node.js
 * 2. Run: npm install @azure/data-tables @azure/identity
 * 3. Make sure you're logged into Azure CLI: az login
 * 
 * Usage: node migrate-schedule.js
 */

const { TableClient } = require("@azure/data-tables");
const { DefaultAzureCredential } = require("@azure/identity");
const fs = require("fs");
const path = require("path");

const storageAccountName = "azcorestorage2026";
const tableName = "VideoSchedule";

async function migrate() {
    console.log("🚀 Starting migration...\n");
    
    // Read the JSON file
    const jsonPath = path.join(__dirname, "video-schedule.json");
    const data = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    
    console.log(`📁 Found ${data.schedule.length} schedule items to migrate\n`);
    
    // Connect to Table Storage using Managed Identity / Azure CLI credentials
    const credential = new DefaultAzureCredential();
    const url = `https://${storageAccountName}.table.core.windows.net`;
    const client = new TableClient(url, tableName, credential);
    
    // Create table if it doesn't exist (will error if exists, that's ok)
    try {
        await client.createTable();
        console.log("✅ Table created\n");
    } catch (error) {
        if (error.statusCode === 409) {
            console.log("ℹ️  Table already exists\n");
        } else {
            console.log("⚠️  Table creation note:", error.message, "\n");
        }
    }
    
    // Upload each schedule item
    let successCount = 0;
    let errorCount = 0;
    
    for (const item of data.schedule) {
        try {
            const startDate = new Date(item.startTime);
            const partitionKey = startDate.toISOString().split('T')[0]; // Use date as partition key
            const rowKey = item.videoId; // Use videoId as unique row key
            
            const entity = {
                partitionKey: partitionKey,
                rowKey: rowKey,
                videoId: item.videoId,
                title: item.title,
                description: item.description || "",
                url: item.url,
                startTime: item.startTime,
                duration: item.duration || 0
            };
            
            await client.upsertEntity(entity, "Replace");
            console.log(`✅ Uploaded: ${item.title.substring(0, 50)}...`);
            successCount++;
        } catch (error) {
            console.error(`❌ Failed: ${item.title} - ${error.message}`);
            errorCount++;
        }
    }
    
    console.log(`\n========================================`);
    console.log(`✅ Successfully migrated: ${successCount}`);
    console.log(`❌ Failed: ${errorCount}`);
    console.log(`========================================\n`);
    
    if (successCount > 0) {
        console.log("🎉 Migration complete! Your schedule data is now in Azure Table Storage.");
        console.log("\n📌 Next steps:");
        console.log("   1. Test the admin page at: https://lemon-beach-0a645ad0f.4.azurestaticapps.net/admin.html");
        console.log("   2. Merge your PR to deploy to production");
    }
}

migrate().catch(error => {
    console.error("Migration failed:", error);
    process.exit(1);
});
