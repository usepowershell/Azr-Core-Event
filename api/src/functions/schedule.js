const { TableClient } = require("@azure/data-tables");
const { ManagedIdentityCredential } = require("@azure/identity");

const storageAccountName = process.env.STORAGE_ACCOUNT_NAME || "azcorestorage2026";
const tableName = "VideoSchedule";

function getTableClient() {
    const credential = new ManagedIdentityCredential();
    const url = `https://${storageAccountName}.table.core.windows.net`;
    return new TableClient(url, tableName, credential);
}

// Generate a URL-safe session ID
function generateSessionId() {
    // Format: sess_<timestamp>_<random>
    const timestamp = Date.now().toString(36); // Base36 for shorter string
    const random = Math.random().toString(36).substring(2, 8); // 6 random chars
    return `sess_${timestamp}_${random}`;
}

// GET /api/schedule - Get all schedule items
async function getSchedule(request, context) {
    try {
        const client = getTableClient();
        const entities = [];
        
        for await (const entity of client.listEntities()) {
            entities.push({
                id: entity.rowKey,
                sessionId: entity.rowKey, // sessionId is the same as id/rowKey
                videoId: entity.videoId,
                title: entity.title,
                description: entity.description,
                url: entity.url,
                startTime: entity.startTime,
                duration: entity.duration
            });
        }
        
        // Sort by startTime
        entities.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
        
        return {
            status: 200,
            jsonBody: {
                timezone: "America/New_York",
                schedule: entities
            }
        };
    } catch (error) {
        context.log("Error fetching schedule:", error);
        return {
            status: 500,
            jsonBody: { error: "Failed to fetch schedule", details: error.message }
        };
    }
}

// POST /api/schedule - Add a new schedule item
async function addScheduleItem(request, context) {
    try {
        const body = await request.json();
        const client = getTableClient();
        
        // Generate a URL-safe session ID
        const sessionId = generateSessionId();
        const startDate = new Date(body.startTime);
        const partitionKey = startDate.toISOString().split('T')[0]; // Use date as partition key
        
        const entity = {
            partitionKey: partitionKey,
            rowKey: sessionId,
            videoId: body.videoId,
            title: body.title,
            description: body.description || "",
            url: body.url || `https://www.youtube.com/watch?v=${body.videoId}`,
            startTime: body.startTime,
            duration: body.duration || 0
        };
        
        await client.createEntity(entity);
        
        context.log("Created schedule item with sessionId:", sessionId);
        
        return {
            status: 201,
            jsonBody: { message: "Schedule item created", id: sessionId, sessionId: sessionId }
        };
    } catch (error) {
        context.log("Error adding schedule item:", error);
        return {
            status: 500,
            jsonBody: { error: "Failed to add schedule item", details: error.message }
        };
    }
}

// PUT /api/schedule/{id} - Update a schedule item
async function updateScheduleItem(request, context) {
    try {
        const id = request.params.id;
        const body = await request.json();
        const client = getTableClient();
        
        context.log("Update requested for ID:", id);
        
        // Find the existing entity first
        let existingEntity = null;
        let allRowKeys = [];
        for await (const entity of client.listEntities()) {
            allRowKeys.push(entity.rowKey);
            if (entity.rowKey === id) {
                existingEntity = entity;
                break;
            }
        }
        
        context.log("All rowKeys in table:", allRowKeys);
        context.log("Found entity:", existingEntity ? "yes" : "no");
        
        if (!existingEntity) {
            return {
                status: 404,
                jsonBody: { error: "Schedule item not found" }
            };
        }
        
        const updatedEntity = {
            partitionKey: existingEntity.partitionKey,
            rowKey: id,
            videoId: body.videoId || existingEntity.videoId,
            title: body.title || existingEntity.title,
            description: body.description !== undefined ? body.description : existingEntity.description,
            url: body.url || existingEntity.url,
            startTime: body.startTime || existingEntity.startTime,
            duration: body.duration !== undefined ? body.duration : existingEntity.duration
        };
        
        await client.updateEntity(updatedEntity, "Replace");
        
        return {
            status: 200,
            jsonBody: { message: "Schedule item updated" }
        };
    } catch (error) {
        context.log("Error updating schedule item:", error);
        return {
            status: 500,
            jsonBody: { error: "Failed to update schedule item", details: error.message }
        };
    }
}

// DELETE /api/schedule/{id} - Delete a schedule item
async function deleteScheduleItem(request, context) {
    try {
        const id = request.params.id;
        const client = getTableClient();
        
        // Find the existing entity first to get the partition key
        let existingEntity = null;
        for await (const entity of client.listEntities()) {
            if (entity.rowKey === id) {
                existingEntity = entity;
                break;
            }
        }
        
        if (!existingEntity) {
            return {
                status: 404,
                jsonBody: { error: "Schedule item not found" }
            };
        }
        
        await client.deleteEntity(existingEntity.partitionKey, id);
        
        return {
            status: 200,
            jsonBody: { message: "Schedule item deleted" }
        };
    } catch (error) {
        context.log("Error deleting schedule item:", error);
        return {
            status: 500,
            jsonBody: { error: "Failed to delete schedule item", details: error.message }
        };
    }
}

// Route handler
module.exports = async function (context, req) {
    const method = req.method.toUpperCase();
    // Decode the ID in case it was URL-encoded (for IDs with special characters like hyphens)
    const rawId = context.bindingData?.id || req.params?.id;
    const id = rawId ? decodeURIComponent(rawId) : null;
    
    // Wrap req to have consistent interface
    const request = {
        method: req.method,
        params: { id },
        json: async () => req.body
    };
    
    let result;
    switch (method) {
        case "GET":
            result = await getSchedule(request, context);
            break;
        case "POST":
            result = await addScheduleItem(request, context);
            break;
        case "PUT":
            if (!id) {
                result = { status: 400, jsonBody: { error: "ID required for update" } };
            } else {
                result = await updateScheduleItem(request, context);
            }
            break;
        case "DELETE":
            if (!id) {
                result = { status: 400, jsonBody: { error: "ID required for delete" } };
            } else {
                result = await deleteScheduleItem(request, context);
            }
            break;
        default:
            result = { status: 405, jsonBody: { error: "Method not allowed" } };
    }
    
    context.res = {
        status: result.status,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(result.jsonBody)
    };
};
