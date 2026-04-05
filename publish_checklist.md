Store publishing checklist

- [ ] Confirm `manifest.json` fields: `name`, `description`, `version`, `manifest_version: 3`.
- [ ] Verify `host_permissions` includes `https://myslt.slt.lk/*`.
- [ ] Confirm `icons/` contains 16, 48, 128 px images.
- [ ] Prepare 2–4 screenshots (desktop/mobile) showing the popup UI.
- [ ] Prepare a short (80 chars) and long description for the store listing.
- [ ] Prepare a privacy policy URL or paste the text from `privacy_policy.md` into the store.
- [ ] Create `slt-extension.zip` using `package-extension.ps1`.
- [ ] Upload zip to Chrome Web Store / Microsoft Partner Center.
- [ ] Provide contact email and website in store dashboard.
- [ ] Add release notes when publishing.
- [ ] Test the published extension (install from store) before wide release.

Optional:
- Offer a settings page UI to allow users to change notification thresholds.
- Add analytics only if you clearly disclose it in privacy policy (not recommended).
