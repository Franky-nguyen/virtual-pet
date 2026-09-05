# Current Status

- `electron/main.ts` has IPC `load-save`/`write-save` handlers that were missing at launch. Both validate save data shape with `isValidSave` before read/write.
- Security patches applied: write-save is schema-validated before persisting; load-save is schema-validated before deserialising; `killBackgroundProcesses` scoped to tracked PIDs (no more `taskkill /IM python.exe`); `second-instance` guarded with `isDestroyed()`.
- The 150ms `setTimeout` delay before `force-taskbar-ui` on "Minimize to Tray" click is intentional and must not be removed — removing it causes a race where the animation disappears. See `electron/main.ts:536-540`.
