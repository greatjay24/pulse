# Pulse Roadmap

This file tracks planned improvements. When starting a new Claude session, reference this file to continue work.

---

## In Progress

### Widget Picker Inline Configuration
**Status:** Planned
**Priority:** High
**Goal:** Let users configure integrations directly when adding widgets instead of redirecting to Settings.

**Files to create:**
- `src/hooks/useGoogleOAuth.ts` - Extract OAuth logic from Settings.tsx
- `src/components/IntegrationConfigForm.tsx` - Form for API key/credential input
- `src/components/ProjectCredentialsGrid.tsx` - Multi-project setup grid for Overview page

**Files to modify:**
- `src/components/WidgetPicker.tsx` - Add step-based flow (select → configure → done)
- `src/App.tsx` - Pass new props, remove redirect logic

**Implementation notes:**
- Step 1 (select): Current grid, but clicking "needs integration" goes to Step 2
- Step 2 (configure): Shows IntegrationConfigForm or ProjectCredentialsGrid based on context
- On submit: Update settings via callback, add widget, close modal
- OAuth should work inline using the extracted hook

---

## Planned

### Onboarding Flow
**Status:** Not started
**Priority:** Medium
**Goal:** Guide new users through first-time setup.

**Implementation:**
- Create `src/components/Onboarding.tsx` modal wizard
- Add `hasCompletedOnboarding: boolean` to Settings type in `src/types/index.ts`
- Steps: Welcome → Create project → Connect first integration → Done
- Show automatically when `settings.apps.length === 0` and `!hasCompletedOnboarding`

---

### Keyboard Shortcuts
**Status:** Not started
**Priority:** Low
**Goal:** Quick navigation without mouse.

**Implementation:**
- Add `useEffect` with `keydown` listener in `App.tsx`
- Shortcuts:
  - `Cmd/Ctrl + 1` → Overview
  - `Cmd/Ctrl + 2-9` → Project by index
  - `Cmd/Ctrl + ,` → Settings
  - `Cmd/Ctrl + N` → New project
  - `Cmd/Ctrl + E` → Toggle edit layout mode
  - `Cmd/Ctrl + ?` → Show shortcuts modal

---

### Data Refresh Controls
**Status:** Not started
**Priority:** Medium
**Goal:** Manual refresh and auto-refresh for widgets.

**Implementation:**
- Add refresh icon button to widget headers in `DashboardGrid.tsx`
- Add `lastRefreshed: Date` state per widget
- Show "Updated X minutes ago" tooltip
- Optional: Add `refreshInterval` setting (off, 1min, 5min, 15min)

---

### Loading & Error States
**Status:** Not started
**Priority:** Medium
**Goal:** Better feedback during data fetching.

**Implementation:**
- Create `src/components/WidgetSkeleton.tsx` with animated placeholders
- Add `isLoading`, `error`, `retry()` props to widget components
- Show skeleton during initial load
- Show error message + retry button on failure
- Consider `react-error-boundary` for catching render errors

---

### Code Splitting
**Status:** Not started
**Priority:** Low
**Goal:** Reduce initial bundle size (currently 929KB).

**Implementation:**
- Use `React.lazy()` for page components:
  ```tsx
  const Settings = lazy(() => import('./pages/Settings'));
  ```
- Wrap lazy components in `<Suspense fallback={<Loading />}>`
- Consider splitting heavy dependencies (charts, etc.)

---

## Completed

- [x] Resizable/draggable dashboard grid with react-grid-layout
- [x] Edit Layout mode with save/cancel
- [x] Add Widget card in grid
- [x] GitHub Actions release workflow for DMG/MSI/AppImage builds
- [x] Environment variables for OAuth credentials (not hardcoded)
- [x] Terminal setup script with auto-launch prompt (`scripts/setup.sh`)
- [x] Auto-launch Settings toggle (Settings > Appearance)

---

## Quick Start for New Sessions

```bash
# Start the dev server
npm run tauri dev

# Build for production (test before pushing)
npm run build

# Create a release (after pushing to main)
git tag v0.x.x && git push origin v0.x.x
```

To work on a feature, tell Claude: "Let's implement [feature name] from ROADMAP.md"
