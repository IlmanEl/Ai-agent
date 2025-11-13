# CLAUDE.md - AI Assistant Guide

## Project Overview

**Project Name:** ai-agent-referendum
**Version:** 1.0.0
**Purpose:** Telegram bot agent for automated campaign outreach with AI-powered responses and human oversight

This is a Node.js application that:
- Manages outbound Telegram conversations with campaign leads
- Uses GPT-4o-mini with RAG (Retrieval Augmented Generation) for context-aware AI responses
- Provides a control bot interface for human admin oversight and message approval
- Tracks campaign statuses and lead progression through Supabase
- Implements typing indicators and natural conversation delays for human-like interaction

---

## Codebase Structure

```
/home/user/Ai-agent/
├── index.js                       # Main entry point - event listener and orchestration
├── package.json                   # Dependencies and project metadata
├── package-lock.json              # Locked dependency versions
├── .gitignore                     # Git ignore patterns
│
├── src/
│   ├── config/
│   │   └── env.js                # Environment config with Joi validation
│   │
│   ├── modules/                   # Core functionality modules
│   │   ├── auth.js              # Telegram session authentication
│   │   ├── db.js                # Supabase client and agent data
│   │   ├── send.js              # Message sending with delays/typing
│   │   ├── aiAgent.js           # AI response generation with RAG
│   │   └── controlBot.js        # Admin control bot for message review
│   │
│   ├── services/                  # Business logic services
│   │   ├── dialog.js            # Dialog orchestration
│   │   ├── dialogState.js       # Local JSON state management
│   │   └── campaignManager.js   # Campaign and lead management
│   │
│   └── utils/
│       └── logger.js            # Winston logger configuration
│
├── scripts/                       # Utility scripts
│   ├── addTestLead.js           # Create test campaign data
│   └── embedKnowledge.js        # Embed knowledge base for RAG
│
└── knowledge/
    └── referendum.txt           # Knowledge base content

Generated Files (gitignored):
├── .env                         # Environment variables
├── app.log                      # Application logs
├── control_state.json           # Control bot state
└── dialog_state.json            # Dialog history storage
```

---

## Technology Stack

| Technology | Version | Purpose |
|------------|---------|---------|
| **Node.js** | ESM modules | Runtime environment |
| **Telegram** | ^2.25.8 | Telegram API client library |
| **OpenAI** | ^4.57.0 | LLM API (GPT-4o-mini) |
| **Supabase** | ^2.45.4 | PostgreSQL + Vector DB for RAG |
| **Joi** | ^17.13.3 | Schema validation |
| **Winston** | ^3.14.2 | Structured logging |
| **dotenv** | ^16.4.5 | Environment configuration |

**Module System:** ES Modules (`"type": "module"`)
**Architecture Pattern:** Event-driven with modular service layers

---

## Key Application Flow

### Startup Sequence (index.js)

1. Load and validate environment variables
2. Initialize Telegram client with agent session from Supabase
3. Load agent data (prompts, persona, opener text)
4. Start control bot listener (admin interface)
5. Fetch active dialogs from database
6. Check for new leads and send opener message if available
7. Begin listening for incoming Telegram messages

### Message Handling Flow

```
Incoming Message → Mark as Read → Check Handover Status
                                          ↓
                                   Get Dialog State
                                          ↓
                               Generate AI Reply (with RAG)
                                          ↓
                                  Check Handover Intent
                                          ↓
                    ┌─────────────────────┴──────────────────────┐
                    ↓                                             ↓
            Handover Needed                               Direct Reply
                    ↓                                             ↓
        Send to Control Bot                          Send to User
        Update Status: PENDING_HANDOVER              Update History
        Update Lead: HANDOVER                        Update Lead: REPLIED
```

### Control Bot Flow

```
Admin Receives Notification → Review Message
                                    ↓
              ┌─────────────────────┼─────────────────────┐
              ↓                     ↓                     ↓
          Approve                 Edit                Reject
              ↓                     ↓                     ↓
      Send to User          Modify & Send          Discard Message
      Reset Status          Reset Status           Keep PENDING
```

---

## Database Schema (Supabase)

### ai_agents table
```javascript
{
  id: UUID,                      // Primary key
  agent_name: string,            // Display name
  tg_session_string: string,     // Telegram auth session
  initial_opener_text: string,   // First contact message
  client_id: UUID,               // For RAG filtering
  core_system_prompt: string,    // System instructions for AI
  agent_persona: string          // Agent character definition
}
```

