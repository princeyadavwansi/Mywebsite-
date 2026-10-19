# ShadowChat — Matrix messaging starter

This source lives in a subfolder so it does not overwrite the existing website at the repository root.

## Current features
- Matrix account sign-in
- Matrix Rust crypto initialization through matrix-js-sdk
- Private room creation with Matrix Megolm encryption state
- Invite contacts by Matrix ID
- Text messaging

## Run locally
Requires Node.js 20+.
1. Open this folder in a terminal.
2. Run npm install
3. Run npm run dev
4. Open the local URL Vite prints.

## Deploy on GitHub Pages
The workflow in .github/workflows/deploy-shadowchat.yml builds this folder and publishes the existing root index plus the app at /Mywebsite-/shadowchat/. In GitHub, open Settings > Pages and select GitHub Actions as the build/deployment source. The workflow may need to be run again after enabling Pages.

## Security notes
This is a starter, not a security-audited or hack-proof messenger. It uses the Matrix SDK rather than custom cryptography. Do not use it for highly sensitive communication until the device verification flow, recovery-key backup, secure session revocation, production security headers, and a full security review are completed.

Use a homeserver you trust. The default is the public matrix.org server. A public repository exposes the app source, not message plaintext by itself; never put passwords, access tokens, or recovery keys in the repo. Matrix encryption does not hide all metadata such as IP address, timing, room membership, or server usage, and cannot protect a compromised endpoint or screenshots.
