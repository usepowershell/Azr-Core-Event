const { app } = require("@azure/functions");
const { TableClient } = require("@azure/data-tables");
const { ManagedIdentityCredential } = require("@azure/identity");

const storageAccountName = process.env.STORAGE_ACCOUNT_NAME || "azcorestorage2026";
const tableName = "Speakers";

function getTableClient() {
    const credential = new ManagedIdentityCredential();
    const url = `https://${storageAccountName}.table.core.windows.net`;
    return new TableClient(url, tableName, credential);
}

// Generate a URL-safe speaker ID from name
function generateSpeakerId(name) {
    const slug = name.toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .substring(0, 50);
    const random = Math.random().toString(36).substring(2, 6);
    return `${slug}-${random}`;
}

// GET /api/speakers - Get all speakers
async function getSpeakers(request, context) {
    try {
        const client = getTableClient();
        const speakers = [];
        
        for await (const entity of client.listEntities()) {
            speakers.push({
                id: entity.rowKey,
                name: entity.name,
                title: entity.title || '',
                company: entity.company || '',
                bio: entity.bio || '',
                headshotFile: entity.headshotFile || '', // Filename in /images/speakers/
                linkedin: entity.linkedin || '',
                twitter: entity.twitter || '',
                sessionIds: entity.sessionIds ? JSON.parse(entity.sessionIds) : []
            });
        }
        
        // Sort by name
        speakers.sort((a, b) => a.name.localeCompare(b.name));
        
        return {
            status: 200,
            jsonBody: { speakers }
        };
    } catch (error) {
        context.log("Error fetching speakers:", error);
        return {
            status: 500,
            jsonBody: { error: "Failed to fetch speakers", details: error.message }
        };
    }
}

// GET /api/speakers/{id} - Get single speaker
async function getSpeaker(request, context) {
    try {
        const id = request.params.id;
        const client = getTableClient();
        
        for await (const entity of client.listEntities()) {
            if (entity.rowKey === id) {
                return {
                    status: 200,
                    jsonBody: {
                        id: entity.rowKey,
                        name: entity.name,
                        title: entity.title || '',
                        company: entity.company || '',
                        bio: entity.bio || '',
                        headshotFile: entity.headshotFile || '',
                        linkedin: entity.linkedin || '',
                        twitter: entity.twitter || '',
                        sessionIds: entity.sessionIds ? JSON.parse(entity.sessionIds) : []
                    }
                };
            }
        }
        
        return {
            status: 404,
            jsonBody: { error: "Speaker not found" }
        };
    } catch (error) {
        context.log("Error fetching speaker:", error);
        return {
            status: 500,
            jsonBody: { error: "Failed to fetch speaker", details: error.message }
        };
    }
}

// POST /api/speakers - Add a new speaker
async function addSpeaker(request, context) {
    try {
        const body = await request.json();
        const client = getTableClient();
        
        const speakerId = generateSpeakerId(body.name);
        
        const entity = {
            partitionKey: "speaker",
            rowKey: speakerId,
            name: body.name,
            title: body.title || '',
            company: body.company || '',
            bio: body.bio || '',
            headshotFile: body.headshotFile || '', // e.g., "rick-claus.jpg"
            linkedin: body.linkedin || '',
            twitter: body.twitter || '',
            sessionIds: JSON.stringify(body.sessionIds || [])
        };
        
        await client.createEntity(entity);
        
        return {
            status: 201,
            jsonBody: {
                message: "Speaker created",
                id: speakerId,
                name: body.name,
                title: body.title || '',
                company: body.company || '',
                bio: body.bio || '',
                headshotFile: body.headshotFile || '',
                linkedin: body.linkedin || '',
                twitter: body.twitter || '',
                sessionIds: body.sessionIds || []
            }
        };
    } catch (error) {
        context.log("Error creating speaker:", error);
        return {
            status: 500,
            jsonBody: { error: "Failed to create speaker", details: error.message }
        };
    }
}

// PUT /api/speakers/{id} - Update a speaker
async function updateSpeaker(request, context) {
    try {
        const id = request.params.id;
        const body = await request.json();
        const client = getTableClient();
        
        // Find the existing entity
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
                jsonBody: { error: "Speaker not found" }
            };
        }
        
        const updatedEntity = {
            partitionKey: existingEntity.partitionKey,
            rowKey: id,
            name: body.name || existingEntity.name,
            title: body.title !== undefined ? body.title : existingEntity.title,
            company: body.company !== undefined ? body.company : existingEntity.company,
            bio: body.bio !== undefined ? body.bio : existingEntity.bio,
            headshotFile: body.headshotFile !== undefined ? body.headshotFile : existingEntity.headshotFile,
            linkedin: body.linkedin !== undefined ? body.linkedin : existingEntity.linkedin,
            twitter: body.twitter !== undefined ? body.twitter : existingEntity.twitter,
            sessionIds: body.sessionIds ? JSON.stringify(body.sessionIds) : existingEntity.sessionIds
        };
        
        await client.updateEntity(updatedEntity, "Replace");
        
        return {
            status: 200,
            jsonBody: {
                message: "Speaker updated",
                id: id,
                name: updatedEntity.name,
                title: updatedEntity.title,
                company: updatedEntity.company,
                bio: updatedEntity.bio,
                headshotFile: updatedEntity.headshotFile,
                linkedin: updatedEntity.linkedin,
                twitter: updatedEntity.twitter,
                sessionIds: JSON.parse(updatedEntity.sessionIds || '[]')
            }
        };
    } catch (error) {
        context.log("Error updating speaker:", error);
        return {
            status: 500,
            jsonBody: { error: "Failed to update speaker", details: error.message }
        };
    }
}

