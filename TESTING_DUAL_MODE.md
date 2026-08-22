# Dual-Mode UI Testing Checklist

## Pre-Test Setup

```bash
# Terminal 1: Start Python detector
python detector.py

# Terminal 2: Start Electron app
npm run electron:dev
```

## Test Cases

### ✅ Dashboard Mode Startup

- [ ] App launches in dashboard mode (380x650px)
- [ ] Window is centered on screen
- [ ] Gradient background visible (purple → pink)
- [ ] Header shows "PosturePet" text
- [ ] Two buttons in header: 🔽 (minimize) and ✕ (close)
- [ ] Pomodoro timer visible
- [ ] Pet display with XP bar visible
- [ ] Calibrate button visible
- [ ] Status text visible
- [ ] Window is draggable

### ✅ Switch to Taskbar Mode

- [ ] Click 🔽 button in header
- [ ] Window smoothly resizes to 150x150px
- [ ] Window moves to bottom-right corner (16px padding)
- [ ] Background becomes transparent
- [ ] Only pet emoji visible (large, 7xl size)
- [ ] 🔼 expand button visible in top-right
- [ ] Timer, XP bar, calibrate button all hidden
- [ ] Pet animation still working
- [ ] Window is draggable

### ✅ Taskbar Mode Functionality

- [ ] Pet emoji changes based on posture status:
  - Good posture → 🦊 (bouncing)
  - Slouching → 😰 (shaking)
  - Away → 😴 (sleeping with Zzz)
- [ ] Glow ring changes color based on status
- [ ] Widget stays in bottom-right corner when dragged elsewhere
- [ ] 🔼 button remains clickable

### ✅ Switch Back to Dashboard

- [ ] Click 🔼 button
- [ ] Window resizes to 380x650px
- [ ] Window repositions to center of screen
- [ ] All UI elements reappear:
  - Timer
  - XP bar (shows accumulated changes)
  - Level badge
  - Calibrate button
  - Status text
- [ ] Gradient background returns
- [ ] Pet size returns to normal (5xl)

### ✅ Posture Detection During Mode Switch

- [ ] Start in dashboard with good posture
- [ ] Note current XP value
- [ ] Switch to taskbar mode
- [ ] Slouch for 10 seconds
- [ ] Pet emoji changes to 😰
- [ ] Switch back to dashboard
- [ ] XP bar shows decrease (loss during taskbar mode)

### ✅ Timer Continues in Background

- [ ] Start Pomodoro timer in dashboard
- [ ] Switch to taskbar mode
- [ ] Wait 1 minute
- [ ] Switch back to dashboard
- [ ] Timer shows 1 minute elapsed

### ✅ Level-Up During Taskbar Mode

- [ ] Set XP to 95 (or high value near 100)
- [ ] Switch to taskbar mode
- [ ] Maintain good posture until level-up
- [ ] Pet should briefly show ✅ emoji
- [ ] Switch back to dashboard
- [ ] Level badge shows increased level
- [ ] XP bar reset to low value

### ✅ Calibration in Both Modes

**Dashboard:**
- [ ] Click "🎯 Calibrate Posture" button
- [ ] Pet changes to 🧘 (meditation pose)
- [ ] Button text changes to "⏳ Calibrating… hold still!"
- [ ] After ~3 seconds, pet shows ✅
- [ ] Status updates to "Calibration saved! 🎉"

**Taskbar:**
- [ ] (Calibration button not visible in taskbar mode)
- [ ] Switch to dashboard to calibrate

### ✅ Window Behavior

- [ ] Window stays always-on-top in both modes
- [ ] Window is transparent in both modes
- [ ] Window doesn't appear in taskbar/dock
- [ ] Window can be dragged in both modes
- [ ] Buttons have no-drag region (clickable without moving window)

### ✅ Edge Cases

- [ ] Switch modes rapidly (5+ times) → no crashes
- [ ] Switch modes while timer is at 0:00 → timer continues
- [ ] Switch modes during calibration → calibration continues
- [ ] Close window during calibration → app exits cleanly
- [ ] Multi-monitor setup: taskbar mode positions on primary display

### ✅ Visual Quality

**Dashboard:**
- [ ] Smooth rounded corners (3xl)
- [ ] Gradient background not pixelated
- [ ] Text is crisp and readable
- [ ] XP bar animates smoothly
- [ ] Pet animations play correctly

**Taskbar:**
- [ ] Pet emoji is large and clear
- [ ] Glow ring is visible and smooth
- [ ] No background artifacts
- [ ] Expand button is visible but not intrusive

### ✅ Performance

- [ ] Mode switching is instant (<100ms)
- [ ] No frame drops during animation
- [ ] No memory leaks after multiple switches
- [ ] CPU usage remains low (~5-10%)

### ✅ Accessibility

- [ ] All buttons have hover states
- [ ] Button tooltips show on hover
- [ ] Emoji are large enough to see clearly
- [ ] Color contrast sufficient for text

## Known Issues / Expected Behavior

- ✅ Mode preference not saved between sessions (resets to dashboard)
- ✅ Taskbar mode always positions bottom-right (not configurable yet)
- ✅ No animation during mode switch (instant resize/reposition)
- ✅ XP continues accumulating in taskbar mode (not visible until expand)

## Bug Report Template

If you find issues:

```
**Bug**: [Brief description]
**Steps to Reproduce**:
1. 
2. 
3. 

**Expected**: [What should happen]
**Actual**: [What actually happened]
**Mode**: Dashboard / Taskbar
**OS**: Windows / Mac / Linux
**Screenshot**: [If applicable]
```

## Success Criteria

All checkboxes above should be ✅ for dual-mode feature to be considered complete and stable.
