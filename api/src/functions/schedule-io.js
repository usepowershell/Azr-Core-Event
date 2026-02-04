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
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `sess_${timestamp}_${random}`;
}

// Escape a field for CSV (RFC 4180 compliant)
function escapeCsvField(value) {
    if (value === null || value === undefined) {
        return '';
    }
    const str = String(value);
    // If field contains comma, quote, or newline, wrap in quotes and escape internal quotes
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
        return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
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
                // Check if it's an escaped quote
                if (i + 1 < line.length && line[i + 1] === '"') {
                    current += '"';
                    i += 2;
                } else {
                    // End of quoted field
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
    fields.push(current); // Don't forget the last field
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
            if (currentRow.trim()) {
                rows.push(currentRow);
            }
            currentRow = '';
            if (char === '\r') i++; // Skip \n after \r
        } else if (char === '\r' && !inQuotes) {
            if (currentRow.trim()) {
                rows.push(currentRow);
            }
            currentRow = '';
        } else {
            currentRow += char;
        }
    }
    if (currentRow.trim()) {
        rows.push(currentRow);
    }
    
    return rows;
}

// GET /api/schedule/export - Export all schedule items as CSV
async function exportSchedule(request, context) {
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
        
        // Sort by startTime
        entities.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
        
        // Build CSV
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
            body: csv
        };
    } catch (error) {
        context.log("Error exporting schedule:", error);
        return {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: "Failed to export schedule", details: error.message })
        };
    }
}

// POST /api/schedule/import - Import schedule items from CSV
async function importSchedule(request, context) {
    try {
        const body = await request.text();
        const client = getTableClient();
        
        context.log("Import received, content length:", body.length);
        
        const rows = parseCsv(body);
        if (rows.length < 2) {
            return {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ error: "CSV must have header row and at least one data row" })
            };
        }
        
        // Parse header
        const headerRow = parseCsvLine(rows[0]);
        const headers = headerRow.map(h => h.trim().toLowerCase());
        context.log("Headers found:", headers);
        
        // Validate required columns
        const requiredColumns = ['videoid', 'title', 'starttime'];
        for (const col of requiredColumns) {
            if (!headers.includes(col)) {
                return {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ error: `Missing required column: ${col}` })
                };
            }
        }
        
        const results = {
            created: 0,
            updated: 0,
            errors: []
        };
        
        // Process each data row
        for (let i = 1; i < rows.length; i++) {
            try {
                const values = parseCsvLine(rows[i]);
                const record = {};
                
                headers.forEach((header, index) => {
                    record[header] = values[index] || '';
                });
                
                // Map to entity
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
                try {
                    for await (const existing of client.listEntities()) {
                        if (existing.rowKey === sessionId) {
                            exists = true;
                            // Need to delete first if partition key changed
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
                } catch (entityError) {
                    // Try to create if update failed
                    try {
                        await client.createEntity(entity);
                        results.created++;
                    } catch (createError) {
                        results.errors.push(`Row ${i + 1}: ${createError.message}`);
                    }
                }
                
            } catch (rowError) {
                results.errors.push(`Row ${i + 1}: ${rowError.message}`);
            }
        }
        
        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: "Import completed",
                created: results.created,
                updated: results.updated,
                errors: results.errors
            })
        };
    } catch (error) {
        context.log("Error importing schedule:", error);
        return {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: "Failed to import schedule", details: error.message })
        };
    }
}

// Route handler
module.exports = async function (context, req) {
    const method = req.method.toUpperCase();
    const action = context.bindingData?.action;
    
    const request = {
        method: req.method,
        text: async () => req.body,
        json: async () => req.body
    };
    
    let result;
    
    if (action === 'export' && method === 'GET') {
        result = await exportSchedule(request, context);
    } else if (action === 'import' && method === 'POST') {
        result = await importSchedule(request, context);
    } else {
        result = {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: "Unknown action. Use /api/schedule/export or /api/schedule/import" })
        };
    }
    
    context.res = {
        status: result.status,
        headers: result.headers || { "Content-Type": "application/json" },
        body: result.body
    };
};
