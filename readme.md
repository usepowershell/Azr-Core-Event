# Azure Core Underground 2026

A community conference website for Azure infrastructure professionals, featuring dynamic schedule management, YouTube video integration, and speaker profiles.

**Live Site:** <https://lemon-beach-0a645ad0f.4.azurestaticapps.net>

## Features

### Public Website (index.html)

#### Hero & Navigation

- Conference branding and tagline
- Quick navigation to About, Schedule, Speakers, and Sponsors sections

#### Video Player Section

- **Embedded YouTube Player** - Automatically loads and plays the current session
- **Live Stream Detection** - Shows "LIVE" badge when stream is broadcasting
- **Now Playing Info Box** - Displays current session title, description, and YouTube link
- **Up Next Box** - Shows the next scheduled session with live countdown timer
- **Live Chat Button** - Opens YouTube live chat in a popup window during streams

#### Dynamic Schedule

- Fetches sessions from Azure Table Storage API
- Groups sessions by day with date headers
- Clickable session cards open detailed modal with:
  - Session time and date
  - Full title and description (with clickable links)
  - Direct YouTube link

#### Featured Speakers Section

- Dynamically loads speakers from API
- Speaker cards with avatar (headshot or initials), name, title, and company
- Hover effect with subtle lift animation
- **Speaker Modal Popup** on click showing:
  - Large avatar/headshot
  - Name, title, and company
  - Social links (Twitter/X, LinkedIn, GitHub, Website)
  - Full biography with clickable links
  - List of their sessions (clickable to open session details)

#### Additional Sections

- **About** - Event description and target audience with feature cards
- **Sponsors** - Sponsor logos grid
- **Code of Conduct** - Modal with community guidelines
- **Footer** - Event info and links

#### Accessibility & UX

- Keyboard navigation (Escape to close modals)
- Click outside modal to close
- Responsive design for all screen sizes
- Loading states for async content

---

### Admin Dashboard (admin.html)

**Authentication:** Requires Azure AD login (configured in staticwebapp.config.json)

#### Schedule Management

- **View All Sessions** - Table with title, video ID, date/time, duration, and actions
- **Add Session** - Form with video ID, title, description, start time, and duration
- **Edit Session** - Inline editing of any session field
- **Delete Session** - Single delete with confirmation
- **Multi-Select Delete** - Checkbox selection for bulk deletion

#### CSV Export/Import

- **Export to CSV** - Downloads schedule as RFC 4180 compliant CSV
  - Excel formula protection (prefixes dangerous characters with single quote)
  - Handles multi-line descriptions and special characters
- **Import from CSV** - Upload CSV to create/update sessions
  - Creates new sessions or updates existing (by sessionId)
  - Validates required columns (videoId, title, startTime)
  - Reports success/error counts

#### Navigation

- Link to Speakers Admin
- Return to main site

---

### Speakers Admin (speakers-admin.html)

**Authentication:** Requires Azure AD login

#### Speaker Management

- **View All Speakers** - Card grid with avatar, name, title, company, and social links
- **Add Speaker** - Form with:
  - Name, title, company
  - Biography (multi-line)
  - Headshot filename (for `/images/speakers/` folder)
  - Social links (LinkedIn, Twitter)
  - Session IDs (comma-separated)
- **Edit Speaker** - Full editing of all fields
- **Delete Speaker** - With confirmation
- **Headshot Preview** - Shows image preview when filename is entered

#### Extract Speakers

- **Auto-Extract from Schedule** - Parses session descriptions for "Speaker:" patterns
- Automatically creates speaker entries with linked sessions
- Updates existing speakers with new session links
- Reports created/updated counts

---

## Architecture

### Azure Resources

| Resource | Type | Purpose |
|----------|------|---------|
| `lemon-beach-0a645ad0f` | Azure Static Web App (Standard) | Hosts frontend HTML/CSS/JS |
| `azcoreunderground-api` | Azure Function App (Node.js 20) | REST API backend |
| `azcorestorage2026` | Azure Storage Account | Table Storage for data |
| `rg-AzureCoreUnderground` | Resource Group | Contains all resources |

### Data Storage (Azure Table Storage)

#### VideoSchedule Table

