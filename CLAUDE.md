# Pulse - Project Instructions for Claude

## Engineering Approach

**Diagnose before prescribing.** Before making ANY code changes:

1. **Understand the system** - Read relevant files to understand how components interact
2. **Trace the full chain** - For layout/CSS issues, trace from root styles (`index.css`) through the component hierarchy. For data flow, trace from source to display.
3. **Identify the root cause** - Don't treat symptoms; find the actual constraint or logic violation
4. **Explain the "why"** - If you can't explain why a fix works, you don't understand it yet
5. **Make minimal, surgical fixes** - One targeted change that addresses the root cause, not multiple speculative changes

This applies to ALL work: bug fixes, new features, refactors, UI changes.

**No trial-and-error.** Whether CSS, logic, or architecture — understand the system first, then make precise changes.

## Quality Standards

- **No placeholder/stock data** - All statistics, metrics, and displays must be dynamic and real
- **Every button must work** - No non-functional UI elements. If it exists, it does something.
- **No dead code paths** - Remove unused components/routes rather than leaving them broken

## Project Architecture

- **Tauri v2** desktop app with React frontend and Rust backend
- **Tauri v2 detection**: Use `window.__TAURI_INTERNALS__` (not `__TAURI__`)
- **Layout model**: `body { overflow: hidden }` with `height: 100vh` wrapper; `<main>` handles page scrolling via `overflow: auto`
- **Styling**: Inline styles with theme tokens from `ThemeContext`, plus base styles in `index.css`

## Key Files

- `src/index.css` - Root CSS constraints (body overflow, scrollbar styles)
- `src/App.tsx` - Main layout wrapper, routing between pages
- `src/contexts/ThemeContext.tsx` - Theme tokens and fonts
- `src/types/index.ts` - TypeScript interfaces for all data models
- `src-tauri/src/lib.rs` - Rust backend commands (API calls, file I/O)

## Common Patterns

**Adding a new page**: Render conditionally in `App.tsx` based on `activeNav` state, inside the `<main>` element.

**Adding integrations**: Update `IntegrationType` in `types/index.ts`, add API logic in `lib.rs`, update Settings UI.

**Per-project config**: Store on the `App` interface (e.g., `googleCalendar?: GoogleCalendarConfig`).
