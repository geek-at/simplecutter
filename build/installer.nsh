; Custom NSIS hooks for electron-builder.
; Adds an "Edit with DTA Cutter" verb to the Explorer context menu of video files
; (SystemFileAssociations → does not change the default "Open" handler).
; SHCTX = HKCU for per-user installs, HKLM for per-machine installs.

!macro RegisterVideoVerb EXT
  WriteRegStr SHCTX "Software\Classes\SystemFileAssociations\${EXT}\shell\DTACutter" "" "Edit with DTA Cutter"
  WriteRegStr SHCTX "Software\Classes\SystemFileAssociations\${EXT}\shell\DTACutter" "Icon" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}",0'
  WriteRegStr SHCTX "Software\Classes\SystemFileAssociations\${EXT}\shell\DTACutter\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
!macroend

!macro UnregisterVideoVerb EXT
  DeleteRegKey SHCTX "Software\Classes\SystemFileAssociations\${EXT}\shell\DTACutter"
!macroend

!macro customInstall
  !insertmacro RegisterVideoVerb ".mp4"
  !insertmacro RegisterVideoVerb ".mkv"
  !insertmacro RegisterVideoVerb ".mov"
  !insertmacro RegisterVideoVerb ".webm"
  !insertmacro RegisterVideoVerb ".avi"
  !insertmacro RegisterVideoVerb ".m4v"
  ; Tell Explorer the association set changed so the menu shows up immediately
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro customUnInstall
  !insertmacro UnregisterVideoVerb ".mp4"
  !insertmacro UnregisterVideoVerb ".mkv"
  !insertmacro UnregisterVideoVerb ".mov"
  !insertmacro UnregisterVideoVerb ".webm"
  !insertmacro UnregisterVideoVerb ".avi"
  !insertmacro UnregisterVideoVerb ".m4v"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