**Current Agent UUID:** `8435c742-1f1e-4e72-a33b-2221985e9f83` (hardcoded in index.js:20)

### campaigns table
```javascript
{
  id: UUID,
  client_id: UUID,
  name: string,
  status: 'ACTIVE' | 'PAUSED' | 'COMPLETED'
}
```

### leads table
```javascript
{
  id: UUID,
  campaign_id: UUID,
  username: string,              // Telegram username (without @)
  channel_name: string,
  status: 'NEW' | 'CONTACTED' | 'REPLIED' | 'HANDOVER',
  assigned_agent_id: UUID,
  first_contact_at: timestamp,
  last_contact_at: timestamp,
  metadata: jsonb
}
```

### knowledge_base table (RAG)
```javascript
{
  id: UUID,
  client_id: UUID,              // For filtering by client
  content: string,              // Text chunk (~500 chars)
  embedding: vector(1536),      // OpenAI embedding
  source: string,               // Source document identifier
  created_at: timestamp
}
```

**Vector Search RPC Function:**
```sql
match_knowledge(query_embedding, match_threshold, match_count, client_id)
```

### Local State Files

**dialog_state.json** - Conversation history and status
```javascript
{
  "{agent_id}_{username}": {
    history: [
      { role: 'user', content: '...' },
      { role: 'assistant', content: '...' }
    ],
    status: 'ACTIVE' | 'PENDING_HANDOVER' | 'NEW',
    pending_reply: string,        // Message awaiting approval
    targetUsername: string,
    lastUpdate: timestamp
  }
}
```

---

## Environment Configuration

### Required Environment Variables (.env)

```bash
# Telegram Agent Configuration
TG_API_ID=<number>              # From https://my.telegram.org
TG_API_HASH=<string>            # From https://my.telegram.org
TG_PHONE=<string>               # Agent's phone number
TG_SESSION=<string>             # Optional: pre-existing session

# OpenAI Configuration
OPENAI_API_KEY=<string>         # OpenAI API key

# Supabase Configuration
SUPABASE_URL=<string>           # Supabase project URL
SUPABASE_KEY=<string>           # Supabase service key

# Control Bot (Admin Interface)
CONTROL_BOT_TOKEN=<string>      # From @BotFather
CONTROL_SECRET_KEY=<string>     # Security key
CONTROL_ADMIN_ID=<number>       # Admin's Telegram user ID
```

### Validation

All environment variables are validated using Joi schema on startup (src/config/env.js:8-26).
Application will exit with error if validation fails.

### Hardcoded Configuration

- **Agent UUID:** `8435c742-1f1e-4e72-a33b-2221985e9f83` (index.js:20)
- **Test Target:** `@ilmanEl` (src/config/env.js:50)
- **AI Model:** `gpt-5-mini` (src/config/env.js:37) - Note: This appears to be a typo, likely should be `gpt-4o-mini`
- **Rate Limits:** 1000-3000ms reply delay (src/config/env.js:51-54)

---

## Key Modules Explained

### 1. index.js (Main Entry Point)
**Lines:** 167
**Purpose:** Application orchestration and event handling

**Key Responsibilities:**
- Initialize Telegram client
- Load agent data from Supabase
- Start control bot listener
- Handle incoming message events
- Coordinate with AI agent and campaign manager
- Manage handover workflow

**Important Constants:**
- Line 20: `CURRENT_AGENT_UUID` - Change this to switch agents

### 2. src/modules/aiAgent.js (AI Response Generation)
**Purpose:** Generate AI responses using GPT-4o-mini with RAG

**Key Functions:**
- `generateAIReply(history, agentData, openaiKey)` - Main function
- RAG: Fetches relevant knowledge from Supabase vector DB
- Intent detection: Determines if handover is needed
- Returns: `{ agentReply, handoverIntent }`

**Handover Intents:**
- `POSITIVE_CLOSE` - User is ready to proceed (positive engagement)
- `AI_FAILURE` - AI cannot handle the request
- `null` - Continue normal conversation

### 3. src/modules/controlBot.js (Admin Control Interface)
**Lines:** 203
**Purpose:** Telegram bot for human oversight

**Key Functions:**
- `startControlBotListener(deps)` - Long polling listener
- `sendHandoverNotification(data)` - Send message for review
- Inline keyboard with buttons: Approve, Edit, Reject

**State Management:**
- Uses `control_state.json` for polling offset
- Integrates with `dialogState.js` for conversation state

### 4. src/services/campaignManager.js (Lead Management)
**Purpose:** Track campaign progress and lead status

