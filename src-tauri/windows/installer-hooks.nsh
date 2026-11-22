; Muster NSIS installer hooks (bundle.windows.nsis.installerHooks in tauri.conf.json).
;
; Windows keeps showing a cached icon for the same exe path after an update, so a new
; app icon would only appear after the icon cache happened to expire. After every
; install or in-app update, tell the shell that icons changed so the taskbar, Start
; menu and desktop shortcut pick up the current icon.

!macro NSIS_HOOK_POSTINSTALL
  ; SHCNE_ASSOCCHANGED (0x08000000), SHCNF_IDLIST (0): refresh shell icons.
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
  ; Per-user icon cache refresh (Windows 10/11). Hidden and best-effort: a missing
  ; tool or a failure must never fail the install.
  IfFileExists "$SYSDIR\ie4uinit.exe" 0 +2
    nsExec::Exec '"$SYSDIR\ie4uinit.exe" -show'
!macroend
