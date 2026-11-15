' PosturePet 2.0 (Tauri) launcher
' - Rebuilds automatically whenever sources or icons are newer than the release EXE.
' - Always launches the release executable produced by `tauri build`.
Option Explicit

Dim shell, fso, root, releaseExe, launchExe, logPath, buildExitCode, needBuild
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

root = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = root
logPath = root & "\tauri-build.log"

releaseExe = root & "\src-tauri\target\release\posture-pet.exe"

launchExe = releaseExe
needBuild = (Not fso.FileExists(launchExe)) Or SourcesNewerThan(launchExe)

' If the app is already running and up to date, let Tauri's single-instance handler
' bring the existing process forward. If a rebuild is needed, close the stale instance
' cleanly before recompiling so the EXE is unlocked.
If IsPosturePetRunning() Then
    If Not needBuild Then
        If fso.FileExists(launchExe) Then shell.Run """" & launchExe & """", 1, False
        WScript.Quit 0
    End If
    shell.Run "cmd /c taskkill /F /IM posture-pet.exe /IM detector.exe >nul 2>&1", 0, True
    WScript.Sleep 600
End If

' Rebuild whenever the release binary is missing or any source/icon/config is newer.
If needBuild Then
    If shell.Run("cmd /c where cargo >nul 2>&1", 0, True) <> 0 Then
        MsgBox "PosturePet has not been compiled yet and Rust (cargo) was not found." & vbCrLf & vbCrLf & _
               "Install Rust from https://rustup.rs and the Microsoft C++ Build Tools, then run: npm run tauri:build", _
               vbExclamation, "PosturePet 2.0"
        WScript.Quit 1
    End If
    ' A hidden build has no console; output is kept for troubleshooting.
    ' The launcher only needs the portable EXE. Skip NSIS bundling here so a
    ' locked installer file cannot make an otherwise successful app build fail.
    buildExitCode = shell.Run("cmd /d /c cd /d """ & root & """ && call npx tauri build --no-bundle >> """ & logPath & """ 2>&1", 0, True)
    ' npx/cargo can return a nonzero wrapper status after the release EXE has
    ' already been produced. Trust the artifact, not that wrapper status.
    If buildExitCode <> 0 And Not fso.FileExists(launchExe) Then
        MsgBox "PosturePet could not be rebuilt. See tauri-build.log for details.", vbCritical, "PosturePet 2.0"
        WScript.Quit 1
    End If
End If

' Launch the release binary after any required rebuild. Window style 1 is
' normal and non-blocking; the VBS launcher itself exits immediately.
If Not fso.FileExists(launchExe) Then
    MsgBox "The PosturePet release executable was not produced.", vbCritical, "PosturePet 2.0"
    WScript.Quit 1
End If
shell.Run """" & launchExe & """", 1, False

' ── Helpers ──────────────────────────────────────────────────────────────────

' True when any build input is newer than the given binary.
Function SourcesNewerThan(exePath)
    Dim baseline, watched, i
    SourcesNewerThan = False
    If Not fso.FileExists(exePath) Then Exit Function

    baseline = fso.GetFile(exePath).DateLastModified

    If LatestUnder(root & "\src") > baseline Then SourcesNewerThan = True : Exit Function
    If LatestUnder(root & "\src-tauri\src") > baseline Then SourcesNewerThan = True : Exit Function
    If LatestUnder(root & "\src-tauri\icons") > baseline Then SourcesNewerThan = True : Exit Function
    If LatestUnder(root & "\public") > baseline Then SourcesNewerThan = True : Exit Function

    watched = Array("package.json", "index.html", "vite.config.ts", _
                    "tailwind.config.js", "tsconfig.json", _
                    "src-tauri\tauri.conf.json", "src-tauri\Cargo.toml", "src-tauri\build.rs")
    For i = 0 To UBound(watched)
        If FileNewer(root & "\" & watched(i), baseline) Then
            SourcesNewerThan = True
            Exit Function
        End If
    Next
End Function

' Most recent DateLastModified in a folder tree (0 when the folder is absent).
Function LatestUnder(folderPath)
    Dim folder, file, subFolder, latest, subLatest
    latest = 0
    LatestUnder = 0
    If Not fso.FolderExists(folderPath) Then Exit Function

    On Error Resume Next
    Set folder = fso.GetFolder(folderPath)
    If Err.Number <> 0 Then
        Err.Clear
        Exit Function
    End If
    For Each file In folder.Files
        If file.DateLastModified > latest Then latest = file.DateLastModified
    Next
    For Each subFolder In folder.SubFolders
        ' Build output is never a source input.
        If LCase(subFolder.Name) <> "node_modules" And LCase(subFolder.Name) <> "target" Then
            subLatest = LatestUnder(subFolder.Path)
            If subLatest > latest Then latest = subLatest
        End If
    Next
    On Error GoTo 0
    LatestUnder = latest
End Function

Function FileNewer(filePath, baseline)
    FileNewer = False
    If fso.FileExists(filePath) Then
        If fso.GetFile(filePath).DateLastModified > baseline Then FileNewer = True
    End If
End Function

' Return True when a PosturePet process is already active. WMI avoids creating
' a console window and is safe to fail closed if the query is unavailable.
Function IsPosturePetRunning()
    Dim wmi, processes
    IsPosturePetRunning = False
    On Error Resume Next
    Set wmi = GetObject("winmgmts:\\.\root\cimv2")
    Set processes = wmi.ExecQuery("SELECT ProcessId FROM Win32_Process WHERE Name='posture-pet.exe'")
    If Err.Number = 0 Then IsPosturePetRunning = (processes.Count > 0)
    Err.Clear
    On Error GoTo 0
End Function