**Key Functions:**
- `getActiveDialogs(agentId)` - Fetch conversations in progress
- `getNextLead(agentId)` - Get next NEW lead for outreach
- `updateLeadStatus(campaignId, username, status)` - Update lead progression

**Status Progression:**
```
NEW → CONTACTED → REPLIED → HANDOVER
```

### 5. src/services/dialogState.js (State Persistence)
**Purpose:** Local JSON-based conversation history storage

**Key Functions:**
- `getDialogState(agentId, username)` - Retrieve conversation
- `updateDialogState(agentId, username, updates)` - Save changes
- `resetHandoverStatus(agentId, username)` - Clear pending state
- `getAllDialogs(agentId)` - Get all conversations

**Storage Key Format:** `{agentId}_{username}`

### 6. src/modules/send.js (Message Delivery)
**Purpose:** Send messages with human-like delays

**Features:**
- Random delay: 1000-3000ms (configurable)
- Typing indicator simulation
- Message type tracking (OUTGOING vs REPLY)

### 7. src/utils/logger.js (Logging)
**Purpose:** Winston-based structured logging

**Outputs:**
- Console: Colored, timestamped logs
- File: `app.log` (all levels)

**Levels:** error, warn, info, debug

---

## Common Development Tasks

### Adding a New Agent

1. **Create agent in Supabase:**
```sql
INSERT INTO ai_agents (id, agent_name, tg_session_string, initial_opener_text, client_id, core_system_prompt, agent_persona)
VALUES (
  gen_random_uuid(),
  'Agent Name',
  '', -- Will be filled after auth
  'Hello! I am...',
  '<client_uuid>',
  'You are...',
  'Professional, friendly...'
);
```

2. **Update index.js:20:**
```javascript
const CURRENT_AGENT_UUID = "<new_agent_uuid>";
```

3. **Authenticate Telegram session:**
- Remove old session from DB or set to empty string
- Run `node index.js` and follow authentication prompts
- Session will be saved to database automatically

### Adding Knowledge to RAG

1. **Add content to knowledge/referendum.txt** (or create new .txt file)

2. **Run embedding script:**
```bash
node scripts/embedKnowledge.js
```

3. **Script behavior:**
- Chunks text into ~500 character segments
- Generates embeddings using OpenAI
- Stores in `knowledge_base` table with `client_id`

4. **Verification:**
- Check Supabase `knowledge_base` table
- AI agent will automatically use new knowledge

### Creating Test Campaign

```bash
node scripts/addTestLead.js
```

**What it does:**
- Creates a test campaign in Supabase
- Adds a test lead with username `ilmanEl`
- Links to current agent UUID
- Status: `NEW` (ready for contact)

### Modifying AI Behavior

**Option 1: Update Agent Prompts in Database**
```sql
UPDATE ai_agents
SET
  core_system_prompt = 'New instructions...',
  agent_persona = 'New personality...'
WHERE id = '8435c742-1f1e-4e72-a33b-2221985e9f83';
```

**Option 2: Modify aiAgent.js Logic**
- Location: src/modules/aiAgent.js
- Edit prompt construction (lines vary)
- Update handover detection logic

**Option 3: Adjust Model/Parameters**
- Model: src/config/env.js:37
- Temperature/max_tokens: src/modules/aiAgent.js (in OpenAI API call)

### Changing Rate Limits

**Location:** src/config/env.js:51-54

```javascript
rateLimit: {
  replyDelayMinMs: 2000,  // Change minimum delay
  replyDelayMaxMs: 5000   // Change maximum delay
}
```

### Debugging

**Enable verbose logging:**
- Check `app.log` for full logs
- Console shows colored output
- Use `log.debug()` for additional info

**Common issues:**
- **"Не удалось загрузить данные агента"** - Check agent UUID exists in DB
- **Session errors** - Re-authenticate (clear session in DB)
- **API rate limits** - Adjust delays or check API quotas
- **Vector search fails** - Verify embeddings exist in knowledge_base

---

## Development Workflow

### Initial Setup

```bash
# 1. Clone repository
git clone <repo_url>
cd Ai-agent

# 2. Install dependencies
npm install

# 3. Create .env file
cat > .env << EOF
TG_API_ID=<your_value>
TG_API_HASH=<your_value>
TG_PHONE=<your_value>
OPENAI_API_KEY=<your_value>
SUPABASE_URL=<your_value>
SUPABASE_KEY=<your_value>
CONTROL_BOT_TOKEN=<your_value>
CONTROL_SECRET_KEY=<your_value>
CONTROL_ADMIN_ID=<your_value>
EOF

# 4. Create agent in Supabase (see above)

# 5. Run application
node index.js
```

