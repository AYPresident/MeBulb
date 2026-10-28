MeBulb - portable app for Windows (64-bit)
"Not the brightest, but it gets the job done."

Running it
  1. Unzip this folder anywhere you can write to: your Documents, the Desktop or a USB stick.
     No installer, no admin rights.
  2. Double-click MeBulb.exe. Pin it to the taskbar if you like.
  3. To open PDFs with it from Explorer: right-click a PDF > Open with > Choose another app >
     More apps > Look for another app on this PC > pick MeBulb.exe.

The first launch may show "Windows protected your PC" (SmartScreen) because the program is
not code-signed yet. Click "More info" > "Run anyway". IT can remove this for everyone by
signing MeBulb.exe with the company's code-signing certificate, or by allowing it in
AppLocker / Intune if those block unsigned programs.

Your settings, recent files, the font list cache and crash-recovery copies are kept in
%APPDATA%\MeBulb (per user, not in the shared drive).

Live sessions (working on the same PDF at the same time)
  - Everyone opens the PDF from the Egnyte drive (Desktop App).
  - Tools > Start or join live session (or accept the prompt when someone is already in).
  - Changes travel as small files in a hidden ".mebulb" folder beside the PDF. Egnyte syncs
    it like any other folder, so expect a few seconds' delay. Do not delete it while a
    session is running; MeBulb tidies it up itself after the PDF is saved.
  - If you lose connection, keep working. Your changes wait in the Egnyte cache on your PC
    and go out when it reconnects.
  - Anyone can Save; the save contains everyone's markups.

Big drawings
  PDFs over 48 MB (change in Edit > Preferences) are read on demand instead of loaded whole,
  and saving appends only the changes to the end of the file, so a 400 MB set saves in
  about a second. Page edits (rotate, insert, delete), PDF text edits, OCR and form filling
  still rewrite the whole file.

Keyboard shortcuts follow Bluebeam Revu where the same command exists. Change them in
Window > Keyboard shortcuts. Two differences on purpose:
  Ctrl+Shift+V  pastes copied properties (Revu: Paste in Place, here Ctrl+Shift+Alt+V)
  Alt+Z         fits a text box to its text

Third-party software: Electron and Chromium (licenses in LICENSES.chromium.html and
LICENSE), pdf.js (Apache 2.0, resources\app\web\pdfjs\LICENSE), pdf-lib (MIT,
resources\app\web\vendor\pdf-lib-LICENSE.md).
