# Website Code Generator — Bot specification

**Archetype:** custom

**Voice:** professional and approachable — write every user-facing message, button label, error, and empty state in this voice.

A Telegram bot that generates website code projects from user-provided form inputs, delivering a downloadable ZIP with HTML/CSS/JS files or full-stack templates. Targets beginners needing static sites, designers wanting responsive templates, and developers requiring backend scaffolding. Uses a structured form flow with confirmation before generation.

> This is the complete contract for the bot. Implement EVERY entry point, flow, feature, integration, and edge case below. The completeness review checks the bot against this document after each build pass.

## Primary audience

- Beginners
- Designers
- Developers

## Success criteria

- User receives a downloadable ZIP containing generated project files
- Support for regenerating or tweaking projects with confirmed changes

## Entry points

Every feature must be reachable from the bot's command/button surface (button-first; only /start and /help are slash commands).

- **/start** (command, actor: user, command: /start) — Open main menu with instructions and 'Create site' button
- **Create site** (button, actor: user, callback: project:create) — Initiates structured form for project requirements
  - inputs: Project name, Type, Pages, Color scheme, Features, Target stack, Notes
  - outputs: Project request summary, ZIP download

## Flows

### Project creation
_Trigger:_ /start or /create

1. Display main menu
2. Collect project requirements via form
3. Show confirmation summary
4. Generate project files
5. Deliver ZIP with instructions

_Data touched:_ Project request, Generated project

### Project tweak
_Trigger:_ Regenerate request

1. Prompt for changes
2. Update project request
3. Generate new ZIP
4. Deliver updated files

_Data touched:_ Project request, Generated project

## Data entities

Durable data (must survive a restart) uses the toolkit's persistent store, never in-memory maps.

- **Project request** _(retention: persistent)_ — User-provided project requirements
  - fields: type, pages, colors, features, name, target_stack, notes
- **Generated project** _(retention: temporary)_ — Output files and metadata
  - fields: file_tree, package_manifest, README, generation_time
- **User profile** _(retention: persistent)_ — Telegram ID and optional preferences
  - fields: telegram_id, preferred_stack, color_theme

## Integrations

- **Telegram** (required) — Bot API messaging and file delivery
- **Admin notification** (optional) — Optional failure alerts
Call external APIs against their real contract (correct endpoints, ids, params); credentials from env. Do not fake responses.

## Owner controls

- Configure admin notification channel
- Set rate limits per user
- Adjust file retention period

## Notifications

- Deliver ZIP to user chat
- Send admin alert on generation failures or large jobs

## Permissions & privacy

- Store user preferences with explicit consent
- Delete generated files after delivery period
- Rate-limit requests to prevent abuse

## Edge cases

- Large ZIP file size exceeding Telegram limits
- Invalid input combinations in form
- Rate limit exceeded scenarios
- Failed generation due to system errors

## Required tests

- End-to-end static site generation flow
- Regenerate workflow with modified parameters
- Rate limiting enforcement test

## Assumptions

- Default delivery method is ZIP in chat
- Default stacks include Node/Express and Python/Flask
- Storage retention period is 24 hours