### Git Workflow

**Current Branch:** `claude/claude-md-mhxvfyvwy447qo17-01LDLwRXgznvzveUNJ9mdHyd`

**Branch Naming Convention:**
- Feature branches: `claude/<description>-<session_id>`
- Must start with `claude/` and end with session ID
- Push failure (403) indicates incorrect branch name

**Commit Guidelines:**
- Descriptive messages in present tense
- Recent pattern: "Update <file>.js"
- Keep commits focused on single changes

### Testing

**No automated test framework currently exists.**

**Manual Testing Approach:**
1. Create test lead: `node scripts/addTestLead.js`
2. Run application: `node index.js`
3. Send test messages from test account
4. Monitor logs in console and `app.log`
5. Verify state in `dialog_state.json`
6. Test control bot approval/rejection flow

**Recommended Test Scenarios:**
- ✓ New lead outreach
- ✓ User reply handling
- ✓ AI response generation
- ✓ Handover triggering
- ✓ Control bot approval
- ✓ Control bot rejection
- ✓ Control bot edit
- ✓ RAG context retrieval
- ✓ Status updates in database

---

## Code Conventions

### Naming Conventions

**Variables:**
- camelCase: `agentData`, `userReply`, `targetUsername`
- Constants: UPPER_SNAKE_CASE: `CURRENT_AGENT_UUID`

**Functions:**
- camelCase: `sendMessage()`, `getDialogState()`
- Async functions: Always use `async/await` pattern

**Files:**
- camelCase: `aiAgent.js`, `dialogState.js`
- Configuration: lowercase: `env.js`, `logger.js`

### Code Style

**Imports:**
```javascript
// Named imports
import { function1, function2 } from './module.js';

// Default imports
import defaultExport from './module.js';

// Always include .js extension
```

**Error Handling:**
```javascript
// Log errors, don't throw in event handlers
try {
  await someOperation();
} catch (e) {
  log.error('Operation failed', e);
}
```

**Logging:**
```javascript
log.info('Message with context', { data });
log.warn('Warning message');
log.error('Error message', error);
```

### API Patterns

**Telegram API:**
```javascript
// Send message
await client.sendMessage(target, { message: text });

// Invoke API method
await client.invoke(new Api.messages.ReadHistory({ peer }));
```

**OpenAI API:**
```javascript
const response = await openai.chat.completions.create({
  model: 'gpt-4o-mini',
  messages: history,
  temperature: 0.7,
  max_tokens: 500
});
```

**Supabase:**
```javascript
// Query
const { data, error } = await supabase
  .from('table')
  .select('*')
  .eq('field', value);

// RPC function
const { data, error } = await supabase
  .rpc('function_name', { params });
```

---

## Important Constraints and Gotchas

### 1. Telegram Session Management
- Session string stored in database, not .env
- If session expires, must re-authenticate
- Authentication is interactive (requires code from Telegram)

### 2. Agent UUID Hardcoded
- **Line:** index.js:20
- Must update manually to switch agents
- Consider parameterizing in future (env variable or CLI arg)

### 3. Model Name Typo
- Config shows `gpt-5-mini` (src/config/env.js:37)
- Likely should be `gpt-4o-mini`
- Verify before making OpenAI API calls

### 4. State Management
- Dialog state is local JSON (not in database)
- Loss of `dialog_state.json` = loss of conversation history
- Control state in `control_state.json` (polling offset)
- Both files are gitignored

### 5. Rate Limiting
- Artificial delays: 1000-3000ms between messages
- No retry logic for Telegram API failures
- OpenAI API has its own rate limits

### 6. Error Handling
- Many errors are logged but not thrown
- Event handlers catch errors to prevent crashes
- Check logs for silent failures

### 7. Branch Naming for Git
- Must start with `claude/`
- Must end with session ID
- 403 error on push = incorrect branch name

### 8. Knowledge Base Filtering
- RAG uses `client_id` for filtering
- Ensure agent's `client_id` matches knowledge entries
- Similarity threshold hardcoded in aiAgent.js

### 9. Handover Logic
- Only triggers on specific intents
- Once PENDING_HANDOVER, bot ignores new user messages
- Must be reset via control bot action

### 10. Test Target Hardcoded
- `@ilmanEl` in src/config/env.js:50
- Always monitored regardless of campaign status
- Consider removing for production

