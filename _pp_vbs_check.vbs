' Launch PosturePet.vbs - Windows one-click launcher (syntax-check stub)
' Double-click this file to start PosturePet. On a fresh machine it first
' inspects the environment and installs whatever is missing (Node modules via
' npm, Python packages via pip) - handled by start.bat - then launches the app.

Option Explicit

Dim shell, fso, scriptDir, batPath
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

' The launcher lives in the project root; start.bat sits right next to it.
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
batPath = fso.BuildPath(scriptDir, "start.bat")

If Not fso.FileExists(batPath) Then
  MsgBox "start.bat was not found next to this launcher." & vbCrLf & _
         batPath, vbCritical, "PosturePet - missing start.bat"
  WScript.Quit 1
End If

' Run start.bat from the project directory.
' Window style: 1 = normal (shows install progress), 7 = minimized,
'               0 = hidden. Third argument True = wait for it to finish.
shell.CurrentDirectory = scriptDir
WScript.Echo "syntax-ok"
