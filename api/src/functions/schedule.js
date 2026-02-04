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

// Escape a field for CSV (RFC 4180 compliant)
function escapeCsvField(value) {
    if (value === null || value === undefined) return '';
    const str = String(value);
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
        return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
}

// GET /api/schedule?format=csv - Export as CSV
async function exportScheduleAsCsv(request, context) {
    try {
        const client = getTableClient();
        const entities = [];
        
        for await (const entity of client.listEntities()) {
            entities.push({
                sessionId: entity.rowKey,
                videoId: entity.videoId,
                title: entity.title,
                description: entity.description || '',
                url: entity.url,
                startTime: entity.startTime,
                duration: entity.duration || 0
            });
        }
        
        entities.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
        
        const headers = ['sessionId', 'videoId', 'title', 'description', 'url', 'startTime', 'duration'];
        let csv = headers.join(',') + '\n';
        
        for (const entity of entities) {
            const row = headers.map(h => escapeCsvField(entity[h]));
            csv += row.join(',') + '\n';
        }
        
        return {
            status: 200,
            headers: {
                'Content-Type': 'text/csv',
                'Content-Disposition': 'attachment; filename="schedule-export.csv"'
            },
            body: csv,
            isRaw: true
        };
    } catch (error) {
        context.log("Error exporting schedule:", error);
        return {
            status: 500,
            jsonBody: { error: "Failed to export schedule", details: error.message }
        };
    }
}

// Parse CSV line handling quoted fields
function parseCsvLine(line) {
    const fields = [];
    let current = '';
    let inQuotes = false;
    let i = 0;
    
    while (i < line.length) {
        const char = line[i];
        if (inQuotes) {
            if (char === '"') {
                if (i + 1 < line.length && line[i + 1] === '"') {
                    current += '"';
                    i += 2;
                } else {
                    inQuotes = false;
                    i++;
                }
            } else {
                current += char;
                i++;
            }
        } else {
            if (char === '"') {
                inQuotes = true;
                i++;
            } else if (char === ',') {
                fields.push(current);
                current = '';
                i++;
            } else {
                current += char;
                i++;
            }
        }
    }
    fields.push(current);
    return fields;
}

// Parse CSV content handling multi-line fields
function parseCsv(content) {
    const rows = [];
    let currentRow = '';
    let inQuotes = false;
    
    for (let i = 0; i < content.length; i++) {
        const char = content[i];
        if (char === '"') {
            inQuotes = !inQuotes;
            currentRow += char;
        } else if ((char === '\n' || (char === '\r' && content[i + 1] === '\n')) && !inQuotes) {
            if (currentRow.trim()) rows.push(currentRow);
            currentRow = '';
            if (char === '\r') i++;
        } else if (char === '\r' && !inQuotes) {
            if (currentRow.trim()) rows.push(currentRow);
            currentRow = '';
        } else {
            currentRow += char;
        }
    }
    if (currentRow.trim()) rows.push(currentRow);
    return rows;
}

// POST /api/schedule?action=import - Import from CSV
async function importScheduleFromCsv(request, context) {
    try {
        const body = await request.text();
        const client = getTableClient();
        
        context.log("Import received, content length:", body.length);
        
        const rows = parseCsv(body);
        if (rows.length < 2) {
            return {
                status: 400,
                jsonBody: { error: "CSV must have header row and at least one data row" }
            };
        }
        
        const headerRow = parseCsvLine(rows[0]);
        const headers = headerRow.map(h => h.trim().toLowerCase());
        context.log("Headers found:", headers);
        
        const requiredColumns = ['videoid', 'title', 'starttime'];
        for (const col of requiredColumns) {
            if (!headers.includes(col)) {
                return {
                    status: 400,
                    jsonBody: { error: `Missing required column: ${col}` }
                };
            }
        }
        
        const results = { created: 0, updated: 0, errors: [] };
        
        for (let i = 1; i < rows.length; i++) {
            try {
                const values = parseCsvLine(rows[i]);
                const record = {};
                headers.forEach((header, index) => {
                    record[header] = values[index] || '';
                });
                
                const sessionId = record.sessionid?.trim() || generateSessionId();
                const startDate = new Date(record.starttime);
                
                if (isNaN(startDate.getTime())) {
                    results.errors.push(`Row ${i + 1}: Invalid startTime "${record.starttime}"`);
                    continue;
                }
                
                const partitionKey = startDate.toISOString().split('T')[0];
                
                const entity = {
                    partitionKey: partitionKey,
                    rowKey: sessionId,
                    videoId: record.videoid?.trim() || '',
                    title: record.title?.trim() || '',
                    description: record.description || '',
                    url: record.url?.trim() || `https://www.youtube.com/watch?v=${record.videoid?.trim()}`,
                    startTime: record.starttime?.trim() || '',
                    duration: parseInt(record.duration) || 0
                };
                
                // Check if entity exists
                let exists = false;
                for await (const existing of client.listEntities()) {
                    if (existing.rowKey === sessionId) {
                        exists = true;
                        if (existing.partitionKey !== partitionKey) {
                            await client.deleteEntity(existing.partitionKey, existing.rowKey);
                            await client.createEntity(entity);
                        } else {
                            await client.updateEntity(entity, "Replace");
                        }
                        break;
                    }
                }
                
                if (!exists) {
                    await client.createEntity(entity);
                    results.created++;
                } else {
                    results.updated++;
                }
            } catch (rowError) {
                results.errors.push(`Row ${i + 1}: ${rowError.message}`);
            }
        }
        
        return {
            status: 200,
            jsonBody: {
                message: "Import completed",
                created: results.created,
                updated: results.updated,
                errors: results.errors
            }
        };
    } catch (error) {
        context.log("Error importing schedule:", error);
        return {
            status: 500,
            jsonBody: { error: "Failed to import schedule", details: error.message }
        };
    }
}

// Route handler
module.exports = async function (context, req) {
    const method = req.method.toUpperCase();
    // Decode the ID in case it was URL-encoded (for IDs with special characters like hyphens)
    const rawId = context.bindingData?.id || req.params?.id;
    const id = rawId ? decodeURIComponent(rawId) : null;
    
    // Check for query parameters
    const format = req.query?.format || req.query?.Format;
    const action = req.query?.action || req.query?.Action;
    
    // Wrap req to have consistent interface
    const request = {
        method: req.method,
        params: { id },
        json: async () => req.body,
        text: async () => (typeof req.body === 'string' ? req.body : JSON.stringify(req.body))
    };
    
    let result;
    switch (method) {
        case "GET":
            if (format === 'csv') {
                result = await exportScheduleAsCsv(request, context);
            } else {
                result = await getSchedule(request, context);
            }
            break;
        case "POST":
            if (action === 'import') {
                result = await importScheduleFromCsv(request, context);
            } else {
                result = await addScheduleItem(request, context);
            }
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
    
    // Handle raw responses (like CSV)
    if (result.isRaw) {
        context.res = {
            status: result.status,
            headers: result.headers,
            body: result.body
        };
    } else {
        context.res = {
            status: result.status,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(result.jsonBody)
        };
    }
};