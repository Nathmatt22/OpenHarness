# OpenHarness installer customization (assisted NSIS installer).
# The header bitmap (installerHeader.bmp) is wired automatically by electron-builder
# from the build resources, so nothing needs to be defined here.

!macro customHeader
  !ifndef MUI_HEADERIMAGE
    !define MUI_HEADERIMAGE
    !define MUI_HEADERIMAGE_BITMAP "${BUILD_RESOURCES_DIR}\installerHeader.bmp"
    !define MUI_HEADERIMAGE_RIGHT
  !endif
!macroend