---

## Security Considerations

### API Keys and Secrets
- All stored in `.env` file (gitignored)
- Never commit `.env` to version control
- Validate all required keys on startup

### Telegram Session
- Session string has full account access
- Stored in database (ensure DB security)
- Rotate sessions periodically

### Control Bot
- Uses `CONTROL_SECRET_KEY` for security
- `CONTROL_ADMIN_ID` restricts access
- Consider adding authentication for button callbacks

### Database Access
- Uses Supabase service key (full access)
- No row-level security in current implementation
- Consider adding RLS policies for multi-tenant use

### Input Validation
- User messages passed directly to AI
- No sanitization before storage
- Consider XSS protection if displaying in web UI

---

## Performance Considerations

### Bottlenecks
1. **OpenAI API Calls:** ~1-3s per request
2. **Vector Search:** Depends on knowledge base size
3. **Telegram Message Delays:** Artificial 1-3s delay

### Optimization Opportunities
1. **Cache AI Responses:** For common questions
2. **Parallel Processing:** Handle multiple dialogs concurrently
3. **Database Indexing:** Ensure indices on `username`, `status`, `campaign_id`
4. **Batch Operations:** Group database updates

### Scalability Notes
- Current architecture: Single agent, single process
- Multi-agent: Requires separate processes or worker pool
- Shared state: Move `dialog_state.json` to database
- High volume: Consider message queue (Redis, RabbitMQ)

---

## Future Improvements

### Recommended Enhancements

1. **Testing Framework**
   - Add Jest or Mocha for unit tests
   - Mock Telegram/OpenAI APIs
   - Integration tests for full flow

2. **Configuration Management**
   - Move hardcoded values to .env or config file
   - Support multiple agents via CLI args
   - Dynamic reload of agent configs

3. **State Management**
   - Migrate `dialog_state.json` to Supabase
   - Add conversation archiving
   - Implement state cleanup for old conversations

4. **Error Handling**
   - Add retry logic for API failures
   - Implement circuit breakers
   - Better error reporting to admin

5. **Monitoring**
   - Metrics collection (response times, success rates)
   - Alerting for failures
   - Dashboard for campaign progress

6. **Security**
   - Add rate limiting per user
   - Implement input sanitization
   - Add authentication for control bot callbacks
   - Row-level security in Supabase

7. **Features**
   - Multi-language support
   - Scheduled messages
   - A/B testing for opener messages
   - Analytics and reporting

---

## Key Files to Modify for Common Tasks

