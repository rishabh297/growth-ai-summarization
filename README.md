# Patient Journey Dashboard

A comprehensive React-based dashboard for visualizing pediatric patient data, including growth charts, visit timelines, diagnosis insights, and physician summary tools.

## Overview

This tool was developed at the Zak Lab (Harvard) to help physicians efficiently review patient histories and generate clinical summaries. It provides:

- **Visit Timeline** - Chronological view of patient encounters with diagnoses, medications, and problems
- **Growth Charts** - Weight, height, and BMI tracking with CDC percentile curves
- **Diagnosis Insights** - ICD-10 code lookup, diagnosis frequency analysis, and activity timelines
- **Medication Tracking** - Medication coverage timelines and categorization
- **Lab Results** - Lab trends, results tables, and reference range comparisons
- **Problems List** - Active vs. resolved problem tracking with resolution status
- **Physician Summary** - AI-assisted summary generation with dictation support

## Tech Stack

- **Frontend**: React 18, Tailwind CSS, Recharts, Headless UI
- **Backend**: Node.js, Express
- **Data Processing**: Papa Parse (CSV), XLSX (Excel)
- **Charts**: Recharts with CDC growth percentile data

## Prerequisites

- Node.js v18+
- npm or yarn

## Installation

```bash
# Clone the repository
git clone <repository-url>
cd "P3 Project"

# Install dependencies
npm install
```

## Running the Application

### Start Both Servers

```bash
# Terminal 1: Start the API server (port 3002)
node server/index.js

# Terminal 2: Start the React dev server (port 3001)
PORT=3001 npm start
```

Or use the combined command:
```bash
npm run dev
```

### Access the Application

- **Frontend**: http://localhost:3001
- **API Server**: http://localhost:3002

## Data Requirements

The application expects patient data in CSV format. Place your data files in the `public/` directory:

### Required Files

| File | Description |
|------|-------------|
| `combined_visits_aggregated.csv` | Main patient visit data with diagnoses, medications, labs |

### CSV Structure

The main CSV should include columns for:
- Patient ID, demographics (DOB, sex)
- Visit information (date, encounter type, age at visit)
- Diagnoses (ICD-10 codes)
- Medications (name, start/end dates)
- Lab results (test name, value, units, reference range)
- Vitals (height, weight)
- Referrals

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3001 | React dev server port |
| `REACT_APP_API_URL` | http://localhost:3002 | API server URL |

### Proxy Configuration

The React dev server proxies API requests to the backend. This is configured in `package.json`:
```json
{
  "proxy": "http://localhost:3002"
}
```

## Features

### Visit Timeline
- Sort by newest/oldest first
- Limit display to last 10, 25, 50, or all visits
- Click visits to see detailed view with diagnoses, medications, labs
- ICD code tooltips with descriptions

### Growth Charts
- Weight, height, and BMI over time
- CDC percentile curves (3rd, 10th, 25th, 50th, 75th, 90th, 97th)
- Sex-specific percentile data
- Combined infant (0-36 months) and child (2-20 years) data

### Diagnosis & Medication Alignment
- Visual timeline showing diagnosis occurrences
- Medication coverage periods
- Lab activity markers
- Unified age-based timeline

### Physician Summary
- Free-text summary input with auto-save
- Voice dictation support (Web Speech API)
- Timer tracking for summary completion time
- Per-user summary storage

## Project Structure

```
P3 Project/
├── public/
│   ├── combined_visits_aggregated.csv  # Patient data (gitignored)
│   ├── icd10_codes.json                # ICD-10 code descriptions
│   ├── growth_percentiles.json         # CDC growth chart data
│   └── section111validicd*.xlsx        # ICD validation files
├── server/
│   ├── index.js                        # Express API server
│   └── data/                           # User summaries (gitignored)
├── src/
│   ├── App.js                          # Main app component
│   ├── components/
│   │   └── PatientDataProcessor.js     # Main dashboard component
│   └── utils/
│       └── icdLookup.js                # ICD code lookup utilities
└── package.json
```

## Privacy & Security

⚠️ **Important**: This application handles sensitive patient data (PHI).

- All patient data files are excluded from git via `.gitignore`
- Patient summaries are stored locally per-user
- Never commit CSV files, patient IDs, or summary data to version control

### Files Excluded from Git
- `server/data/` - Patient summaries
- `P3 Project Data/` - Raw patient data
- `combined_visits_aggregated*.csv` - Processed visit data
- `patient_ids*.txt` - Patient ID lists

## Sharing via ngrok

To share the application externally:

```bash
# Start with host check disabled
DANGEROUSLY_DISABLE_HOST_CHECK=true PORT=3001 npm start

# In another terminal, create tunnel
ngrok http 3001
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Ensure no patient data is included in commits
5. Submit a pull request

## License

This project is for research purposes at Harvard Zak Lab.

## Contact

For questions about this tool, contact the Zak Lab research team.