// DELETE /api/speakers/{id} - Delete a speaker
async function deleteSpeaker(request, context) {
    try {
        const id = request.params.id;
        const client = getTableClient();
        
        for await (const entity of client.listEntities()) {
            if (entity.rowKey === id) {
                await client.deleteEntity(entity.partitionKey, entity.rowKey);
                return {
                    status: 200,
                    jsonBody: { message: "Speaker deleted", id: id }
                };
            }
        }
        
        return {
            status: 404,
            jsonBody: { error: "Speaker not found" }
        };
    } catch (error) {
        context.log("Error deleting speaker:", error);
        return {
            status: 500,
            jsonBody: { error: "Failed to delete speaker", details: error.message }
        };
    }
}

// POST /api/speakers/extract - Extract speakers from schedule descriptions
async function extractSpeakers(request, context) {
    try {
        const credential = new ManagedIdentityCredential();
        const scheduleClient = new TableClient(
            `https://${storageAccountName}.table.core.windows.net`,
            "VideoSchedule",
            credential
        );
        
        const speakerClient = getTableClient();
        
        // Get existing speakers
        const existingSpeakers = new Map();
        for await (const entity of speakerClient.listEntities()) {
            existingSpeakers.set(entity.name.toLowerCase(), entity);
        }
        
        // Extract speakers from schedule
        const extractedSpeakers = new Map();
        const speakerSessions = new Map();
        
        for await (const session of scheduleClient.listEntities()) {
            const description = session.description || '';
            
            // Look for "Speaker:" or "Speakers:" patterns
            const speakerMatches = description.match(/Speakers?:\s*([^\n]+(?:\n(?![A-Z#✅📅⁉️])[^\n]+)*)/gi);
            
            if (speakerMatches) {
                for (const match of speakerMatches) {
                    const namesSection = match.replace(/Speakers?:\s*/i, '').trim();
                    
                    // Split by common delimiters
                    const names = namesSection
                        .split(/[,\n]/)
                        .map(n => n.trim())
                        .filter(n => n && n.length > 2 && !n.includes('http') && !n.includes('@'));
                    
                    for (const name of names) {
                        // Clean up the name - remove title/role after dash
                        const cleanName = name
                            .replace(/^\d+\.\s*/, '')
                            .replace(/\s*[-–—]\s*.*$/, '')
                            .replace(/\s*\(.*\)/, '')
                            .trim();
                        
                        if (cleanName && cleanName.length > 2 && cleanName.split(' ').length <= 4) {
                            const lowerName = cleanName.toLowerCase();
                            
                            if (!extractedSpeakers.has(lowerName)) {
                                extractedSpeakers.set(lowerName, cleanName);
                                speakerSessions.set(lowerName, []);
                            }
                            
                            speakerSessions.get(lowerName).push(session.rowKey);
                        }
                    }
                }
            }
        }
        
        // Create/update speakers
        const results = { created: 0, updated: 0, speakers: [] };
        
        for (const [lowerName, displayName] of extractedSpeakers) {
            const sessionIds = speakerSessions.get(lowerName) || [];
            
            if (existingSpeakers.has(lowerName)) {
                const existing = existingSpeakers.get(lowerName);
                const existingSessionIds = existing.sessionIds ? JSON.parse(existing.sessionIds) : [];
                const mergedSessionIds = [...new Set([...existingSessionIds, ...sessionIds])];
                
                existing.sessionIds = JSON.stringify(mergedSessionIds);
                await speakerClient.updateEntity(existing, "Replace");
                results.updated++;
                results.speakers.push({ name: displayName, action: 'updated', sessions: mergedSessionIds.length });
            } else {
                const speakerId = generateSpeakerId(displayName);
                const entity = {
                    partitionKey: "speaker",
                    rowKey: speakerId,
                    name: displayName,
                    title: '',
                    company: '',
                    bio: '',
                    headshotFile: '',
                    linkedin: '',
                    twitter: '',
                    sessionIds: JSON.stringify(sessionIds)
                };
                
                await speakerClient.createEntity(entity);
                results.created++;
                results.speakers.push({ name: displayName, action: 'created', sessions: sessionIds.length });
            }
        }
        
        return {
            status: 200,
            jsonBody: {
                message: "Speaker extraction completed",
                created: results.created,
                updated: results.updated,
                speakers: results.speakers
            }
        };
    } catch (error) {
        context.log("Error extracting speakers:", error);
        return {
            status: 500,
            jsonBody: { error: "Failed to extract speakers", details: error.message }
        };
    }
}

// Register routes
app.http("getSpeakers", {
    methods: ["GET"],
    authLevel: "anonymous",
    route: "speakers",
    handler: getSpeakers
});

app.http("getSpeaker", {
    methods: ["GET"],
    authLevel: "anonymous",
    route: "speakers/{id}",
    handler: getSpeaker
});

app.http("addSpeaker", {
    methods: ["POST"],
    authLevel: "anonymous",
    route: "speakers",
    handler: addSpeaker
});

app.http("updateSpeaker", {
    methods: ["PUT"],
    authLevel: "anonymous",
    route: "speakers/{id}",
    handler: updateSpeaker
});

app.http("deleteSpeaker", {
    methods: ["DELETE"],
    authLevel: "anonymous",
    route: "speakers/{id}",
    handler: deleteSpeaker
});

app.http("extractSpeakers", {
    methods: ["POST"],
    authLevel: "anonymous",
    route: "speakers/extract",
    handler: extractSpeakers
});

module.exports = {
    getSpeakers,
    getSpeaker,
    addSpeaker,
    updateSpeaker,
    deleteSpeaker,
    extractSpeakers
};