| Task | Files to Modify |
|------|----------------|
| **Change AI behavior** | src/modules/aiAgent.js, ai_agents table |
| **Modify message flow** | index.js (event handler), src/services/dialog.js |
| **Update database schema** | SQL migrations, src/modules/db.js |
| **Add new environment variable** | src/config/env.js (validation), .env |
| **Change logging** | src/utils/logger.js |
| **Modify control bot** | src/modules/controlBot.js |
| **Update campaign logic** | src/services/campaignManager.js |
| **Change message delays** | src/config/env.js, src/modules/send.js |
| **Add knowledge content** | knowledge/*.txt, run embedKnowledge.js |
| **Switch agents** | index.js:20 (CURRENT_AGENT_UUID) |

---

## Troubleshooting Guide

### Application Won't Start

**Error:** "Invalid required env"
- **Cause:** Missing or invalid environment variables
- **Fix:** Check .env file against required variables list
- **Verify:** src/config/env.js shows which variables failed validation

**Error:** "Не удалось загрузить данные агента"
- **Cause:** Agent UUID doesn't exist in database
- **Fix:**
  1. Check index.js:20 for correct UUID
  2. Verify agent exists in `ai_agents` table
  3. Ensure database connection is working

**Error:** "Session expired"
- **Cause:** Telegram session is invalid
- **Fix:**
  1. Set `tg_session_string` to empty in database
  2. Run `node index.js` and follow auth prompts
  3. New session will be saved automatically

### Messages Not Sending

**Symptom:** Bot doesn't respond to messages
- **Check:** Is username in `monitoredTargets` array?
- **Check:** Is dialog status `PENDING_HANDOVER`?
- **Check:** Logs in `app.log` for errors
- **Verify:** Telegram client is connected (check startup logs)

**Symptom:** AI generates reply but message not sent
- **Check:** src/modules/send.js logs
- **Check:** Telegram API rate limits
- **Verify:** Username format (must include @)

### Control Bot Issues

**Symptom:** No notifications received
- **Check:** CONTROL_BOT_TOKEN is valid
- **Check:** CONTROL_ADMIN_ID matches your Telegram ID
- **Check:** src/modules/controlBot.js logs
- **Verify:** Bot has permission to message you

**Symptom:** Buttons don't work
- **Check:** Control bot is running (startControlBotListener called)
- **Check:** Callback data format matches expected pattern
- **Check:** dialog_state.json has correct pending_reply

### RAG Not Working

**Symptom:** AI doesn't use knowledge base
- **Check:** knowledge_base table has entries
- **Check:** client_id matches between agent and knowledge
- **Check:** Similarity threshold in aiAgent.js
- **Verify:** Embeddings were generated correctly

**Fix:** Re-run embedding script
```bash
node scripts/embedKnowledge.js
```

### Database Errors

**Symptom:** "relation 'table_name' does not exist"
- **Cause:** Missing database table
- **Fix:** Run SQL migrations to create required tables

**Symptom:** "RPC function does not exist"
- **Cause:** Missing `match_knowledge` function
- **Fix:** Create vector search function in Supabase

---

## AI Assistant Guidelines

When working on this codebase, follow these guidelines:

### Do's
✓ Read relevant source files before making changes
✓ Test changes with `node scripts/addTestLead.js` and manual testing
✓ Check logs in `app.log` for debugging
✓ Update database queries carefully (Supabase)
✓ Maintain existing code style and conventions
✓ Document new features or complex logic
✓ Use async/await for all async operations
✓ Log important events with winston logger
✓ Consider impact on dialog state management
✓ Test both normal flow and handover flow

### Don'ts
✗ Don't commit `.env`, `*.log`, or `*_state.json` files
✗ Don't change agent UUID without updating database
✗ Don't remove error handling from event handlers
✗ Don't hardcode API keys or credentials
✗ Don't modify state files manually (use provided functions)
✗ Don't skip environment variable validation
✗ Don't use callbacks (prefer async/await)
✗ Don't throw errors in Telegram event handlers
✗ Don't forget `.js` extension in imports
✗ Don't push to branches not starting with `claude/`

### Before Making Changes
1. Understand the full message flow
2. Check if change affects dialog state
3. Consider impact on campaign status
4. Verify change doesn't break control bot
5. Test with both active and pending handover states

### After Making Changes
1. Test with test lead
2. Verify logs show expected behavior
3. Check dialog_state.json for correct updates
4. Confirm database updates (if applicable)
5. Test control bot flow (if affected)
6. Review error handling

---

## Quick Reference

### Start Application
```bash
node index.js
```

### Create Test Data
```bash
node scripts/addTestLead.js
```

### Embed Knowledge
```bash
node scripts/embedKnowledge.js
```

### View Logs
```bash
tail -f app.log
```

### Check State
```bash
cat dialog_state.json | jq
cat control_state.json | jq
```

### Git Operations
```bash
# Create and switch to claude branch
git checkout -b claude/<description>-<session_id>

# Commit changes
git add .
git commit -m "Description"

# Push to remote
git push -u origin claude/<branch_name>
```

---

## Resources

### Documentation
- Telegram API: https://core.telegram.org/api
- Telegram Library: https://gram.js.org/
- OpenAI API: https://platform.openai.com/docs
- Supabase Docs: https://supabase.com/docs
- Winston Logging: https://github.com/winstonjs/winston

### Internal Files
- Environment Config: src/config/env.js
- Main Flow: index.js
- AI Logic: src/modules/aiAgent.js
- Control Bot: src/modules/controlBot.js
- State Management: src/services/dialogState.js

### Support
- Check logs: `app.log`
- Review code comments (mixed English/Russian)
- Test with: `scripts/addTestLead.js`

---

## Summary

This is an event-driven Telegram bot agent that:
1. Sends initial messages to campaign leads
2. Uses AI (GPT-4o-mini) with RAG to respond intelligently
3. Detects when to hand over to human admin
4. Provides control bot interface for message approval
5. Tracks campaign progress in Supabase

**Key Principle:** The bot should feel human-like (delays, typing indicators) while maintaining AI efficiency.

**Architecture Highlight:** Hybrid state management (DB for campaigns/leads, JSON for dialog history) enables fast local access with persistent storage.

**Human in the Loop:** Control bot ensures quality before critical messages are sent, maintaining reputation and relationship quality.

---

*Last Updated: 2025-11-13*
*Repository: /home/user/Ai-agent*
*Version: 1.0.0*
