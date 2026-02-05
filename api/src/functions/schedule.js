const { app } = require("@azure/functions");
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

// Escape a field for CSV (RFC 4180 compliant + Excel formula protection)
function escapeCsvField(value) {
    if (value === null || value === undefined) return '';
    let str = String(value);
    
    // Check if the value starts with characters Excel interprets as formulas
    const formulaChars = ['-', '+', '=', '@'];
    const startsWithFormula = formulaChars.some(ch => str.startsWith(ch));
    
    // Always quote fields that start with formula characters or contain special chars
    if (startsWithFormula || str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
        // For formula chars, prefix with a single quote (Excel will treat as text)
        if (startsWithFormula) {
            str = "'" + str;
        }
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

// Strip leading single quote that was added for Excel formula protection
function stripExcelQuote(value) {
    if (value && value.startsWith("'") && ['-', '+', '=', '@'].some(ch => value.charAt(1) === ch)) {
        return value.substring(1);
    }
    return value;
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
                fields.push(stripExcelQuote(current));
                current = '';
                i++;
            } else {
                current += char;
                i++;
            }
        }
    }
    fields.push(stripExcelQuote(current));
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

// POST /api/schedule?action=playlist - Import from YouTube playlist
async function importPlaylist(request, context) {
    try {
        const body = await request.json();
        const playlistId = body.playlistId;
        const apiKey = body.apiKey || process.env.YOUTUBE_API_KEY;
        const startDate = body.startDate ? new Date(body.startDate) : new Date();
        const sessionDuration = body.sessionDuration || 60; // Default 60 minutes between sessions
        
        if (!playlistId) {
            return {
                status: 400,
                jsonBody: { error: "playlistId is required" }
            };
        }
        
        if (!apiKey) {
            return {
                status: 400,
                jsonBody: { error: "YouTube API key is required. Provide apiKey in request or set YOUTUBE_API_KEY environment variable." }
            };
        }
        
        context.log("Importing playlist:", playlistId);
        
        // Fetch playlist items from YouTube API
        const playlistItems = [];
        let nextPageToken = null;
        
        do {
            const url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&maxResults=50&playlistId=${playlistId}&key=${apiKey}${nextPageToken ? `&pageToken=${nextPageToken}` : ''}`;
            
            context.log("Fetching URL:", url.replace(apiKey, 'API_KEY_HIDDEN'));
            
            let response;
            try {
                response = await fetch(url);
            } catch (fetchError) {
                context.log("Fetch error:", fetchError);
                return {
                    status: 500,
                    jsonBody: { error: "Network error fetching from YouTube", details: fetchError.message }
                };
            }
            
            const responseText = await response.text();
            context.log("Response status:", response.status);
            
            if (!response.ok) {
                let errorDetails = responseText;
                try {
                    const errorJson = JSON.parse(responseText);
                    errorDetails = errorJson.error?.message || errorJson.error?.errors?.[0]?.message || responseText;
                } catch (e) {
                    // Keep responseText as errorDetails
                }
                context.log("YouTube API error:", errorDetails);
                return {
                    status: 400,
                    jsonBody: { error: "Failed to fetch playlist from YouTube", details: errorDetails }
                };
            }
            
            const data = JSON.parse(responseText);
            playlistItems.push(...(data.items || []));
            nextPageToken = data.nextPageToken;
        } while (nextPageToken);
        
        context.log(`Found ${playlistItems.length} videos in playlist`);
        
        // Get video details for duration
        const videoIds = playlistItems.map(item => item.contentDetails.videoId).join(',');
        const videosUrl = `https://www.googleapis.com/youtube/v3/videos?part=contentDetails,snippet&id=${videoIds}&key=${apiKey}`;
        const videosResponse = await fetch(videosUrl);
        const videosData = await videosResponse.json();
        
        // Create a map of video durations
        const videoDurations = {};
        for (const video of videosData.items || []) {
            // Parse ISO 8601 duration (PT1H2M3S)
            const duration = video.contentDetails.duration;
            let seconds = 0;
            const hours = duration.match(/(\d+)H/);
            const minutes = duration.match(/(\d+)M/);
            const secs = duration.match(/(\d+)S/);
            if (hours) seconds += parseInt(hours[1]) * 3600;
            if (minutes) seconds += parseInt(minutes[1]) * 60;
            if (secs) seconds += parseInt(secs[1]);
            videoDurations[video.id] = seconds;
        }
        
        // Create schedule items
        const client = getTableClient();
        const results = { created: 0, skipped: 0, errors: [], videos: [] };
        let currentTime = new Date(startDate);
        
        for (const item of playlistItems) {
            try {
                const videoId = item.contentDetails.videoId;
                const snippet = item.snippet;
                
                // Skip private or deleted videos
                if (snippet.title === 'Private video' || snippet.title === 'Deleted video') {
                    results.skipped++;
                    continue;
                }
                
                const sessionId = generateSessionId();
                const partitionKey = currentTime.toISOString().split('T')[0];
                const duration = videoDurations[videoId] || 0;
                
                const entity = {
                    partitionKey: partitionKey,
                    rowKey: sessionId,
                    videoId: videoId,
                    title: snippet.title,
                    description: snippet.description || '',
                    url: `https://www.youtube.com/watch?v=${videoId}`,
                    startTime: currentTime.toISOString(),
                    duration: duration
                };
                
                await client.createEntity(entity);
                results.created++;
                results.videos.push({ title: snippet.title, videoId, startTime: currentTime.toISOString() });
                
                // Move to next time slot (use video duration + gap, or sessionDuration)
                const nextGap = duration > 0 ? duration + (sessionDuration * 60) : sessionDuration * 60;
                currentTime = new Date(currentTime.getTime() + nextGap * 1000);
                
            } catch (itemError) {
                results.errors.push(`${item.snippet?.title || 'Unknown'}: ${itemError.message}`);
            }
        }
        
        return {
            status: 200,
            jsonBody: {
                message: "Playlist import completed",
                created: results.created,
                skipped: results.skipped,
                errors: results.errors,
                videos: results.videos
            }
        };
    } catch (error) {
        context.log("Error importing playlist:", error);
        return {
            status: 500,
            jsonBody: { error: "Failed to import playlist", details: error.message }
        };
    }
}

// Helper to handle request wrapper for v4
function wrapRequest(request, id) {
    return {
        method: request.method,
        params: { id },
        query: Object.fromEntries(new URL(request.url).searchParams),
        json: () => request.json(),
        text: () => request.text()
    };
}

// Register routes using v4 programming model
app.http("getSchedule", {
    methods: ["GET"],
    authLevel: "anonymous",
    route: "schedule",
    handler: async (request, context) => {
        const url = new URL(request.url);
        const format = url.searchParams.get('format');
        
        if (format === 'csv') {
            return exportScheduleAsCsv(wrapRequest(request), context);
        }
        return getSchedule(wrapRequest(request), context);
    }
});

app.http("addScheduleItem", {
    methods: ["POST"],
    authLevel: "anonymous",
    route: "schedule",
    handler: async (request, context) => {
        const url = new URL(request.url);
        const action = url.searchParams.get('action');
        
        if (action === 'import') {
            return importScheduleFromCsv(wrapRequest(request), context);
        }
        if (action === 'playlist') {
            return importPlaylist(wrapRequest(request), context);
        }
        return addScheduleItem(wrapRequest(request), context);
    }
});

app.http("updateScheduleItem", {
    methods: ["PUT"],
    authLevel: "anonymous",
    route: "schedule/{id}",
    handler: async (request, context) => {
        const id = decodeURIComponent(request.params.id);
        return updateScheduleItem(wrapRequest(request, id), context);
    }
});

app.http("deleteScheduleItem", {
    methods: ["DELETE"],
    authLevel: "anonymous",
    route: "schedule/{id}",
    handler: async (request, context) => {
        const id = decodeURIComponent(request.params.id);
        return deleteScheduleItem(wrapRequest(request, id), context);
    }
});

module.exports = {
    getSchedule,
    addScheduleItem,
    updateScheduleItem,
    deleteScheduleItem,
    exportScheduleAsCsv,
    importScheduleFromCsv,
    importPlaylist
};