# Azure OpenAI GPT-4.1 Integration

This project now routes LLM requests through an Express proxy that calls Azure OpenAI. Follow these steps to run it locally.

## 1. Configure Environment Variables

Obtain your key and endpoint from your API Key Manager, then set the following before starting the proxy (for macOS/Linux shells):

```sh
export AZURE_OPENAI_ENDPOINT="http://azure-ai.hms.edu"
export AZURE_OPENAI_API_KEY="<your key here>"
export AZURE_OPENAI_DEPLOYMENT="gpt-4.1"        # optional, defaults to gpt-4.1
export AZURE_OPENAI_API_VERSION="2024-10-21"    # optional
```

On Windows PowerShell:

```powershell
$Env:AZURE_OPENAI_ENDPOINT = "http://azure-ai.hms.edu"
$Env:AZURE_OPENAI_API_KEY = "<your key here>"
$Env:AZURE_OPENAI_DEPLOYMENT = "gpt-4.1"
$Env:AZURE_OPENAI_API_VERSION = "2024-10-21"
```

Keep the API key out of the frontend; never check it into source control.

## 2. Start the Azure proxy server

In one terminal:

```sh
npm run server
```

The proxy listens on `http://localhost:3001` and exposes `POST /api/azure/chat`.

## 3. Run the React app

In a second terminal (after installing dependencies as usual):

```sh
npm start
```

Create React App will forward `/api/azure/*` requests to the proxy because `package.json` now specifies the proxy target.

## 4. Customising requests

The frontend sends `prompt`, `systemPrompt`, `temperature`, and `maxTokens` when calling the proxy. You can override the deployment or API version per-request by including `deploymentId` or `apiVersion` in the JSON payload if needed.
