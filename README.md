# DigitalSofts AI Employee

A Vercel-ready **Next.js** studio where nine AI employees collaborate on your idea — live, step by step — and deliver a downloadable, production-oriented project.

**Repo:** [AhtishamHussain/Ai-Agent](https://github.com/AhtishamHussain/Ai-Agent)

## Agent team

CEO → Research → Product Manager → CTO → Engineer → Reviewer → QA → DevOps → Marketing

Agents share a transcript, stream professional responses, and the Engineer emits multi-file code (with a Reviewer fix pass). On free API tiers, some agents are lightly skipped to stay within rate limits.

## Features

- Live agent collaboration (SSE streaming)
- Multi-file project generation
- Download project as ZIP
- Free Gemini provider by default (also supports OpenRouter, Cerebras, Groq, OpenAI)

## Requirements

- Node.js **18+**
- A free **Gemini** API key from [Google AI Studio](https://aistudio.google.com/apikey)

## Environment

Copy the example env file and add your key:

```bash
cp .env.example .env.local
```

`.env.local` example:

```
LLM_PROVIDER=gemini
GEMINI_API_KEY=your_key_here
GEMINI_MODEL=gemini-2.0-flash-lite
```

Never commit `.env.local` or real API keys.

## Deploy on Vercel

1. Import this GitHub repo in [Vercel](https://vercel.com/new).
2. Add environment variables:
   - `GEMINI_API_KEY`
   - `LLM_PROVIDER=gemini`
   - `GEMINI_MODEL=gemini-2.0-flash-lite` (optional)
3. Deploy.

## How to use

1. Enter a clear product idea.
2. Click **Run team** (or Ctrl/Cmd+Enter).
3. Watch each agent think and reply in **Live collaboration**.
4. Inspect files in **Project files**.
5. Click **Download ZIP** when complete.

## Notes

- Generated apps are **not** executed on the server (Vercel cannot spawn long-lived app processes). Download and run the ZIP yourself.
- Free Gemini has rate limits (HTTP 429). Wait a minute and retry, or use `gemini-2.0-flash-lite`.

---

## How to run

### 1. Clone the repository

```bash
git clone https://github.com/AhtishamHussain/Ai-Agent.git
cd Ai-Agent
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment

```bash
cp .env.example .env.local
```

Edit `.env.local` and set your free Gemini key:

```
LLM_PROVIDER=gemini
GEMINI_API_KEY=your_key_here
GEMINI_MODEL=gemini-2.0-flash-lite
```

Get a key: https://aistudio.google.com/apikey

### 4. Start development server

```bash
npm run dev
```

Open: [http://localhost:3000](http://localhost:3000)

### 5. Production build (optional)

```bash
npm run build
npm start
```

### Useful commands

| Command | Description |
|---------|-------------|
| `npm install` | Install dependencies |
| `npm run dev` | Run local app at http://localhost:3000 |
| `npm run build` | Create production build |
| `npm start` | Serve production build |
| `npm run lint` | Run ESLint |
