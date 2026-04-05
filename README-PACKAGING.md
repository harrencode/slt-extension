Packaging and publishing - SLT Usage extension

Quick package (Windows PowerShell):

1. Increment the `version` in `manifest.json`.
2. Run the helper script to create `slt-extension.zip`:

```powershell
cd G:\slt-extension
.\package-extension.ps1
```

Alternative (cross-platform zip):

```bash
# from inside the extension folder
zip -r slt-extension.zip . -x ".git/*" "node_modules/*" "*.zip"
```

Test locally (Chrome / Edge):
- Open `chrome://extensions` (or `edge://extensions`).
- Enable "Developer mode" and click "Load unpacked". Select the `G:\slt-extension` folder.
- Verify the popup displays `--` then real values after a successful scrape and that notifications appear.

Publishing checklist:
- Ensure `manifest.json` has `manifest_version: 3` and the correct `name`, `description`, and `version`.
- Provide icons: 16x16, 48x48, 128x128. At minimum include `icons/128.png`.
- Add a `privacy_policy` page URL in the store listing (we provide a template: `privacy_policy.md`).
- Prepare screenshots (1280x800 recommended) and a short/long description for the store.
- Create `slt-extension.zip` and upload to:
  - Chrome Web Store Developer Dashboard (zip upload)
  - Microsoft Partner Center (Edge Add-ons) (zip upload)

Store submission notes:
- The extension only scrapes pages locally within the user's browser and stores data in `chrome.storage.local`; it does not transmit personal data to external servers. Add this to your privacy policy and store listing.
- If the store asks for a contact email or website, provide one you control.
- Follow each store's publisher verification steps (merchant account, payment if required).

Post-publish:
- Increment `version` and re-run the packaging script for new releases.
- Keep a changelog and release notes to paste into the store release UI.