| Field | Type | Description |
|-------|------|-------------|
| partitionKey | string | Date (YYYY-MM-DD) |
| rowKey | string | Session ID (sess_*) |
| videoId | string | YouTube video ID |
| title | string | Session title |
| description | string | Full description |
| url | string | YouTube URL |
| startTime | string | ISO 8601 datetime |
| duration | number | Duration in minutes |

#### Speakers Table

| Field | Type | Description |
|-------|------|-------------|
| partitionKey | string | "speaker" |
| rowKey | string | Speaker ID (name-slug) |
| name | string | Display name |
| title | string | Job title |
| company | string | Company name |
| bio | string | Biography |
| headshotFile | string | Image filename |
| linkedin | string | LinkedIn URL |
| twitter | string | Twitter/X URL |
| sessionIds | JSON string | Array of session IDs |

### Security

- **Managed Identity** - Function App uses system-assigned managed identity for Table Storage access (no connection strings)
- **Azure AD Authentication** - Admin pages require authenticated users
- **No Public Blob Access** - Storage account has `allowBlobPublicAccess: false`
- **Static Headshots** - Speaker images stored in `/images/speakers/` folder in repo
- **Security Headers** - X-Content-Type-Options, X-Frame-Options configured

---

## API Endpoints

### Schedule API (`/api/schedule`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/schedule` | Anonymous | Get all sessions |
| GET | `/api/schedule?format=csv` | Anonymous | Export as CSV |
| POST | `/api/schedule` | Authenticated | Add new session |
| POST | `/api/schedule?action=import` | Authenticated | Import from CSV |
| PUT | `/api/schedule/{id}` | Authenticated | Update session |
| DELETE | `/api/schedule/{id}` | Authenticated | Delete session |

### Speakers API (`/api/speakers`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/speakers` | Anonymous | Get all speakers |
| GET | `/api/speakers/{id}` | Anonymous | Get single speaker |
| POST | `/api/speakers` | Authenticated | Add new speaker |
| POST | `/api/speakers/extract` | Authenticated | Extract from schedule |
| PUT | `/api/speakers/{id}` | Authenticated | Update speaker |
| DELETE | `/api/speakers/{id}` | Authenticated | Delete speaker |

---

## CI/CD

### GitHub Actions Workflow

**Trigger:** Push to `main` branch (paths: `api/**`) or manual dispatch

**Steps:**

1. Checkout repository
2. Setup Node.js 20.x
3. Install production dependencies only (`npm install --omit=dev`)
4. Login to Azure via OIDC (federated credentials)
5. Restart Function App (clears disk space)
6. Deploy to Azure Functions

**File:** `.github/workflows/azure-functions-deploy.yml`

---

## Local Development

### Prerequisites

- Node.js 20.x
- Azure CLI (logged in)
- Azure Functions Core Tools

### Running the API Locally

```bash
cd api
npm install
func start
```

### Environment Variables

- `STORAGE_ACCOUNT_NAME` - Azure Storage account name (default: `azcorestorage2026`)

---

## File Structure

```
├── index.html              # Main public website
├── admin.html              # Schedule admin dashboard
├── speakers-admin.html     # Speakers admin dashboard
├── styles.css              # All CSS styles
├── staticwebapp.config.json # SWA routing and auth config
├── readme.md               # This file
├── api/
│   ├── package.json        # Node.js dependencies
│   ├── host.json           # Functions host config
│   └── src/functions/
│       ├── schedule.js     # Schedule CRUD + CSV import/export
│       └── speakers.js     # Speakers CRUD + extract
├── assets/
│   └── Loading-Schedule.png # Placeholder image
├── images/
│   └── speakers/           # Speaker headshot images
└── .github/workflows/
    └── azure-functions-deploy.yml # CI/CD pipeline
```

---

## Technologies

- **Frontend:** HTML5, CSS3, Vanilla JavaScript
- **Backend:** Azure Functions (Node.js 20, v4 programming model)
- **Database:** Azure Table Storage
- **Hosting:** Azure Static Web Apps (Standard tier)
- **Authentication:** Azure AD / Microsoft Entra ID
- **CI/CD:** GitHub Actions with OIDC
- **Video:** YouTube IFrame API
