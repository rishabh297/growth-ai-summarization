const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises;

const fetchFn = global.fetch ? (...args) => global.fetch(...args) : (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const app = express();

app.use(cors());
app.use(express.json());

const DEFAULT_DEPLOYMENT = process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4.1';
const DEFAULT_API_VERSION = process.env.AZURE_OPENAI_API_VERSION || '2024-10-21';

const SUMMARY_BASE_DIR = path.join(__dirname, 'data');

// Get the directory and file path for a specific author
const getAuthorPaths = (author) => {
  const safeAuthor = (author || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');
  const authorDir = path.join(SUMMARY_BASE_DIR, safeAuthor);
  const summaryFile = path.join(authorDir, 'patient_summaries.json');
  return { authorDir, summaryFile, safeAuthor };
};

const ensureAuthorStore = async (author) => {
  const { authorDir, summaryFile } = getAuthorPaths(author);
  await fs.mkdir(authorDir, { recursive: true });
  try {
    await fs.access(summaryFile);
  } catch (error) {
    if (error.code === 'ENOENT') {
      await fs.writeFile(summaryFile, JSON.stringify({}, null, 2), 'utf-8');
    } else {
      throw error;
    }
  }
  return { authorDir, summaryFile };
};

const readSummariesFromDisk = async (author) => {
  const { summaryFile } = getAuthorPaths(author);
  try {
    const contents = await fs.readFile(summaryFile, 'utf-8');
    return contents ? JSON.parse(contents) : {};
  } catch (error) {
    if (error.code === 'ENOENT') {
      await ensureAuthorStore(author);
      return {};
    }
    throw error;
  }
};

const writeSummariesToDisk = async (summaries, author) => {
  await ensureAuthorStore(author);
  const { summaryFile } = getAuthorPaths(author);
  await fs.writeFile(summaryFile, JSON.stringify(summaries, null, 2), 'utf-8');
};

// Search for a patient summary across all author folders
const findPatientSummary = async (patientId) => {
  try {
    const authors = await fs.readdir(SUMMARY_BASE_DIR);
    for (const author of authors) {
      const authorPath = path.join(SUMMARY_BASE_DIR, author);
      const stat = await fs.stat(authorPath);
      if (stat.isDirectory()) {
        const summaryFile = path.join(authorPath, 'patient_summaries.json');
        try {
          const contents = await fs.readFile(summaryFile, 'utf-8');
          const summaries = JSON.parse(contents);
          if (summaries[patientId]) {
            return { ...summaries[patientId], foundInAuthorFolder: author };
          }
        } catch (e) {
          // File doesn't exist or can't be read, continue
        }
      }
    }
    return null;
  } catch (error) {
    return null;
  }
};

// Ensure base directory exists
fs.mkdir(SUMMARY_BASE_DIR, { recursive: true }).catch((error) => {
  console.error('Failed to initialize summary store:', error);
});

const buildAzureUrl = (deploymentId, apiVersion) => {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  if (!endpoint) {
    throw new Error('AZURE_OPENAI_ENDPOINT is not set.');
  }
  const base = endpoint.endsWith('/') ? endpoint.slice(0, -1) : endpoint;
  return `${base}/openai/deployments/${deploymentId}/chat/completions?api-version=${apiVersion}`;
};

const buildMessages = (prompt, systemPrompt, messages) => {
  if (messages && Array.isArray(messages) && messages.length > 0) {
    return messages;
  }

  const result = [];
  if (systemPrompt) {
    result.push({ role: 'system', content: systemPrompt });
  }
  result.push({ role: 'user', content: prompt });
  return result;
};

app.post('/api/azure/chat', async (req, res) => {
  const {
    prompt,
    systemPrompt,
    messages,
    temperature,
    maxTokens,
    deploymentId,
    apiVersion,
    responseFormat
  } = req.body || {};

  if (!prompt && (!messages || messages.length === 0)) {
    return res.status(400).json({ error: 'Either prompt or messages must be provided.' });
  }

  const apiKey = process.env.AZURE_OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'AZURE_OPENAI_API_KEY is not set on the server.' });
  }

  try {
    const deploymentToUse = deploymentId || DEFAULT_DEPLOYMENT;
    const versionToUse = apiVersion || DEFAULT_API_VERSION;
    const azureUrl = buildAzureUrl(deploymentToUse, versionToUse);

    const payload = {
      messages: buildMessages(prompt, systemPrompt, messages),
    };

    if (typeof temperature === 'number') {
      payload.temperature = temperature;
    }

    if (typeof maxTokens === 'number') {
      payload.max_tokens = maxTokens;
    }

    if (responseFormat) {
      payload.response_format = responseFormat;
    }

    const azureResponse = await fetchFn(azureUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': apiKey
      },
      body: JSON.stringify(payload)
    });

    if (!azureResponse.ok) {
      const errorText = await azureResponse.text();
      return res.status(azureResponse.status).json({
        error: 'Azure OpenAI request failed.',
        details: errorText
      });
    }

    const data = await azureResponse.json();
    const messageContent = data?.choices?.[0]?.message?.content ?? '';

    return res.json({
      message: messageContent,
      usage: data?.usage,
      raw: data
    });
  } catch (error) {
    console.error('Azure proxy error:', error);
    return res.status(500).json({
      error: 'Failed to complete Azure OpenAI request.',
      details: error.message
    });
  }
});

app.get('/api/patient-summaries/:patientId', async (req, res) => {
  const { patientId } = req.params;
  const { author } = req.query; // Optional: search in specific author's folder
  
  try {
    if (author) {
      // Search in specific author's folder
      const summaries = await readSummariesFromDisk(author);
    const entry = summaries[patientId];
    if (!entry) {
      return res.status(404).json({ message: 'No saved summary for this patient.' });
    }
    return res.json(entry);
    } else {
      // Search across all author folders
      const entry = await findPatientSummary(patientId);
      if (!entry) {
        return res.status(404).json({ message: 'No saved summary for this patient.' });
      }
      return res.json(entry);
    }
  } catch (error) {
    console.error('Failed to read patient summary:', error);
    return res.status(500).json({
      error: 'Failed to read patient summary.',
      details: error.message
    });
  }
});

app.post('/api/patient-summaries', async (req, res) => {
  const { patientId, summary, visitCount, visitsIncluded, author, timeToComplete, savedAt } = req.body || {};

  if (!patientId || typeof summary !== 'string') {
    return res.status(400).json({ error: 'patientId and summary text are required.' });
  }

  const authorName = author || 'unknown';

  try {
    const summaries = await readSummariesFromDisk(authorName);
    const normalizedVisitCount = Number.isFinite(Number(visitCount)) && Number(visitCount) > 0
      ? Number(visitCount)
      : null;
    const { safeAuthor } = getAuthorPaths(authorName);
    const payload = {
      patientId,
      summary,
      visitCount: normalizedVisitCount,
      visitsIncluded: Array.isArray(visitsIncluded) ? visitsIncluded : [],
      author: authorName,
      timeToComplete: timeToComplete || null,
      savedAt: savedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    summaries[patientId] = payload;
    await writeSummariesToDisk(summaries, authorName);

    return res.status(201).json({ ...payload, savedToFolder: `server/data/${safeAuthor}/` });
  } catch (error) {
    console.error('Failed to persist patient summary:', error);
    return res.status(500).json({
      error: 'Failed to save patient summary.',
      details: error.message
    });
  }
});

const PORT = process.env.PORT || 3002;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Azure OpenAI proxy listening on port ${PORT}`);
  });
}

module.exports = app;
