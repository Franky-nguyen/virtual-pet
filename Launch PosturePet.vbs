' Launch PosturePet.vbs
'
' Dynamically resolve the folder this script lives in, set it as the working
' directory, then run start.bat from there.  This fixes the Windows system-
' directory working-directory problem that caused the pet widget to open at
' (0,0) instead of snapping to the bottom-right corner above the taskbar.
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)

Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = scriptDir

' Run start.bat silently (window style 0) and asynchronously (wait 0).
WshShell.Run Chr(34) & scriptDir & "\start.bat" & Chr(34), 0, False

Set WshShell = Nothing
Set fso = Nothing
